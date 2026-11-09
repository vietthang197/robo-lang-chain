import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readJson } from '../core/io.mjs';
import { validateBundle } from '../core/validate.mjs';
import { profileRules } from '../core/profile-rules/index.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/valid-min.bundle.json', import.meta.url));
const load = () => structuredClone(readJson(FIXTURE));
const rules = (issues) => issues.map((i) => i.rule);

const SVC = 'uat:robo-lang-chain:service:robo-lang-chain';
const OP = 'uat:robo-lang-chain:operation:com.thanglv.robolangchain.controller.DocumentRagController#process';
const CTRL = 'uat:robo-lang-chain:component:com.thanglv.robolangchain.controller.DocumentRagController';
const EP = 'uat:robo-lang-chain:endpoint:http:GET /document/rag/process/{documentId}';
const node = (b, uid) => b.nodes.find((n) => n.uid === uid);

test('valid bundle passes', () => {
  const { errors, warnings } = validateBundle(load());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('bad shape is reported as R1-shape', () => {
  const b = load();
  b.schemaVersion = '2.0';
  b.nodes.push({ type: 'Widget', uid: 'uat:robo-lang-chain:widget:x' });
  b.edges.push({ type: 'LIKES', from: SVC, to: OP });
  b.nodes[0].extra = 1;
  const errs = validateBundle(b).errors.filter((e) => e.rule === 'R1-shape');
  assert.ok(errs.length >= 4, JSON.stringify(errs));
  assert.deepEqual(rules(validateBundle(null).errors), ['R1-shape']);
});

test('duplicate uid', () => {
  const b = load();
  b.nodes.push(structuredClone(node(b, OP)));
  assert.ok(rules(validateBundle(b).errors).includes('R2-uid'));
});

test('uid that does not fit the scan', () => {
  const b = load();
  b.nodes.push({ type: 'Component', uid: 'dev:robo-lang-chain:component:x.Y' });
  assert.ok(rules(validateBundle(b).errors).includes('R2-uid'));
});

test('edge to unknown project uid', () => {
  const b = load();
  b.edges.push({ type: 'CALLS', from: OP, to: 'uat:robo-lang-chain:operation:x.Y#z' });
  assert.ok(rules(validateBundle(b).errors).includes('R3-dangling'));

  const t = load();
  t.edges.push({ type: 'TARGETS', from: OP, to: 'uat:other:endpoint:http:GET /x' });
  assert.ok(!rules(validateBundle(t).errors).includes('R3-dangling'));

  const c = load();
  c.edges.push({ type: 'CALLS', from: OP, to: 'uat:other:operation:a#b' });
  assert.ok(rules(validateBundle(c).errors).includes('R3-dangling'));

  const s = load();
  s.edges.push({ type: 'OVERRIDES', from: OP, to: 'ext:org.x.Repo#save' });
  s.edges.push({ type: 'DEPENDS_ON', from: SVC, to: 'lib:maven:g:a' });
  assert.ok(!rules(validateBundle(s).errors).includes('R3-dangling'));
});

test('missing Deployment', () => {
  const b = load();
  b.nodes = b.nodes.filter((n) => n.type !== 'Deployment');
  b.edges = b.edges.filter((e) => e.type !== 'DEPLOYED_AS' && e.type !== 'SERVES');
  assert.ok(rules(validateBundle(b).errors).includes('R4-service-deployment'));
});

test('service with no Endpoint, Channel or Gap', () => {
  const b = load();
  b.nodes = b.nodes.filter((n) => n.type !== 'Endpoint');
  b.edges = b.edges.filter((e) => e.to !== EP);
  assert.ok(rules(validateBundle(b).errors).includes('R5-service-surface'));
});

test('ClientCall without urlTemplate and without HAS_GAP', () => {
  const b = load();
  const cc = 'uat:robo-lang-chain:clientcall:com.x.A#b->feign:GET ?';
  b.nodes.push({ type: 'ClientCall', uid: cc, props: { clientKind: 'feign' } });
  b.edges.push({ type: 'MAKES_CALL', from: OP, to: cc });
  assert.ok(rules(validateBundle(b).errors).includes('R5-clientcall-url'));

  const gapUid = 'gap:uat:robo-lang-chain:unresolved-call:ab12';
  b.nodes.push({ type: 'Gap', uid: gapUid, props: { kind: 'unresolved-call', question: 'URL gọi tới đâu?', askWho: 'Dev' } });
  b.edges.push({ type: 'HAS_GAP', from: cc, to: gapUid });
  assert.ok(!rules(validateBundle(b).errors).includes('R5-clientcall-url'));
});

test('description without evidence', () => {
  const b = load();
  delete node(b, OP).props.evidence;
  assert.ok(rules(validateBundle(b).errors).includes('R6-description-evidence'));
});

test('controller Component without description', () => {
  const b = load();
  const p = node(b, CTRL).props;
  delete p.description; delete p.evidence; delete p.confidence;
  assert.ok(rules(validateBundle(b).errors).includes('R6-required-description'));
});

test('coverage 30/34', () => {
  const b = load();
  b.scan.coverage = { filesTotal: 34, filesRead: 30 };
  const { errors, warnings } = validateBundle(b);
  assert.deepEqual(errors, []);
  assert.ok(rules(warnings).includes('W-coverage'));
});

test('unreachable operation and single-endpoint capability warnings', () => {
  const b = load();
  const helper = 'uat:robo-lang-chain:operation:com.x.Helper#run';
  b.nodes.push({ type: 'Operation', uid: helper, props: {} });
  const cap = 'uat:robo-lang-chain:capability:document-rag';
  b.nodes.push({ type: 'Capability', uid: cap, props: { description: 'Xử lý RAG tài liệu PDF', evidence: [EP], confidence: 'high' } });
  b.edges.push({ type: 'REALIZED_BY', from: cap, to: EP });
  const w = rules(validateBundle(b).warnings);
  assert.ok(w.includes('W-unreachable-operation'));
  assert.ok(w.includes('W-single-endpoint-capability'));
});

test('link bundle skips service rules', () => {
  const b = {
    schemaVersion: '1.0',
    scan: { scanId: 'uat-system-link-20261109T120000Z', env: 'uat', projectKey: '__system__' },
    nodes: [{ type: 'Deployment', uid: 'uat:b-service:deployment', props: { hosts: ['10.1.2.3'] } }],
    edges: [{
      type: 'TARGETS',
      from: 'uat:a-service:clientcall:com.x.BClient#get->feign:GET /b/items/{id}',
      to: 'uat:b-service:endpoint:http:GET /b/items/{id}',
      props: { matchedBy: 'host+path', confidence: 'high' },
    }],
    gaps: [],
    diagnostics: [],
  };
  assert.deepEqual(validateBundle(b).errors, []);
});

test('profile rules hook runs selected profiles', () => {
  for (const p of ['spring-boot', 't24', 'java-generic']) assert.equal(typeof profileRules[p], 'function');
  const saved = profileRules['spring-boot'];
  profileRules['spring-boot'] = () => [{ rule: 'P-spring-test', message: 'x' }];
  try {
    assert.ok(rules(validateBundle(load(), { profiles: ['spring-boot'] }).errors).includes('P-spring-test'));
    assert.ok(!rules(validateBundle(load(), { profiles: ['t24'] }).errors).includes('P-spring-test'));
  } finally {
    profileRules['spring-boot'] = saved;
  }
});
