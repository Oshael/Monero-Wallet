import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist');
await fs.access(path.join(root, 'vendor/wallet-engine-client.js'));
await fs.access(path.join(root, 'vendor/native-NOTICES.txt'));
await fs.access(path.join(root, 'vendor/client-NOTICES.txt'));
// dist is an ignored generated artifact; stale fixtures must not enter a build.
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
await build({
  entryPoints: {
    wallet: 'src/ui/main.ts',
    'vault.worker': 'src/vault/vault.worker.ts',
    'engine.worker': 'src/engine/engine.worker.ts',
    launcher: 'src/ui/launcher.ts',
  },
  outdir: output,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome151',
  external: ['/vendor/wallet-engine-client.js'],
  alias: { 'wallet-engine-client': '/vendor/wallet-engine-client.js' },
  legalComments: 'external',
  minify: true,
});
await fs.cp(path.join(root, 'extension'), output, { recursive: true });
await fs.cp(path.join(root, 'vendor'), path.join(output, 'vendor'), { recursive: true });
await fs.copyFile(
  path.join(root, 'node_modules/@noble/hashes/LICENSE'),
  path.join(output, 'noble-hashes-LICENSE.txt'),
);
console.log('Unpublished stagenet wallet extension built.');
