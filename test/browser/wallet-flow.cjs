const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2]);

const password = 'disposable browser wallet password';
const replacementPassword = 'replacement browser wallet password';
let stage = 'launch';

async function unlock(page, candidate = password) {
  await page.getByLabel('Password', { exact: true }).first().fill(candidate);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).waitFor({ timeout: 45_000 });
}

async function verifySeed(page) {
  await page.getByLabel('Current password', { exact: true }).first().fill(password);
  await page.getByRole('button', { name: 'Reveal seed for 30 seconds' }).click();
  const seedView = page.getByLabel('Wallet seed');
  await seedView.waitFor({ state: 'visible', timeout: 30_000 });
  const seed = await seedView.textContent();
  assert.equal(seed.trim().split(/\s+/).length, 25);
  await page.getByLabel('Enter the saved 25-word seed').fill(seed);
  await page.getByRole('button', { name: 'Verify written seed' }).click();
  await page.getByText('Written seed verified.', { exact: true }).waitFor({ timeout: 30_000 });
  // Headless Chromium reports both tabs as visible. Exercise the event contract
  // explicitly; physical tab visibility remains a manual browser-release check.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await seedView.waitFor({ state: 'hidden', timeout: 5000 });
  return seed;
}

async function assertEncrypted(page, seed) {
  return page.evaluate(async (canary) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('xmr-wallet-vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Storage fixture failed.'));
    });
    try {
      const records = await new Promise((resolve, reject) => {
        const transaction = database.transaction('encrypted-vault', 'readonly');
        const request = transaction.objectStore('encrypted-vault').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Storage fixture failed.'));
      });
      return (
        records.length > 0 &&
        records.every((record) => !new TextDecoder().decode(record.envelope).includes(canary))
      );
    } finally {
      database.close();
    }
  }, seed);
}

