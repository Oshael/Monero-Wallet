import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { ESLint } from 'eslint';

const root = path.resolve(import.meta.dirname, '../..');
const execute = promisify(execFile);

test('complexity, nesting and parameter limits produce blocking lint errors', async () => {
  const linter = new ESLint({ cwd: root });
  const cases = [
    ['max-params', 'function fixture(a,b,c,d,e) { return a; }'],
    ['max-depth', 'function fixture(a) { if(a) { if(a) { if(a) { if(a) { return a; } } } } }'],
    ['complexity', `function fixture(a) { ${'if(a) { a++; } '.repeat(10)} return a; }`],
  ];
  for (const [rule, source] of cases) {
    const [result] = await linter.lintText(source, { filePath: 'scripts/quality-fixture.mjs' });
    assert.ok(result.messages.some((message) => message.ruleId === rule && message.severity === 2));
  }
});

test('vault dependencies on UI are blocked by the dependency boundary gate', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'wallet-boundary-'));
  try {
    await fs.mkdir(path.join(directory, 'src/vault'), { recursive: true });
    await fs.mkdir(path.join(directory, 'src/ui'), { recursive: true });
    await fs.writeFile(path.join(directory, 'src/ui/fixture.ts'), 'export const fixture = 1;');
    await fs.writeFile(
      path.join(directory, 'src/vault/fixture.ts'),
      "import { fixture } from '../ui/fixture.ts'; export { fixture };",
    );
    await fs.writeFile(
      path.join(directory, 'tsconfig.json'),
      '{"compilerOptions":{"noEmit":true}}',
    );
    await assert.rejects(
      execute(
        path.join(root, 'node_modules/.bin/depcruise'),
        ['--config', path.join(root, '.dependency-cruiser.cjs'), 'src'],
        { cwd: directory, timeout: 15_000, maxBuffer: 100_000 },
      ),
      (error) => error.code === 1 && error.stdout.includes('vault-is-independent'),
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('module implementation imports are rejected while public contracts are allowed', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'wallet-private-boundary-'));
  const cases = [
    ['session', 'vault'],
    ['session', 'engine'],
    ['ui', 'session'],
    ['session', 'transactions'],
  ];
  try {
    await fs.writeFile(
      path.join(directory, 'tsconfig.json'),
      '{"compilerOptions":{"noEmit":true}}',
    );
    for (const [caller, owner] of cases) {
      await fs.mkdir(path.join(directory, `src/${caller}`), { recursive: true });
      await fs.mkdir(path.join(directory, `src/${owner}`), { recursive: true });
      await fs.writeFile(
        path.join(directory, `src/${owner}/private.ts`),
        'export const fixture = 1;',
      );
      await fs.writeFile(
        path.join(directory, `src/${owner}/index.ts`),
        'export const fixture = 1;',
      );
      await fs.writeFile(
        path.join(directory, `src/${caller}/use-${owner}.ts`),
        `import { fixture } from '../${owner}/private.ts'; export { fixture };`,
      );
    }
    const arguments_ = ['--config', path.join(root, '.dependency-cruiser.cjs'), 'src'];
    await assert.rejects(
      execute(path.join(root, 'node_modules/.bin/depcruise'), arguments_, {
        cwd: directory,
        timeout: 15_000,
        maxBuffer: 100_000,
      }),
      (error) => {
        assert.equal(typeof error.code, 'number', error.stderr);
        assert.notEqual(error.code, 0);
        for (const name of ['vault', 'engine', 'session', 'transaction']) {
          assert.ok(error.stdout.includes(`${name}-internals-are-private`), error.stdout);
        }
        return true;
      },
    );
    for (const [caller, owner] of cases) {
      await fs.writeFile(
        path.join(directory, `src/${caller}/use-${owner}.ts`),
        `import { fixture } from '../${owner}/index.ts'; export { fixture };`,
      );
    }
    await execute(path.join(root, 'node_modules/.bin/depcruise'), arguments_, {
      cwd: directory,
      timeout: 15_000,
      maxBuffer: 100_000,
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
