import { build } from 'esbuild';

await build({
  entryPoints: ['test/browser/sync-probe.ts'],
  outfile: 'build/sync-browser/sync-probe.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome151',
});
