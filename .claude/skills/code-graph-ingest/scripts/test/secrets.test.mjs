import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readJson } from '../core/io.mjs';
import { findSecrets, maskConfigValue } from '../core/secrets.mjs';
import { validateBundle } from '../core/validate.mjs';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';

test('detects secrets in values', () => {
  assert.ok(findSecrets('mongodb://u:p@h:27017/db').length > 0);
  assert.ok(findSecrets(JWT).length > 0);
  assert.ok(findSecrets('-----BEGIN PRIVATE KEY-----').length > 0);
  assert.ok(findSecrets('password=abc123').length > 0);
  assert.ok(findSecrets('AKIAABCDEFGHIJKLMNOP').length > 0);
  assert.deepEqual(findSecrets('http://10.1.2.3:8081/api'), []);
  assert.deepEqual(findSecrets('${QDRANT_HOST:localhost}'), []);
});

test('masks config values', () => {
  assert.deepEqual(maskConfigValue('spring.data.mongodb.uri', 'mongodb://u:p@h:27017/db'),
    { value: 'mongodb://h:27017/db', masked: true });
  assert.deepEqual(maskConfigValue('b-service.url', 'http://10.1.2.3:8081/api?token=x'),
    { value: 'http://10.1.2.3:8081/api', masked: true });
  assert.deepEqual(maskConfigValue('db.password', 'x'), { value: '***', masked: true });
  assert.deepEqual(maskConfigValue('server.port', '8080'), { value: '8080', masked: false });
  assert.deepEqual(maskConfigValue('b-service.url', 'http://10.1.2.3:8081/api'),
    { value: 'http://10.1.2.3:8081/api', masked: false });
});

test('validator fails on secret anywhere', () => {
  const b = structuredClone(readJson(fileURLToPath(new URL('./fixtures/valid-min.bundle.json', import.meta.url))));
  b.nodes[2].props.description += ' ' + JWT;
  assert.ok(validateBundle(b).errors.some((e) => e.rule === 'R7-secret'));

  const d = structuredClone(b);
  d.nodes[2].props.description = 'ok';
  d.diagnostics.push({ level: 'warn', message: 'password=hunter22' });
  assert.ok(validateBundle(d).errors.some((e) => e.rule === 'R7-secret'));
});
