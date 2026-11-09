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

test('masks URL credentials containing @ ? / #', () => {
  for (const raw of ['mongodb://u:p@ss@h:27017/db', 'mongodb://u:p?ss@h/db', 'mongodb://u:p/ss@h:27017/db', 'mongodb://u:p#ss@h:27017/db']) {
    const { value, masked } = maskConfigValue('spring.data.mongodb.uri', raw);
    assert.equal(masked, true, raw);
    assert.ok(value === '***' || /^mongodb:\/\/h(:27017)?\/db$/.test(value), `${raw} -> ${value}`);
    assert.ok(!/u:|p|ss@/.test(value.replace('mongodb', '')), `${raw} -> ${value}`);
  }
  assert.equal(maskConfigValue('spring.data.mongodb.uri', 'mongodb://u:p@ss@h:27017/db').value, 'mongodb://h:27017/db');
  assert.equal(maskConfigValue('spring.data.mongodb.uri', 'mongodb://u:p/ss@h:27017/db').value, 'mongodb://h:27017/db');
  assert.equal(maskConfigValue('spring.data.mongodb.uri', 'mongodb://u:p@').value, '***');
});

test('credential keys are masked even when the value looks like a URL', () => {
  assert.deepEqual(maskConfigValue('db.password', 'http://h:8080/x'), { value: '***', masked: true });
  assert.deepEqual(maskConfigValue('db.password', '${DB_PASSWORD}'), { value: '${DB_PASSWORD}', masked: false });
});

test('assignment pattern ignores prose, masks and placeholders', () => {
  assert.deepEqual(findSecrets('Kiểm tra token: hợp lệ'), []);
  assert.deepEqual(findSecrets('spring.datasource.password=***'), []);
  assert.deepEqual(findSecrets('${API_TOKEN:${X}}'), []);
  assert.deepEqual(findSecrets('Token: valid for the session'), []);
  assert.ok(findSecrets('password=abc123').includes('assignment'));
  assert.ok(findSecrets('token: eyJabc123.def').includes('assignment'));
  assert.ok(findSecrets('"apikey": "k3y-value"').includes('assignment'));
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
