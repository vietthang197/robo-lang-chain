import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = join(ROOT, 'SKILL.md');

function load() {
  assert.ok(existsSync(SKILL), 'SKILL.md must exist at the skill root');
  return readFileSync(SKILL, 'utf8').replace(/\r\n/g, '\n');
}

test('skill frontmatter has name and description', () => {
  const text = load();
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'SKILL.md must start with a YAML frontmatter block');
  const fm = parse(m[1]);
  assert.equal(fm.name, 'code-graph-ingest');
  assert.equal(typeof fm.description, 'string');
  assert.ok(fm.description.trim().length > 40, 'description must say when to use the skill');
});

test('skill references exist', () => {
  const text = load();
  const paths = new Set([
    ...text.matchAll(/references\/[\w./-]*?\.md\b/g),
    ...text.matchAll(/scripts\/[\w./-]*?\.mjs\b/g),
    ...text.matchAll(/templates\/[\w./-]*[\w/]/g),
  ].map((m) => m[0]));
  assert.ok(paths.size >= 10, `expected many referenced paths, found ${paths.size}`);
  const missing = [...paths].filter((p) => !existsSync(join(ROOT, p)));
  assert.deepEqual(missing, [], 'every referenced path must exist under the skill root');
});

test('every node scripts/<x>.mjs command names an existing script, and every CLI is documented', () => {
  const text = load();
  const used = [...text.matchAll(/node\s+scripts\/([\w.-]+\.mjs)/g)].map((m) => m[1]);
  assert.ok(used.length >= 7, `expected the workflow commands, found ${used.length}`);
  for (const s of used) assert.ok(existsSync(join(ROOT, 'scripts', s)), `node scripts/${s} does not exist`);
  const clis = readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs'));
  for (const cli of clis) assert.ok(used.includes(cli), `SKILL.md never shows a command for scripts/${cli}`);
});

test('skill has the three command sections and phases 0-7', () => {
  const text = load();
  for (const h of ['ingest', 'link', 'report']) assert.match(text, new RegExp(`^## ${h}\\b`, 'm'), `missing heading ## ${h}`);
  for (let i = 0; i <= 7; i++) assert.match(text, new RegExp(`^#+ .*Pha ${i}\\b`, 'm'), `missing phase heading Pha ${i}`);
});

test('large-repo subagent prompt copies rules 1-6, 8, 10-13', () => {
  const text = load();
  const section = text.slice(text.indexOf('### Repo lớn'), text.indexOf('### Pha 5'));
  assert.match(section, /quy tắc 1-6, 8, 10-13/);
});

test('Pha 7 compares nodes and edges of 990-count and says what to do on mismatch', () => {
  const text = load();
  const section = text.slice(text.indexOf('### Pha 7'), text.indexOf('## link'));
  assert.match(section, /expectEdges/);
  assert.match(section, /count-mismatch/);
  assert.match(section, /không chạy lại cleanup/i);
  assert.match(section, /chạy lại `990-count` một lần/);
});
