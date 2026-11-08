import { build } from 'esbuild';

await build({
  entryPoints: ['test/browser/scanner-deletion-probe.ts'],
  outfile: 'build/deletion-browser/scanner-deletion-probe.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome151',
  external: ['/vendor/wallet-engine-client.js'],
  alias: { 'wallet-engine-client': '/vendor/wallet-engine-client.js' },
});
