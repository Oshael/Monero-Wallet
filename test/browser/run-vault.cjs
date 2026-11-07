const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[2]);

async function main() {
  process.umask(0o077);
  const run = await fs.mkdtemp(path.join(__dirname, 'run-vault-'));
  let context;
  try {
    const extension = path.join(run, 'extension');
    await fs.mkdir(extension);
    for (const file of ['probe.js', 'vault.worker.js']) {
      await fs.copyFile(path.join(__dirname, file), path.join(extension, file));
    }
    await fs.writeFile(
      path.join(extension, 'probe.html'),
      '<!doctype html><title>Browser vault probe</title>',
    );
    await fs.writeFile(
      path.join(extension, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Browser vault probe',
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
    const result = await page.evaluate(async () => {
      const { runVaultFlow } = await import('./probe.js');
      return runVaultFlow();
    });
    for (const [contract, value] of Object.entries(result)) {
      if (typeof value === 'boolean') assert.equal(value, true, contract);
    }
    assert.ok(result.encryptedBytes > 0);
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
  console.error('Browser vault probe failed; no wallet data is logged.');
  process.exitCode = 1;
});
