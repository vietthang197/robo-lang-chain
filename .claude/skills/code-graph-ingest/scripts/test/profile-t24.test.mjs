import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readJson } from '../core/io.mjs';
import { validateBundle } from '../core/validate.mjs';
import { planLinks } from '../core/link.mjs';

const FIXTURE = (rel) => fileURLToPath(new URL(`../../templates/fixtures/${rel}`, import.meta.url));
const loadT24 = () => structuredClone(readJson(FIXTURE('t24/expected/t24.uat.bundle.json')));
const loadA = () => structuredClone(readJson(FIXTURE('spring-boot/expected/a-service.uat.bundle.json')));
const T24 = { profiles: ['t24'] };
const t24Issues = (b) => validateBundle(b, T24).errors.filter((e) => e.rule.startsWith('t24'));

const VERSION = 'uat:t24:component:VERSION/FUNDS.TRANSFER,ACTR';
const VERSION_EP = 'uat:t24:endpoint:ofs:FUNDS.TRANSFER,ACTR';
const ENQ_EP = 'uat:t24:endpoint:ofs:ENQ ENQ.CUST.LIST';
const INPUT = 'uat:t24:component:FT.LOCAL.INPUT';
const INPUT_ENTRY = 'uat:t24:operation:FT.LOCAL.INPUT#FT.LOCAL.INPUT';
const INPUT_PROCESS = 'uat:t24:operation:FT.LOCAL.INPUT#PROCESS';
const CHECK_ENTRY = 'uat:t24:operation:FT.LOCAL.CHECK#FT.LOCAL.CHECK';
const OFS_CALL = 'uat:a-service:clientcall:com.example.a.client.T24Client#transfer->ofs:FUNDS.TRANSFER,ACTR';

// Same row shape as linkQueries() returns, built from bundles (see profile-spring.test.mjs).
function linkInput(bundles) {
  const out = { clientCalls: [], endpoints: [], deployments: [], services: [], accesses: [], externals: [], channels: [], subscriptions: [] };
  for (const b of bundles) {
    const pk = b.scan.projectKey;
    const byUid = new Map(b.nodes.map((n) => [n.uid, n]));
    for (const n of b.nodes) {
      const p = n.props ?? {};
      if (n.type === 'ClientCall')
        out.clientCalls.push({
          uid: n.uid, projectKey: pk, clientKind: p.clientKind ?? null, httpMethod: p.httpMethod ?? null,
          urlTemplate: p.urlTemplate ?? null, baseUrlConfigKey: p.baseUrlConfigKey ?? null,
          resolvedHost: p.resolvedHost ?? null, resolvedPort: p.resolvedPort ?? null, resolvedPath: p.resolvedPath ?? null,
          discoveryName: p.discoveryName ?? null, signature: p.signature ?? null, topic: p.topic ?? null,
          confidence: p.confidence ?? null, manualTargets: [],
        });
      if (n.type === 'Endpoint')
        out.endpoints.push({
          uid: n.uid, projectKey: pk, protocol: p.protocol ?? null, httpMethod: p.httpMethod ?? null,
          path: p.path ?? null, pathRegex: p.pathRegex ?? null, signature: p.signature ?? null,
        });
      if (n.type === 'Deployment')
        out.deployments.push({ uid: n.uid, projectKey: pk, port: p.port ?? null, contextPath: p.contextPath ?? null, hosts: p.hosts ?? null });
      if (n.type === 'Service') out.services.push({ uid: n.uid, projectKey: pk, name: p.name ?? null });
      if (n.type === 'Channel') out.channels.push({ uid: n.uid, tech: p.tech ?? null, name: p.name ?? null, env: b.scan.env });
    }
    for (const e of b.edges) {
      if (e.type === 'ACCESSES' && byUid.get(e.to)?.type === 'DataStore')
        out.accesses.push({ projectKey: pk, dataStore: e.to, mode: e.props?.mode ?? null });
      if (e.type === 'SUBSCRIBES') out.subscriptions.push({ projectKey: pk, channel: e.to });
    }
  }
  return out;
}

