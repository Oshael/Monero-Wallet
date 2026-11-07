const assert = require('node:assert/strict');

// This fixture owns one transport fault; raw transaction bytes stay in memory.
class LostBroadcastResponse {
  #context;
  #handler;
  #firstHex = '';
  #drop = true;
  #requests = 0;
  #acceptedBeforeDrop = false;
  #sameBytes = true;
  #failed = false;

  constructor(context) {
    this.#context = context;
    this.#handler = (route) => this.#handle(route);
  }

  async install() {
    await this.#context.route('**/send*transaction', this.#handler);
  }

  async #handle(route) {
    try {
      const payload = route.request().postDataJSON();
      const hex = payload.tx_as_hex;
      assert.ok(typeof hex === 'string' && /^[0-9a-f]+$/i.test(hex));
      if (this.#firstHex) this.#sameBytes &&= hex === this.#firstHex;
      else this.#firstHex = hex;
      this.#requests++;
      const response = await route.fetch({ timeout: 20_000, maxRedirects: 0 });
      if (response.status() !== 200) {
        await route.fulfill({ response });
        return;
      }
      const result = await response.json();
      if (this.#drop && result.status === 'OK') {
        this.#drop = false;
        this.#acceptedBeforeDrop = true;
        await route.abort('failed');
        return;
      }
      await route.fulfill({ response });
    } catch {
      this.#failed = true;
      await route.abort('failed');
    }
  }

  report() {
    return {
      requests: this.#requests,
      acceptedBeforeDrop: this.#acceptedBeforeDrop,
      sameBytes: this.#sameBytes,
      failed: this.#failed,
    };
  }

  async close() {
    await this.#context.unroute('**/send*transaction', this.#handler);
    this.#firstHex = '';
  }
}

module.exports = { LostBroadcastResponse };
