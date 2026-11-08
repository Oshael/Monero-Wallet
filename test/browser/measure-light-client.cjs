const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { StagenetBrowser } = require('./stagenet-browser.cjs');
const { ClientMetrics } = require('./client-metrics.cjs');
const { RpcTraffic } = require('./rpc-traffic.cjs');

const node = 'http://127.0.0.1:38081';
const scanner = 'http://127.0.0.1:38084';
let stage = 'launch';

async function measure(backup) {
  const root = await fs.mkdtemp(path.join(__dirname, 'run-light-client-'));
  let wallet;
  let metrics;
  let traffic;
  let chainRequests = 0;
  const inspectRequest = (request) => {
    if (
      ['/get_blocks.bin', '/get_hashes.bin', '/get_blocks_by_height.bin'].includes(
        new URL(request.url()).pathname,
      )
    )
      chainRequests++;
  };
  try {
    wallet = await StagenetBrowser.open({
      playwright: process.argv[2],
      executablePath: process.argv[3],
      root,
      extension: path.join(__dirname, 'extension'),
    });
    metrics = new ClientMetrics(await wallet.context.browser().newBrowserCDPSession());
    wallet.context.on('request', inspectRequest);
    // Record sizes without recording request or response payloads.
    traffic = [new RpcTraffic(wallet.context, node), new RpcTraffic(wallet.context, scanner)];
    const started = performance.now();
    stage = backup ? 'restore-funded-light-backup' : 'create-new-light-wallet';
    if (backup) await wallet.importBackup(backup);
    else await wallet.create();
    const address = await wallet.page.locator('#wallet-address').textContent();
    const before = await wallet.balances();
    stage = 'select-light-service';
    await wallet.connectLight(scanner, node);
    stage = 'light-sync';
    const scanStarted = performance.now();
    await wallet.sync();
    assert.equal(chainRequests, 0);
    const syncMs = Math.round(performance.now() - scanStarted);
    assert.deepEqual(await wallet.balances(), before);
    stage = 'encrypted-light-backup';
    await wallet.backup('measured-light-checkpoint.xmrvault');
    const encryptedBackupBytes = (
      await fs.stat(path.join(root, 'measured-light-checkpoint.xmrvault'))
    ).size;
    stage = 'reopen-light-checkpoint';
    await wallet.page.reload();
    await wallet.unlock();
    assert.equal(await wallet.page.locator('#wallet-address').textContent(), address);
    assert.deepEqual(await wallet.balances(), before);
    const samples = await Promise.all(traffic.map((sample) => sample.finish()));
    console.log(
      JSON.stringify({
        scenario: backup ? 'funded-light-restore' : 'new-light-wallet',
        exactBalancePreserved: true,
        checkpointRecovered: true,
        elapsedMs: Math.round(performance.now() - started),
        syncMs,
        localChainRequests: chainRequests,
        encryptedBackupBytes,
        traffic: samples,
        metrics: await metrics.finish(),
      }),
    );
  } finally {
    wallet?.context.off('request', inspectRequest);
    const cleanup = await Promise.allSettled([
      ...(traffic ?? []).map((sample) => sample.close()),
      metrics?.close(),
    ]);
    try {
      await wallet?.close();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
    if (cleanup.some((result) => result.status === 'rejected'))
      throw new Error('Measurement cleanup failed.');
  }
}

async function main() {
  process.umask(0o077);
  await measure();
  await measure(path.resolve(process.argv[4]));
}

main().catch(() => {
  console.error(JSON.stringify({ failedAt: stage }));
  process.exitCode = 1;
});
