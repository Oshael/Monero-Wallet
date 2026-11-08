const assert = require('node:assert/strict');
const path = require('node:path');
const { StagenetBrowser } = require('./stagenet-browser.cjs');
const { vaultRevision } = require('./vault-revision.cjs');
const { ActiveFixtureUser } = require('./active-fixture-user.cjs');

const root = path.resolve(process.argv[4]);
const options = {
  playwright: process.argv[2],
  executablePath: process.argv[3],
  root,
  extension: path.join(root, 'extension'),
};
let stage = 'open';

async function main() {
  let sender;
  let recipient;
  let senderActivity;
  let recipientActivity;
  try {
    sender = await StagenetBrowser.open(options);
    recipient = await StagenetBrowser.open({ ...options, root: path.join(root, 'recipient') });
    await sender.importBackup(path.join(root, 'legacy-sender.xmrvault'));
    await recipient.importBackup(path.join(root, 'legacy-recipient.xmrvault'));
    senderActivity = new ActiveFixtureUser(sender.page);
    recipientActivity = new ActiveFixtureUser(recipient.page);
    const before = { sender: await sender.balances(), recipient: await recipient.balances() };
    const pending = await sender.pending();
    assert.equal(pending.status, 'confirmed');
    stage = 'select-light-service';
    await sender.connectLight('http://127.0.0.1:38084');
    await recipient.connectLight('http://127.0.0.1:38084');
    stage = 'light-scan';
    await Promise.all([sender.sync(), recipient.sync()]);
    stage = 'preserved-balances';
    assert.deepEqual(await sender.balances(), before.sender);
    assert.deepEqual(await recipient.balances(), before.recipient);
    assert.equal((await sender.pending()).hash, pending.hash);
    stage = 'light-failure-and-lock';
    await assertLightFailures(sender);
    assert.equal((await sender.pending()).status, 'confirmed');
    stage = 'encrypted-light-checkpoint';
    await sender.backup('light-checkpoint.xmrvault');
    await recipient.backup('light-checkpoint.xmrvault');
    await sender.page.reload();
    await sender.unlock();
    await recipient.page.reload();
    await recipient.unlock();
    assert.deepEqual(await sender.balances(), before.sender);
    assert.deepEqual(await recipient.balances(), before.recipient);
    assert.equal((await sender.pending()).hash, pending.hash);
    console.log(
      JSON.stringify({
        explicitScannerSelection: true,
        legacyBalancesPreserved: true,
        confirmedSendPreserved: true,
        encryptedLightCheckpointRecovered: true,
        existingFundedWalletsReused: true,
        scannerFailurePreservesBalances: true,
        nativeFailureLocksWithoutCheckpoint: true,
      }),
    );
  } finally {
    const activity = await Promise.allSettled([
      senderActivity?.close(),
      recipientActivity?.close(),
    ]);
    const browsers = await Promise.allSettled([sender?.close(), recipient?.close()]);
    if ([...activity, ...browsers].some((result) => result.status === 'rejected')) {
      throw new Error('Disposable fixture cleanup failed.');
    }
  }
}

async function assertLightFailures(wallet) {
  await wallet.act('Stop and save scan');
  const before = await wallet.balances();
  const abort = (route) => route.abort('failed');
  const scanner = 'http://127.0.0.1:38084/**';
  await wallet.context.route(scanner, abort);
  try {
    await wallet.act('Synchronize');
    await wallet.page.waitForFunction(() =>
      document.querySelector('#wallet-sync')?.textContent.startsWith('failed'),
    );
    assert.deepEqual(await wallet.balances(), before);
  } finally {
    await wallet.context.unroute(scanner, abort);
  }
  await wallet.sync();
  await wallet.act('Stop and save scan');
  const revision = await vaultRevision(wallet.page);
  const engine = wallet.page.workers().find((worker) => worker.url().endsWith('/engine.worker.js'));
  assert.ok(engine);
  await engine.evaluate(async () => {
    const { LibraryUtils } = await import('/vendor/wallet-engine-client.js');
    LibraryUtils.getWasmModule().import_light_wallet_data = () => {
      throw new WebAssembly.RuntimeError('Disposable light import failure.');
    };
  });
  await wallet.act('Synchronize');
  await wallet.page
    .getByRole('button', { name: 'Unlock', exact: true })
    .waitFor({ timeout: 90_000 });
  assert.equal(wallet.page.workers().length, 0);
  assert.equal(await vaultRevision(wallet.page), revision);
  await wallet.unlock();
  assert.deepEqual(await wallet.balances(), before);
}

main().catch((error) => {
  const diagnostic = ['TimeoutError', 'AssertionError'].includes(error?.name)
    ? error.name
    : 'operation';
  console.error(JSON.stringify({ failedAt: stage, diagnostic }));
  process.exitCode = 1;
});
