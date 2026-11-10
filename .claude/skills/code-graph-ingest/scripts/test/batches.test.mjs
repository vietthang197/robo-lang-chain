import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readJson } from '../core/io.mjs';
import { toLoadPlan, sharedCleanupStatement, storable, MAX_ROWS, MAX_CHARS } from '../core/batches.mjs';

const fixture = () =>
  readJson(fileURLToPath(new URL('./fixtures/valid-min.bundle.json', import.meta.url)));

const SCAN = { scanId: 'uat-svc-20261109T101500Z', env: 'uat', projectKey: 'svc' };
const bundle = (nodes, edges = [], scan = SCAN) => ({
  schemaVersion: '1.0', scan, nodes, edges, gaps: [], diagnostics: [],
});
const op = (i, props = {}) => ({
  type: 'Operation', uid: `uat:svc:operation:a.B#m${i}`, props: { kind: 'java-method', name: `m${i}`, ...props },
});
const files = (plan) => plan.map((p) => p.file);
const byPrefix = (plan, prefix) => plan.filter((p) => p.file.startsWith(prefix));
const phase = (f) => f[0];

test('limits', () => {
  assert.equal(MAX_ROWS, 300);
  assert.equal(MAX_CHARS, 200000);
});

test('orders statements', () => {
  const plan = toLoadPlan(fixture(), { mode: 'ingest' });
  const names = files(plan);
  assert.equal(names[0], '000-schema');
  assert.equal(plan[0].language, 'sqlscript');
  assert.equal(names.at(-2), '900-cleanup');
  assert.equal(names.at(-1), '990-count');
  const middle = names.slice(1, -2).map(phase);
  assert.deepEqual(middle, [...middle].sort());
  assert.ok(middle.includes('1') && middle.includes('2') && middle.includes('3'));
  assert.deepEqual(new Set(middle), new Set(['1', '2', '3']));
  for (const p of plan.slice(1)) assert.equal(p.language, 'cypher', p.file);
  assert.ok(names.includes('100-nodes-Service'));
  assert.ok(names.some((n) => /^2\d\d-delete-stale-edges$/.test(n)));
  assert.ok(names.some((n) => /^3\d\d-edges-CONTAINS$/.test(n)));
  assert.equal(new Set(names).size, names.length);
  // CodeNode is the supertype: never a label for rows
  assert.ok(!plan.some((p) => p.file.includes('nodes-CodeNode')));
});

