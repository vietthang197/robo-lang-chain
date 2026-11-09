import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../core/io.mjs';
import { planLinks } from '../core/link.mjs';
import { validateBundle } from '../core/validate.mjs';
import { toLoadPlan } from '../core/batches.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/link-input.json', import.meta.url));
const CLI = fileURLToPath(new URL('../link-plan.mjs', import.meta.url));
const input = () => readJson(FIXTURE);
const OPTS = { env: 'uat', scanId: 'uat-link-20261110T000000Z', gapAnswers: [] };

const CALL1 = 'uat:a-service:clientcall:com.x.BClient#get->feign:GET /items/{id}';
const CALL2 = 'uat:a-service:clientcall:com.x.BClient#getAgain->feign:GET /items/{id}';
const OFS = 'uat:a-service:clientcall:com.x.T24Client#transfer->ofs:FUNDS.TRANSFER,ACTR';
const PARTNER = 'uat:a-service:clientcall:com.x.PartnerClient#x->rest-template:GET http://api.partner.com/v1/x';
const B_EP = 'uat:b-service:endpoint:http:GET /items/{id}';
const C_EP = 'uat:c-service:endpoint:http:GET /items/{id}';
const T24_EP = 'uat:t24:endpoint:ofs:FUNDS.TRANSFER,ACTR';

const targets = (b, from) => b.edges.filter((e) => e.type === 'TARGETS' && e.from === from);
const gapUid = (kind, call) => `gap:uat:system:${kind}:${createHash('sha1').update(call).digest('hex').slice(0, 12)}`;
const node = (b, uid) => b.nodes.find((n) => n.uid === uid);
const call = (inp, uid) => inp.clientCalls.find((c) => c.uid === uid);
const dep = (inp, pk) => inp.deployments.find((d) => d.projectKey === pk);

test('host+path match', () => {
  const b = planLinks(input(), OPTS);
  assert.equal(b.scan.projectKey, '__system__');
  const t = targets(b, CALL1);
  assert.equal(t.length, 1);
  assert.equal(t[0].to, B_EP);
  assert.deepEqual(t[0].props, { matchedBy: 'host+path', confidence: 'high', derived: true, env: 'uat' });
  assert.ok(!b.edges.some((e) => e.to === C_EP));
  // host already known: no Deployment patch
  assert.ok(!b.nodes.some((n) => n.type === 'Deployment'));
});

test('port-only match when the deployment has no hosts yet is host+path/medium (rule recorded)', () => {
  const inp = input();
  dep(inp, 'b-service').hosts = [];
  const t = targets(planLinks(inp, OPTS), CALL1);
  assert.equal(t[0].to, B_EP);
  assert.equal(t[0].props.matchedBy, 'host+path');
  assert.equal(t[0].props.confidence, 'medium');
});

test('known hosts without the call host: no host match; context-path strip still yields one path candidate', () => {
  const inp = input();
  dep(inp, 'b-service').hosts = ['10.9.9.9'];
  const t = targets(planLinks(inp, OPTS), CALL1);
  assert.equal(t[0].to, B_EP);
  assert.deepEqual([t[0].props.matchedBy, t[0].props.confidence], ['path', 'medium']);
});

test('context path: call path not under contextPath is not a candidate', () => {
  const inp = input();
  for (const c of inp.clientCalls) if (c.resolvedPath) { c.resolvedHost = null; c.resolvedPort = null; }
  call(inp, CALL1).resolvedPath = '/items/{id}';
  const b = planLinks(inp, OPTS);
  // b has contextPath /b, so only c remains -> path/medium to c
  const t = targets(b, CALL1);
  assert.equal(t.length, 1);
  assert.equal(t[0].to, C_EP);
  assert.equal(t[0].props.matchedBy, 'path');
});

