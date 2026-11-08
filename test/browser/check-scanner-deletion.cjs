const assert = require('node:assert/strict');
const path = require('node:path');
const { StagenetBrowser } = require('./stagenet-browser.cjs');

const scanner = 'http://127.0.0.1:38084';
let phase = 'create';

async function probe(wallet, operation) {
  return wallet.page.evaluate(async (name) => {
    const module = await import('./scanner-deletion-probe.js');
    return module[name]();
  }, operation);
}

async function labelledWallet(wallet) {
  phase = 'create-wallet';
  await wallet.create();
  phase = 'create-label';
  await wallet.page
    .getByLabel('Address label', { exact: true })
    .fill('Retained after scanner deletion');
  await wallet.act('Create receiving address');
  phase = 'select-service';
  await wallet.connectLight(scanner);
  const address = await wallet.page.locator('#wallet-address').textContent();
  await wallet.page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  phase = 'register-fixture';
  await probe(wallet, 'registerDisposableScanner');
  phase = 'read-fixture';
  assert.equal(await probe(wallet, 'disposableAccountExists'), true);
  await wallet.unlock();
  return address;
}

async function deleteWithLostResponse(wallet) {
  let lost = false;
  const drop = async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    lost = true;
    await response.dispose();
    await route.abort('failed');
  };
  await wallet.context.route(`${scanner}/delete_account`, drop);
  try {
    await wallet.page.getByRole('checkbox', { name: /^Stop this scanner registration/ }).check();
    await wallet.act(
      'Delete selected scanner registration',
      /Operation failed: light-server-unavailable\./,
    );
    assert.equal(lost, true);
    assert.match(
      await wallet.page.locator('#light-registration').textContent(),
      /Deletion requested.*1 deletion request/,
    );
    await wallet.act('Synchronize', /Operation failed: light-registration-disabled\./);
    await wallet.backup('pending-scanner-deletion.xmrvault');
    await wallet.page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    assert.equal(await probe(wallet, 'disposableAccountExists'), false);
  } finally {
    await wallet.context.unroute(`${scanner}/delete_account`, drop);
  }
}

async function assertPreserved(wallet, address) {
  assert.equal(await wallet.page.locator('#wallet-address').textContent(), address);
  assert.deepEqual(await wallet.balances(), { total: 0n, unlocked: 0n });
  await wallet.act('Show receiving addresses');
  await wallet.page.getByText('Retained after scanner deletion', { exact: true }).waitFor();
}

async function recoveredDeletion(wallet, address, pendingBackup) {
  await wallet.importBackup(pendingBackup);
  await assertPreserved(wallet, address);
  assert.match(
    await wallet.page.locator('#light-registration').textContent(),
    /Deletion requested/,
  );
  await wallet.act('Synchronize', /Operation failed: light-registration-disabled\./);
  await wallet.act('Retry pending scanner deletion');
  assert.match(
    await wallet.page.locator('#light-registration').textContent(),
    /Requested registration deleted/,
  );
  await wallet.backup('confirmed-scanner-deletion.xmrvault');
  await wallet.page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  assert.equal(await probe(wallet, 'disposableAccountExists'), false);
  await wallet.unlock();
  await wallet.act('Synchronize', /Operation failed: light-registration-disabled\./);
  await assertPreserved(wallet, address);
}

async function main() {
  const root = process.argv[4];
  const options = {
    playwright: process.argv[2],
    executablePath: process.argv[3],
    extension: path.join(root, 'extension'),
  };
  let wallet;
  let loginCount = 0;
  const countLogins = (request) => {
    if (request.url() === `${scanner}/login`) loginCount++;
  };
  try {
    wallet = await StagenetBrowser.open({ ...options, root: path.join(root, 'original') });
    wallet.context.on('request', countLogins);
    const address = await labelledWallet(wallet);
    const baseline = loginCount;
    phase = 'lost-response';
    await deleteWithLostResponse(wallet);
    assert.equal(loginCount, baseline, 'Deletion must never register the wallet');
    await wallet.close();
    wallet = await StagenetBrowser.open({ ...options, root: path.join(root, 'restored') });
    wallet.context.on('request', countLogins);
    phase = 'backup-recovery';
    await recoveredDeletion(
      wallet,
      address,
      path.join(root, 'original', 'pending-scanner-deletion.xmrvault'),
    );
    assert.equal(loginCount, baseline, 'Restoring a deletion backup must not register');
    phase = 'fresh-consent';
    await wallet.connectLight(scanner);
    await wallet.page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    await probe(wallet, 'registerDisposableScanner');
    assert.equal(await probe(wallet, 'disposableAccountExists'), true);
    await wallet.unlock();
    await wallet.page.getByRole('checkbox', { name: /^Stop this scanner registration/ }).check();
    await wallet.act('Delete selected scanner registration');
    await wallet.page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    assert.equal(await probe(wallet, 'disposableAccountExists'), false);
    console.log(
      JSON.stringify({
        deletionUI: true,
        lostResponseRecovery: true,
        encryptedBackupRecovery: true,
        noAutomaticRegistration: true,
        localIdentityLabelsPreserved: true,
        explicitConsentReconnect: true,
      }),
    );
  } finally {
    await wallet?.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      scannerDeletionFailedAt: phase,
      category: error.name,
      source: error.stack?.match(
        /(?:stagenet-browser|check-scanner-deletion|scanner-deletion-probe)\.(?:cjs|js):\d+:\d+/g,
      ),
      code: error.message?.match(/\b(?:light|wallet|invalid|scanner)-[a-z-]{1,50}\b/)?.[0],
    }),
  );
  process.exitCode = 1;
});
