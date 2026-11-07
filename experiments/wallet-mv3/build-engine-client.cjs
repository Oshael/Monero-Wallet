const path = require('node:path');

const source = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const webpack = require(path.join(source, 'node_modules/webpack'));
const base = require(path.join(source, 'webpack.worker.js'));

webpack(
  {
    ...base,
    name: 'Extension wallet engine client',
    entry: path.join(source, 'index.ts'),
    externals: [],
    resolve: {
      ...base.resolve,
      alias: {
        ...base.resolve.alias,
        child_process: false,
        'web-worker': false,
        worker_threads: false,
        perf_hooks: false,
        ws: false,
      },
    },
    experiments: { outputModule: true },
    output: { path: output, filename: 'wallet-engine-client.js', library: { type: 'module' } },
  },
  (error, stats) => {
    if (error || stats.hasErrors()) {
      console.error(error?.message ?? stats.toString({ all: false, errors: true }));
      process.exitCode = 1;
      return;
    }
    console.log('Public engine module built for the extension worker.');
  },
);
