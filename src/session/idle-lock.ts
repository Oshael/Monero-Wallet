export class IdleLock {
  readonly #lock: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastActive = Date.now();

  constructor(lock: () => void) {
    this.#lock = lock;
    document.addEventListener('pointerdown', this.#activity);
    document.addEventListener('keydown', this.#activity);
    document.addEventListener('visibilitychange', this.#resume);
    this.touch();
  }

  touch(): void {
    this.#lastActive = Date.now();
    clearTimeout(this.#timer);
    this.#timer = setTimeout(this.#lock, 5 * 60_000);
  }

  close(): void {
    clearTimeout(this.#timer);
    document.removeEventListener('pointerdown', this.#activity);
    document.removeEventListener('keydown', this.#activity);
    document.removeEventListener('visibilitychange', this.#resume);
  }

  readonly #activity = (event: Event): void => {
    if (event.isTrusted) this.touch();
  };

  readonly #resume = (): void => {
    if (document.visibilityState === 'visible' && Date.now() - this.#lastActive >= 5 * 60_000) {
      this.#lock();
    }
  };
}
