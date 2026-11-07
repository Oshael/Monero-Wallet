import assert from 'node:assert/strict';
import test from 'node:test';
import { atomic, formatAmount, nodeConnection, parseAmount } from '../../src/domain/validation.ts';

void test('amounts use exact atomic integer arithmetic', () => {
  assert.equal(parseAmount('1.000000000001'), 1_000_000_000_001n);
  assert.equal(parseAmount('0.000000000001'), 1n);
  assert.equal(formatAmount('18446744073709551615'), '18446744.073709551615');
  for (const input of ['0', '-1', '01', '1e2', '1.0000000000001', '1,5', 'NaN']) {
    assert.throws(() => parseAmount(input));
  }
  assert.throws(() => atomic('18446744073709551616'));
});

void test('node inputs require HTTPS except for explicitly selected loopback fixtures', () => {
  const valid = { uri: 'https://node.example/', username: '', password: '' };
  assert.equal(nodeConnection(valid).uri, 'https://node.example');
  assert.equal(
    nodeConnection({ ...valid, uri: 'http://127.0.0.1:38081' }).uri,
    'http://127.0.0.1:38081',
  );
  for (const uri of [
    'http://node.example',
    'https://user:secret@node.example',
    'https://node.example/?secret=x',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => nodeConnection({ ...valid, uri }));
  }
});
