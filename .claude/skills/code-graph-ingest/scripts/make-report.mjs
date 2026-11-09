#!/usr/bin/env node
// Usage: node scripts/make-report.mjs <report-data.json> <out.md> --env <dev|uat> [--prev <old-report-data.json>]
// report-data.json holds the rows of the report queries (print-queries.mjs report) keyed by query name.
// Writes the topology report and studio-queries.md next to it. Exits 1 on errors, 2 on bad usage.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readJson } from './core/io.mjs';
import { renderReport, renderStudioQueries } from './core/report.mjs';
import { studioQueries } from './core/queries.mjs';
import { ENVS } from './core/model.mjs';

const USAGE = 'usage: node scripts/make-report.mjs <report-data.json> <out.md> --env <dev|uat> [--prev <old.json>]';

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env' || a === '--prev') {
      if (i + 1 >= argv.length || a.slice(2) in flags) return null;
      flags[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) return null;
    else pos.push(a);
  }
  if (pos.length !== 2 || !ENVS.includes(flags.env)) return null;
  return { input: pos[0], out: pos[1], env: flags.env, prev: flags.prev ?? null };
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const data = readJson(args.input);
  const prev = args.prev ? readJson(args.prev) : null;
  const md = renderReport(data, prev, { env: args.env, generatedAt: new Date().toISOString() });
  writeFileSync(args.out, md, 'utf8');
  const studioFile = join(dirname(args.out), 'studio-queries.md');
  writeFileSync(studioFile, renderStudioQueries(studioQueries(args.env), args.env), 'utf8');
  console.log(`${args.out}: ${(data.services ?? []).length} service(s), ${(data.dependencies ?? []).length} `
    + `dependency row(s), ${(data.gaps ?? []).length} gap row(s); ${studioFile} written`);
} catch (e) {
  console.error(`ERROR ${e.message}`);
  process.exit(1);
}