test('expected t24 bundle validates', () => {
  const b = loadT24();
  const { errors } = validateBundle(b, T24);
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(b.scan.readerProfiles, ['t24']);
  assert.equal(b.scan.projectKey, 't24');
  assert.equal(b.scan.env, 'uat');
  const ep = b.nodes.find((n) => n.uid === VERSION_EP);
  assert.ok(ep, 'VERSION endpoint missing');
  assert.equal(ep.props.protocol, 'ofs');
  assert.equal(ep.props.signature, 'FUNDS.TRANSFER,ACTR');
  const enq = b.nodes.find((n) => n.uid === ENQ_EP);
  assert.equal(enq?.props.signature, 'ENQ ENQ.CUST.LIST');
});

test('version hook edge', () => {
  const b = loadT24();
  const t = b.edges.filter((e) => e.type === 'TRIGGERS' && e.from === VERSION);
  assert.equal(t.length, 1, JSON.stringify(t));
  assert.equal(t[0].to, INPUT_ENTRY);
  assert.equal(t[0].props.event, 'INPUT.ROUTINE');
  const entry = b.nodes.find((n) => n.uid === INPUT_ENTRY);
  assert.equal(entry.props.kind, 'routine-entry');
  // The VERSION reaches its OFS Endpoint through an Operation it CONTAINS (EXPOSES).
  const ops = b.edges.filter((e) => e.type === 'CONTAINS' && e.from === VERSION).map((e) => e.to);
  assert.ok(b.edges.some((e) => e.type === 'EXPOSES' && ops.includes(e.from) && e.to === VERSION_EP));
  // GOSUB paragraphs and CALL between routines.
  assert.ok(b.edges.some((e) => e.type === 'CALLS' && e.from === INPUT_ENTRY && e.to === INPUT_PROCESS && e.props.dispatch === 'gosub'));
  assert.ok(b.edges.some((e) => e.type === 'CALLS' && e.from === INPUT_PROCESS && e.to === CHECK_ENTRY && e.props.dispatch === 'call'));
});

test('t24 accesses', () => {
  const b = loadT24();
  const acc = (to, mode) => b.edges.some((e) => e.type === 'ACCESSES' && e.from === INPUT_PROCESS && e.to === to && e.props.mode === mode);
  assert.ok(acc('ds:uat:t24:F.CUSTOMER', 'read'));
  assert.ok(acc('ds:uat:t24:F.FUNDS.TRANSFER', 'write'));
  for (const uid of ['ds:uat:t24:F.CUSTOMER', 'ds:uat:t24:F.FUNDS.TRANSFER']) {
    const ds = b.nodes.find((n) => n.uid === uid);
    assert.equal(ds?.type, 'DataStore');
    assert.equal(ds.props.kind, 't24-application');
  }
  // ENQUIRY FILE.NAME = CUSTOMER -> read.
  assert.ok(b.edges.some((e) => e.type === 'ACCESSES' && e.to === 'ds:uat:t24:F.CUSTOMER' && e.from.includes('ENQ.CUST.LIST') && e.props.mode === 'read'));
});

test('t24 secrets are masked', () => {
  const b = loadT24();
  const raw = readFileSync(FIXTURE('t24/records/OFS.SOURCE/BROWSERTC.txt'), 'utf8');
  const pw = /^GENERIC\.PASSWORD\s*=\s*(.+)$/m.exec(raw)?.[1]?.trim();
  assert.ok(pw, 'fixture OFS.SOURCE has no GENERIC.PASSWORD');
  const key = b.nodes.find((n) => n.uid === 'uat:t24:config:OFS.SOURCE/BROWSERTC/GENERIC.PASSWORD');
  assert.equal(key?.props.value, '***');
  assert.equal(key.props.masked, true);
  assert.ok(!JSON.stringify(b).includes(pw), 'raw OFS password leaked into the bundle');
});

