interface RequestFrame<Request> {
  id: string;
  command: Request;
}

export interface WorkerResult<Reply> {
  value: Reply;
  transfer?: Transferable[];
}

function requestFrame<Request>(
  data: unknown,
  decode: (value: unknown) => Request,
): RequestFrame<Request> {
  if (typeof data !== 'object' || data === null || !('id' in data) || !('command' in data)) {
    throw new Error('worker-protocol');
  }
  if (typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/.test(data.id)) {
    throw new Error('worker-protocol');
  }
  return { id: data.id, command: decode(data.command) };
}

export function serveWorker<Request, Reply>(options: {
  decode: (value: unknown) => Request;
  execute: (command: Request) => Promise<WorkerResult<Reply>>;
  errorCode: (error: unknown) => string;
}): void {
  let busy = false;
  self.addEventListener('message', (event: MessageEvent<unknown>) => {
    void handle(event.data).catch(() => {
      self.close();
    });
  });

  async function handle(data: unknown): Promise<void> {
    let request: RequestFrame<Request>;
    try {
      request = requestFrame(data, options.decode);
    } catch {
      self.close();
      return;
    }
    if (busy) {
      self.postMessage({ id: request.id, ok: false, value: 'worker-busy' });
      return;
    }
    busy = true;
    try {
      const result = await options.execute(request.command);
      self.postMessage(
        { id: request.id, ok: true, value: result.value },
        { transfer: result.transfer ?? [] },
      );
    } catch (error) {
      self.postMessage({ id: request.id, ok: false, value: options.errorCode(error) });
    } finally {
      busy = false;
    }
  }
}
