import { build } from 'esbuild';

await build({
  entryPoints: ['test/browser/transaction-probe.ts'],
  outfile: 'build/transaction-browser/transaction-probe.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome151',
  external: ['./vendor/wallet-engine-client.js'],
  alias: { 'wallet-engine-client': './vendor/wallet-engine-client.js' },
});
