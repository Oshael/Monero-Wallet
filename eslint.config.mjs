import tseslint from 'typescript-eslint';
import globals from 'globals';

const limits = {
  complexity: ['error', 10],
  'max-depth': ['error', 3],
  'max-params': ['error', 4],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.local/**',
      '**/dist/**',
      '**/build/**',
      '**/._*',
      'vendor/**',
      'experiments/wallet-mv3/source/**',
      'experiments/wallet-mv3/extension/**',
      'experiments/wallet-mv3/run-*/**',
      'experiments/wallet-mv3/rpc-run-*/**',
    ],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...limits,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs', 'experiments/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.worker } },
    rules: limits,
  },
);
