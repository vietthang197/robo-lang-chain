#!/usr/bin/env node
// Usage: node scripts/validate-bundle.mjs <bundle.json> [--profile spring-boot,t24]
// Prints issues; exits 1 when there are errors, 2 on bad usage.
import { readJson } from './core/io.mjs';
import { validateBundle } from './core/validate.mjs';

const USAGE = 'usage: node scripts/validate-bundle.mjs <bundle.json> [--profile spring-boot,t24]';

function parseArgs(argv) {
  let file;
  let profiles;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') profiles = argv[++i];
    else if (a.startsWith('--profile=')) profiles = a.slice('--profile='.length);
    else if (!a.startsWith('--') && file === undefined) file = a;
    else return null;
  }
  if (!file || (profiles !== undefined && !profiles)) return null;
  return { file, profiles: profiles?.split(',').map((s) => s.trim()).filter(Boolean) };
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.error(USAGE);
  process.exit(2);
}

let bundle;
try {
  bundle = readJson(args.file);
} catch (e) {
  console.error(`ERROR [R1-shape] cannot read ${args.file}: ${e.message}`);
  process.exit(1);
}

const { errors, warnings } = validateBundle(bundle, args.profiles ? { profiles: args.profiles } : {});
const line = (level, i) => `${level} [${i.rule}]${i.uid ? ` ${i.uid}` : ''}: ${i.message}`;
for (const i of errors) console.log(line('ERROR', i));
for (const i of warnings) console.log(line('WARN', i));
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
