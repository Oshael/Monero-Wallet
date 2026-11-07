module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'browser-has-no-node-runtime',
      severity: 'error',
      from: { path: '^src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'ui-uses-session-contract',
      severity: 'error',
      from: { path: '^src/ui/' },
      to: { path: '^src/(engine|vault|transactions)/' },
    },
    {
      name: 'vault-is-independent',
      severity: 'error',
      from: { path: '^src/vault/' },
      to: { path: '^src/(ui|session|engine|transactions)/' },
    },
    {
      name: 'vault-internals-are-private',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/vault/' },
      to: { path: '^src/vault/', pathNot: '^src/vault/index\\.ts$' },
    },
    {
      name: 'engine-internals-are-private',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/engine/' },
      to: { path: '^src/engine/', pathNot: '^src/engine/index\\.ts$' },
    },
    {
      name: 'session-internals-are-private',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/session/' },
      to: { path: '^src/session/', pathNot: '^src/session/index\\.ts$' },
    },
    {
      name: 'transaction-internals-are-private',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/transactions/' },
      to: { path: '^src/transactions/', pathNot: '^src/transactions/index\\.ts$' },
    },
    {
      name: 'engine-has-no-persistence-or-ui',
      severity: 'error',
      from: { path: '^src/engine/' },
      to: { path: '^src/(vault|ui|session)/' },
    },
    {
      name: 'domain-has-no-effects',
      severity: 'error',
      from: { path: '^src/domain/' },
      to: { path: '^src/', pathNot: '^src/domain/' },
    },
    {
      name: 'only-engine-loads-native-client',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/engine/' },
      to: { path: '(vendor/|wallet-engine-client)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules|vendor' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js', '.mjs'] },
  },
};
