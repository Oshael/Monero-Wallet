const assert = require('node:assert/strict');
const path = require('node:path');
const { runDaemonFixture } = require(process.argv[4]);

async function main() {
  const result = await runDaemonFixture({
    files: [
      { source: path.join(__dirname, 'transaction-probe.js'), name: 'transaction-probe.js' },
      { source: path.join(__dirname, 'vendor'), name: 'vendor' },
    ],
    check: async (page, origin) =>
      page.evaluate(async (uri) => {
        const { runTransactionProbe } = await import('./transaction-probe.js');
        return runTransactionProbe(uri);
      }, origin),
  });
  if ('failedAt' in result)
    console.log(JSON.stringify({ failedAt: result.failedAt, diagnostic: result.diagnostic }));
  for (const value of Object.values(result)) assert.equal(value, true);
  console.log(JSON.stringify(result));
}

main().catch(() => {
  console.error('Local transaction contract failed; no wallet data is logged.');
  process.exitCode = 1;
});
