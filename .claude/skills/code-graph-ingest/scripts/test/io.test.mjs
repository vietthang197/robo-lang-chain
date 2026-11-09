import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJson, readCatalog } from '../core/io.mjs';

test('writeJson/readJson round-trip with 2-space indent and trailing newline', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-io-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'a.json');
  writeJson(file, { a: [1] });
  assert.equal(readFileSync(file, 'utf8'), '{\n  "a": [\n    1\n  ]\n}\n');
  assert.deepEqual(readJson(file), { a: [1] });
});

test('readCatalog parses YAML', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-io-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'catalog.yaml');
  writeFileSync(file, 'domains:\n  - slug: payments\n');
  assert.deepEqual(readCatalog(file), { domains: [{ slug: 'payments' }] });
});