test('ambiguous without host', () => {
  const inp = input();
  for (const id of [CALL1, CALL2]) Object.assign(call(inp, id), { resolvedHost: null, resolvedPort: null });
  dep(inp, 'c-service').contextPath = '/b';
  const b = planLinks(inp, OPTS);
  assert.equal(targets(b, CALL1).length, 0);
  const uid = gapUid('ambiguous-target', CALL1);
  const g = node(b, uid);
  assert.equal(g.type, 'Gap');
  assert.equal(g.props.kind, 'ambiguous-target');
  assert.equal(g.props.askWho, 'BA');
  assert.equal(g.props.status, 'open');
  assert.equal(g.props.question, 'Lời gọi GET /items/{id} từ a-service trỏ tới host/IP nào?');
  assert.deepEqual(g.props.candidates, [
    { projectKey: 'b-service', hosts: ['10.1.2.3'], port: 8081 },
    { projectKey: 'c-service', hosts: [], port: 8082 },
  ]);
  assert.ok(b.edges.some((e) => e.type === 'HAS_GAP' && e.from === CALL1 && e.to === uid));
  assert.ok(b.gaps.some((x) => x.uid === uid && x.kind === 'ambiguous-target'));
  assert.deepEqual(validateBundle(b, { mode: 'link' }).errors, []);
});

test('ofs match', () => {
  const t = targets(planLinks(input(), OPTS), OFS);
  assert.equal(t.length, 1);
  assert.equal(t[0].to, T24_EP);
  assert.deepEqual([t[0].props.matchedBy, t[0].props.confidence], ['ofs-version', 'high']);
});

test('null signature/discoveryName/topic never match null (R15)', () => {
  const inp = input();
  call(inp, OFS).signature = null;
  inp.endpoints.push({ uid: 'uat:t24:endpoint:ofs:NULLSIG', projectKey: 't24', protocol: 'ofs', httpMethod: null, path: null, pathRegex: null, signature: null });
  inp.services.push({ uid: 'uat:x:service:x', projectKey: 'x', name: null });
  inp.channels.push({ uid: 'ch:uat:kafka:t', tech: 'kafka', name: null, env: 'uat' });
  const b = planLinks(inp, OPTS);
  assert.equal(targets(b, OFS).length, 0);
  assert.ok(node(b, gapUid('unknown-external', OFS)));
});

test('topic match targets the channel', () => {
  const inp = input();
  inp.channels.push({ uid: 'ch:uat:kafka:payment.created', tech: 'kafka', name: 'payment.created', env: 'uat' });
  inp.clientCalls.push({ uid: 'uat:a-service:clientcall:com.x.P#send->kafka-producer:payment.created', projectKey: 'a-service',
    clientKind: 'kafka-producer', httpMethod: null, urlTemplate: 'payment.created', baseUrlConfigKey: null, resolvedHost: null,
    resolvedPort: null, resolvedPath: null, discoveryName: null, signature: null, topic: 'payment.created', confidence: 'high', manualTargets: [] });
  const b = planLinks(inp, OPTS);
  const t = targets(b, 'uat:a-service:clientcall:com.x.P#send->kafka-producer:payment.created');
  assert.deepEqual(t.map((e) => [e.to, e.props.matchedBy, e.props.confidence]), [['ch:uat:kafka:payment.created', 'topic', 'high']]);
});

test('discovery name match is host+path/high', () => {
  const inp = input();
  Object.assign(call(inp, CALL1), { resolvedHost: null, resolvedPort: null, resolvedPath: '/items/{id}', discoveryName: 'c-service' });
  const t = targets(planLinks(inp, OPTS), CALL1);
  assert.deepEqual(t.map((e) => [e.to, e.props.matchedBy, e.props.confidence]), [[C_EP, 'host+path', 'high']]);
});

test('external host', () => {
  const b = planLinks(input(), OPTS);
  const t = targets(b, PARTNER);
  assert.deepEqual(t.map((e) => [e.to, e.props.matchedBy, e.props.confidence]), [['sys:uat:api.partner.com', 'host', 'medium']]);
  assert.deepEqual(node(b, 'sys:uat:api.partner.com'),
    { type: 'ExternalSystem', uid: 'sys:uat:api.partner.com', props: { name: 'api.partner.com', host: 'api.partner.com', port: 80 } });
  assert.ok(b.edges.some((e) => e.type === 'SERVICE_DEPENDS_ON' && e.from === 'uat:a-service:service:a-service' && e.to === 'sys:uat:api.partner.com'));
});

