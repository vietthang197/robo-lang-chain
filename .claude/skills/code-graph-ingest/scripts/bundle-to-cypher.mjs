#!/usr/bin/env node
// Usage: node scripts/bundle-to-cypher.mjs <bundle.json> <outDir> [--mode ingest|link]
// Writes NNN-*.cypher files plus plan.json ([{file, language}]) to send in order through MCP.
// Refuses bundles that fail validation. Exits 1 on errors, 2 on bad usage.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJson } from './core/io.mjs';
import { validateBundle } from './core/validate.mjs';
import { toLoadPlan } from './core/batches.mjs';

const USAGE = 'usage: node scripts/bundle-to-cypher.mjs <bundle.json> <outDir> [--mode ingest|link]';
const GENERATED = /^\d{3,}-[A-Za-z0-9_-]+\.cypher$/;

function parseArgs(argv) {
  const pos = [];
  let mode = 'ingest';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') mode = argv[++i];
    else if (a.startsWith('--mode=')) mode = a.slice('--mode='.length);
    else if (a.startsWith('--')) return null;
    else pos.push(a);
  }
  if (pos.length !== 2 || (mode !== 'ingest' && mode !== 'link')) return null;
  return { file: pos[0], outDir: pos[1], mode };
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const bundle = readJson(args.file);
  const { errors } = validateBundle(bundle, { mode: args.mode });
  if (errors.length) {
    for (const i of errors) console.error(`ERROR [${i.rule}]${i.uid ? ` ${i.uid}` : ''}: ${i.message}`);
    throw new Error(`${args.file} has ${errors.length} validation error(s); run validate-bundle first`);
  }
  const plan = toLoadPlan(bundle, { mode: args.mode });
  mkdirSync(args.outDir, { recursive: true });
  // Drop batches from an earlier run so a stale file is never sent by mistake.
  for (const f of readdirSync(args.outDir)) if (GENERATED.test(f)) rmSync(join(args.outDir, f));
  for (const p of plan) writeFileSync(join(args.outDir, `${p.file}.cypher`), p.statement + '\n', 'utf8');
  writeJson(
    join(args.outDir, 'plan.json'),
    plan.map(({ file, language, expectNodes }) => ({ file: `${file}.cypher`, language, ...(expectNodes !== undefined && { expectNodes }) })),
  );
  console.log(`${plan.length} statement file(s) -> ${args.outDir} (mode ${args.mode})`);
} catch (e) {
  console.error(`ERROR ${e.message}`);
  process.exit(1);
}
