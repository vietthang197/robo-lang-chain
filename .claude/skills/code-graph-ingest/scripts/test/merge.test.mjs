import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBundles } from '../core/merge.mjs';

const scan = (filesTotal, filesRead, skipped = []) => ({
  scanId: 'uat-p-20261109T101500Z',
  env: 'uat',
  projectKey: 'p',
  coverage: { filesTotal, filesRead, skipped },
});
const LIB = 'lib:maven:g:a';
const SVC = 'uat:p:service:p';
const part = (s, nodes, edges, gaps = [], diagnostics = []) => ({
  schemaVersion: '1.0', scan: s, nodes, edges, gaps, diagnostics,
});

test('merges parts and dedupes', () => {
  const a = part(
    scan(10, 8, [{ path: 'target/**', reason: 'build output' }]),
    [
      { type: 'Service', uid: SVC, props: { name: 'p' } },
      { type: 'Library', uid: LIB, props: { name: 'a', version: '', description: '' } },
    ],
    [{ type: 'DEPENDS_ON', from: SVC, to: LIB, props: {} }],
    [{ uid: 'gap:uat:p:x', kind: 'unread-files' }],
    [{ level: 'warn', file: 'a', message: 'm1' }],
  );
  const b = part(
    scan(5, 5, [{ path: 'node_modules/**', reason: 'vendor' }]),
    [{ type: 'Library', uid: LIB, props: { name: 'other', version: '1.0', description: 'Thư viện a' } }],
    [{ type: 'DEPENDS_ON', from: SVC, to: LIB, props: {} }],
    [{ uid: 'gap:uat:p:x', kind: 'unread-files' }, { uid: 'gap:uat:p:y', kind: 'unknown-external' }],
    [{ level: 'warn', file: 'b', message: 'm2' }],
  );
  const m = mergeBundles([a, b]);
  assert.equal(m.nodes.length, 2);
  assert.equal(m.nodes.filter((n) => n.uid === LIB).length, 1);
  assert.deepEqual(m.nodes.find((n) => n.uid === LIB).props, { name: 'a', version: '1.0', description: 'Thư viện a' });
  assert.equal(m.edges.length, 1);
  assert.equal(m.scan.coverage.filesTotal, 15);
  assert.equal(m.scan.coverage.filesRead, 13);
  assert.equal(m.scan.coverage.skipped.length, 2);
  assert.deepEqual(m.gaps.map((g) => g.uid), ['gap:uat:p:x', 'gap:uat:p:y']);
  assert.equal(m.diagnostics.length, 2);
  assert.equal(m.scan.scanId, 'uat-p-20261109T101500Z');
  assert.equal(m.schemaVersion, '1.0');
  // inputs untouched
  assert.equal(a.nodes[1].props.version, '');
  assert.equal(a.scan.coverage.filesTotal, 10);
});

test('rejects mismatched scans', () => {
  const a = part(scan(1, 1), [], []);
  for (const key of ['env', 'projectKey', 'scanId']) {
    const s = scan(1, 1);
    s[key] = key === 'env' ? 'dev' : 'other';
    assert.throws(() => mergeBundles([a, part(s, [], [])]), { message: 'scan mismatch' });
  }
});