test('no host and no candidate -> unknown-external gap', () => {
  const inp = input();
  Object.assign(call(inp, PARTNER), { resolvedHost: null, resolvedPort: null, urlTemplate: '/v1/x' });
  const b = planLinks(inp, OPTS);
  const g = node(b, gapUid('unknown-external', PARTNER));
  assert.equal(g.props.kind, 'unknown-external');
  assert.equal(g.props.status, 'open');
  assert.ok(b.edges.some((e) => e.type === 'HAS_GAP' && e.from === PARTNER));
});

test('manual answer wins', () => {
  const inp = input();
  dep(inp, 'c-service').contextPath = '/b';
  const gapAnswers = [
    { env: 'uat', clientCall: CALL1, answer: { targetService: 'c-service', host: '10.9.9.9' }, answeredBy: 'BA' },
    { env: 'dev', clientCall: CALL2, answer: { targetService: 'c-service' }, answeredBy: 'BA' },
  ];
  const b = planLinks(inp, { ...OPTS, gapAnswers });
  const t = targets(b, CALL1);
  assert.deepEqual(t.map((e) => [e.to, e.props.matchedBy, e.props.confidence]), [[C_EP, 'manual', 'high']]);
  // other-env answer is ignored
  assert.equal(targets(b, CALL2)[0].to, B_EP);
  // answer.host (not the call host) lands in c's deployment hosts
  assert.deepEqual(node(b, 'uat:c-service:deployment'),
    { type: 'Deployment', uid: 'uat:c-service:deployment', props: { hosts: ['10.9.9.9'] } });
  assert.deepEqual(validateBundle(b, { mode: 'link' }).errors, []);
});

test('manual answer that resolves no endpoint -> ambiguous-target gap', () => {
  const gapAnswers = [{ env: 'uat', clientCall: CALL1, answer: { targetService: 'c-service' }, answeredBy: 'BA' }];
  const b = planLinks(input(), { ...OPTS, gapAnswers });
  assert.equal(targets(b, CALL1).length, 0);
  const g = node(b, gapUid('ambiguous-target', CALL1));
  assert.match(g.props.question, /gapAnswers/);
  assert.match(g.props.question, /c-service/);
});

test('manual answer closes the automatic gap as answered', () => {
  const inp = input();
  for (const id of [CALL1, CALL2]) Object.assign(call(inp, id), { resolvedHost: null, resolvedPort: null });
  dep(inp, 'c-service').contextPath = '/b';
  const gapAnswers = [{ env: 'uat', clientCall: CALL1, answer: { targetService: 'b-service' }, answeredBy: 'BA' }];
  const b = planLinks(inp, { ...OPTS, gapAnswers });
  assert.equal(targets(b, CALL1)[0].props.matchedBy, 'manual');
  assert.equal(node(b, gapUid('ambiguous-target', CALL1)).props.status, 'answered');
  assert.equal(node(b, gapUid('ambiguous-target', CALL2)).props.status, 'open');
});

test('DB manualTargets are informational only: without a gapAnswer the call is matched automatically', () => {
  const inp = input();
  call(inp, PARTNER).manualTargets = [C_EP];
  const t = targets(planLinks(inp, OPTS), PARTNER);
  assert.deepEqual(t.map((e) => [e.to, e.props.matchedBy]), [['sys:uat:api.partner.com', 'host']]);
});

test('manual answer without answer.host adds no host (call resolvedHost is not trusted)', () => {
  const inp = input();
  dep(inp, 'c-service').contextPath = '/b';
  const gapAnswers = [{ env: 'uat', clientCall: CALL1, answer: { targetService: 'c-service' }, answeredBy: 'BA' }];
  const b = planLinks(inp, { ...OPTS, gapAnswers });
  assert.equal(targets(b, CALL1)[0].to, C_EP);
  assert.ok(!b.nodes.some((n) => n.type === 'Deployment'));
});

