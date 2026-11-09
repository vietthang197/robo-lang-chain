import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCypherLiteral, schemaStatements } from '../core/cypher.mjs';
import { VERTEX_TYPES, EDGE_TYPES } from '../core/model.mjs';

test('cypher literal escapes', () => {
  assert.equal(
    toCypherLiteral("O'Brien \\ D:\\upload\nđã xử lý $x"),
    "'O\\'Brien \\\\ D:\\\\upload\\nđã xử lý $x'",
  );
  assert.equal(toCypherLiteral('a\rb\tc'), "'a\\rb\\tc'");
  assert.equal(toCypherLiteral({ a: 1, b: 'x' }), "{a: 1, b: 'x'}");
  assert.equal(toCypherLiteral([1, 'a']), "[1, 'a']");
  assert.equal(toCypherLiteral(null), 'null');
  assert.equal(toCypherLiteral(true), 'true');
  assert.equal(toCypherLiteral(-2.5), '-2.5');
  assert.equal(toCypherLiteral({ nested: { list: [false, null] } }), '{nested: {list: [false, null]}}');
  assert.throws(() => toCypherLiteral(NaN));
  assert.throws(() => toCypherLiteral(Infinity));
  assert.throws(() => toCypherLiteral(undefined));
  assert.throws(() => toCypherLiteral(() => 1));
});

test('cypher literal quotes unsafe map keys', () => {
  assert.equal(toCypherLiteral({ 'a-b': 1 }), '{`a-b`: 1}');
  assert.throws(() => toCypherLiteral({ 'a`b': 1 }));
});

test('schema statements', () => {
  const s = schemaStatements();
  assert.ok(s.includes('CREATE VERTEX TYPE CodeNode IF NOT EXISTS'));
  for (const t of VERTEX_TYPES.filter((t) => t !== 'CodeNode'))
    assert.ok(s.includes(`CREATE VERTEX TYPE ${t} IF NOT EXISTS EXTENDS CodeNode`), t);
  for (const t of EDGE_TYPES) assert.ok(s.includes(`CREATE EDGE TYPE \`${t}\` IF NOT EXISTS`), t);
  assert.ok(s.some((x) => /CREATE INDEX IF NOT EXISTS ON CodeNode \(uid\) UNIQUE/.test(x)));
  assert.ok(s.some((x) => /ON CodeNode \(env\) NOTUNIQUE/.test(x)));
  assert.ok(s.some((x) => /ON CodeNode \(projectKey\) NOTUNIQUE/.test(x)));
  // supertype and its indexed properties come before the indexes
  const iCode = s.indexOf('CREATE VERTEX TYPE CodeNode IF NOT EXISTS');
  const iProp = s.findIndex((x) => x.startsWith('CREATE PROPERTY CodeNode.uid'));
  const iIdx = s.findIndex((x) => x.startsWith('CREATE INDEX'));
  assert.ok(iCode < iProp && iProp < iIdx);
});
