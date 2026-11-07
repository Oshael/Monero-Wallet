import { build } from 'esbuild';

await build({
  entryPoints: ['test/browser/lifecycle-probe.ts'],
  outfile: 'build/lifecycle-browser/lifecycle-probe.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome151',
});
