import { WalletError } from '../domain/validation.ts';

export class ExclusiveSession {
  #release: (() => void) | undefined;
  #holding: Promise<void> | undefined;

  async acquire(signal: AbortSignal): Promise<void> {
    if (this.#holding) throw new WalletError('session-busy');
    let acquired: (() => void) | undefined;
    let rejected: ((error: Error) => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      acquired = resolve;
      rejected = reject;
    });
    this.#holding = navigator.locks
      .request(
        'xmr-wallet-unlocked-session',
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock || signal.aborted) throw new WalletError('session-busy');
          await this.#hold(signal, acquired);
        },
      )
      .catch(() => {
        rejected?.(new WalletError('session-busy'));
      });
    await ready;
  }

  async #hold(signal: AbortSignal, acquired: (() => void) | undefined): Promise<void> {
    let release: () => void = () => {
      throw new WalletError('session-busy');
    };
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#release = release;
    signal.addEventListener('abort', release, { once: true });
    try {
      acquired?.();
      if (signal.aborted) release();
      await held;
    } finally {
      signal.removeEventListener('abort', release);
    }
  }

  async release(): Promise<void> {
    this.#release?.();
    await this.#holding;
    this.#release = undefined;
    this.#holding = undefined;
  }
}
