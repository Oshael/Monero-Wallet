const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path');
const { chromium } = require(process.argv[2]);

function respond(request, response) {
  if (request.url === '/oversized') {
    response.writeHead(200, { 'Content-Length': String(65 * 1024 * 1024) });
    response.write(Buffer.from([0]));
    return;
  }
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: '/json' }).end();
    return;
  }
  if (request.url === '/slow') return;
  if (request.url === '/binary' && request.method === 'POST') {
    if (request.headers['content-length'] !== '2') {
      response.writeHead(400).end();
      return;
    }
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.once('end', () => {
      if (!Buffer.concat(chunks).equals(Buffer.from([7, 8]))) {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(Buffer.from([0, 255, 128, 64]));
    });
    return;
  }
  if (request.url === '/unavailable') {
    response.writeHead(503);
    response.end('unavailable');
    return;
  }
  if (request.url !== '/json') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end('{"result":"fixture"}');
}

async function requestFromWorker(page, origin) {
  return page.evaluate(async (nodeOrigin) => {
    const worker = new Worker('monero.worker.js');
    function send(route, settings = {}) {
      return new Promise((resolve, reject) => {
        const callbackId = crypto.randomUUID();
        const timeout = setTimeout(
          () => reject(new Error(`Worker timed out on ${route}.`)),
          20_000,
        );
        worker.addEventListener(
          'message',
          ({ data }) => {
            clearTimeout(timeout);
            if (data[1] !== callbackId) {
              reject(new Error(`Worker failed on ${route}.`));
              return;
            }
            if (data[2].error) {
              const reason = String(data[2].error.message ?? 'Unknown worker error').replaceAll(
                nodeOrigin,
                '[loopback]',
              );
              reject(new Error(`Worker failed on ${route}: ${reason}`));
              return;
            }
            resolve(data[2].result);
          },
          { once: true },
        );
        worker.postMessage([
          undefined,
          'httpRequest',
          callbackId,
          {
            uri: nodeOrigin + route,
            resolveWithFullResponse: true,
            ...settings,
          },
        ]);
      });
    }
    try {
      const json = await send('/json');
      const binary = await send('/binary', { method: 'POST', body: new Uint8Array([7, 8]) });
      const unavailable = await send('/unavailable');
      async function rejected(route) {
        try {
          await send(route);
          return false;
        } catch (error) {
          if (error.message.startsWith('Worker timed out')) throw error;
          return true;
        }
      }
      const oversizedStarted = performance.now();
      const oversizedRejected =
        (await rejected('/oversized')) && performance.now() - oversizedStarted < 5000;
      const redirectRejected = await rejected('/redirect');
      const started = performance.now();
      const stalledRejected = await rejected('/slow');
      return {
        json: [json.statusCode, JSON.parse(json.body).result],
        binary: [binary.statusCode, Array.from(binary.body)],
        unavailable: [unavailable.statusCode, unavailable.body],
        oversizedRejected,
        redirectRejected,
        stalledRejected: stalledRejected && performance.now() - started < 19_000,
      };
    } finally {
      worker.terminate();
    }
  }, origin);
}

async function main() {
  const run = await fs.mkdtemp(path.join(__dirname, 'rpc-run-'));
  const extension = path.join(run, 'extension');
  const server = createServer(respond);
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  let context;
  try {
    await listening;
    const origin = `http://127.0.0.1:${server.address().port}`;
    await fs.mkdir(extension);
    await fs.copyFile(
      path.join(__dirname, 'source/dist/monero.worker.js'),
      path.join(extension, 'monero.worker.js'),
    );
    await fs.writeFile(
      path.join(extension, 'probe.html'),
      '<!doctype html><title>Offline fixture worker</title>',
    );
    await fs.writeFile(
      path.join(extension, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Wallet worker RPC fixture',
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
      timeout: 15000,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      ],
    });
    context.on('requestfailed', (request) => {
      if (request.url().startsWith(origin + '/')) {
        console.error(`Loopback request failed (${request.failure()?.errorText}).`);
      }
    });
    const page = await context.newPage();
    await page.goto('chrome://extensions/');
    const id = await page.locator('extensions-item').getAttribute('id', { timeout: 5000 });
    assert.match(id, /^[a-p]{32}$/);
    await page.goto(`chrome-extension://${id}/probe.html`);
    const response = await requestFromWorker(page, origin);
    assert.deepEqual(response, {
      json: [200, 'fixture'],
      binary: [200, [0, 255, 128, 64]],
      unavailable: [503, 'unavailable'],
      oversizedRejected: true,
      redirectRejected: true,
      stalledRejected: true,
    });
    console.log(
      'Browser worker JSON, binary, 503, response size, redirect and timeout contracts passed.',
    );
  } finally {
    try {
      if (context) await context.close();
    } finally {
      server.close();
      await fs.rm(run, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
