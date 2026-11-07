const { withinBudget } = require('./fixture-budget.cjs');

class RpcTraffic {
  #context;
  #prefix;
  #listener;
  #pending = new Set();
  #failed = false;
  #sizes = { requests: 0, requestBytes: 0, responseBytes: 0 };

  constructor(context, origin) {
    this.#context = context;
    this.#prefix = `${new URL(origin).origin}/`;
    this.#listener = (request) => this.#record(request);
    context.on('requestfinished', this.#listener);
  }

  #record(request) {
    if (!request.url().startsWith(this.#prefix)) return;
    if (this.#pending.size >= 64 || this.#sizes.requests >= 100_000) {
      this.#failed = true;
      return;
    }
    const sampled = withinBudget(request.sizes(), 'Traffic sampling')
      .then((sizes) => {
        this.#sizes.requests++;
        this.#sizes.requestBytes += sizes.requestBodySize + sizes.requestHeadersSize;
        this.#sizes.responseBytes += sizes.responseBodySize + sizes.responseHeadersSize;
      })
      .catch(() => {
        this.#failed = true;
      });
    this.#pending.add(sampled);
    void sampled.finally(() => this.#pending.delete(sampled));
  }

  async finish() {
    await this.close();
    if (this.#failed) throw new Error('Traffic measurement incomplete.');
    return { ...this.#sizes };
  }

  async close() {
    this.#context.off('requestfinished', this.#listener);
    await Promise.all(this.#pending);
  }
}

module.exports = { RpcTraffic };
