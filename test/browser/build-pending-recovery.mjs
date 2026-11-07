import { build } from 'esbuild';

await build({
  entryPoints: ['test/browser/pending-recovery-probe.ts'],
  outfile: 'build/pending-browser/pending-recovery-probe.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome151',
  external: ['/vendor/wallet-engine-client.js'],
  alias: { 'wallet-engine-client': '/vendor/wallet-engine-client.js' },
});