test('ofs link from spring', () => {
  const a = loadA();
  const svc = 'uat:a-service:operation:com.example.a.service.ItemService#getItem';
  a.nodes.push({ type: 'ClientCall', uid: OFS_CALL, props: {
    kind: 'ofs', clientKind: 'ofs', httpMethod: null, urlTemplate: 'FUNDS.TRANSFER,ACTR', baseUrlConfigKey: null,
    resolvedBaseUrl: null, resolvedHost: null, resolvedPort: null, resolvedPath: null, discoveryName: null,
    signature: 'FUNDS.TRANSFER,ACTR', topic: null, confidence: 'high',
  } });
  a.edges.push({ type: 'MAKES_CALL', from: svc, to: OFS_CALL, props: { line: 20 } });
  const link = planLinks(linkInput([a, loadT24()]), { env: 'uat', scanId: 'uat-link-20261110T000000Z', gapAnswers: [] });
  const t = link.edges.filter((e) => e.type === 'TARGETS' && e.from === OFS_CALL);
  assert.equal(t.length, 1, JSON.stringify(link, null, 2));
  assert.equal(t[0].to, VERSION_EP);
  assert.equal(t[0].props.matchedBy, 'ofs-version');
  assert.equal(t[0].props.confidence, 'high');
  const dep = link.edges.find((e) => e.type === 'SERVICE_DEPENDS_ON'
    && e.from === 'uat:a-service:service:a-service' && e.to === 'uat:t24:service:t24');
  assert.ok(dep, 'no SERVICE_DEPENDS_ON a-service -> t24');
  assert.equal(dep.props.protocol, 'ofs');
  assert.ok(link.edges.some((e) => e.type === 'OWNS_DATA' && e.from === 'uat:t24:service:t24' && e.to === 'ds:uat:t24:F.FUNDS.TRANSFER'));
  assert.deepEqual(validateBundle(link, { mode: 'link' }).errors, []);
});

test('t24 rule catches version without endpoint', () => {
  const b = loadT24();
  const before = b.edges.length;
  b.edges = b.edges.filter((e) => !(e.type === 'EXPOSES' && e.to === VERSION_EP));
  assert.equal(b.edges.length, before - 1);
  const issues = t24Issues(b);
  assert.ok(issues.some((i) => i.rule === 't24-version-endpoint' && i.uid === VERSION), JSON.stringify(issues));
});

test('t24 rule catches a version endpoint that is not ofs', () => {
  const b = loadT24();
  b.nodes.find((n) => n.uid === VERSION_EP).props.protocol = 'http';
  assert.ok(t24Issues(b).some((i) => i.rule === 't24-version-endpoint' && i.uid === VERSION));
});

test('t24 rule catches a TRIGGERS target that is not in the bundle', () => {
  const b = loadT24();
  b.edges.find((e) => e.type === 'TRIGGERS' && e.from === VERSION).to = 'uat:t24:operation:FT.MISSING#FT.MISSING';
  const issues = t24Issues(b);
  assert.ok(issues.some((i) => i.rule === 't24-triggers-target' && i.uid === VERSION), JSON.stringify(issues));
});

test('t24 rule catches a routine without routine-entry', () => {
  const b = loadT24();
  b.nodes.find((n) => n.uid === INPUT_ENTRY).props.kind = 'paragraph';
  const issues = t24Issues(b);
  assert.deepEqual(issues.map((i) => [i.rule, i.uid]), [['t24-routine-entry', INPUT]]);
});

