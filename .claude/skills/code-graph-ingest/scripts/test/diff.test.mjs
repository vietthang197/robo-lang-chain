import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readJson } from '../core/io.mjs';
import { diffBundles, renderDiff } from '../core/diff.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/valid-min.bundle.json', import.meta.url));
const load = () => structuredClone(readJson(FIXTURE));
const SVC = 'uat:robo-lang-chain:service:robo-lang-chain';
const OP = 'uat:robo-lang-chain:operation:com.thanglv.robolangchain.controller.DocumentRagController#process';
const EP = 'uat:robo-lang-chain:endpoint:http:GET /document/rag/process/{documentId}';
const DEP = 'uat:robo-lang-chain:deployment';

test('diff detects add/remove/change', () => {
  const prev = load();
  const next = load();
  next.nodes = next.nodes.filter((n) => n.uid !== DEP);
  next.edges = next.edges.filter((e) => e.from !== DEP && e.to !== DEP);
  next.nodes.push({ type: 'Library', uid: 'lib:maven:g:a', props: { name: 'a' } });
  next.edges.push({ type: 'DEPENDS_ON', from: SVC, to: 'lib:maven:g:a', props: {} });
  next.nodes.find((n) => n.uid === OP).props.description = 'Mô tả mới';
  const d = diffBundles(prev, next);
  assert.deepEqual(d.addedNodes.map((n) => n.uid), ['lib:maven:g:a']);
  assert.deepEqual(d.removedNodes.map((n) => n.uid), [DEP]);
  assert.deepEqual(d.changedNodes.map((c) => ({ uid: c.uid, fields: c.fields })), [{ uid: OP, fields: ['description'] }]);
  assert.equal(d.addedEdges.length, 1);
  assert.equal(d.removedEdges.length, 2);
  const md = renderDiff(d);
  assert.match(md, /Library/);
  assert.match(md, /Deployment/);
  assert.match(md, /description/);
  assert.match(md, /lib:maven:g:a/);
});

test('diff ignores line moves', () => {
  const prev = load();
  const next = load();
  prev.nodes.find((n) => n.uid === EP).props.lineStart = 10;
  next.nodes.find((n) => n.uid === EP).props.lineStart = 42;
  next.nodes.find((n) => n.uid === EP).props.lineEnd = 50;
  next.nodes.find((n) => n.uid === SVC).props.scanId = 'x';
  next.nodes.find((n) => n.uid === SVC).props.contentHash = 'abc';
  const d = diffBundles(prev, next);
  assert.deepEqual(d.changedNodes, []);
  assert.deepEqual(d.addedNodes, []);
  assert.deepEqual(d.removedNodes, []);
});

test('null prev means everything added', () => {
  const next = load();
  const d = diffBundles(null, next);
  assert.equal(d.addedNodes.length, next.nodes.length);
  assert.equal(d.addedEdges.length, next.edges.length);
  assert.deepEqual(d.removedNodes, []);
  assert.deepEqual(d.removedEdges, []);
  assert.deepEqual(d.changedNodes, []);
  assert.match(renderDiff(d), /Service/);
});