async function checkFlow(context, id, run) {
  const uri = `chrome-extension://${id}/wallet.html`;
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const categories = [
      'importScripts',
      'Content Security Policy',
      'not defined',
      'not a function',
      'module specifier',
      'Failed to load',
      'Wasm',
      'wasm',
    ];
    console.log(
      JSON.stringify({
        consoleCategories: categories.filter((category) => message.text().includes(category)),
      }),
    );
  });
  await page.goto(uri);
  const evictionProtected = await page.evaluate(() =>
    chrome.permissions.contains({ permissions: ['unlimitedStorage'] }),
  );
  assert.equal(evictionProtected, true);
  console.log(JSON.stringify({ evictionProtected }));
  stage = 'create';
  await page.getByLabel('Password — at least 12 characters', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create wallet', exact: true }).click();
  try {
    await page
      .getByRole('button', { name: 'Lock wallet', exact: true })
      .waitFor({ timeout: 45_000 });
  } catch (error) {
    const status = await page.locator('#status').textContent();
    const code = status?.match(/Operation failed: ([a-z-]+)\./)?.[1];
    console.log(JSON.stringify({ createError: code ?? 'unreported' }));
    throw error;
  }
  const address = await page.locator('#wallet-address').textContent();
  stage = 'backup';
  const seed = await verifySeed(page);
  assert.equal(await assertEncrypted(page, seed), true);
  stage = 'new-wallet-birthday';
  assert.equal(
    await page.evaluate(async () =>
      (await import('./pending-recovery-probe.js')).nativeBirthdayMatches(),
    ),
    true,
  );
  stage = 'subaddress';
  await page.getByLabel('Address label', { exact: true }).fill('Disposable receiving address');
  await page.getByRole('button', { name: 'Create receiving address' }).click();
  try {
    await page
      .getByText('Disposable receiving address', { exact: true })
      .waitFor({ timeout: 20_000 });
  } catch (error) {
    const status = await page.locator('#status').textContent();
    console.log(
      JSON.stringify({
        subaddressError: status?.match(/Operation failed: ([a-z-]+)\./)?.[1] ?? 'unreported',
      }),
    );
    throw error;
  }
  const second = await context.newPage();
  stage = 'exclusive-session';
  await second.goto(uri);
  await second.getByLabel('Password', { exact: true }).first().fill(password);
  await second.getByRole('button', { name: 'Unlock', exact: true }).click();
  await second
    .getByText('Operation failed: session-busy.', { exact: true })
    .waitFor({ timeout: 10_000 });
  await second.close();
  stage = 'lock';
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Wallet seed"]'));
  assert.equal(page.workers().length, 0);
  await page.reload();
  stage = 'reopen';
  await unlock(page);
  assert.equal(await page.locator('#wallet-address').textContent(), address);
  await page.getByText('Written seed verified.', { exact: true }).waitFor();
  stage = 'encrypted-backup';
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download encrypted backup', exact: true }).click();
  const backup = path.join(run, 'disposable-backup.xmrvault');
  await (await downloadReady).saveAs(backup);
  stage = 'password-rotation';
  await changePassword(page);
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).first().fill(password);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await page
    .getByText('Operation failed: authentication-failed.', { exact: true })
    .waitFor({ timeout: 45_000 });
  await unlock(page, replacementPassword);
  assert.equal(await page.locator('#wallet-address').textContent(), address);
  stage = 'tab-close-recovery';
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(uri);
  await unlock(reopened, replacementPassword);
  assert.equal(await reopened.locator('#wallet-address').textContent(), address);
  stage = 'backup-import-after-local-deletion';
  await reopened.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  // The locked screen briefly reads whether a vault exists. Wait for that short
  // transaction to close before deliberately deleting this test database.
  await reopened.getByRole('button', { name: 'Unlock', exact: true }).waitFor();
  await deleteDisposableStorage(reopened);
  await reopened.reload();
  await reopened.getByText('Import encrypted backup', { exact: true }).click();
  await reopened.getByLabel('Backup file', { exact: true }).setInputFiles(backup);
  await reopened.getByLabel('Backup password', { exact: true }).fill(password);
  await reopened.getByRole('button', { name: 'Open encrypted backup', exact: true }).click();
  await reopened
    .getByRole('button', { name: 'Lock wallet', exact: true })
    .waitFor({ timeout: 45_000 });
  assert.equal(await reopened.locator('#wallet-address').textContent(), address);
  await reopened.getByRole('button', { name: 'Show receiving addresses', exact: true }).click();
  await reopened.getByText('Disposable receiving address', { exact: true }).waitFor();
  stage = 'fatal-worker-lock';
  await assertFatalWorkerLocks(reopened);
  await unlock(reopened);
  stage = 'fatal-native-lock';
  await assertFatalNativeLocks(reopened);
  stage = 'pending-recovery';
  await checkPendingRecovery(context, reopened, id, run);
  console.log(
    JSON.stringify({
      created: true,
      nativeBirthdayPreserved: true,
      seedVerified: true,
      encryptedRecords: true,
      subaddressCreated: true,
      secondTabBlocked: true,
      lockTerminatedWorkers: true,
      addressRestored: true,
      passwordRotated: true,
      abruptTabRecovered: true,
      importedAfterLocalDeletion: true,
      labelsRecovered: true,
      fatalWorkerLocks: true,
      seedHiddenOnVisibilityEvent: true,
      fatalNativeLocks: true,
      preparedRecoveryReviewedAndCancelled: true,
    }),
  );
}

async function checkPendingRecovery(context, page, id, run) {
  const probe = await context.newPage();
  const file = path.join(run, 'pending-recovery.xmrvault');
  try {
    await probe.goto(`chrome-extension://${id}/pending-probe.html`);
    const downloading = probe.waitForEvent('download');
    const restoreHeight = await probe.evaluate(async () => {
      const { downloadPendingRecovery } = await import('./pending-recovery-probe.js');
      return downloadPendingRecovery();
    });
    assert.ok(Number.isSafeInteger(restoreHeight) && restoreHeight >= 0);
    console.log(JSON.stringify({ newWalletRestoreHeight: restoreHeight }));
    await (await downloading).saveAs(file);
  } finally {
    await probe.close();
  }
  await page.getByText('Import encrypted backup', { exact: true }).click();
  await page.getByLabel('Backup file', { exact: true }).setInputFiles(file);
  await page.getByLabel('Backup password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Open encrypted backup', exact: true }).click();
  await page
    .getByRole('button', { name: 'Approve exact transaction and sign locally', exact: true })
    .waitFor({ timeout: 45_000 });
  await page.reload();
  await unlock(page);
  await page
    .getByRole('button', { name: 'Approve exact transaction and sign locally', exact: true })
    .waitFor();
  assert.equal(
    await page.locator('#pending-send code').textContent(),
    await page.locator('#wallet-address').textContent(),
  );
  await page.getByLabel('Amount in XMR', { exact: true }).fill('2');
  assert.equal(
    await page
      .getByRole('button', { name: 'Approve exact transaction and sign locally', exact: true })
      .count(),
    0,
  );
  await page
    .getByRole('button', { name: 'Discard an unbroadcast transaction', exact: true })
    .click();
  await page.getByText('No pending transaction.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
}