test('discovery name beats a port-only medium match and teaches the host', () => {
  const inp = input();
  dep(inp, 'b-service').hosts = [];
  Object.assign(call(inp, CALL1), { discoveryName: 'b-service' });
  const b = planLinks(inp, OPTS);
  const t = targets(b, CALL1);
  assert.deepEqual(t.map((e) => [e.to, e.props.matchedBy, e.props.confidence]), [[B_EP, 'host+path', 'high']]);
  assert.deepEqual(node(b, 'uat:b-service:deployment').props, { hosts: ['10.1.2.3'] });
  // without a discovery name the port-only fallback still applies
  assert.equal(targets(b, CALL2)[0].props.confidence, 'medium');
});

test('resolvedPath with trailing slash and query matches through the contextPath strip', () => {
  const inp = input();
  Object.assign(call(inp, CALL1), { resolvedHost: null, resolvedPort: null, resolvedPath: '/b/items/123/?x=1' });
  const t = targets(planLinks(inp, OPTS), CALL1);
  assert.deepEqual(t.map((e) => [e.to, e.props.matchedBy]), [[B_EP, 'path']]);
});

test('async rollup: kafka producer -> channel -> subscriber service', () => {
  const inp = input();
  const P1 = 'uat:a-service:clientcall:com.x.P#send->kafka-producer:payment.created';
  const P2 = 'uat:a-service:clientcall:com.x.P#resend->kafka-producer:payment.created';
  const CH = 'ch:uat:kafka:payment.created';
  inp.channels.push({ uid: CH, tech: 'kafka', name: 'payment.created', env: 'uat' });
  for (const uid of [P1, P2])
    inp.clientCalls.push({ uid, projectKey: 'a-service', clientKind: 'kafka-producer', httpMethod: null, urlTemplate: 'payment.created',
      baseUrlConfigKey: null, resolvedHost: null, resolvedPort: null, resolvedPath: null, discoveryName: null, signature: null,
      topic: 'payment.created', confidence: 'high', manualTargets: [] });
  inp.subscriptions = [{ projectKey: 'b-service', channel: CH }, { projectKey: 'a-service', channel: CH }];
  inp.clientCalls = inp.clientCalls.filter((c) => c.uid !== CALL1 && c.uid !== CALL2);
  const b = planLinks(inp, OPTS);
  const deps = b.edges.filter((e) => e.type === 'SERVICE_DEPENDS_ON' && e.to === 'uat:b-service:service:b-service');
  assert.equal(deps.length, 1);
  assert.deepEqual(deps[0].props, {
    protocol: 'kafka', sync: false, endpointsUsed: [CH], callCount: 2, confidence: 'high', derived: true, env: 'uat',
  });
  assert.ok(!b.edges.some((e) => e.type === 'SERVICE_DEPENDS_ON' && e.from === e.to));
  assert.deepEqual(validateBundle(b, { mode: 'link' }).errors, []);
});

test('rollup', () => {
  const b = planLinks(input(), OPTS);
  const deps = b.edges.filter((e) => e.type === 'SERVICE_DEPENDS_ON');
  const ab = deps.filter((e) => e.from === 'uat:a-service:service:a-service' && e.to === 'uat:b-service:service:b-service');
  assert.equal(ab.length, 1);
  assert.deepEqual(ab[0].props, {
    protocol: 'http', sync: true, endpointsUsed: [B_EP], callCount: 2, confidence: 'high', derived: true, env: 'uat',
  });
  const at24 = deps.find((e) => e.to === 'uat:t24:service:t24');
  assert.equal(at24.props.protocol, 'ofs');
  assert.ok(!deps.some((e) => e.from === e.to));
  const data = b.edges.filter((e) => e.type === 'OWNS_DATA' || e.type === 'READS_DATA')
    .map((e) => [e.type, e.from, e.to, e.props.source, e.props.derived, e.props.env]);
  assert.deepEqual(data, [
    ['OWNS_DATA', 'uat:a-service:service:a-service', 'ds:uat:mongodb:app.items', 'writes', true, 'uat'],
    ['READS_DATA', 'uat:a-service:service:a-service', 'ds:uat:mongodb:app.ref', 'writes', true, 'uat'],
    ['READS_DATA', 'uat:b-service:service:b-service', 'ds:uat:mongodb:app.items', 'writes', true, 'uat'],
  ]);
});

