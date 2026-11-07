import { build } from 'esbuild';
import path from 'node:path';

const output = path.resolve('build/vault-browser');

await build({
  entryPoints: {
    probe: 'test/browser/vault-probe.ts',
    'vault.worker': 'src/vault/vault.worker.ts',
  },
  outdir: output,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome151',
  legalComments: 'external',
});

console.log('Browser vault probe built.');
