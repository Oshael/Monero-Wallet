const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { StagenetBrowser } = require('./stagenet-browser.cjs');
const { LostBroadcastResponse } = require('./lost-broadcast-response.cjs');
const { waitForSettlement } = require('./live-settlement.cjs');

const root = path.resolve(process.argv[4]);
const opening = {
  playwright: process.argv[2],
  executablePath: process.argv[3],
  extension: path.join(root, 'extension'),
  root,
};
let stage = 'launch';

async function openSender() {
  const sender = await StagenetBrowser.open(opening);
  try {
    await sender.unlock();
    return sender;
  } catch (error) {
    await sender.close();
    throw error;
  }
}

async function prepare(sender, address) {
  await sender.page.getByLabel('Stagenet destination address', { exact: true }).fill(address);
  await sender.page.getByLabel('Amount in XMR', { exact: true }).fill('0.1');
  await sender.page.getByLabel('Maximum miner fee in XMR', { exact: true }).fill('0.01');
  // A real block can arrive between the completed scan and preparation. Only
  // this pre-construction freshness rejection permits a bounded rescan/retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    await sender.sync();
    const result = await sender.act(
      'Prepare transaction for review',
      /^(Done\.|Operation failed: synchronization-required\.)$/,
    );
    if (result === 'Done.') return reviewedFee(sender, address);
  }
  throw new Error('Fresh synchronization deadline.');
}

async function reviewedFee(sender, address) {
  assert.equal(await sender.page.locator('#pending-send code').textContent(), address);
  const pending = await sender.pending();
  assert.equal(pending.status, 'prepared');
  assert.equal(pending.amount, 100_000_000_000n);
  assert.ok(pending.fee > 0n && pending.fee <= 10_000_000_000n);
  return pending.fee;
}

async function sign(sender) {
  await sender.act('Approve exact transaction and sign locally');
  const signed = await sender.pending();
  assert.equal(signed.status, 'signed');
  assert.match(signed.hash, /^[0-9a-f]{64}$/);
  await sender.backup('signed-checkpoint.xmrvault');
  return signed.hash;
}

async function uncertainBroadcast(sender) {
  const fault = new LostBroadcastResponse(sender.context);
  await fault.install();
  try {
    await sender.act('Broadcast approved transaction', 'Operation failed: broadcast-unknown.');
    const unknown = await sender.pending();
    assert.equal(unknown.status, 'unknown');
    await sender.page.reload();
    await sender.unlock();
    assert.equal((await sender.pending()).status, 'unknown');
    assert.equal((await sender.pending()).hash, unknown.hash);
    await sender.act(
      'Discard an unbroadcast transaction',
      'Operation failed: invalid-transfer-state.',
    );
    await sender.act(
      'Broadcast approved transaction',
      /^(Done\.|Operation failed: broadcast-unknown\.)$/,
    );
    const report = fault.report();
    assert.equal(report.failed, false);
    assert.equal(report.acceptedBeforeDrop, true);
    assert.equal(report.sameBytes, true);
    assert.ok(report.requests >= 2);
    assert.equal((await sender.pending()).hash, unknown.hash);
    return report;
  } finally {
    await fault.close();
  }
}

async function createRecipient() {
  await fs.writeFile(path.join(root, 'transfer-attempt.json'), JSON.stringify({ started: true }), {
    flag: 'wx',
  });
  const wallet = await StagenetBrowser.open({ ...opening, root: path.join(root, 'recipient') });
  try {
    await wallet.create();
    await wallet.connect();
    await wallet.backup('recipient-backup.xmrvault');
    const address = await wallet.page.locator('#wallet-address').textContent();
    await fs.writeFile(path.join(root, 'recipient-address.txt'), address, { flag: 'wx' });
    return { wallet, address };
  } catch (error) {
    await wallet.close();
    throw error;
  }
}

