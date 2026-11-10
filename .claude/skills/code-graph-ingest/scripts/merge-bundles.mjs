#!/usr/bin/env node
// Usage: node scripts/merge-bundles.mjs <out.json> <part1.json> [part2.json ...]
// Writes the merged bundle; exits 1 on read/merge errors, 2 on bad usage.
import { readJson, writeJson } from './core/io.mjs';
import { mergeBundles } from './core/merge.mjs';

const USAGE = 'usage: node scripts/merge-bundles.mjs <out.json> <part1.json> [part2.json ...]';

const argv = process.argv.slice(2);
if (argv.length < 2 || argv.some((a) => a.startsWith('--'))) {
  console.error(USAGE);
  process.exit(2);
}
const [out, ...inputs] = argv;

const load = (f) => {
  try {
    return readJson(f);
  } catch (e) {
    throw new Error(`cannot read ${f}: ${e.message}`);
  }
};

let merged;
try {
  merged = mergeBundles(inputs.map(load));
  writeJson(out, merged);
} catch (e) {
  console.error(`ERROR ${e.message}`);
  process.exit(1);
}
console.log(
  `merged ${inputs.length} part(s) -> ${out}: ${merged.nodes.length} node(s), ${merged.edges.length} edge(s), ${merged.gaps.length} gap(s)`,
);
