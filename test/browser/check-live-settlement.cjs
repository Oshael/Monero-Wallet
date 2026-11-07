const assert = require('node:assert/strict');
const path = require('node:path');
const { StagenetBrowser } = require('./stagenet-browser.cjs');
const { waitForSettlement } = require('./live-settlement.cjs');

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
  try {
    sender = await StagenetBrowser.open(options);
    recipient = await StagenetBrowser.open({ ...options, root: path.join(root, 'recipient') });
    await sender.unlock();
    await recipient.unlock();
    const pending = await sender.pending();
    assert.equal(pending.status, 'confirmed');
    assert.equal(pending.amount, 100_000_000_000n);
    assert.ok(pending.fee > 0n && pending.fee <= 10_000_000_000n);
    assert.equal(
      await sender.page.locator('#pending-send code').textContent(),
      await recipient.page.locator('#wallet-address').textContent(),
    );
    stage = 'synchronize';
    await sender.sync();
    await recipient.sync();
    stage = 'settle';
    await waitForSettlement(sender, recipient, pending.fee);
    stage = 'checkpoint';
    await sender.backup('settled-checkpoint.xmrvault');
    await recipient.backup('settled-checkpoint.xmrvault');
    await sender.page.reload();
    await sender.unlock();
    assert.equal((await sender.pending()).hash, pending.hash);
    assert.equal((await sender.pending()).status, 'confirmed');
    const expected = 400_000_000_000n - pending.fee;
    assert.deepEqual(await sender.balances(), { total: expected, unlocked: expected });
    await recipient.page.reload();
    await recipient.unlock();
    assert.deepEqual(await recipient.balances(), {
      total: 100_000_000_000n,
      unlocked: 100_000_000_000n,
    });
    console.log(
      JSON.stringify({
        confirmed: true,
        exactReceipt: true,
        unlockedReceipt: true,
        exactFeeAndChange: true,
        senderCheckpointRecovered: true,
        recipientCheckpointRecovered: true,
        feeAtomic: pending.fee.toString(),
      }),
    );
  } finally {
    await sender?.close();
    await recipient?.close();
  }
}

main().catch(() => {
  console.error(JSON.stringify({ stage, failed: true }));
  process.exitCode = 1;
});