test('splits by count', () => {
  const plan = toLoadPlan(bundle(Array.from({ length: 650 }, (_, i) => op(i))), { mode: 'ingest' });
  const nodeBatches = byPrefix(plan, '1');
  assert.equal(nodeBatches.length, 3);
  const rows = nodeBatches.map((b) => (b.statement.match(/uid: 'uat:svc:operation:/g) ?? []).length);
  assert.deepEqual(rows, [300, 300, 50]);
});

test('splits by size', () => {
  const big = 'x'.repeat(250000);
  const plan = toLoadPlan(bundle([op(1), op(2, { description: big }), op(3)]), { mode: 'ingest' });
  const nodeBatches = byPrefix(plan, '1');
  const withBig = nodeBatches.filter((b) => b.statement.includes(big));
  assert.equal(withBig.length, 1);
  assert.equal((withBig[0].statement.match(/uid: 'uat:svc:operation:/g) ?? []).length, 1);
  const all = nodeBatches.map((b) => b.statement).join('\n');
  for (const i of [1, 2, 3]) assert.ok(all.includes(`a.B#m${i}'`), `m${i}`);
  for (const b of nodeBatches.filter((b) => !b.statement.includes(big)))
    assert.ok(b.statement.length <= MAX_CHARS);
});

test('cleanup is scoped', () => {
  const plan = toLoadPlan(
    bundle(
      [op(1), { type: 'Library', uid: 'lib:maven:g:a', props: { name: 'a' } }],
      [{ type: 'DEPENDS_ON', from: 'uat:svc:operation:a.B#m1', to: 'lib:maven:g:a', props: {} }],
    ),
    { mode: 'ingest' },
  );
  const cleanup = plan.find((p) => p.file === '900-cleanup').statement;
  assert.ok(cleanup.includes("env:'uat'"));
  assert.ok(cleanup.includes("projectKey:'svc'"));
  assert.ok(cleanup.includes(`scanId <> '${SCAN.scanId}'`));
  const stale = plan.find((p) => p.file.endsWith('delete-stale-edges')).statement;
  assert.ok(stale.includes("env:'uat'") && stale.includes("projectKey:'svc'"));
  for (const p of plan) {
    if (!/DELETE/.test(p.statement)) continue;
    assert.ok(!/ext:|lib:/.test(p.statement), p.file);
    assert.ok(p.statement.includes("projectKey:'svc'"), p.file);
  }
  const count = plan.find((p) => p.file === '990-count').statement;
  assert.ok(count.startsWith("MATCH (n:CodeNode {env:'uat', projectKey:'svc'}) WITH count(n) AS nodes "), count);
  assert.ok(count.includes("OPTIONAL MATCH (a:CodeNode {env:'uat', projectKey:'svc'})-[e]->()"), count);
});

test('ingest rows carry scan fields; shared rows never get projectKey', () => {
  const plan = toLoadPlan(
    bundle([
      op(1),
      { type: 'Library', uid: 'lib:maven:g:a', props: { name: 'a' } },
      { type: 'DataStore', uid: 'ds:uat:mongodb:db.c', props: { tech: 'mongodb' } },
    ]),
    { mode: 'ingest' },
  );
  const stmt = (t) => plan.find((p) => p.file.endsWith(`nodes-${t}`)).statement;
  assert.match(stmt('Operation'), /env: 'uat'/);
  assert.match(stmt('Operation'), /projectKey: 'svc'/);
  assert.match(stmt('Operation'), new RegExp(`scanId: '${SCAN.scanId}'`));
  assert.ok(!stmt('Library').includes('projectKey'));
  assert.ok(!stmt('Library').includes('env'));
  assert.match(stmt('DataStore'), /env: 'uat'/);
  assert.ok(!stmt('DataStore').includes('projectKey'));
  // only project nodes are counted by 990-count (shared rows carry no projectKey)
  assert.equal(plan.find((p) => p.file === '990-count').expectNodes, 1);
  assert.match(stmt('Operation'), /^UNWIND \[.*\] AS r MERGE \(n:Operation \{uid: r\.uid\}\) SET n\./s);
});

test('protects human descriptions', () => {
  const plan = toLoadPlan(fixture(), { mode: 'ingest' });
  const s = plan.find((p) => p.file.endsWith('nodes-Component')).statement;
  assert.ok(s.includes("CASE WHEN n.descriptionSource = 'human'"));
  assert.ok(s.includes("n.description = CASE WHEN n.descriptionSource = 'human' THEN n.description ELSE r.description END"));
  const withSource = toLoadPlan(bundle([op(1, { description: 'd', descriptionSource: 'ai' })]), { mode: 'ingest' })
    .find((p) => p.file.endsWith('nodes-Operation')).statement;
  // description is decided before descriptionSource can change
  assert.ok(withSource.indexOf('n.description =') < withSource.indexOf('n.descriptionSource ='));
  assert.ok(withSource.includes(
    "n.descriptionSource = CASE WHEN n.descriptionSource = 'human' THEN n.descriptionSource ELSE r.descriptionSource END",
  ));
});

test('edge rows carry scanId and keep env/derived', () => {
  const plan = toLoadPlan(fixture(), { mode: 'ingest' });
  const s = plan.find((p) => p.file.endsWith('edges-CONTAINS')).statement;
  assert.match(s, /^UNWIND \[.*\] AS r MATCH \(a:CodeNode \{uid:r\.from\}\), \(b:CodeNode \{uid:r\.to\}\) MERGE \(a\)-\[e:CONTAINS\]->\(b\) SET e\.scanId = r\.scanId/s);
  assert.ok(s.includes("scanId: 'uat-robo-lang-chain-20261109T101500Z'"));
  const stale = plan.find((p) => p.file.endsWith('delete-stale-edges')).statement;
  assert.equal(
    stale,
    "MATCH (a:CodeNode {env:'uat', projectKey:'robo-lang-chain'})-[e]->() WHERE e.scanId IS NULL OR e.scanId <> 'uat-robo-lang-chain-20261109T101500Z' DELETE e",
  );
});

test('unsafe property keys throw', () => {
  assert.throws(() => toLoadPlan(bundle([op(1, { 'bad-key': 1 })]), { mode: 'ingest' }), /bad-key/);
  assert.throws(
    () => toLoadPlan(bundle([op(1), op(2)], [{ type: 'CALLS', from: op(1).uid, to: op(2).uid, props: { 'x y': 1 } }]), { mode: 'ingest' }),
    /x y/,
  );
});

test('unknown or supertype labels throw', () => {
  assert.throws(() => toLoadPlan(bundle([{ type: 'CodeNode', uid: 'uat:svc:module:x', props: {} }]), { mode: 'ingest' }), /CodeNode/);
  assert.throws(() => toLoadPlan(bundle([{ type: 'Nope', uid: 'uat:svc:module:x', props: {} }]), { mode: 'ingest' }), /Nope/);
  assert.throws(() => toLoadPlan(bundle([op(1)], [{ type: 'NOPE', from: 'a', to: 'b', props: {} }]), { mode: 'ingest' }), /NOPE/);
  assert.throws(() => toLoadPlan(fixture(), { mode: 'other' }), /mode/);
});

const LINK_SCAN = { scanId: 'uat-system-20261110T000000Z', env: 'uat', projectKey: '__system__' };
const linkBundle = () =>
  bundle(
    [
      { type: 'Deployment', uid: 'uat:svc:deployment', props: { hosts: ['10.0.0.1'] } },
      { type: 'Deployment', uid: 'uat:other:deployment', props: { port: 8081 } },
      { type: 'ExternalSystem', uid: 'sys:uat:ollama', props: { host: 'ollama' } },
      { type: 'Gap', uid: 'gap:uat:system:ambiguous-target:abc', props: { kind: 'ambiguous-target' } },
    ],
    [
      { type: 'SERVICE_DEPENDS_ON', from: 'uat:svc:service:svc', to: 'sys:uat:ollama', props: { derived: true, env: 'uat', protocol: 'http' } },
      { type: 'HAS_GAP', from: 'uat:svc:service:svc', to: 'gap:uat:system:ambiguous-target:abc', props: { derived: true } },
    ],
    LINK_SCAN,
  );

test('link mode', () => {
  const plan = toLoadPlan(linkBundle(), { mode: 'link' });
  const names = files(plan);
  assert.ok(!names.some((n) => n.includes('delete-stale-edges')));
  assert.ok(names.includes('900-cleanup-derived'));
  assert.ok(!names.includes('900-cleanup'));
  assert.equal(names[0], '000-schema');
  assert.equal(names.at(-1), '990-count');

  const deps = plan.filter((p) => p.file.endsWith('nodes-Deployment'));
  const hostsStmt = deps.find((p) => p.statement.includes('hosts')).statement;
  assert.ok(hostsStmt.includes('n.hosts = r.hosts'));
  // a patch never creates a node: MATCH, not MERGE
  assert.ok(hostsStmt.includes('MATCH (n:Deployment {uid: r.uid})') && !hostsStmt.includes('MERGE'));
  assert.ok(!hostsStmt.includes('projectKey'));
  assert.ok(!/scanId|env/.test(hostsStmt));
  // patches with different key sets never null each other's props
  assert.ok(!hostsStmt.includes('port'));
  assert.ok(deps.some((p) => p.statement.includes('n.port = r.port') && !p.statement.includes('hosts')));

  const sys = plan.find((p) => p.file.endsWith('nodes-ExternalSystem')).statement;
  assert.ok(sys.includes("env: 'uat'") && sys.includes(`scanId: '${LINK_SCAN.scanId}'`));
  assert.ok(!sys.includes('projectKey'));
  assert.ok(sys.includes('MERGE (n:ExternalSystem {uid: r.uid})'));
  const count = plan.find((p) => p.file === '990-count');
  assert.equal(count.statement, `MATCH (n:CodeNode) WHERE n.scanId = '${LINK_SCAN.scanId}' RETURN count(n) AS nodes`);
  assert.equal(count.expectNodes, 2);

  const dep = plan.find((p) => p.file.endsWith('edges-SERVICE_DEPENDS_ON')).statement;
  assert.ok(dep.includes('derived: true') && dep.includes("env: 'uat'"));
  const gapEdge = plan.find((p) => p.file.endsWith('edges-HAS_GAP')).statement;
  assert.ok(gapEdge.includes("env: 'uat'"), 'derived edge gets env from scan');

  const cleanup = plan.filter((p) => p.file.startsWith('9') && p.file.includes('cleanup')).map((p) => p.statement);
  assert.ok(cleanup.includes(
    `MATCH ()-[e]->() WHERE e.derived = true AND e.env = 'uat' AND (e.scanId IS NULL OR e.scanId <> '${LINK_SCAN.scanId}') DELETE e`,
  ));
  assert.ok(cleanup.includes(
    `MATCH (g:Gap) WHERE g.uid STARTS WITH 'gap:uat:system:' AND (g.scanId IS NULL OR g.scanId <> '${LINK_SCAN.scanId}') DETACH DELETE g`,
  ));
});

test('mode must match bundle kind', () => {
  assert.throws(() => toLoadPlan(linkBundle(), { mode: 'ingest' }), /__system__/);
  assert.throws(() => toLoadPlan(fixture(), { mode: 'link' }), /__system__/);
});

test('shared cleanup only touches orphans', () => {
  const s = sharedCleanupStatement();
  assert.ok(s.includes('NOT (n)--()'));
  for (const p of ['ext:', 'lib:', 'tag:', 'ds:', 'ch:', 'sys:']) assert.ok(s.includes(`n.uid STARTS WITH '${p}'`), p);
  assert.ok(!toLoadPlan(fixture(), { mode: 'ingest' }).some((p) => p.statement === s));
});

test('project gaps are scoped like project nodes (R12)', () => {
  const gap = { type: 'Gap', uid: 'gap:uat:svc:unresolved-call:abc', props: { kind: 'unresolved-call' } };
  const sysGap = { type: 'Gap', uid: 'gap:uat:system:ambiguous-target:def', props: { kind: 'ambiguous-target' } };
  const plan = toLoadPlan(bundle([op(1), gap, sysGap]), { mode: 'ingest' });
  const s = plan.find((p) => p.file.endsWith('nodes-Gap')).statement;
  const rowOf = (uid) => s.slice(s.indexOf(`{uid: '${uid}'`)).split('}')[0];
  assert.ok(rowOf(gap.uid).includes("projectKey: 'svc'"));
  assert.ok(rowOf(gap.uid).includes("env: 'uat'") && rowOf(gap.uid).includes(`scanId: '${SCAN.scanId}'`));
  assert.ok(!rowOf(sysGap.uid).includes('projectKey'));
  // 900-cleanup selects by (env, projectKey), which now includes the project gap
  const cleanup = plan.find((p) => p.file === '900-cleanup').statement;
  assert.ok(cleanup.startsWith("MATCH (n:CodeNode {env:'uat', projectKey:'svc'})"));
  assert.equal(plan.find((p) => p.file === '990-count').expectNodes, 2);
});

test('cleanups also remove rows with null scanId, within scope (R13)', () => {
  const plan = toLoadPlan(fixture(), { mode: 'ingest' });
  const sid = "'uat-robo-lang-chain-20261109T101500Z'";
  assert.equal(
    plan.find((p) => p.file === '200-delete-stale-edges').statement,
    `MATCH (a:CodeNode {env:'uat', projectKey:'robo-lang-chain'})-[e]->() WHERE e.scanId IS NULL OR e.scanId <> ${sid} DELETE e`,
  );
  assert.equal(
    plan.find((p) => p.file === '900-cleanup').statement,
    `MATCH (n:CodeNode {env:'uat', projectKey:'robo-lang-chain'}) WHERE n.scanId IS NULL OR n.scanId <> ${sid} DETACH DELETE n`,
  );
  const link = toLoadPlan(linkBundle(), { mode: 'link' });
  const derived = link.find((p) => p.file === '900-cleanup-derived').statement;
  assert.equal(
    derived,
    `MATCH ()-[e]->() WHERE e.derived = true AND e.env = 'uat' AND (e.scanId IS NULL OR e.scanId <> '${LINK_SCAN.scanId}') DELETE e`,
  );
  assert.ok(link.find((p) => p.file === '901-cleanup-derived-gaps').statement.includes("g.uid STARTS WITH 'gap:uat:system:' AND (g.scanId IS NULL OR"));
});

test('ingest Service row gets scan.coverage when it has none (R19); link mode untouched', () => {
  const b = fixture();
  const svcStmt = (plan) => plan.find((p) => p.file.endsWith('-nodes-Service')).statement;
  const plan = toLoadPlan(b, { mode: 'ingest' });
  assert.ok(svcStmt(plan).includes(`coverage: '{"filesTotal":34,"filesRead":34,"skipped":[]}'`));
  assert.match(svcStmt(plan), /n\.coverage = r\.coverage/);
  const own = fixture();
  own.nodes.find((n) => n.type === 'Service').props.coverage = { filesTotal: 9, filesRead: 1 };
  const s2 = svcStmt(toLoadPlan(own, { mode: 'ingest' }));
  assert.ok(s2.includes(`coverage: '{"filesTotal":9,"filesRead":1}'`));
  assert.ok(!s2.includes('filesTotal: 34'));
  const none = fixture();
  delete none.scan.coverage;
  assert.ok(!svcStmt(toLoadPlan(none, { mode: 'ingest' })).includes('coverage'));
  // Non-Service nodes never get it.
  for (const p of plan.filter((x) => /-nodes-/.test(x.file) && !x.file.endsWith('-nodes-Service')))
    assert.ok(!p.statement.includes('filesTotal'), p.file);
});

test('map props and lists of maps are stored as JSON strings (ArcadeDB has no map properties)', () => {
  assert.equal(storable({ a: 1 }), '{"a":1}');
  assert.equal(storable([{ a: 1 }]), '[{"a":1}]');
  assert.deepEqual(storable(['x', 1, true, null]), ['x', 1, true, null]);
  assert.equal(storable('s'), 's');
  assert.equal(storable(null), null);
  const b = fixture();
  b.edges.push({ type: 'TAGGED', from: b.nodes[0].uid, to: b.nodes[0].uid, props: { attributes: { value: '/x' } } });
  const plan = toLoadPlan(b, { mode: 'ingest' });
  const all = plan.map((p) => p.statement ?? '').join('\n');
  // Row literals start after "[" or ", "; a map assigned to a property would read "key: {".
  assert.ok(!/\w: \{/.test(all), 'no map literal is assigned as a property value');
  assert.ok(all.includes(`attributes: '{"value":"/x"}'`));
});

test('ingest: shared rows with different key sets never SET a key they lack (no nulling)', () => {
  const full = { type: 'DataStore', uid: 'ds:uat:mongodb:db.a', props: { tech: 'mongodb', location: 'db1:27017' } };
  const thin = { type: 'DataStore', uid: 'ds:uat:mongodb:db.b', props: { tech: 'mongodb' } };
  const lib1 = { type: 'Library', uid: 'lib:maven:g:a', props: { name: 'a', version: '1.0' } };
  const lib2 = { type: 'Library', uid: 'lib:maven:g:b', props: { name: 'b' } };
  const plan = toLoadPlan(bundle([op(1), op(2, { description: 'x', descriptionSource: 'ai' }), full, thin, lib1, lib2]), { mode: 'ingest' });
  for (const p of plan.filter((x) => /nodes-(DataStore|Library)$/.test(x.file))) {
    const sets = [...p.statement.matchAll(/n\.(\w+) = r\.\1/g)].map((m) => m[1]);
    const rows = p.statement.slice(p.statement.indexOf('[') + 1, p.statement.indexOf('] AS r'));
    const rowCount = (rows.match(/\{uid: /g) ?? []).length;
    for (const k of sets)
      assert.equal((rows.match(new RegExp(`\\b${k}: `, 'g')) ?? []).length, rowCount, `${p.file} sets ${k} for a row lacking it`);
  }
  assert.ok(!plan.some((p) => p.file.endsWith('nodes-DataStore') && p.statement.includes('db.b') && p.statement.includes('n.location')));
  // project rows keep one batch per label (union of keys)
  assert.equal(plan.filter((p) => p.file.endsWith('nodes-Operation')).length, 1);
});

test('990-count also counts edges from project nodes; plan carries expectEdges', () => {
  const ds = { type: 'DataStore', uid: 'ds:uat:mongodb:db.a', props: { tech: 'mongodb' } };
  const edges = [
    { type: 'CALLS', from: op(1).uid, to: op(2).uid },
    { type: 'CALLS', from: op(1).uid, to: op(2).uid }, // duplicate merges into one
    { type: 'ACCESSES', from: op(2).uid, to: ds.uid, props: { mode: 'read' } },
    { type: 'TAGGED', from: ds.uid, to: 'tag:x:y' }, // from a shared node: not counted
  ];
  const plan = toLoadPlan(bundle([op(1), op(2), ds], edges), { mode: 'ingest' });
  const count = plan.find((p) => p.file === '990-count');
  assert.equal(count.expectNodes, 2);
  assert.equal(count.expectEdges, 2);
  assert.equal(count.statement,
    "MATCH (n:CodeNode {env:'uat', projectKey:'svc'}) WITH count(n) AS nodes " +
    "OPTIONAL MATCH (a:CodeNode {env:'uat', projectKey:'svc'})-[e]->() WHERE e.scanId = 'uat-svc-20261109T101500Z' " +
    'RETURN nodes, count(e) AS edges');
});
