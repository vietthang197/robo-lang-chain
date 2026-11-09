import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readJson } from '../core/io.mjs';
import { validateBundle } from '../core/validate.mjs';
import { planLinks } from '../core/link.mjs';
import { parseUid } from '../core/uid.mjs';

const EXPECTED = (name) =>
  fileURLToPath(new URL(`../../templates/fixtures/spring-boot/expected/${name}.uat.bundle.json`, import.meta.url));
const loadA = () => structuredClone(readJson(EXPECTED('a-service')));
const loadB = () => structuredClone(readJson(EXPECTED('b-service')));
const SPRING = { profiles: ['spring-boot'] };
const springIssues = (b) => validateBundle(b, SPRING).errors.filter((e) => e.rule.startsWith('spring-boot'));

const CALL = 'uat:a-service:clientcall:com.example.a.client.BClient#getItem->feign:GET /items/{id}';
const B_EP = 'uat:b-service:endpoint:http:GET /items/{id}';
const B_CTRL = 'uat:b-service:component:com.example.b.controller.ItemController';

// Same row shape as linkQueries() returns, built from the bundles instead of the DB.
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
      if (n.type === 'ExternalSystem') out.externals.push({ uid: n.uid, name: p.name ?? null, host: p.host ?? null, port: p.port ?? null });
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

test('expected spring bundles validate', () => {
  for (const b of [loadA(), loadB()]) {
    const { errors } = validateBundle(b, SPRING);
    assert.deepEqual(errors, [], `${b.scan.projectKey}: ${JSON.stringify(errors, null, 2)}`);
    assert.deepEqual(b.scan.readerProfiles, ['spring-boot']);
  }
});

test('masked password', () => {
  const pw = loadA().nodes.find((n) => n.uid === 'uat:a-service:config:spring.datasource.password');
  assert.ok(pw, 'ConfigKey spring.datasource.password missing');
  assert.equal(pw.props.value, '***');
  assert.equal(pw.props.masked, true);
  assert.ok(!JSON.stringify(loadA()).includes('"secret"'), 'raw password value leaked into the bundle');
});

test('base url keeps the target context-path and the endpoint path excludes it (R16)', () => {
  const a = loadA();
  const url = a.nodes.find((n) => n.uid === 'uat:a-service:config:b-service.url');
  assert.equal(url.props.value, 'http://10.1.2.3:8081/b');
  const call = a.nodes.find((n) => n.uid === CALL);
  assert.equal(call.props.resolvedPath, '/b/items/{id}');
  assert.ok(a.edges.some((e) => e.type === 'USES_CONFIG' && e.from === CALL
    && e.to === 'uat:a-service:config:b-service.url' && e.props?.role === 'base-url'));
  const b = loadB();
  assert.equal(b.nodes.find((n) => n.uid === B_EP).props.path, '/items/{id}');
  assert.equal(b.nodes.find((n) => n.type === 'Deployment').props.contextPath, '/b');
});

test('link of the two fixtures', () => {
  const a = loadA();
  const b = loadB();
  const link = planLinks(linkInput([a, b]), { env: 'uat', scanId: 'uat-link-20261110T000000Z', gapAnswers: [] });
  const t = link.edges.filter((e) => e.type === 'TARGETS' && e.from === CALL);
  assert.equal(t.length, 1, JSON.stringify(link, null, 2));
  assert.equal(t[0].to, B_EP);
  assert.equal(t[0].props.matchedBy, 'host+path');
  assert.equal(t[0].props.confidence, 'high');
  assert.ok(link.edges.some((e) => e.type === 'SERVICE_DEPENDS_ON'
    && e.from === 'uat:a-service:service:a-service' && e.to === 'uat:b-service:service:b-service'));
  assert.ok(link.edges.some((e) => e.type === 'OWNS_DATA' || e.type === 'READS_DATA'));
  assert.deepEqual(link.gaps, []);
  assert.deepEqual(validateBundle(link, { mode: 'link' }).errors, []);
});

test('spring rule catches controller without endpoint', () => {
  const b = loadB();
  const before = b.edges.length;
  b.edges = b.edges.filter((e) => !(e.type === 'EXPOSES' && e.to === B_EP));
  assert.equal(b.edges.length, before - 1);
  const issues = springIssues(b);
  assert.ok(issues.some((i) => i.uid === B_CTRL), JSON.stringify(issues));
});

test('spring rule catches http client call without base-url config or gap', () => {
  const a = loadA();
  a.edges = a.edges.filter((e) => !(e.type === 'USES_CONFIG' && e.from === CALL));
  assert.ok(springIssues(a).some((i) => i.uid === CALL));
  // A Gap instead of the config edge is accepted.
  const gap = `gap:uat:a-service:missing-config-value:0123456789ab`;
  a.nodes.push({ type: 'Gap', uid: gap, props: { kind: 'missing-config-value', askWho: 'DevOps', question: 'Giá trị b-service.url ở uat là gì?', status: 'open' } });
  a.edges.push({ type: 'HAS_GAP', from: CALL, to: gap, props: {} });
  assert.deepEqual(springIssues(a), []);
});

test('spring client rule exempts absolute URLs and discovery-only calls', () => {
  const a = loadA();
  a.edges = a.edges.filter((e) => !(e.type === 'USES_CONFIG' && e.from === CALL));
  const call = a.nodes.find((n) => n.uid === CALL);
  call.props.baseUrlConfigKey = null;
  assert.deepEqual(springIssues(a), []); // Feign with name only: discovery
  call.props.discoveryName = null;
  assert.ok(springIssues(a).some((i) => i.uid === CALL));
  call.props.urlTemplate = 'lb://b-service/items/{id}';
  assert.deepEqual(springIssues(a), []);
});

test('link records the caller host on the target deployment', () => {
  const link = planLinks(linkInput([loadA(), loadB()]), { env: 'uat', scanId: 'uat-link-20261110T000000Z', gapAnswers: [] });
  const dep = link.nodes.find((n) => n.uid === 'uat:b-service:deployment');
  assert.deepEqual(dep?.props.hosts, ['10.1.2.3']);
});

test('spring rule catches server.port not reflected in Deployment.port', () => {
  const b = loadB();
  b.nodes.find((n) => n.type === 'Deployment').props.port = 9999;
  assert.ok(springIssues(b).some((i) => parseUid(i.uid ?? '').group === 'config' || i.uid?.endsWith(':deployment')));
});
