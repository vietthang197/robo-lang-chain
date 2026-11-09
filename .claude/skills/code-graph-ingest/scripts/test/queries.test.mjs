import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linkQueries, reportQueries, studioQueries } from '../core/queries.mjs';
import { sharedCleanupStatement } from '../core/batches.mjs';

const CLI = fileURLToPath(new URL('../print-queries.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const WRITE = /\b(CREATE|MERGE|DELETE|SET|REMOVE|DETACH)\b/i;
const names = (qs) => qs.map((q) => q.name);

for (const env of ['dev', 'uat']) {
  test(`env ${env} is substituted as a string literal in every query`, () => {
    const all = [...linkQueries(env), ...reportQueries(env), ...studioQueries(env)];
    for (const q of all) {
      assert.ok(q.cypher.includes(`'${env}'`), `${q.name ?? q.title} lacks '${env}'`);
      assert.ok(!q.cypher.includes('<env>'), `${q.name ?? q.title} still has <env>`);
    }
  });
}

test('link query names', () => {
  const n = names(linkQueries('dev'));
  for (const k of ['clientCalls', 'endpoints', 'deployments', 'services', 'accesses', 'externals', 'channels'])
    assert.ok(n.includes(k), `missing ${k}`);
  assert.equal(new Set(n).size, n.length);
});

test('clientCalls returns the fields link-plan needs', () => {
  const q = linkQueries('dev').find((x) => x.name === 'clientCalls').cypher;
  for (const f of ['uid', 'projectKey', 'clientKind', 'httpMethod', 'urlTemplate', 'resolvedHost',
    'resolvedPort', 'resolvedPath', 'discoveryName', 'signature', 'topic'])
    assert.match(q, new RegExp(`AS ${f}\\b`), `clientCalls lacks ${f}`);
});

test('channels returns uid, tech, name, env', () => {
  const q = linkQueries('dev').find((x) => x.name === 'channels').cypher;
  for (const f of ['uid', 'tech', 'name', 'env']) assert.match(q, new RegExp(`AS ${f}\\b`));
});

test('report query names and gaps attached uid via HAS_GAP', () => {
  const qs = reportQueries('uat');
  assert.deepEqual(names(qs), ['services', 'dependencies', 'dataOwnership', 'gaps']);
  const gaps = qs.find((x) => x.name === 'gaps').cypher;
  assert.match(gaps, /HAS_GAP\]->\(g\)/);
  assert.match(gaps, /AS attached\b/);
});

test('studioQueries has at least 5 titled entries with a <domain> placeholder', () => {
  const qs = studioQueries('dev');
  assert.ok(qs.length >= 5);
  for (const q of qs) assert.ok(q.title && q.cypher);
  assert.ok(qs.some((q) => q.cypher.includes('<domain>')));
});

test('queries are read-only', () => {
  for (const q of [...linkQueries('dev'), ...reportQueries('dev'), ...studioQueries('dev')]) {
    assert.doesNotMatch(q.cypher, WRITE, q.name ?? q.title);
    assert.match(q.cypher.trim(), /^(MATCH|OPTIONAL MATCH)\b/);
  }
});

test('unknown or unsafe env is rejected', () => {
  for (const bad of ['prod', "dev' OR 1=1 //", '', undefined, 'DEV'])
    for (const fn of [linkQueries, reportQueries, studioQueries])
      assert.throws(() => fn(bad), /env/);
});

test('CLI prints link queries as JSON', () => {
  const r = run('link', '--env', 'uat');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out, linkQueries('uat'));
});

test('CLI report and studio modes', () => {
  assert.deepEqual(JSON.parse(run('report', '--env=dev').stdout), reportQueries('dev'));
  const s = run('studio', '--env', 'dev');
  assert.equal(s.status, 0, s.stderr);
  assert.deepEqual(JSON.parse(s.stdout), studioQueries('dev').map(({ title, cypher }) => ({ name: title, cypher })));
});

test('CLI maintenance prints the shared cleanup statement', () => {
  const r = run('maintenance', '--env', 'dev');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [{ name: 'sharedCleanup', cypher: sharedCleanupStatement() }]);
});

test('CLI usage errors exit 2', () => {
  assert.equal(run().status, 2);
  assert.equal(run('bogus', '--env', 'dev').status, 2);
  assert.equal(run('link').status, 2);
  assert.equal(run('link', '--env', 'dev', '--x').status, 2);
  assert.equal(run('link', 'extra', '--env', 'dev').status, 2);
});

test('CLI unknown env exits 1', () => {
  const r = run('link', '--env', 'prod');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /env/);
});
