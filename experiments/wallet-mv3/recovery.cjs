const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2]);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function browserFixture(page) {
  return page.evaluate(async () => {
    function invoke(worker, method, ...args) {
      return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          worker.removeEventListener('message', onMessage);
          reject(new Error(`Worker timed out during ${method}.`));
        }, 15000);
        function onMessage({ data }) {
          if (data[1] !== id) return;
          clearTimeout(timer);
          worker.removeEventListener('message', onMessage);
          resolve(data[2]);
        }
        worker.addEventListener('message', onMessage);
        worker.postMessage(['recovery-test', method, id, ...args]);
      });
    }

    const normal = new Worker('entropy-worker.js');
    let fixture;
    try {
      const before = (await invoke(normal, 'entropyCount')).result;
      const created = await invoke(normal, 'createWalletFull', { networkType: 'stagenet' });
      if (created.error) throw new Error('Wallet creation failed with browser entropy.');
      const seed = (await invoke(normal, 'getSeed')).result;
      const address = (await invoke(normal, 'getAddress', 0, 0)).result;
      const entropyCalls = (await invoke(normal, 'entropyCount')).result - before;
      const closed = await invoke(normal, 'close', false);
      if (closed.error) throw new Error('Wallet worker did not close.');
      fixture = { seed, address, entropyCalls };
    } finally {
      normal.terminate();
    }

    const denied = new Worker('entropy-worker.js?deny');
    try {
      const before = (await invoke(denied, 'entropyCount')).result;
      const attempted = await invoke(denied, 'createWalletFull', { networkType: 'stagenet' });
      fixture.deniedCalls = (await invoke(denied, 'entropyCount')).result - before;
      fixture.deniedRejected = Boolean(attempted.error);
    } finally {
      denied.terminate();
    }
    return fixture;
  });
}

async function restoreWithCli(seed, scratch, label) {
  const wallet = path.join(scratch, label);
  const password = randomBytes(24).toString('hex');
  const { status, signal, error } = spawnSync(
    path.join(__dirname, 'monero-wallet-cli'),
    [
      '--offline',
      '--stagenet',
      '--log-file',
      '/dev/null',
      '--shared-ringdb-dir',
      path.join(scratch, 'ringdb'),
      '--subaddress-lookahead',
      '2:4',
      '--generate-new-wallet',
      wallet,
      '--restore-deterministic-wallet',
      '--restore-height',
      '0',
      '--create-address-file',
      'address',
    ],
    {
      cwd: scratch,
      env: { ...process.env, TERM: 'dumb', LC_ALL: 'C' },
      input: `${seed}\n\n${password}\n${password}\n`,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 30_000,
    },
  );
  let address;
  try {
    address = (await fs.readFile(`${wallet}.address.txt`, 'utf8')).trim();
  } catch (readError) {
    if (readError.code !== 'ENOENT') throw readError;
  }
  return { status, signal, error: error?.code, address };
}

async function main() {
  process.umask(0o077);
  const scratch = await fs.mkdtemp(path.join(__dirname, 'run-'));
  const extension = path.join(__dirname, 'extension');
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      executablePath: process.argv[3],
      channel: 'chromium',
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
    const page = await context.newPage();
    await page.goto('chrome://extensions/');
    const id = await page.locator('extensions-item').getAttribute('id', { timeout: 5_000 });
    check(/^[a-p]{32}$/.test(id), 'The test extension did not load.');
    await page.goto(`chrome-extension://${id}/probe.html`);
    const previous = await page
      .locator('#result:not([data-state="running"])')
      .getAttribute('data-state', { timeout: 25_000 });
    check(previous === 'passed', 'The baseline browser probe did not pass.');
    const fixture = await browserFixture(page);
    check(fixture.entropyCalls > 0, 'Wallet creation did not call browser entropy.');
    check(
      fixture.deniedCalls > 0 && fixture.deniedRejected,
      'Wallet creation did not reject denied entropy.',
    );
    const words = fixture.seed.trim().split(/\s+/);
    check(words.length === 25, 'The browser seed did not have 25 words.');
    const restored = await restoreWithCli(fixture.seed, scratch, 'restore');
    check(
      restored.status === 0 && restored.address === fixture.address,
      `CLI restore did not produce a matching address (status ${restored.status}, signal ${restored.signal}, error ${restored.error}, address present ${Boolean(restored.address)}).`,
    );
    words[24] = words.find((word) => word !== words[24]);
    const corrupted = await restoreWithCli(words.join(' '), scratch, 'checksum-rejection');
    check(
      corrupted.status === 1 && !corrupted.address,
      'The CLI accepted the modified mnemonic checksum.',
    );
    console.log(
      JSON.stringify({
        browser: context.browser().version(),
        seedWordCount: 25,
        cliAddressMatch: true,
        changedChecksumRejected: true,
        browserEntropyUsed: true,
        deniedEntropyRejected: true,
      }),
    );
  } finally {
    try {
      if (context) await context.close();
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
