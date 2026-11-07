import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkerChannel } from '../../src/runtime/worker-channel.ts';

class FixtureWorker extends EventTarget {
  sent: unknown[] = [];
  terminated = false;

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.sent.push(structuredClone(message, { transfer }));
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  requestId(): string {
    const frame = this.sent[0];
    assert.ok(typeof frame === 'object' && frame !== null && 'id' in frame);
    assert.equal(typeof frame.id, 'string');
    return String(frame.id);
  }
}

function decode(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid disposable reply.');
  return value;
}

void test('worker channel bounds concurrency and transfers ownership of buffers', async () => {
  const worker = new FixtureWorker();
  const channel = new WorkerChannel(worker, decode);
  try {
    const buffer = new ArrayBuffer(16);
    const response = channel.call({ kind: 'fixture', buffer }, [buffer]);
    assert.equal(buffer.byteLength, 0);
    await assert.rejects(channel.call({ kind: 'fixture' }), { code: 'worker-busy' });
    worker.reply({ id: worker.requestId(), ok: true, value: true });
    assert.equal(await response, true);
  } finally {
    channel.dispose();
  }
});

void test('locking a worker rejects pending operations and terminates its realm', async () => {
  const worker = new FixtureWorker();
  const signal = new AbortController();
  const channel = new WorkerChannel(worker, decode, signal.signal);
  const rejected = assert.rejects(channel.call({ kind: 'fixture' }), { code: 'worker-closed' });
  signal.abort();
  await rejected;
  assert.equal(worker.terminated, true);
  await assert.rejects(channel.call({ kind: 'fixture' }), { code: 'worker-closed' });
});

void test('mismatched replies fail closed without completing another request', async () => {
  const worker = new FixtureWorker();
  const channel = new WorkerChannel(worker, decode);
  const rejected = assert.rejects(channel.call({ kind: 'fixture' }), { code: 'worker-protocol' });
  worker.reply({ id: crypto.randomUUID(), ok: true, value: true });
  await rejected;
  assert.equal(worker.terminated, true);
});

void test('a stalled worker is terminated when its operation budget expires', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const worker = new FixtureWorker();
  const channel = new WorkerChannel(worker, decode);
  const rejected = assert.rejects(channel.call({ kind: 'fixture' }), { code: 'worker-timeout' });
  context.mock.timers.tick(30_000);
  await rejected;
  assert.equal(worker.terminated, true);
});
