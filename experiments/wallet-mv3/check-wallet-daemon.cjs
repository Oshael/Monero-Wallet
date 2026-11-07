const assert = require('node:assert/strict');
const { runDaemonFixture } = require('./daemon-fixture.cjs');

async function checkWallet(page, origin) {
  return page.evaluate(async (uri) => {
    const worker = new Worker('monero.worker.js');
    function invoke(method, ...args) {
      return new Promise((resolve, reject) => {
        const callbackId = crypto.randomUUID();
        const cleanup = () => {
          clearTimeout(timer);
          worker.removeEventListener('message', onMessage);
        };
        function onMessage({ data }) {
          if (!Array.isArray(data) || data[1] !== callbackId) return;
          cleanup();
          if (data[2].error) {
            reject(new Error(`The wallet operation ${method} failed.`));
            return;
          }
          resolve(data[2].result);
        }
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`The wallet operation ${method} timed out.`));
        }, 15_000);
        worker.addEventListener('message', onMessage);
        worker.postMessage(['daemon-wallet', method, callbackId, ...args]);
      });
    }
    try {
      const response = await invoke('httpRequest', {
        method: 'POST',
        uri: `${uri}/json_rpc`,
        username: 'fixture',
        password: 'disposable',
        body: JSON.stringify({ jsonrpc: '2.0', id: 'fixture', method: 'get_info' }),
        resolveWithFullResponse: true,
      });
      const info = JSON.parse(response.body);
      const denied = await invoke('httpRequest', {
        uri: `${uri}/get_info`,
        username: 'fixture',
        password: 'wrong',
        resolveWithFullResponse: true,
      });
      await invoke('createWalletFull', {
        networkType: 'mainnet',
        regtest: true,
        server: { uri, username: 'fixture', password: 'disposable' },
      });
      const connected = await invoke('isConnectedToDaemon');
      const height = await invoke('getDaemonHeight');
      const synced = await invoke('sync');
      const walletHeight = await invoke('getHeight');
      await invoke('close', false);
      return {
        rpcStatus: response.statusCode,
        daemonStatus: info.result.status,
        wrongPasswordStatus: denied.statusCode,
        connected,
        height,
        walletHeight,
        syncFailed: Boolean(synced?.error),
      };
    } finally {
      worker.terminate();
    }
  }, origin);
}

async function main() {
  const result = await runDaemonFixture({ check: checkWallet });
  assert.equal(result.rpcStatus, 200);
  assert.equal(result.daemonStatus, 'OK');
  assert.equal(result.wrongPasswordStatus, 401);
  assert.equal(result.connected, true);
  assert.ok(result.height >= 1 && result.walletHeight >= 1);
  assert.equal(result.syncFailed, false);
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
