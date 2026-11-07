// This probe uses the pinned upstream worker's private message format.
// It exercises the published bundle without installing the library's Node dependencies.
const walletId = 'stagenet-probe';
const result = document.querySelector('#result');

function request(worker, method, ...args) {
  return new Promise((resolve, reject) => {
    const callbackId = crypto.randomUUID();
    const listeners = new AbortController();
    const options = { once: true, signal: listeners.signal };
    const timeout = setTimeout(() => fail('timed out'), 10_000);

    function cleanup() {
      clearTimeout(timeout);
      listeners.abort();
    }

    function fail(reason) {
      cleanup();
      reject(new Error(`${method} ${reason}.`));
    }

    worker.addEventListener('message', ({ data }) => {
      cleanup();
      if (!Array.isArray(data)) {
        fail('returned an unexpected response');
        return;
      }
      const [replyWalletId, replyCallbackId, reply] = data;
      if (replyWalletId !== walletId || replyCallbackId !== callbackId || !reply) {
        fail('returned an unexpected response');
        return;
      }
      if (reply.error) {
        fail('failed in the wallet engine');
        return;
      }
      resolve(reply.result);
    }, options);
    worker.addEventListener('error', () => fail('raised a worker error'), options);
    worker.postMessage([walletId, method, callbackId, ...args]);
  });
}

async function withWallet(config, operation) {
  const worker = new Worker('monero.worker.js');
  try {
    await request(worker, 'createWalletFull', { networkType: 'stagenet', ...config });
    const outcome = await operation(worker);
    await request(worker, 'close', false);
    return outcome;
  } finally {
    worker.terminate();
  }
}

async function run() {
  const start = performance.now();
  const original = await withWallet({}, async (worker) => ({
    address: await request(worker, 'getAddress', 0, 0),
    seed: await request(worker, 'getSeed'),
    network: await request(worker, 'getNetworkType'),
    wasmBytes: await request(worker, 'getWasmMemoryUsed'),
  }));
  if (original.network !== 2 || !original.address || !original.seed) {
    throw new Error('The engine did not return a stagenet wallet.');
  }
  if (!Number.isSafeInteger(original.wasmBytes) || original.wasmBytes <= 0) {
    throw new Error('The engine did not report a WASM heap size.');
  }

  const restoredAddress = await withWallet({ seed: original.seed }, (worker) =>
    request(worker, 'getAddress', 0, 0),
  );
  if (restoredAddress !== original.address) {
    throw new Error('Restoring the seed in a new worker changed the primary address.');
  }

  const elapsedMs = Math.round(performance.now() - start);
  result.dataset.state = 'passed';
  result.textContent = `Stagenet creation and restore passed (${elapsedMs} ms, ${original.wasmBytes} WASM heap bytes after creation).`;
}

run().catch((error) => {
  result.dataset.state = 'failed';
  result.textContent = error.message;
});
