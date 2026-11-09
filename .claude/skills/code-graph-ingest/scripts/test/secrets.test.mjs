import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readJson } from '../core/io.mjs';
import { findSecrets, maskConfigValue, CREDENTIAL_KEY, SECRET_KEY } from '../core/secrets.mjs';
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

test('an @ in the path or query is not userinfo', () => {
  assert.deepEqual(maskConfigValue('b-service.url', 'http://h:8080/x?email=a@b.com'),
    { value: 'http://h:8080/x', masked: true });
  assert.deepEqual(maskConfigValue('b-service.url', 'http://h:8080/users/@me'),
    { value: 'http://h:8080/users/@me', masked: false });
  assert.deepEqual(maskConfigValue('repo.url', 'ssh://git@host/repo'), { value: 'ssh://host/repo', masked: true });
});

test('credential keys are masked even when the value looks like a URL', () => {
  assert.deepEqual(maskConfigValue('db.password', 'http://h:8080/x'), { value: '***', masked: true });
  assert.deepEqual(maskConfigValue('db.password', '${DB_PASSWORD}'), { value: '${DB_PASSWORD}', masked: false });
});

test('assignment pattern ignores prose, masks and placeholders', () => {
  assert.deepEqual(findSecrets('Kiểm tra token: hợp lệ'), []);
  assert.deepEqual(findSecrets('spring.datasource.password=***'), []);
  assert.deepEqual(findSecrets('${API_TOKEN:${X}}'), []);
  assert.deepEqual(findSecrets('password=${DB_PASS}'), []);
  assert.deepEqual(findSecrets('password=${DB_PASS:hunter22}'), ['assignment']);
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

test('jaas config keys are credential keys', () => {
  const jaas = 'org.apache.kafka.common.security.plain.PlainLoginModule required username="app" password="pw";';
  assert.deepEqual(maskConfigValue('spring.kafka.properties.sasl.jaas.config', jaas), { value: '***', masked: true });
  assert.ok(CREDENTIAL_KEY.test('sasl.jaas.config') && SECRET_KEY.test('sasl.jaas.config'));
});

test('R7-config-default: credential defaults must be masked', () => {
  const base = structuredClone(readJson(fileURLToPath(new URL('./fixtures/valid-min.bundle.json', import.meta.url))));
  const withKey = (key, props) => {
    const b = structuredClone(base);
    const uid = `uat:robo-lang-chain:config:${key}`;
    b.nodes.push({ type: 'ConfigKey', uid, props: { key, value: '***', masked: true, isPlaceholder: true, ...props } });
    b.edges.push({ type: 'CONTAINS', from: 'uat:robo-lang-chain:service:robo-lang-chain', to: uid, props: {} });
    return validateBundle(b).errors.filter((e) => e.rule === 'R7-config-default');
  };
  // findSecrets alone misses this one.
  assert.deepEqual(findSecrets('${DB_PASS:secret123}'), []);
  assert.equal(withKey('spring.datasource.password', { placeholderExpr: '${DB_PASS:secret123}' }).length, 1);
  assert.equal(withKey('spring.datasource.password', { placeholderExpr: '${DB_PASS:***}', defaultValue: 's3cr3t' }).length, 1);
  assert.equal(withKey('app.client-secret', { placeholderExpr: '${A:${B:topsecret}}' }).length, 1);
  assert.equal(withKey('spring.kafka.properties.sasl.jaas.config', { placeholderExpr: '${JAAS:x y z}' }).length, 1);
  for (const expr of ['${DB_PASS:***}', '${DB_PASS}', '${DB_PASS:}', '${A:${B}}', '${A:${B:***}}'])
    assert.deepEqual(withKey('spring.datasource.password', { placeholderExpr: expr, defaultValue: '***' }), [], expr);
  assert.deepEqual(withKey('spring.datasource.password', { placeholderExpr: null, defaultValue: null }), []);
  // Non-credential keys keep their defaults.
  assert.deepEqual(withKey('server.port', { value: '8080', masked: false, placeholderExpr: '${PORT:8080}', defaultValue: '8080' }), []);
});

test('R7-config-default: a placeholder default must be exactly one balanced placeholder', () => {
  const b = structuredClone(readJson(fileURLToPath(new URL('./fixtures/valid-min.bundle.json', import.meta.url))));
  const uid = 'uat:robo-lang-chain:config:spring.datasource.password';
  const errs = (expr) => {
    const x = structuredClone(b);
    x.nodes.push({ type: 'ConfigKey', uid, props: { key: 'spring.datasource.password', value: '***', masked: true, placeholderExpr: expr } });
    x.edges.push({ type: 'CONTAINS', from: 'uat:robo-lang-chain:service:robo-lang-chain', to: uid, props: {} });
    return validateBundle(x).errors.filter((e) => e.rule === 'R7-config-default');
  };
  assert.equal(errs('${A:${B}s3cret${C}}').length, 1);
  assert.equal(errs('${A:x${B}}').length, 1);
  assert.equal(errs('${A:${B}${C}}').length, 1);
  assert.deepEqual(errs('${A:${B:${C:***}}}'), []);
});

test('findSecrets flags an OFS request carrying user/password (ofs-credential)', () => {
  const hit = (s) => assert.ok(findSecrets(s).includes('ofs-credential'), s);
  const miss = (s) => assert.ok(!findSecrets(s).includes('ofs-credential'), s);
  hit('FUNDS.TRANSFER,ACTR/I/PROCESS,INPUTT/123456,,DEBIT.ACCT.NO=1001');
  hit('FUNDS.TRANSFER,ACTR/I/PROCESS//0,OFSUSER/Pw.2026/VN0010001,FT123');
  hit('ENQUIRY.SELECT,,OFSUSER/secretPw,ENQ.CUST.LIST,SHORT.NAME:EQ=NGUYEN');
  hit('String msg = "CUSTOMER,INPUT/I/PROCESS,user1/pass1,";');
  miss('FUNDS.TRANSFER,ACTR');
  miss('ENQ ENQ.CUST.LIST');
  miss('Nhập giao dịch chuyển khoản nội bộ qua OFS (FUNDS.TRANSFER,ACTR/I/…). Input chính: DEBIT.ACCT.NO, DEBIT.AMOUNT.');
  miss('FUNDS.TRANSFER,ACTR/I/PROCESS,***/***,FT123');
  miss('http://10.1.2.3:8081/b/items/{id}');
});
