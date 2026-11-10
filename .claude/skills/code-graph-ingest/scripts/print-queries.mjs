#!/usr/bin/env node
// Usage: node scripts/print-queries.mjs link|report|studio|maintenance --env <dev|uat>
// Prints JSON [{name, cypher}] to stdout. Run each query through the ArcadeDB MCP `query` tool
// and save {<name>: records} to link-input.json (link) or report-data.json (report).
// `maintenance` prints the shared-node cleanup statement (a write; run it only on purpose).
// Exits 1 on errors, 2 on bad usage.
import { linkQueries, reportQueries, studioQueries } from './core/queries.mjs';
import { sharedCleanupStatement } from './core/batches.mjs';

const USAGE = 'usage: node scripts/print-queries.mjs link|report|studio|maintenance --env <dev|uat>';

const MODES = {
  link: (env) => linkQueries(env),
  report: (env) => reportQueries(env),
  studio: (env) => studioQueries(env).map(({ title, cypher }) => ({ name: title, cypher })),
  maintenance: () => [{ name: 'sharedCleanup', cypher: sharedCleanupStatement() }],
};

function parseArgs(argv) {
  const pos = [];
  let env;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env') env = argv[++i];
    else if (a.startsWith('--env=')) env = a.slice('--env='.length);
    else if (a.startsWith('--')) return null;
    else pos.push(a);
  }
  if (pos.length !== 1 || !Object.hasOwn(MODES, pos[0]) || !env) return null;
  return { mode: pos[0], env };
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.error(USAGE);
  process.exit(2);
}

try {
  console.log(JSON.stringify(MODES[args.mode](args.env), null, 2));
} catch (e) {
  console.error(`ERROR ${e.message}`);
  process.exit(1);
}
