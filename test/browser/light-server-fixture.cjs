const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

class LightServerFixture {
  static async open() {
    const root = await fs.mkdtemp('/dev/shm/monero-wallet-lws-');
    let server;
    try {
      assert.equal((await fs.statfs(root)).type, 0x01021994, 'Scanner fixture requires tmpfs.');
      server = spawn(
        path.join(__dirname, 'monero-lws-daemon'),
        [
          '--regtest',
          '--network',
          'main',
          '--daemon',
          'tcp://127.0.0.1:18082',
          '--rest-server',
          'http://127.0.0.1:18084',
          '--db-path',
          root,
          '--auto-accept-creation',
          '--auto-accept-import',
          '--max-subaddresses',
          '2000',
          '--scan-threads',
          '2',
          '--log-level',
          '0',
        ],
        { cwd: root, stdio: 'ignore' },
      );
      await once(server, 'spawn');
      const fixture = new LightServerFixture(server, root);
      await fixture.ready();
      return fixture;
    } catch (error) {
      await new LightServerFixture(server, root).close();
      throw error;
    }
  }

  constructor(server, root) {
    this.server = server;
    this.root = root;
  }

  async ready() {
    for (let attempt = 0; attempt < 60; attempt++) {
      assert.equal(this.server.exitCode, null, 'The disposable light server exited.');
      try {
        const response = await fetch('http://127.0.0.1:18084/get_version', {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          const version = await response.json();
          assert.equal(version.last_git_commit_hash, 'e70630140be66ac80b990df8221063ae7f28499c');
          return;
        }
        await response.arrayBuffer();
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
      await delay(250);
    }
    throw new Error('Disposable light server startup deadline.');
  }

  async close() {
    const server = this.server;
    try {
      if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
      const exited = once(server, 'exit');
      const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
      server.kill('SIGTERM');
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      await fs.rm(this.root, { recursive: true, force: true });
    }
  }
}

module.exports = { LightServerFixture };
