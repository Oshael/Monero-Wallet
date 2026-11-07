import { WorkerChannel } from '../../src/runtime/worker-channel.ts';

type Channel = WorkerChannel<unknown, unknown>;

export function recordWorkerFailures(): () => void {
  const prototype = WorkerChannel.prototype as Channel;
  const dispose = originalMethod('dispose');
  const call = originalMethod('call');
  prototype.dispose = function (code): void {
    recordCode(code);
    dispose.call(this, code);
  };
  prototype.call = async function (command, transfer): Promise<unknown> {
    try {
      return await call.call(this, command, transfer);
    } catch (error) {
      if (error instanceof Error && 'code' in error) recordCode(error.code);
      recordCommand(command);
      throw error;
    }
  };
  return () => {
    prototype.dispose = dispose;
    prototype.call = call;
  };
}

function recordCommand(command: unknown): void {
  if (typeof command !== 'object' || command === null || !('kind' in command)) return;
  if (typeof command.kind === 'string' && /^[a-z-]{1,64}$/.test(command.kind))
    document.body.dataset.workerCommand = command.kind;
}

function originalMethod<Name extends 'call' | 'dispose'>(name: Name): Channel[Name] {
  // Read descriptors so the saved implementation keeps its dynamic receiver.
  const implementation: unknown = Object.getOwnPropertyDescriptor(
    WorkerChannel.prototype,
    name,
  )?.value;
  if (typeof implementation !== 'function') throw new Error('Worker diagnostic hook unavailable.');
  return implementation as Channel[Name];
}

function recordCode(code: unknown): void {
  if (typeof code === 'string' && code !== 'worker-closed' && /^[a-z-]{1,64}$/.test(code))
    document.body.dataset.workerFailure = code;
}
