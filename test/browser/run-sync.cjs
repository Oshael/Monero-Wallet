const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const { ClientMetrics } = require('./client-metrics.cjs');
const { withinBudget } = require('./fixture-budget.cjs');
const { RpcTraffic } = require('./rpc-traffic.cjs');

async function main() {
  const minimumHeight = Number(process.argv[4]);
  const restoreHeight = Number(process.argv[5]);
  assert.ok(Number.isSafeInteger(minimumHeight) && minimumHeight > 0);
  assert.ok(
    Number.isSafeInteger(restoreHeight) && restoreHeight >= 0 && restoreHeight <= minimumHeight,
  );
  const operation = process.argv[6] ?? 'restore';
  assert.ok(['restore', 'resume'].includes(operation));
  const storage = await prepareProfile({ operation, minimumHeight, restoreHeight });
  const run = storage.root;
  const extension = path.join(__dirname, 'extension');
  let context;
  let metrics;
  let traffic;
  let activityFailed = false;
  let activity;
  let reporting;
  let progress;
  let completed = false;
  let sample;
  const started = performance.now();
  try {
    context = await chromium.launchPersistentContext(path.join(run, 'profile'), {
      executablePath: process.argv[3],
      channel: 'chromium',
      headless: true,
      chromiumSandbox: true,
      timeout: 15_000,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      ],
    });
    metrics = new ClientMetrics(await context.browser().newBrowserCDPSession());
    traffic = new RpcTraffic(context, 'http://127.0.0.1:38881');
    const page = await context.newPage();
    await page.goto('chrome://extensions/');
    const id = await page.locator('extensions-item').getAttribute('id', { timeout: 5000 });
    assert.match(id, /^[a-p]{32}$/);
    await page.goto(`chrome-extension://${id}/sync-probe.html`);
    await page.evaluate(() =>
      document.addEventListener('pointerdown', (event) => {
        if (event.isTrusted)
          document.body.dataset.activity = String(Number(document.body.dataset.activity ?? 0) + 1);
      }),
    );
    reporting = setInterval(() => {
      if (progress) return;
      progress = reportProgress(page).finally(() => {
        progress = undefined;
      });
    }, 30_000);
    activity = setInterval(() => {
      void page.mouse.click(5, 5).catch(() => {
        activityFailed = true;
      });
    }, 60_000);
    const result = await evaluateProbe(page, {
      restoreHeight,
      minimumHeight,
      uri: 'http://127.0.0.1:38881',
      operation,
    });
    assert.equal(activityFailed, false);
    assert.equal(result.checkpointRecovered, true);
    sample = { traffic: await traffic.finish(), metrics: await metrics.finish() };
    console.log(JSON.stringify({ result, ...sample }));
    completed = true;
  } catch (error) {
    sample = await partialMeasurement(traffic, metrics);
    console.error(JSON.stringify({ partialMeasurement: sample }));
    throw error;
  } finally {
    clearInterval(activity);
    clearInterval(reporting);
    await progress;
    await traffic?.close();
    await disposeRun(context, metrics);
    await fs.writeFile(
      storage.record,
      JSON.stringify({
        ...storage.state,
        segments: [
          ...storage.state.segments,
          { elapsedMs: Math.round(performance.now() - started), sample },
        ],
      }),
      { mode: 0o600 },
    );
    if (completed) {
      await fs.rm(run, { recursive: true, force: true });
      await fs.unlink(storage.record);
    }
  }
}

async function prepareProfile(options) {
  const directory = path.join(__dirname, '.local');
  const root = path.join(directory, 'sync-profile');
  const record = path.join(directory, 'incomplete-sync-run.json');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let state = {
    restoreHeight: options.restoreHeight,
    minimumHeight: options.minimumHeight,
    attempts: 0,
    segments: [],
  };
  if (options.operation === 'resume') {
    state = JSON.parse(await fs.readFile(record, 'utf8'));
    assert.equal(state.restoreHeight, options.restoreHeight);
    assert.ok(options.minimumHeight >= state.minimumHeight);
    assert.ok(Number.isSafeInteger(state.attempts) && state.attempts < 6);
    assert.ok(Array.isArray(state.segments) && state.segments.length < 6);
  } else {
    await fs.mkdir(root, { mode: 0o700 });
  }
  state = { ...state, minimumHeight: options.minimumHeight, attempts: state.attempts + 1 };
  await fs.writeFile(record, JSON.stringify(state), { mode: 0o600 });
  return { root, record, state };
}

async function partialMeasurement(traffic, metrics) {
  const [bytes, memory] = await Promise.allSettled([traffic?.finish(), metrics?.finish()]);
  return {
    traffic: bytes.status === 'fulfilled' ? bytes.value : null,
    metrics: memory.status === 'fulfilled' ? memory.value : null,
  };
}

async function evaluateProbe(page, options) {
  try {
    return await page.evaluate(async (options) => {
      const { runSyncProbe, resumeSyncProbe } = await import('./sync-probe.js');
      return options.operation === 'resume' ? resumeSyncProbe(options) : runSyncProbe(options);
    }, options);
  } catch (error) {
    const diagnostic = await withinBudget(
      page.evaluate(() => ({
        phase: document.body.dataset.phase,
        code: document.body.dataset.failure,
        command: document.body.dataset.workerCommand,
      })),
      'Failure sampling',
    ).catch(() => ({ phase: 'unavailable', code: 'unclassified' }));
    console.error(
      JSON.stringify({
        failedPhase: diagnostic.phase,
        code: diagnostic.code,
        command: diagnostic.command,
      }),
    );
    throw error;
  }
}

async function reportProgress(page) {
  try {
    const status = await withinBudget(
      page.evaluate(() => ({
        phase: document.body.dataset.phase,
        height: document.body.dataset.height,
        sync: document.body.dataset.sync,
        activity: document.body.dataset.activity,
      })),
      'Progress sampling',
    );
    if (
      ['create', 'restore', 'open', 'scan', 'stop', 'checkpoint', 'unlock', 'complete'].includes(
        status.phase,
      )
    )
      console.log(
        JSON.stringify({
          phase: status.phase,
          height: Number(status.height ?? 0),
          sync: status.sync,
          trustedActivity: Number(status.activity ?? 0),
        }),
      );
  } catch {
    console.log(JSON.stringify({ phase: 'unavailable' }));
  }
}

async function disposeRun(context, metrics) {
  try {
    await metrics?.close();
  } finally {
    await context?.close();
  }
}

main().catch((error) => {
  const categories = [
    'deadline',
    'locked',
    'Memory',
    'Traffic',
    'synchronization',
    'Synchronization',
    'worker',
    'input',
    'node',
  ].filter((category) => String(error.message).includes(category));
  console.error(JSON.stringify({ failed: true, categories }));
  process.exitCode = 1;
});
