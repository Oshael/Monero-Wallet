const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { runDaemonFixture } = require('./daemon-fixture.cjs');

const origin = 'http://127.0.0.1:18083';
const requests = [];
let daemonInfo;

function setFixtureInfo(request, response) {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) request.destroy();
  });
  request.once('end', () => {
    daemonInfo = JSON.parse(body).result;
    response.writeHead(204).end();
  });
}

function respond(request, response) {
  if (request.url === '/fixture-info' && request.method === 'POST') {
    setFixtureInfo(request, response);
    return;
  }
  const match = request.url.match(/^(\/first\/node|\/second\/node)?\/json_rpc$/);
  if (!match) {
    response.writeHead(404).end();
    return;
  }
  const prefix = match[1] ?? '';
  requests.push(prefix);
  const height = { '/first/node': 201, '/second/node': 202, '': 203 }[prefix];
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id: '0', result: { ...daemonInfo, height } }));
}

async function checkPaths(page, daemonOrigin) {
  return page.evaluate(
    async ({ nodeOrigin, daemonOrigin }) => {
      const worker = new Worker('monero.worker.js');
      function invoke(wallet, method, args = []) {
        return new Promise((resolve, reject) => {
          const callback = crypto.randomUUID();
          const timer = setTimeout(() => finish(new Error('Native RPC path deadline.')), 20_000);
          function finish(error, result) {
            clearTimeout(timer);
            worker.removeEventListener('message', received);
            if (error) reject(error);
            else resolve(result);
          }
          function received({ data }) {
            if (!Array.isArray(data) || data[1] !== callback) return;
            finish(
              data[2].error ? new Error(`Native RPC path operation failed: ${method}.`) : undefined,
              data[2].result,
            );
          }
          worker.addEventListener('message', received);
          worker.postMessage([wallet, method, callback, ...args]);
        });
      }
      const connection = (path) => ({ uri: nodeOrigin + path, username: '', password: '' });
      try {
        // Reuse the official fixture response so this test only changes routing/height.
        const info = await invoke(undefined, 'httpRequest', [
          {
            uri: daemonOrigin + '/json_rpc',
            method: 'POST',
            username: 'fixture',
            password: 'disposable',
            body: JSON.stringify({ jsonrpc: '2.0', id: '0', method: 'get_info' }),
            resolveWithFullResponse: true,
          },
        ]);
        if (info.statusCode !== 200) throw new Error('Official fixture status unavailable.');
        await fetch(nodeOrigin + '/fixture-info', { method: 'POST', body: info.body });
        await invoke('first', 'createWalletFull', [
          {
            networkType: 'stagenet',
          },
        ]);
        await invoke('second', 'createWalletFull', [
          {
            networkType: 'stagenet',
          },
        ]);
        await invoke('first', 'setDaemonConnection', [connection('/first/node/'), false]);
        await invoke('second', 'setDaemonConnection', [connection('/second/node'), false]);
        const first = await invoke('first', 'getDaemonHeight');
        const second = await invoke('second', 'getDaemonHeight');
        await invoke('second', 'close', [false]);
        const firstAfterOtherClient = await invoke('first', 'getDaemonHeight');
        await invoke('first', 'setDaemonConnection', [connection(''), false]);
        const rootAfterSelection = await invoke('first', 'getDaemonHeight');
        await invoke('first', 'close', [false]);
        return { first, second, firstAfterOtherClient, rootAfterSelection };
      } finally {
        worker.terminate();
      }
    },
    { nodeOrigin: origin, daemonOrigin },
  );
}

async function main() {
  const server = createServer(respond);
  const listening = once(server, 'listening');
  server.listen(18083, '127.0.0.1');
  try {
    await listening;
    const result = await runDaemonFixture({ check: checkPaths, connectOrigins: [origin] });
    assert.deepEqual(result, {
      first: 201,
      second: 202,
      firstAfterOtherClient: 201,
      rootAfterSelection: 203,
    });
    assert.ok(
      requests.includes('/first/node') &&
        requests.includes('/second/node') &&
        requests.includes(''),
    );
    console.log(
      'Native RPC endpoint paths, trailing slash, client isolation and reselection passed.',
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
