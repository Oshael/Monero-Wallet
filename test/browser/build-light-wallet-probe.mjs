import { build } from 'esbuild';

await build({
  entryPoints: [
    'test/browser/light-wallet-probe.ts',
    'test/browser/light-wallet-capacity-probe.ts',
  ],
  outdir: 'build/light-browser',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome151',
  external: ['./vendor/wallet-engine-client.js'],
  alias: { 'wallet-engine-client': './vendor/wallet-engine-client.js' },
});
