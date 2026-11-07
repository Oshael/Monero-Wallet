export class WorkerFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'WorkerFailure';
    this.code = code;
  }
}

interface Pending<Reply> {
  id: string;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ReplyFrame {
  id: string;
  ok: boolean;
  value: unknown;
}

type WorkerHandle = EventTarget & {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
};

function replyFrame(value: unknown): ReplyFrame {
  if (typeof value !== 'object' || value === null) throw new WorkerFailure('worker-protocol');
  if (!('id' in value) || !('ok' in value) || !('value' in value)) {
    throw new WorkerFailure('worker-protocol');
  }
  if (typeof value.id !== 'string' || typeof value.ok !== 'boolean') {
    throw new WorkerFailure('worker-protocol');
  }
  return { id: value.id, ok: value.ok, value: value.value };
}

export class WorkerChannel<Request, Reply> {
  readonly #worker: WorkerHandle;
  readonly #decode: (value: unknown) => Reply;
  readonly #signal: AbortSignal | undefined;
  #pending: Pending<Reply> | undefined;
  #closed: WorkerFailure | undefined;

  constructor(worker: WorkerHandle, decode: (value: unknown) => Reply, signal?: AbortSignal) {
    this.#worker = worker;
    this.#decode = decode;
    this.#signal = signal;
    worker.addEventListener('message', this.#onMessage);
    worker.addEventListener('error', this.#onError);
    worker.addEventListener('messageerror', this.#onMessageError);
    signal?.addEventListener('abort', this.#onAbort, { once: true });
    if (signal?.aborted) this.dispose();
  }

  call(command: Request, transfer: Transferable[] = []): Promise<Reply> {
    if (this.#closed) return Promise.reject(this.#closed);
    if (this.#pending) return Promise.reject(new WorkerFailure('worker-busy'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.dispose('worker-timeout');
      }, 30_000);
      this.#pending = { id, resolve, reject, timer };
      try {
        this.#worker.postMessage({ id, command }, transfer);
      } catch {
        this.dispose('worker-protocol');
      }
    });
  }

  dispose(code = 'worker-closed'): void {
    if (this.#closed) return;
    this.#closed = new WorkerFailure(code);
    this.#worker.removeEventListener('message', this.#onMessage);
    this.#worker.removeEventListener('error', this.#onError);
    this.#worker.removeEventListener('messageerror', this.#onMessageError);
    this.#signal?.removeEventListener('abort', this.#onAbort);
    this.#worker.terminate();
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(this.#closed);
      this.#pending = undefined;
    }
  }

  readonly #onMessage = (event: Event): void => {
    try {
      if (!(event instanceof MessageEvent)) throw new WorkerFailure('worker-protocol');
      const data: unknown = event.data;
      this.#receive(replyFrame(data));
    } catch {
      this.dispose('worker-protocol');
    }
  };

  #receive(frame: ReplyFrame): void {
    const pending = this.#pending;
    if (frame.id !== pending?.id) throw new WorkerFailure('worker-protocol');
    clearTimeout(pending.timer);
    this.#pending = undefined;
    if (!frame.ok) {
      const code = typeof frame.value === 'string' ? frame.value : 'worker-operation';
      pending.reject(new WorkerFailure(/^[a-z-]{1,64}$/.test(code) ? code : 'worker-operation'));
      return;
    }
    try {
      pending.resolve(this.#decode(frame.value));
    } catch {
      pending.reject(new WorkerFailure('worker-protocol'));
      this.dispose('worker-protocol');
    }
  }

  readonly #onError = (event: Event): void => {
    event.preventDefault();
    this.dispose('worker-failed');
  };

  readonly #onMessageError = (): void => {
    this.dispose('worker-protocol');
  };

  readonly #onAbort = (): void => {
    this.dispose();
  };
}