async function resumeUnsentRecipient() {
  await fs.access(path.join(root, 'transfer-attempt.json'));
  const wallet = await StagenetBrowser.open({ ...opening, root: path.join(root, 'recipient') });
  try {
    await wallet.unlock();
    const address = await fs.readFile(path.join(root, 'recipient-address.txt'), 'utf8');
    assert.equal(await wallet.page.locator('#wallet-address').textContent(), address.trim());
    assert.deepEqual(await wallet.balances(), { total: 0n, unlocked: 0n });
    return { wallet, address: address.trim() };
  } catch (error) {
    await wallet.close();
    throw error;
  }
}

async function main() {
  process.umask(0o077);
  // An interrupted run must be diagnosed from its persisted journal. Never
  // automatically create a replacement transaction after an uncertain send.
  assert.ok([undefined, 'resume-preparation', 'resume-signed'].includes(process.argv[5]));
  let sender;
  let recipient;
  try {
    stage = 'recipient';
    const initialized = process.argv[5] ? await resumeUnsentRecipient() : await createRecipient();
    recipient = initialized.wallet;
    const { address } = initialized;
    await recipient.sync();
    stage = 'sender';
    sender = await openSender();
    let fee;
    let hash;
    if (process.argv[5] === 'resume-signed') {
      const saved = await sender.pending();
      assert.equal(saved.status, 'signed');
      assert.equal(saved.amount, 100_000_000_000n);
      assert.ok(saved.fee > 0n && saved.fee <= 10_000_000_000n);
      assert.equal(await sender.page.locator('#pending-send code').textContent(), address);
      assert.match(saved.hash, /^[0-9a-f]{64}$/);
      fee = saved.fee;
      hash = saved.hash;
      console.log(JSON.stringify({ resumedSignedCheckpoint: true }));
    } else {
      // Explicit preparation-only resumption never accepts an existing signed,
      // prepared or uncertain intent, and therefore cannot replace an unknown send.
      assert.equal(
        await sender.page.locator('#pending-send').textContent(),
        'No pending transaction.',
      );
      await sender.sync();
      assert.deepEqual(await sender.balances(), {
        total: 500_000_000_000n,
        unlocked: 500_000_000_000n,
      });
      stage = 'prepare';
      fee = await prepare(sender, address);
      await sender.close();
      sender = await openSender();
      assert.equal((await sender.pending()).status, 'prepared');
      assert.equal(await sender.page.locator('#pending-send code').textContent(), address);
      stage = 'sign';
      hash = await sign(sender);
      await sender.close();
      sender = await openSender();
      assert.equal((await sender.pending()).status, 'signed');
      assert.equal((await sender.pending()).hash, hash);
    }
    stage = 'broadcast';
    const fault = await uncertainBroadcast(sender);
    await sender.close();
    sender = await openSender();
    assert.equal((await sender.pending()).hash, hash);
    stage = 'reconcile';
    await sender.sync();
    await recipient.sync();
    await waitForSettlement(sender, recipient, fee);
    stage = 'checkpoint';
    await sender.backup('settled-checkpoint.xmrvault');
    await recipient.backup('settled-checkpoint.xmrvault');
    await sender.close();
    sender = await openSender();
    assert.equal((await sender.pending()).hash, hash);
    assert.equal((await sender.pending()).status, 'confirmed');
    console.log(
      JSON.stringify({
        exactReceipt: true,
        exactFeeAndChange: true,
        preparedRecovery: true,
        signedRecovery: true,
        lostResponseRecovered: true,
        sameSignedBytesRetried: fault.sameBytes,
        unknownCancellationRejected: true,
        confirmedCheckpointRecovered: true,
        feeAtomic: fee.toString(),
      }),
    );
  } finally {
    await sender?.close();
    await recipient?.close();
  }
}

main().catch((error) => {
  const categories = [
    'Timeout',
    'deadline',
    'Expected',
    'closed',
    'failed',
    'Waiting',
    'EEXIST',
  ].filter((category) => String(error.message).includes(category));
  console.error(JSON.stringify({ stage, failed: true, categories }));
  process.exitCode = 1;
});
