const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { StagenetBrowser } = require('./stagenet-browser.cjs');
const { vaultRevision } = require('./vault-revision.cjs');

let stage = 'launch';

async function waitForProgress(page, minimum) {
  await page.waitForFunction(
    (height) =>
      Number(document.body.dataset.height) >= height && document.body.dataset.sync === 'syncing',
    minimum,
    { timeout: 180_000 },
  );
  return Number(await page.locator('body').getAttribute('data-height'));
}

async function interruptedScan(wallet, uri) {
  const page = wallet.page;
  await page.goto(uri);
  const initial = await page.evaluate(async () =>
    (await import('./lifecycle-probe.js')).beginOldScan(),
  );
  const interruptedHeight = await waitForProgress(page, 10_000);
  await page.reload();
  const reopened = await page.evaluate(async () =>
    (await import('./lifecycle-probe.js')).openCheckpoint(),
  );
  assert.equal(reopened.address, initial.address);
  assert.ok(reopened.height <= interruptedHeight);
  const abort = (route) => route.abort('failed');
  const rpc = 'http://127.0.0.1:38081/**';
  await wallet.context.route(rpc, abort);
  try {
    await page.evaluate(async () => (await import('./lifecycle-probe.js')).restartScan());
    await page.waitForFunction(() => document.body.dataset.sync === 'failed', undefined, {
      timeout: 45_000,
    });
  } finally {
    await wallet.context.unroute(rpc, abort);
  }
  await page.evaluate(async () => (await import('./lifecycle-probe.js')).restartScan());
  await waitForProgress(page, Math.max(reopened.height, 10_000) + 10_000);
  const saved = await page.evaluate(async () =>
    (await import('./lifecycle-probe.js')).checkpoint(),
  );
  assert.ok(saved.height >= 20_000 && saved.encryptedBytes > 0);
  await page.reload();
  const recovered = await page.evaluate(async () =>
    (await import('./lifecycle-probe.js')).openCheckpoint(),
  );
  assert.equal(recovered.address, initial.address);
  assert.equal(recovered.height, saved.height);
  return { interruptedHeight, recoveredHeight: recovered.height };
}

async function idleAndResume(wallet, walletUri) {
  const page = wallet.page;
  await page.clock.install();
  await page.goto(walletUri);
  await wallet.unlock();
  await page.clock.fastForward(5 * 60_000 + 1000);
  await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor();
  assert.equal(page.workers().length, 0);
  await wallet.unlock();
  const resumedTime = await page.evaluate(() => Date.now() + 6 * 60_000);
  await page.clock.setSystemTime(resumedTime);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor();
  assert.equal(page.workers().length, 0);
  await wallet.unlock();
}

async function backgroundFatal(wallet) {
  const page = wallet.page;
  await page.clock.resume();
  const before = await vaultRevision(page);
  const worker = page.workers().find((entry) => entry.url().endsWith('/engine.worker.js'));
  assert.ok(worker);
  await worker.evaluate(async () => {
    const { LibraryUtils } = await import('/vendor/wallet-engine-client.js');
    LibraryUtils.getWasmModule().sync = () => {
      throw new WebAssembly.RuntimeError('Disposable background scan failure.');
    };
  });
  await page.getByRole('button', { name: 'Synchronize', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(page.workers().length, 0);
  assert.equal(await vaultRevision(page), before);
  await wallet.unlock();
}

async function main() {
  process.umask(0o077);
  const root = await fs.mkdtemp(path.join(__dirname, 'run-lifecycle-'));
  let wallet;
  try {
    wallet = await StagenetBrowser.open({
      playwright: process.argv[2],
      executablePath: process.argv[3],
      root,
      extension: path.join(__dirname, 'extension'),
    });
    const walletUri = wallet.page.url();
    stage = 'interrupted-scan';
    const recovery = await interruptedScan(wallet, new URL('lifecycle-probe.html', walletUri).href);
    stage = 'idle-and-resume';
    await idleAndResume(wallet, walletUri);
    stage = 'background-fatal';
    await backgroundFatal(wallet);
    console.log(
      JSON.stringify({
        ...recovery,
        interruptedScanRecovered: true,
        nodeFailureRecovered: true,
        idleTerminatesWorkers: true,
        elapsedResumeTerminatesWorkers: true,
        backgroundFatalLocks: true,
        fatalCheckpointPreserved: true,
      }),
    );
  } finally {
    await wallet?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error(JSON.stringify({ failed: true, stage }));
  process.exitCode = 1;
});
