import { WalletError } from '../domain/validation.ts';
import { serveWorker } from '../runtime/worker-host.ts';
import { decodeCommand } from './messages.ts';
import { EngineRuntime } from './runtime.ts';

const runtime = new EngineRuntime();

serveWorker({
  decode: decodeCommand,
  execute: (command) => runtime.execute(command),
  errorCode,
});

function errorCode(error: unknown): string {
  if (error instanceof WalletError) return error.code;
  if (error instanceof WebAssembly.RuntimeError) return 'engine-native-fatal';
  if (!(error instanceof Error)) return 'engine-native-error';
  for (const category of [
    'require',
    'window',
    'HEAP',
    'Module',
    'random',
    'FS',
    'Network',
    'network',
    'factory',
    'constructor',
    'function',
    'undefined',
    'importScripts',
  ]) {
    if (error.message.includes(category)) return `engine-${category.toLowerCase()}-error`;
  }
  return 'engine-failed';
}