test('rollup: producers are async, self calls skipped, confidence is the minimum', () => {
  const inp = input();
  dep(inp, 'b-service').hosts = [];
  inp.clientCalls.push({ uid: 'uat:b-service:clientcall:com.y.Self#x->rest-template:GET /items/{id}', projectKey: 'b-service',
    clientKind: 'rest-template', httpMethod: 'GET', urlTemplate: '/items/{id}', baseUrlConfigKey: null, resolvedHost: 'localhost',
    resolvedPort: 8081, resolvedPath: '/b/items/{id}', discoveryName: null, signature: null, topic: null, confidence: 'high', manualTargets: [] });
  inp.endpoints.push({ uid: 'uat:t24:endpoint:http:POST /q', projectKey: 't24', protocol: 'http', httpMethod: 'POST', path: '/q', pathRegex: null, signature: 'POST /q' });
  inp.clientCalls.push({ uid: 'uat:a-service:clientcall:com.x.Q#p->jms-producer:POST /q', projectKey: 'a-service',
    clientKind: 'jms-producer', httpMethod: 'POST', urlTemplate: '/q', baseUrlConfigKey: null, resolvedHost: null,
    resolvedPort: null, resolvedPath: '/q', discoveryName: null, signature: null, topic: null, confidence: 'high', manualTargets: [] });
  const b = planLinks(inp, OPTS);
  const deps = b.edges.filter((e) => e.type === 'SERVICE_DEPENDS_ON');
  assert.ok(!deps.some((e) => e.from === e.to));
  assert.equal(deps.find((e) => e.to === 'uat:b-service:service:b-service').props.confidence, 'medium');
  const t24 = deps.find((e) => e.to === 'uat:t24:service:t24');
  assert.equal(t24.props.sync, true); // the ofs call is sync, so the pair stays sync
  assert.equal(t24.props.protocol, 'http,ofs');
  inp.clientCalls = inp.clientCalls.filter((c) => c.uid !== OFS);
  const only = planLinks(inp, OPTS).edges.find((e) => e.type === 'SERVICE_DEPENDS_ON' && e.to === 'uat:t24:service:t24');
  assert.equal(only.props.sync, false);
});

test('output validates', () => {
  const b = planLinks(input(), OPTS);
  assert.deepEqual(validateBundle(b, { mode: 'link' }).errors, []);
  assert.doesNotThrow(() => toLoadPlan(b, { mode: 'link' }));
});

test('deterministic sorted output', () => {
  const inp = input();
  const a = planLinks(inp, OPTS);
  inp.clientCalls.reverse();
  inp.endpoints.reverse();
  inp.accesses.reverse();
  const b = planLinks(inp, OPTS);
  assert.deepEqual(a, b);
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const sorted = [...a.edges].sort((x, y) => cmp(x.type, y.type) || cmp(x.from, y.from) || cmp(x.to, y.to));
  assert.deepEqual(a.edges, sorted);
});

test('CLI writes a valid link bundle from input + catalog', () => {
  const dir = mkdtempSync(join(tmpdir(), 'link-plan-'));
  const catalog = join(dir, 'catalog.yaml');
  writeFileSync(catalog, `gapAnswers:\n  - env: uat\n    clientCall: "${CALL1}"\n    answer: { targetService: b-service }\n    answeredBy: BA\n`);
  const out = join(dir, 'link.bundle.json');
  const r = spawnSync(process.execPath, [CLI, FIXTURE, catalog, 'uat', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const b = readJson(out);
  assert.equal(b.scan.env, 'uat');
  assert.equal(targets(b, CALL1)[0].props.matchedBy, 'manual');
  assert.deepEqual(validateBundle(b, { mode: 'link' }).errors, []);
  const bad = spawnSync(process.execPath, [CLI, FIXTURE], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
