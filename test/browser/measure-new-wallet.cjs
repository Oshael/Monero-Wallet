const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { StagenetBrowser } = require('./stagenet-browser.cjs');
const { ClientMetrics } = require('./client-metrics.cjs');
const { RpcTraffic } = require('./rpc-traffic.cjs');

let stage = 'launch';

function scannedHeight(text) {
  const match = text.match(/Scanned ([0-9]+) \/ [0-9]+/);
  assert.ok(match);
  return Number(match[1]);
}

async function main() {
  process.umask(0o077);
  const uri = 'http://127.0.0.1:38881';
  const root = await fs.mkdtemp(path.join(__dirname, 'run-new-wallet-'));
  let wallet;
  let metrics;
  let traffic;
  const started = performance.now();
  try {
    wallet = await StagenetBrowser.open({
      playwright: process.argv[2],
      executablePath: process.argv[3],
      root,
      extension: path.join(__dirname, 'extension'),
    });
    metrics = new ClientMetrics(await wallet.context.browser().newBrowserCDPSession());
    traffic = new RpcTraffic(wallet.context, uri);
    stage = 'create';
    await wallet.create();
    const address = await wallet.page.locator('#wallet-address').textContent();
    await wallet.connect(uri);
    stage = 'scan';
    await wallet.sync();
    const height = scannedHeight(await wallet.page.locator('#wallet-sync').textContent());
    assert.deepEqual(await wallet.balances(), { total: 0n, unlocked: 0n });
    stage = 'checkpoint';
    await wallet.backup('new-wallet.xmrvault');
    const encryptedBackupBytes = (await fs.stat(path.join(root, 'new-wallet.xmrvault'))).size;
    stage = 'reopen';
    await wallet.page.reload();
    await wallet.unlock();
    assert.equal(await wallet.page.locator('#wallet-address').textContent(), address);
    assert.equal(scannedHeight(await wallet.page.locator('#wallet-sync').textContent()), height);
    assert.deepEqual(await wallet.balances(), { total: 0n, unlocked: 0n });
    console.log(
      JSON.stringify({
        result: {
          newWallet: true,
          checkpointRecovered: true,
          height,
          encryptedBackupBytes,
          elapsedMs: Math.round(performance.now() - started),
        },
        traffic: await traffic.finish(),
        metrics: await metrics.finish(),
      }),
    );
  } finally {
    await traffic?.close();
    await metrics?.close();
    await wallet?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error(JSON.stringify({ failed: true, stage }));
  process.exitCode = 1;
});
