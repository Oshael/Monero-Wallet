const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const password = 'disposable live-stagenet wallet password';

function atomic(value) {
  assert.match(value, /^\d+(?:\.\d{1,12})?$/);
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, '0'));
}

class StagenetBrowser {
  constructor(context, page, root) {
    this.context = context;
    this.page = page;
    this.root = root;
  }

  static async open(options) {
    const { chromium } = require(options.playwright);
    await fs.mkdir(options.root, { recursive: true, mode: 0o700 });
    const context = await chromium.launchPersistentContext(path.join(options.root, 'profile'), {
      channel: 'chromium',
      executablePath: options.executablePath,
      headless: true,
      chromiumSandbox: true,
      timeout: 15_000,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${options.extension}`,
        `--load-extension=${options.extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      ],
    });
    try {
      const page = await context.newPage();
      await page.goto('chrome://extensions/');
      const id = await page.locator('extensions-item').getAttribute('id', { timeout: 5000 });
      assert.match(id, /^[a-p]{32}$/);
      await page.goto(`chrome-extension://${id}/wallet.html`);
      return new StagenetBrowser(context, page, options.root);
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  async unlock() {
    await this.page.getByLabel('Password', { exact: true }).first().fill(password);
    await this.page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await this.page.getByRole('button', { name: 'Lock wallet', exact: true }).waitFor({
      timeout: 45_000,
    });
  }

  async importBackup(filename) {
    await this.page.getByText('Import encrypted backup', { exact: true }).click();
    await this.page.getByLabel('Backup file', { exact: true }).setInputFiles(filename);
    await this.page.getByLabel('Backup password', { exact: true }).fill(password);
    await this.act('Open encrypted backup');
    await this.page
      .getByRole('button', { name: 'Lock wallet', exact: true })
      .waitFor({ timeout: 45_000 });
  }

  async create() {
    await this.page.getByLabel('Password — at least 12 characters', { exact: true }).fill(password);
    await this.page.getByRole('button', { name: 'Create wallet', exact: true }).click();
    await this.page.getByRole('button', { name: 'Lock wallet', exact: true }).waitFor({
      timeout: 45_000,
    });
    await this.page.getByLabel('Current password', { exact: true }).first().fill(password);
    await this.page.getByRole('button', { name: 'Reveal seed for 30 seconds' }).click();
    const view = this.page.getByLabel('Wallet seed');
    await view.waitFor({ state: 'visible', timeout: 30_000 });
    const seed = await view.textContent();
    assert.equal(seed.trim().split(/\s+/).length, 25);
    await this.page.getByLabel('Enter the saved 25-word seed').fill(seed);
    await this.page.getByRole('button', { name: 'Verify written seed' }).click();
    await this.page.getByText('Written seed verified.', { exact: true }).waitFor({
      timeout: 30_000,
    });
    await this.page.getByRole('button', { name: 'Hide seed', exact: true }).click();
  }

  async connect(uri = 'http://127.0.0.1:38081') {
    await this.page.getByLabel('Stagenet node URL (HTTPS)', { exact: true }).fill(uri);
    await this.page.getByLabel('Node username (optional)', { exact: true }).fill('fixture');
    await this.page.getByLabel('Node password (optional)', { exact: true }).fill('disposable');
    await this.act('Connect to selected node');
  }

  async connectLight(scanner, uri = 'http://127.0.0.1:38081') {
    await this.page.getByLabel('Stagenet scanner URL (HTTPS)', { exact: true }).fill(scanner);
    await this.page.getByLabel('Matching stagenet node URL (HTTPS)', { exact: true }).fill(uri);
    await this.page.getByLabel('Node username (optional)', { exact: true }).fill('fixture');
    await this.page.getByLabel('Node password (optional)', { exact: true }).fill('disposable');
    await this.page.getByRole('checkbox', { name: /I agree to share my private view key/ }).check();
    await this.act('Use selected light wallet service');
  }

  async act(title, expected = 'Done.') {
    const button = this.page.getByRole('button', { name: title, exact: true });
    const handle = await button.elementHandle();
    assert.ok(handle);
    try {
      await button.click();
      // Signing removes its approval form. The original button's finalizer is
      // still the completion signal even after that element leaves the DOM.
      await this.page.waitForFunction((element) => !element.disabled, handle, {
        timeout: 90_000,
      });
    } finally {
      await handle.dispose();
    }
    const message = await this.page.locator('#status').textContent();
    const code = message.match(/^Operation failed: ([a-z-]+)\.$/)?.[1];
    if (code) console.log(JSON.stringify({ action: title, code }));
    if (expected instanceof RegExp) assert.match(message, expected);
    else assert.equal(message, expected);
    return message;
  }

  async sync() {
    await this.requestSync();
    const deadline = performance.now() + 15 * 60_000;
    while (performance.now() < deadline) {
      const state = await this.page.locator('#wallet-sync').textContent();
      const status = await this.page.locator('#status').textContent();
      assert.ok(!status.startsWith('An operation failed.'), 'Background wallet operation failed.');
      assert.ok(!state.startsWith('failed') && !state.startsWith('Waiting for the selected node'));
      if (state.startsWith('synced')) return;
      await this.page.waitForTimeout(5000);
      await this.page.mouse.click(5, 5);
    }
    throw new Error('Synchronization deadline.');
  }

  async requestSync() {
    for (let attempt = 0; attempt < 15; attempt++) {
      const response = await this.act(
        'Synchronize',
        /^(Done\.|Operation failed: (?:session-busy|sync-busy)\.)$/,
      );
      if (response === 'Done.') return;
      await this.page.waitForTimeout(1000);
    }
    throw new Error('Background synchronization did not yield to the fixture.');
  }

  async balances() {
    const text = await this.page.locator('#wallet-balances').textContent();
    const values = text.match(/^Total: ([0-9.]+) · Unlocked: ([0-9.]+) stagenet XMR$/);
    assert.ok(values);
    return { total: atomic(values[1]), unlocked: atomic(values[2]) };
  }

  async pending() {
    const text = await this.page.locator('#pending-send').textContent();
    const state = text.match(
      /transaction status: ([a-z]+) ([0-9a-f]*)|Transaction: ([a-z]+) ([0-9a-f]*)/,
    );
    const amounts = text.match(/Amount: ([0-9.]+) XMR · Fee: ([0-9.]+) XMR/);
    assert.ok(state && amounts);
    return {
      status: state[1] ?? state[3],
      hash: state[2] ?? state[4],
      amount: atomic(amounts[1]),
      fee: atomic(amounts[2]),
    };
  }

  async backup(filename) {
    assert.match(filename, /^[a-z-]+\.xmrvault$/);
    const downloading = this.page.waitForEvent('download');
    await this.page.getByRole('button', { name: 'Download encrypted backup', exact: true }).click();
    await (await downloading).saveAs(path.join(this.root, filename));
  }

  async close() {
    await this.context.close();
  }
}

module.exports = { StagenetBrowser };
