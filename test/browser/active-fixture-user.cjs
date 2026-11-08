// A paired-profile test keeps both disposable sessions active until its workflow ends.
class ActiveFixtureUser {
  #page;
  #timer;
  #pending;
  #failed = false;
  #closed = false;

  constructor(page) {
    this.#page = page;
    this.#timer = setInterval(() => this.#tick(), 30_000);
  }

  #tick() {
    if (this.#pending) return;
    this.#pending = this.#page.mouse
      .click(5, 5)
      .catch(() => {
        this.#failed = true;
      })
      .finally(() => {
        this.#pending = undefined;
      });
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#timer);
    await this.#pending;
    if (this.#failed) throw new Error('Disposable user activity failed.');
  }
}

module.exports = { ActiveFixtureUser };
