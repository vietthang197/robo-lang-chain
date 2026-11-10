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
  for (const k of ['clientCalls', 'endpoints', 'deployments', 'services', 'accesses', 'externals', 'channels', 'subscriptions'])
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

test('studio Endpoint -> DataStore chain starts from the exposing Operation and its Component (R21, R22)', () => {
  const chain = studioQueries('uat').find((q) => q.title === 'Chuỗi Endpoint → DataStore');
  assert.ok(chain, 'chain query missing');
  assert.match(chain.cypher, /\(ep:Endpoint\)<-\[:EXPOSES\]-\(op:Operation\) WHERE ep\.env = 'uat'/);
  assert.match(chain.cypher, /OPTIONAL MATCH \(c:Component\)-\[:CONTAINS\]->\(op\)/);
  assert.match(chain.cypher, /\[x IN \[op, c\] WHERE x IS NOT NULL\] AS starts/);
  assert.match(chain.cypher, /UNWIND starts AS s/);
  // Interface dispatch at every junction: 4 forward CALLS|TRIGGERS segments, 3 reverse OVERRIDES hops.
  for (const k of [1, 3, 5]) assert.ok(chain.cypher.includes(`p${k} = `) && chain.cypher.includes('-[:CALLS|TRIGGERS*0..3]->'));
  for (const [k, m, i] of [[2, 'm1', 'i1'], [4, 'm2', 'i2'], [6, 'm3', 'i3']])
    assert.ok(chain.cypher.includes(`p${k} = (${m})<-[:OVERRIDES*0..1]-(${i}:CodeNode)`), `junction p${k}`);
  assert.ok(chain.cypher.includes('p7 = (i3)-[:CALLS|TRIGGERS*0..3]->(n:CodeNode)-[:ACCESSES]->(ds:DataStore)'));
  // CALLS is only ever walked forward: every CALLS pattern is followed by "->".
  for (const m of chain.cypher.matchAll(/\[:CALLS\|TRIGGERS\*0\.\.3\](..)/g)) assert.equal(m[1], '->');
  assert.ok(!chain.cypher.includes('<-[:CALLS'), 'CALLS never reversed');
  assert.match(chain.cypher, /RETURN ep, op, p1, p2, p3, p4, p5, p6, p7 LIMIT 200/);
  const table = studioQueries('uat').find((q) => q.title === 'Chuỗi Endpoint → DataStore (bảng)');
  assert.ok(table, 'table chain query missing');
  assert.match(table.cypher, /RETURN DISTINCT ep.signature AS endpoint, op.qualifiedName AS startOp, ds.uid AS dataStore/);
});
