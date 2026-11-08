const path = require('node:path');
const { runDaemonFixture } = require('./daemon-fixture.cjs');
const { LightServerFixture } = require('./light-server-fixture.cjs');

async function runLightWalletFixture(probe) {
  return runDaemonFixture({
    zmq: true,
    connectOrigins: ['http://127.0.0.1:18084'],
    files: [
      { source: path.join(__dirname, probe.file), name: probe.file },
      { source: path.join(__dirname, 'vendor'), name: 'vendor' },
    ],
    check: async (page, origin) => {
      const server = await LightServerFixture.open();
      try {
        return await page.evaluate(
          async ({ node, file, name }) => {
            const module = await import(`./${file}`);
            return module[name](node, 'http://127.0.0.1:18084');
          },
          { node: origin, file: probe.file, name: probe.name },
        );
      } finally {
        await server.close();
      }
    },
  });
}

module.exports = { runLightWalletFixture };
