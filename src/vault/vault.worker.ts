import { serveWorker } from '../runtime/worker-host.ts';
import { CryptoRuntime } from './crypto-runtime.ts';
import { VaultError } from './errors.ts';
import { decodeCryptoCommand } from './messages.ts';

const runtime = new CryptoRuntime();

serveWorker({
  decode: decodeCryptoCommand,
  execute: (command) => runtime.execute(command),
  errorCode: (error) => (error instanceof VaultError ? error.code : 'vault-failed'),
});
