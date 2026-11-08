const assert = require('node:assert/strict');
const { runLightWalletFixture } = require('./light-wallet-fixture.cjs');

async function main() {
  const result = await runLightWalletFixture({
    file: 'light-wallet-probe.js',
    name: 'runLightWalletProbe',
  });
  if ('failedAt' in result) console.log(JSON.stringify(result));
  for (const [contract, passed] of Object.entries(result)) assert.equal(passed, true, contract);
  console.log(JSON.stringify(result));
}

main().catch(() => {
  console.error('Light wallet contract failed; no wallet data is logged.');
  process.exitCode = 1;
});