test('iris link from spring: rest-template call matches an IRIS endpoint by host/port/path (R21)', () => {
  const IRIS_EP = 'uat:t24:endpoint:iris:GET /party/customers/{customerId}';
  const CALL = 'uat:a-service:clientcall:com.example.a.client.IrisClient#getCustomer->rest-template:GET /party/customers/{id}';
  const OPTS = { env: 'uat', scanId: 'uat-link-20261110T000000Z', gapAnswers: [] };
  const t = loadT24();
  t.nodes.push({ type: 'Endpoint', uid: IRIS_EP, props: {
    kind: 'iris', protocol: 'iris', httpMethod: 'GET', path: '/party/customers/{customerId}',
    pathRegex: '^/party/customers/[^/]+$', signature: 'GET /party/customers/{customerId}',
  } });
  const dep = t.nodes.find((n) => n.type === 'Deployment');
  dep.props.port = 9089;
  dep.props.contextPath = '/irf-provider-container/api';
  dep.props.hosts = ['10.9.0.5'];
  const a = loadA();
  a.nodes.push({ type: 'ClientCall', uid: CALL, props: {
    kind: 'rest-template', clientKind: 'rest-template', httpMethod: 'GET', urlTemplate: '/party/customers/{id}',
    baseUrlConfigKey: 't24.iris.url', resolvedBaseUrl: 'http://10.9.0.5:9089/irf-provider-container/api',
    resolvedHost: '10.9.0.5', resolvedPort: 9089, resolvedPath: '/irf-provider-container/api/party/customers/{id}',
    discoveryName: null, signature: null, topic: null, confidence: 'high',
  } });
  const link = planLinks(linkInput([a, t]), OPTS);
  const tg = link.edges.filter((e) => e.type === 'TARGETS' && e.from === CALL);
  assert.deepEqual(tg.map((e) => [e.to, e.props.matchedBy, e.props.confidence]), [[IRIS_EP, 'host+path', 'high']], JSON.stringify(link, null, 2));
  const sdo = link.edges.find((e) => e.type === 'SERVICE_DEPENDS_ON'
    && e.from === 'uat:a-service:service:a-service' && e.to === 'uat:t24:service:t24');
  assert.equal(sdo?.props.protocol, 'iris');
  assert.deepEqual(link.gaps, []);
  assert.deepEqual(validateBundle(link, { mode: 'link' }).errors, []);

  // Without known hosts the same call still matches by port + path (medium).
  dep.props.hosts = [];
  const medium = planLinks(linkInput([a, t]), OPTS).edges.filter((e) => e.type === 'TARGETS' && e.from === CALL);
  assert.deepEqual(medium.map((e) => [e.to, e.props.matchedBy, e.props.confidence]), [[IRIS_EP, 'host+path', 'medium']]);
});

test('raw OFS.SOURCE GENERIC.USER does not leak into the bundle', () => {
  const raw = readFileSync(FIXTURE('t24/records/OFS.SOURCE/BROWSERTC.txt'), 'utf8');
  const user = /^GENERIC\.USER\s*=\s*(.+)$/m.exec(raw)?.[1]?.trim();
  assert.equal(user, 'OFSUAT01');
  assert.ok(!JSON.stringify(loadT24()).includes(user), 'raw OFS user leaked into the bundle');
});

test('ofs signatures are normalised before matching (R23)', () => {
  const OPTS = { env: 'uat', scanId: 'uat-link-20261110T000000Z', gapAnswers: [] };
  const a = loadA();
  const mk = (uid, signature) => ({ type: 'ClientCall', uid, props: {
    kind: 'ofs', clientKind: 'ofs', httpMethod: null, urlTemplate: signature, signature, confidence: 'high' } });
  const FT = 'uat:a-service:clientcall:com.example.a.client.T24Client#transfer->ofs:funds.transfer, actr';
  const EQ = 'uat:a-service:clientcall:com.example.a.client.T24Client#customers->ofs:enq  enq.cust.list';
  a.nodes.push(mk(FT, 'funds.transfer, actr'), mk(EQ, 'enq  enq.cust.list'));
  const link = planLinks(linkInput([a, loadT24()]), OPTS);
  const to = (from) => link.edges.filter((e) => e.type === 'TARGETS' && e.from === from).map((e) => [e.to, e.props.matchedBy]);
  assert.deepEqual(to(FT), [[VERSION_EP, 'ofs-version']]);
  assert.deepEqual(to(EQ), [[ENQ_EP, 'ofs-version']]);
  // A gapAnswers manual match normalises too.
  const manual = planLinks(linkInput([a, loadT24()]), { ...OPTS, gapAnswers: [{ env: 'uat', clientCall: FT, answer: { targetService: 't24' }, answeredBy: 'BA' }] });
  assert.deepEqual(manual.edges.filter((e) => e.type === 'TARGETS' && e.from === FT).map((e) => [e.to, e.props.matchedBy]), [[VERSION_EP, 'manual']]);
});
