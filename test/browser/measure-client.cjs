const { runWalletFlow } = require('./wallet-flow.cjs');
const { ClientMetrics } = require('./client-metrics.cjs');

runWalletFlow(async (context) => {
  const browser = context.browser();
  if (!browser) throw new Error('Browser metrics unavailable.');
  console.log(JSON.stringify({ browserVersion: browser.version() }));
  const metrics = new ClientMetrics(await browser.newBrowserCDPSession());
  return async () => console.log(JSON.stringify(await metrics.finish()));
}).catch(() => {
  console.error('Client measurement failed; no wallet data is logged.');
  process.exitCode = 1;
});
