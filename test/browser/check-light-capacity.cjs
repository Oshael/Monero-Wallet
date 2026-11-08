const assert = require('node:assert/strict');
const { runLightWalletFixture } = require('./light-wallet-fixture.cjs');

async function main() {
  const inputs = process.argv[4] === 'inputs';
  const result = await runLightWalletFixture({
    file: 'light-wallet-capacity-probe.js',
    name: inputs ? 'runLightWalletInputsProbe' : 'runLightWalletCapacity',
  });
  if ('failedAt' in result) console.log(JSON.stringify(result));
  assert.equal(result.outputs, inputs ? 64 : 1000);
  for (const field of [
    'exactUnlockedBalance',
    'signedLocally',
    'preparationAvoidsLocalChainScan',
    'privateCanariesPreserved',
  ])
    assert.equal(result[field], true, field);
  for (const field of ['importMs', 'prepareMs', 'signMs', 'cacheBytes'])
    assert.ok(Number.isSafeInteger(result[field]) && result[field] > 0, field);
  console.log(JSON.stringify(result));
}

main().catch(() => {
  console.error('Light capacity contract failed; no wallet data logged.');
  process.exitCode = 1;
});
