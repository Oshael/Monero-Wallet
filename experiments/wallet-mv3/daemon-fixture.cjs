const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require(process.argv[2]);

async function waitForDaemon(daemon, origin) {
  for (let attempt = 0; attempt < 50; attempt++) {
    assert.equal(daemon.exitCode, null, 'The disposable daemon exited during startup.');
    try {
      const response = await fetch(`${origin}/get_info`, { signal: AbortSignal.timeout(500) });
      assert.equal(response.status, 401, 'The official daemon did not require authentication.');
      await response.arrayBuffer();
      return;
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
    }
    await delay(200);
  }
  throw new Error('The disposable daemon did not become available within the startup budget.');
}

async function startDaemon(run) {
  const executable = path.join(__dirname, 'monerod');
  await fs.access(executable, constants.X_OK);
  const daemon = spawn(
    path.join(__dirname, 'monerod'),
    [
      '--regtest',
      '--fixed-difficulty',
      '1',
      '--offline',
      '--no-igd',
      '--no-zmq',
      '--hide-my-port',
      '--non-interactive',
      '--rpc-bind-ip',
      '127.0.0.1',
      '--rpc-bind-port',
      '18081',
      '--rpc-login',
      'fixture:disposable',
      '--data-dir',
      path.join(run, 'chain'),
      '--log-file',
      '/dev/null',
      '--max-concurrency',
      '2',
    ],
    { stdio: 'ignore' },
  );
  await once(daemon, 'spawn');
  return daemon;
}

async function stopDaemon(daemon) {
  if (!daemon || daemon.exitCode !== null || daemon.signalCode !== null) return;
  const exited = once(daemon, 'exit');
  daemon.kill('SIGTERM');
  const timeout = setTimeout(() => daemon.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

async function runDaemonFixture(options) {
  process.umask(0o077);
  const run = await fs.mkdtemp(path.join(__dirname, 'run-daemon-'));
  const origin = 'http://127.0.0.1:18081';
  let daemon;
  let context;
  try {
    daemon = await startDaemon(run);
    await waitForDaemon(daemon, origin);
    const extension = path.join(run, 'extension');
    await fs.mkdir(extension);
    await fs.copyFile(
      path.join(__dirname, 'source/dist/monero.worker.js'),
      path.join(extension, 'monero.worker.js'),
    );
    for (const file of options.files ?? []) {
      await fs.cp(file.source, path.join(extension, file.name), { recursive: true });
    }
    await fs.writeFile(
      path.join(extension, 'probe.html'),
      '<!doctype html><title>Disposable daemon test</title>',
    );
    await fs.writeFile(
      path.join(extension, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Wallet daemon test',
        version: '0.1.0',
        host_permissions: ['http://127.0.0.1/*'],
        content_security_policy: {
          extension_pages: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src ${origin}; object-src 'none'`,
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
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      ],
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (/^wallet-test-(phase|height|funded|rpc-error):[a-z0-9-]+$/.test(message.text()))
        console.log(message.text());
    });
    await page.goto('chrome://extensions/');
    const id = await page.locator('extensions-item').getAttribute('id', { timeout: 5000 });
    assert.match(id, /^[a-p]{32}$/);
    await page.goto(`chrome-extension://${id}/probe.html`);
    return await options.check(page, origin);
  } finally {
    try {
      if (context) await context.close();
    } finally {
      try {
        await stopDaemon(daemon);
      } finally {
        await fs.rm(run, { recursive: true, force: true });
      }
    }
  }
}

module.exports = { runDaemonFixture };
