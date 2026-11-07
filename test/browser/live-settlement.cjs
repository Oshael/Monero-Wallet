const assert = require('node:assert/strict');

async function waitForSettlement(sender, recipient, fee) {
  const deadline = performance.now() + 60 * 60_000;
  const expected = 400_000_000_000n - fee;
  while (performance.now() < deadline) {
    const received = await recipient.balances();
    const pending = await sender.pending();
    assert.ok(received.total <= 100_000_000_000n);
    console.log(
      JSON.stringify({
        stage: 'confirmations',
        senderStatus: pending.status,
        received: received.total === 100_000_000_000n,
        unlocked: received.unlocked === 100_000_000_000n,
      }),
    );
    if (pending.status === 'confirmed' && received.unlocked === 100_000_000_000n) {
      const remaining = await sender.balances();
      assert.equal(remaining.total, expected);
      // Each wallet scans independently. The recipient can observe the unlock
      // block one polling cycle before the sender observes its unlocked change.
      if (remaining.unlocked === expected) return;
    }
    await sender.page.waitForTimeout(30_000);
    await sender.page.mouse.click(5, 5);
    await recipient.page.mouse.click(5, 5);
  }
  throw new Error('Confirmation deadline.');
}

module.exports = { waitForSettlement };
