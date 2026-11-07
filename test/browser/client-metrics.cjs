const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { withinBudget } = require('./fixture-budget.cjs');

const execute = promisify(execFile);

class ClientMetrics {
  #session;
  #timer;
  #pending;
  #failed = false;
  #samples = 0;
  #peakRssKiB = 0;
  #peakRunnerRssBytes = 0;
  #started = performance.now();
  #closed = false;

  constructor(session) {
    this.#session = session;
    this.#timer = setInterval(() => this.#tick(), 1000);
  }

  #tick() {
    if (this.#pending) return;
    this.#pending = this.#sample()
      .catch(() => {
        this.#failed = true;
      })
      .finally(() => {
        this.#pending = undefined;
      });
  }

  async #sample() {
    const { processInfo } = await withinBudget(
      this.#session.send('SystemInfo.getProcessInfo'),
      'Memory sampling',
    );
    const ids = processInfo.map((info) => info.id);
    if (!ids.length || ids.length > 64 || !ids.every((id) => Number.isSafeInteger(id) && id > 0))
      throw new Error('Invalid browser process list.');
    const { stdout } = await execute('ps', ['-o', 'rss=', '-p', ids.join(',')], {
      timeout: 2000,
      maxBuffer: 10_000,
    });
    const values = stdout.trim().split(/\s+/).map(Number);
    if (!values.every(Number.isSafeInteger)) throw new Error('Invalid process memory sample.');
    this.#peakRssKiB = Math.max(
      this.#peakRssKiB,
      values.reduce((total, value) => total + value, 0),
    );
    this.#peakRunnerRssBytes = Math.max(this.#peakRunnerRssBytes, process.memoryUsage().rss);
    this.#samples++;
  }

  async finish() {
    clearInterval(this.#timer);
    try {
      await this.#pending;
      await this.#sample();
      if (this.#failed || this.#samples < 2) throw new Error('Incomplete client measurement.');
      return {
        elapsedMs: Math.round(performance.now() - this.#started),
        memorySamples: this.#samples,
        peakBrowserRssKiB: this.#peakRssKiB,
        peakRunnerRssBytes: this.#peakRunnerRssBytes,
        memoryMethod: 'sum-of-browser-process-RSS-sampled-every-second',
      };
    } finally {
      await this.close();
    }
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#timer);
    await this.#pending;
    await withinBudget(this.#session.detach(), 'Memory cleanup');
  }
}

module.exports = { ClientMetrics };