async function assertFatalWorkerLocks(page) {
  const vaultWorker = page.workers().find((worker) => worker.url().endsWith('/vault.worker.js'));
  assert.ok(vaultWorker);
  await vaultWorker.evaluate(() =>
    self.postMessage({ id: 'invalid', ok: true, value: { kind: 'ready' } }),
  );
  await page.getByLabel('Current password', { exact: true }).first().fill(password);
  await page.getByRole('button', { name: 'Reveal seed for 30 seconds' }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(page.workers().length, 0);
}

async function assertFatalNativeLocks(page) {
  const engineWorker = page.workers().find((worker) => worker.url().endsWith('/engine.worker.js'));
  assert.ok(engineWorker);
  await engineWorker.evaluate(async () => {
    const { LibraryUtils } = await import('/vendor/wallet-engine-client.js');
    LibraryUtils.getWasmModule().get_subaddresses = () => {
      throw new WebAssembly.RuntimeError('Disposable native failure.');
    };
  });
  await page.getByRole('button', { name: 'Show receiving addresses', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock', exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(page.workers().length, 0);
}

async function changePassword(page) {
  const button = page.getByRole('button', { name: 'Change password', exact: true });
  await page.getByLabel('Current password', { exact: true }).last().fill(password);
  await page
    .getByLabel('New password — at least 12 characters', { exact: true })
    .fill(replacementPassword);
  await button.click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some(
        (element) => element.textContent === 'Change password' && !element.disabled,
      ),
    undefined,
    { timeout: 45_000 },
  );
}

async function deleteDisposableStorage(page) {
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('xmr-wallet-vault');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('Disposable storage deletion failed.'));
        request.onblocked = () => reject(new Error('Disposable storage is still open.'));
      }),
  );
}

async function runWalletFlow(onContext) {
  const run = await fs.mkdtemp(path.join(__dirname, 'run-wallet-ui-'));
  let context;
  let finishMeasurement;
  try {
    const extension = path.join(__dirname, 'extension');
    context = await chromium.launchPersistentContext(path.join(run, 'profile'), {
      channel: 'chromium',
      executablePath: process.argv[3],
      headless: true,
      chromiumSandbox: true,
      timeout: 15_000,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND',
      ],
    });
    if (onContext) finishMeasurement = await onContext(context);
    const extensions = await context.newPage();
    await extensions.goto('chrome://extensions/');
    const id = await extensions.locator('extensions-item').getAttribute('id', { timeout: 5000 });
    assert.match(id, /^[a-p]{32}$/);
    await checkFlow(context, id, run);
  } finally {
    await disposeRun(context, run, finishMeasurement);
  }
}

async function disposeRun(context, run, finishMeasurement) {
  try {
    await finishMeasurement?.();
  } finally {
    try {
      await context?.close();
    } finally {
      await fs.rm(run, { recursive: true, force: true });
    }
  }
}

function reportFailure(error) {
  const message = String(error.message);
  const timeout = message.includes('Timeout') || message.includes('timeout');
  const categories = [
    'strict mode violation',
    'Target closed',
    'Target page',
    'Expected values',
    'ENOENT',
    'database',
    'worker',
    'Execution context',
    'Frame was detached',
    'Disposable storage is still open',
  ];
  console.error(
    JSON.stringify({
      stage,
      result: timeout ? 'timeout' : 'failed',
      errorName: error.name,
      errorCode: error.code,
      categories: categories.filter((category) => message.includes(category)),
    }),
  );
  process.exitCode = 1;
}

module.exports = { runWalletFlow };
if (require.main === module) runWalletFlow().catch(reportFailure);
