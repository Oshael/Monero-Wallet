const denyEntropy = new URL(self.location.href).searchParams.has('deny');
const nativeRandomValues = crypto.getRandomValues.bind(crypto);
let entropyCalls = 0;

crypto.getRandomValues = (target) => {
  entropyCalls++;
  if (denyEntropy) throw new Error('Entropy denied by the test harness.');
  return nativeRandomValues(target);
};

importScripts('monero.worker.js');

const handleWalletMessage = self.onmessage;
self.onmessage = (event) => {
  const [walletId, method, callbackId] = event.data;
  if (method === 'entropyCount') {
    self.postMessage([walletId, callbackId, { result: entropyCalls }]);
    return;
  }
  return handleWalletMessage(event);
};
