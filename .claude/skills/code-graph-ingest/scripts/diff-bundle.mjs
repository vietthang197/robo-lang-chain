#!/usr/bin/env node
// Usage: node scripts/diff-bundle.mjs <prev.json|-> <next.json> <out.md>
// "-" as prev means no previous scan (everything is added). Exits 1 on read/write errors, 2 on bad usage.
import { writeFileSync } from 'node:fs';
import { readJson } from './core/io.mjs';
import { diffBundles, renderDiff } from './core/diff.mjs';

const USAGE = 'usage: node scripts/diff-bundle.mjs <prev.json|-> <next.json> <out.md>';

const argv = process.argv.slice(2);
if (argv.length !== 3 || argv.some((a) => a.startsWith('--'))) {
  console.error(USAGE);
  process.exit(2);
}
const [prevPath, nextPath, out] = argv;

let d;
try {
  const load = (f) => {
    try {
      return readJson(f);
    } catch (e) {
      throw new Error(`cannot read ${f}: ${e.message}`);
    }
  };
  const prev = prevPath === '-' ? null : load(prevPath);
  d = diffBundles(prev, load(nextPath));
  writeFileSync(out, renderDiff(d) + '\n', 'utf8');
} catch (e) {
  console.error(`ERROR ${e.message}`);
  process.exit(1);
}
console.log(
  `nodes +${d.addedNodes.length} -${d.removedNodes.length} ~${d.changedNodes.length}, edges +${d.addedEdges.length} -${d.removedEdges.length} -> ${out}`,
);
