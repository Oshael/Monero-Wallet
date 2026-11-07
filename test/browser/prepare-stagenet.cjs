const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2]);

const password = 'disposable live-stagenet wallet password';
const root = path.resolve(process.argv[4]);

async function verifyWrittenSeed(page) {
  await page.getByLabel('Current password', { exact: true }).first().fill(password);
  await page.getByRole('button', { name: 'Reveal seed for 30 seconds' }).click();
  const seedView = page.getByLabel('Wallet seed');
  await seedView.waitFor({ state: 'visible', timeout: 30_000 });
  const seed = await seedView.textContent();
  assert.equal(seed.trim().split(/\s+/).length, 25);
  await page.getByLabel('Enter the saved 25-word seed').fill(seed);
  await page.getByRole('button', { name: 'Verify written seed' }).click();
  await page.getByText('Written seed verified.', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Hide seed', exact: true }).click();
}

async function configureNode(page) {
  const button = page.getByRole('button', { name: 'Connect to selected node', exact: true });
  await page
    .getByLabel('Stagenet node URL (HTTPS)', { exact: true })
    .fill('http://127.0.0.1:38081');
  await page.getByLabel('Node username (optional)', { exact: true }).fill('fixture');
  await page.getByLabel('Node password (optional)', { exact: true }).fill('disposable');
  await button.click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some(
        (element) => element.textContent === 'Connect to selected node' && !element.disabled,
      ),
    undefined,
    { timeout: 30_000 },
  );
  assert.equal(await page.locator('#status').textContent(), 'Done.');
}

async function main() {
  process.umask(0o077);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const addressFile = path.join(root, 'public-address.txt');
  await assert.rejects(fs.access(addressFile));
  const extension = path.join(root, 'extension');
  const manifestFile = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  // Fixture-only grant: avoid a browser permission dialog in this headless test.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
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
    await page.getByLabel('Password — at least 12 characters', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create wallet', exact: true }).click();
    await page
      .getByRole('button', { name: 'Lock wallet', exact: true })
      .waitFor({ timeout: 45_000 });
    await verifyWrittenSeed(page);
    await configureNode(page);
    const address = await page.locator('#wallet-address').textContent();
    assert.match(address, /^[5][123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{94}$/);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download encrypted backup', exact: true }).click();
    await (await downloading).saveAs(path.join(root, 'funding-wallet.xmrvault'));
    await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    await fs.writeFile(addressFile, address + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify({
        created: true,
        seedVerified: true,
        nodeSaved: true,
        encryptedBackupSaved: true,
      }),
    );
  } finally {
    await context.close();
  }
}

main().catch(() => {
  console.error('Stagenet preparation failed; no wallet data is logged.');
  process.exitCode = 1;
});
