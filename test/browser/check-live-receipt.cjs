const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2]);

const root = path.resolve(process.argv[4]);
const password = 'disposable live-stagenet wallet password';
let stage = 'launch';

async function unlock(page) {
  await page.getByLabel('Password', { exact: true }).first().fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).waitFor({
    timeout: 45_000,
  });
}

async function waitForSync(page) {
  const started = performance.now();
  const deadline = started + 15 * 60_000;
  while (performance.now() < deadline) {
    const state = await page.locator('#wallet-sync').textContent();
    assert.ok(!state.startsWith('failed') && !state.startsWith('Waiting'));
    if (state.startsWith('synced')) return Math.round(performance.now() - started);
    await page.waitForTimeout(5000);
    // An active-user test must not disable the production inactivity lock.
    await page.mouse.click(5, 5);
  }
  throw new Error('Synchronization deadline.');
}

function balances(text) {
  const values = text.match(/^Total: ([0-9.]+) · Unlocked: ([0-9.]+) stagenet XMR$/);
  assert.ok(values);
  const atomic = (value) => {
    const [whole, fraction = ''] = value.split('.');
    assert.ok(fraction.length <= 12);
    return BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, '0'));
  };
  return { total: atomic(values[1]), unlocked: atomic(values[2]) };
}

async function main() {
  process.umask(0o077);
  const extension = path.join(root, 'extension');
  const context = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    channel: 'chromium',
    executablePath: process.argv[3],
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
  try {
    const page = await context.newPage();
    await page.goto('chrome://extensions/');
    const id = await page.locator('extensions-item').getAttribute('id', { timeout: 5000 });
    assert.match(id, /^[a-p]{32}$/);
    await page.goto(`chrome-extension://${id}/wallet.html`);
    stage = 'unlock';
    await unlock(page);
    const address = (await fs.readFile(path.join(root, 'public-address.txt'), 'utf8')).trim();
    assert.equal(await page.locator('#wallet-address').textContent(), address);
    stage = 'scan';
    await page.getByRole('button', { name: 'Synchronize', exact: true }).click();
    const elapsedMs = await waitForSync(page);
    const received = balances(await page.locator('#wallet-balances').textContent());
    assert.equal(received.total, 500_000_000_000n);
    assert.equal(received.unlocked, received.total);
    stage = 'checkpoint';
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download encrypted backup', exact: true }).click();
    await (await downloading).saveAs(path.join(root, 'funded-checkpoint.xmrvault'));
    await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    stage = 'reopen';
    await unlock(page);
    assert.deepEqual(balances(await page.locator('#wallet-balances').textContent()), received);
    await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    console.log(
      JSON.stringify({ received: true, unlocked: true, checkpointRecovered: true, elapsedMs }),
    );
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  const categories = ['Timeout', 'deadline', 'Expected', 'closed', 'failed', 'Waiting'].filter(
    (category) => String(error.message).includes(category),
  );
  console.error(JSON.stringify({ stage, failed: true, categories }));
  process.exitCode = 1;
});
