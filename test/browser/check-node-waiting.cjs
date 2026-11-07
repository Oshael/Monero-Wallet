const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.argv[2]);
const root = path.resolve(process.argv[4]);
const password = 'disposable live-stagenet wallet password';
let stage = 'launch';

async function revision(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('xmr-wallet-vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Fixture database failed.'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('encrypted-vault', 'readonly');
        const request = transaction.objectStore('encrypted-vault').get('active');
        let value;
        request.onsuccess = () => {
          value = request.result.revision;
        };
        transaction.oncomplete = () => resolve(value);
        transaction.onabort = () => reject(new Error('Fixture transaction failed.'));
      });
    } finally {
      database.close();
    }
  });
}

async function main() {
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
    stage = 'import-original-backup';
    await page.getByText('Import encrypted backup', { exact: true }).click();
    await page
      .getByLabel('Backup file', { exact: true })
      .setInputFiles(path.join(root, 'funding-wallet.xmrvault'));
    await page.getByLabel('Backup password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Open encrypted backup', exact: true }).click();
    await page
      .getByRole('button', { name: 'Lock wallet', exact: true })
      .waitFor({ timeout: 45_000 });
    const address = await page.locator('#wallet-address').textContent();
    const before = await revision(page);
    stage = 'waiting-state';
    await page.getByRole('button', { name: 'Synchronize', exact: true }).click();
    await page
      .locator('#wallet-sync')
      .filter({ hasText: 'Waiting for the selected node' })
      .waitFor({ timeout: 30_000 });
    const after = await revision(page);
    stage = 'unchanged-revision';
    assert.equal(after, before, 'Waiting for a node must not rewrite an unchanged vault.');
    await page.getByRole('button', { name: 'Stop and save scan', exact: true }).click();
    stage = 'checkpoint';
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (element) => element.textContent === 'Stop and save scan' && !element.disabled,
        ),
      undefined,
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    stage = 'unlock-checkpoint';
    await page.getByLabel('Password', { exact: true }).first().fill(password);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await page
      .getByRole('button', { name: 'Lock wallet', exact: true })
      .waitFor({ timeout: 45_000 });
    assert.equal(await page.locator('#wallet-address').textContent(), address);
    await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    console.log(
      JSON.stringify({
        waitingForNode: true,
        unchangedVaultPreserved: true,
        checkpointReopened: true,
        originalBackupMigrated: true,
      }),
    );
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  const categories = [
    'Timeout',
    'timeout',
    'Expected values',
    'unchanged vault',
    'strict mode violation',
    'closed',
  ].filter((category) => String(error.message).includes(category));
  console.error(JSON.stringify({ stage, failed: true, categories }));
  process.exitCode = 1;
});
