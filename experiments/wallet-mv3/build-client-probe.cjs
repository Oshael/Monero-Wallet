const path = require('node:path');

const source = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const webpack = require(path.join(source, 'node_modules/webpack'));
const base = require(path.join(source, 'webpack.worker.js'));

const config = {
  ...base,
  name: 'Public wallet API probe',
  entry: path.join(__dirname, 'public-api-probe.mjs'),
  resolve: {
    ...base.resolve,
    alias: { ...base.resolve.alias, 'monero-candidate': path.join(source, 'index.ts') },
    modules: [path.join(source, 'node_modules')],
  },
  resolveLoader: { modules: [path.join(source, 'node_modules')] },
  output: { path: output, filename: 'probe.js' },
};

webpack(config, (error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error?.message ?? stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
    return;
  }
  console.log('Public wallet API probe bundle built.');
});
