const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2]);

async function main() {
  process.umask(0o077);
  const run = await fs.mkdtemp(path.join(__dirname, 'run-public-api-'));
  let context;
  try {
    const extension = path.join(run, 'extension');
    await fs.mkdir(extension);
    await fs.copyFile(
      path.join(__dirname, 'source/dist/monero.worker.js'),
      path.join(extension, 'monero.worker.js'),
    );
    const candidate = process.argv[4];
    if (candidate) await fs.copyFile(candidate, path.join(extension, 'candidate.worker.js'));
    await fs.copyFile(path.join(__dirname, 'client/probe.js'), path.join(extension, 'probe.js'));
    await fs.writeFile(
      path.join(extension, 'probe.html'),
      '<!doctype html><title>Public wallet API probe</title><script src="probe.js"></script>',
    );
    await fs.writeFile(
      path.join(extension, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Public wallet API probe',
        version: '0.1.0',
        content_security_policy: {
          extension_pages:
            "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'none'; object-src 'none'",
        },
      }),
    );
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
    const page = await context.newPage();
    await page.goto('chrome://extensions/');
    const id = await page.locator('extensions-item').getAttribute('id', { timeout: 5000 });
    assert.match(id, /^[a-p]{32}$/);
    await page.goto(`chrome-extension://${id}/probe.html`);
    const first =
      process.argv[5] === 'candidate-first' ? 'candidate.worker.js' : 'monero.worker.js';
    const result = await page.evaluate(
      ({ workerFile, first }) =>
        Promise.race([
          globalThis.runPublicWalletProbe(workerFile, first),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Public wallet API probe timed out.')), 45_000),
          ),
        ]),
      { workerFile: candidate ? 'candidate.worker.js' : 'monero.worker.js', first },
    );
    if (result.failedAt)
      console.log(JSON.stringify({ failedAt: result.failedAt, diagnostic: result.diagnostic }));
    assert.ok(result.keysBytes > 0 && result.cacheBytes > 0);
    for (const contract of [
      'addressMatches',
      'backwardAddressMatches',
      'accountsPreserved',
      'subaddressPreserved',
      'wrongPasswordRejected',
      'viewOnlySnapshot',
      'backwardSpendAuthority',
    ]) {
      assert.equal(result[contract], true, `Public wallet contract failed: ${contract}`);
    }
    console.log(JSON.stringify(result));
  } finally {
    try {
      if (context) await context.close();
    } finally {
      await fs.rm(run, { recursive: true, force: true });
    }
  }
}

main().catch(() => {
  console.error('Public wallet API probe failed. No wallet data is logged.');
  process.exitCode = 1;
});
