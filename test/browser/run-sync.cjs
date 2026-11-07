const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
const { ClientMetrics } = require('./client-metrics.cjs');
const { withinBudget } = require('./fixture-budget.cjs');

async function main() {
  const minimumHeight = Number(process.argv[4]);
  const restoreHeight = Number(process.argv[5]);
  assert.ok(Number.isSafeInteger(minimumHeight) && minimumHeight > 0);
  assert.ok(
    Number.isSafeInteger(restoreHeight) && restoreHeight >= 0 && restoreHeight <= minimumHeight,
  );
  const run = await fs.mkdtemp(path.join(__dirname, 'run-sync-'));
  const extension = path.join(__dirname, 'extension');
  let context;
  let metrics;
  let activity;
  let reporting;
  let progress;
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
    const traffic = { requests: 0, requestBytes: 0, responseBytes: 0 };
    const pending = new Set();
    let trafficFailed = false;
    context.on('requestfinished', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:38881/')) return;
      const counted = withinBudget(request.sizes(), 'Traffic sampling')
        .then((sizes) => {
          traffic.requests++;
          traffic.requestBytes += sizes.requestBodySize + sizes.requestHeadersSize;
          traffic.responseBytes += sizes.responseBodySize + sizes.responseHeadersSize;
        })
        .catch(() => {
          trafficFailed = true;
        });
      pending.add(counted);
      void counted.finally(() => pending.delete(counted));
    });
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
        trafficFailed = true;
      });
    }, 60_000);
    const result = await page.evaluate(
      async (options) => {
        const { runSyncProbe } = await import('./sync-probe.js');
        return runSyncProbe(options);
      },
      { restoreHeight, minimumHeight, uri: 'http://127.0.0.1:38881' },
    );
    await Promise.all(pending);
    assert.equal(trafficFailed, false);
    assert.equal(result.checkpointRecovered, true);
    console.log(JSON.stringify({ result, traffic, metrics: await metrics.finish() }));
  } finally {
    clearInterval(activity);
    clearInterval(reporting);
    await progress;
    await disposeRun(context, metrics, run);
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
    if (['create', 'restore', 'scan', 'checkpoint', 'unlock', 'complete'].includes(status.phase))
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

async function disposeRun(context, metrics, run) {
  try {
    await metrics?.close();
  } finally {
    try {
      await context?.close();
    } finally {
      await fs.rm(run, { recursive: true, force: true });
    }
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
