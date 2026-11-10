#!/usr/bin/env node
// Usage: node scripts/link-plan.mjs <link-input.json> <catalog.yaml> <env> <out-bundle.json>
// link-input.json holds the rows of the link queries (print-queries.mjs link) keyed by query name.
// Writes a link bundle; load it with bundle-to-cypher.mjs --mode link. Exits 1 on errors, 2 on bad usage.
import { readJson, writeJson, readCatalog } from './core/io.mjs';
import { planLinks } from './core/link.mjs';
import { validateBundle } from './core/validate.mjs';
import { ENVS } from './core/model.mjs';

const USAGE = 'usage: node scripts/link-plan.mjs <link-input.json> <catalog.yaml> <env> <out-bundle.json>';
const args = process.argv.slice(2);
if (args.length !== 4 || !ENVS.includes(args[2])) {
  console.error(USAGE);
  process.exit(2);
}
const [inputFile, catalogFile, env, outFile] = args;

try {
  const input = readJson(inputFile);
  const catalog = readCatalog(catalogFile);
  const gapAnswers = Array.isArray(catalog.gapAnswers) ? catalog.gapAnswers : [];
  const bundle = planLinks(input, { env, gapAnswers });
  const { errors } = validateBundle(bundle, { mode: 'link' });
  if (errors.length) {
    for (const i of errors) console.error(`ERROR [${i.rule}]${i.uid ? ` ${i.uid}` : ''}: ${i.message}`);
    throw new Error(`link bundle has ${errors.length} validation error(s)`);
  }
  writeJson(outFile, bundle);
  const count = (t) => bundle.edges.filter((e) => e.type === t).length;
  console.log(`${outFile}: ${count('TARGETS')} TARGETS, ${count('SERVICE_DEPENDS_ON')} SERVICE_DEPENDS_ON, `
    + `${bundle.gaps.length} gap(s), scanId ${bundle.scan.scanId}`);
  for (const d of bundle.diagnostics) console.error(`${d.level.toUpperCase()} ${d.message}`);
} catch (e) {
  console.error(`ERROR ${e.message}`);
  process.exit(1);
}
