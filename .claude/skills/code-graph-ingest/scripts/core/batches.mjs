// Turns a validated bundle into an ordered load plan for ArcadeDB (spec §11).
// Every write is scoped: ingest touches only (env, projectKey) of the scan; link touches only
// derived edges and system gaps of the env. Shared nodes are never deleted by a load plan.
import { VERTEX_TYPES, EDGE_TYPES } from './model.mjs';
import { isShared, parseUid } from './uid.mjs';
import { toCypherLiteral, schemaStatements, SAFE_IDENT } from './cypher.mjs';

export const MAX_ROWS = 300;
export const MAX_CHARS = 200000;

const SYSTEM = '__system__';
const ENV_SCOPED = new Set(['ds', 'ch', 'sys', 'gap']);
const SCAN_KEYS = ['env', 'projectKey', 'scanId'];
const DESC_KEYS = ['description', 'descriptionSource'];
const NODE_LABELS = VERTEX_TYPES.filter((t) => t !== 'CodeNode');
const lit = toCypherLiteral;

const checkKey = (k, where) => {
  if (!SAFE_IDENT.test(k)) throw new Error(`unsafe property key "${k}" on ${where}`);
};

// SET list: plain keys sorted, then description before descriptionSource, both guarded so a
// stored human description is never overwritten.
function setClause(alias, keys) {
  const plain = keys.filter((k) => !DESC_KEYS.includes(k)).sort();
  const parts = plain.map((k) => `${alias}.${k} = r.${k}`);
  for (const k of DESC_KEYS)
    if (keys.includes(k))
      parts.push(`${alias}.${k} = CASE WHEN ${alias}.descriptionSource = 'human' THEN ${alias}.${k} ELSE r.${k} END`);
  return parts;
}

function nodeRow(node, scan, mode) {
  const where = `${node.type} ${node.uid}`;
  const props = { ...(node.props ?? {}) };
  delete props.uid;
  const shared = isShared(node.uid);
  const patch = mode === 'link' && !shared;
  for (const k of SCAN_KEYS) delete props[k];
  const row = { uid: node.uid, ...props };
  if (!patch) {
    if (shared) {
      const p = parseUid(node.uid);
      if (ENV_SCOPED.has(p.group)) row.env = p.env;
    } else {
      row.env = scan.env;
      row.projectKey = scan.projectKey;
    }
    row.scanId = scan.scanId;
  }
  const keys = Object.keys(row).filter((k) => k !== 'uid');
  keys.forEach((k) => checkKey(k, where));
  return { row, keys, patch };
}

function edgeRow(edge, scan) {
  const where = `${edge.type} ${edge.from} -> ${edge.to}`;
  const props = { ...(edge.props ?? {}) };
  for (const k of ['from', 'to'])
    if (k in props) throw new Error(`reserved property key "${k}" on ${where}`);
  // scanId (and env for derived edges) come from the scan unless the edge already sets them.
  const row = { from: edge.from, to: edge.to, scanId: scan.scanId, ...props };
  if (row.derived === true && row.env === undefined) row.env = scan.env;
  const keys = Object.keys(row).filter((k) => k !== 'from' && k !== 'to' && k !== 'scanId');
  keys.forEach((k) => checkKey(k, where));
  return { row, keys };
}

// Greedy split: <= MAX_ROWS rows and <= MAX_CHARS chars; an oversized single row is its own batch.
function chunk(items, render) {
  const out = [];
  let cur = [];
  let keys = new Set();
  let litLen = 0;
  const size = (n, len, ks) => len + 2 * Math.max(0, n - 1) + render([], [...ks]).length;
  for (const it of items) {
    let next = new Set([...keys, ...it.keys]);
    if (cur.length && (cur.length >= MAX_ROWS || size(cur.length + 1, litLen + it.lit.length, next) > MAX_CHARS)) {
      out.push(render(cur.map((c) => c.lit), [...keys]));
      cur = [];
      litLen = 0;
      next = new Set(it.keys);
    }
    cur.push(it);
    keys = next;
    litLen += it.lit.length;
  }
  if (cur.length) out.push(render(cur.map((c) => c.lit), [...keys]));
  return out;
}

const nodeRender = (type, patch) => (lits, keys) => {
  // Link patches MATCH instead of MERGE: a patch must never create an unscoped node.
  const head = `UNWIND [${lits.join(', ')}] AS r ${patch ? 'MATCH' : 'MERGE'} (n:${type} {uid: r.uid})`;
  const sets = setClause('n', keys);
  return sets.length ? `${head} SET ${sets.join(', ')}` : head;
};

const edgeRender = (type) => (lits, keys) =>
  `UNWIND [${lits.join(', ')}] AS r MATCH (a:CodeNode {uid:r.from}), (b:CodeNode {uid:r.to}) ` +
  `MERGE (a)-[e:${type}]->(b) SET ${['e.scanId = r.scanId', ...setClause('e', keys)].join(', ')}`;

const name = (phase, i, total, suffix) =>
  `${phase}${String(i).padStart(total <= 100 ? 2 : String(total - 1).length, '0')}-${suffix}`;

function checkScan(bundle, mode) {
  if (mode !== 'ingest' && mode !== 'link') throw new Error(`unknown mode "${mode}" (ingest|link)`);
  const scan = bundle?.scan ?? {};
  for (const k of SCAN_KEYS)
    if (typeof scan[k] !== 'string' || scan[k] === '') throw new Error(`bundle.scan.${k} is required`);
  if (mode === 'ingest' && scan.projectKey === SYSTEM)
    throw new Error(`projectKey ${SYSTEM} is a link bundle; use --mode link`);
  if (mode === 'link' && scan.projectKey !== SYSTEM)
    throw new Error(`link mode needs a link bundle (scan.projectKey ${SYSTEM}), got ${scan.projectKey}`);
  return scan;
}

export function toLoadPlan(bundle, { mode = 'ingest' } = {}) {
  const scan = checkScan(bundle, mode);
  const env = lit(scan.env);
  const pk = lit(scan.projectKey);
  const sid = lit(scan.scanId);
  const plan = [{ file: '000-schema', language: 'sqlscript', statement: schemaStatements().join(';\n') + ';' }];

  // Nodes: grouped by label; link mode also by key set, so patches never null each other's props.
  const groups = new Map();
  let expectNodes = 0;
  for (const node of bundle.nodes ?? []) {
    if (!NODE_LABELS.includes(node.type))
      throw new Error(`node ${node.uid}: type ${node.type} is not a loadable vertex label`);
    const { row, keys, patch } = nodeRow(node, scan, mode);
    if (patch && keys.length === 0) continue;
    if (!patch && (mode === 'link' || !isShared(node.uid))) expectNodes++;
    const sig = mode === 'link' ? `${node.type}|${patch}|${[...keys].sort().join(',')}` : node.type;
    if (!groups.has(sig)) groups.set(sig, { type: node.type, patch, items: [] });
    groups.get(sig).items.push({ lit: lit(row), keys });
  }
  const nodeBatches = [...groups.values()]
    .sort((a, b) => NODE_LABELS.indexOf(a.type) - NODE_LABELS.indexOf(b.type))
    .flatMap((g) => chunk(g.items, nodeRender(g.type, g.patch)).map((statement) => ({ type: g.type, statement })));
  nodeBatches.forEach((b, i) =>
    plan.push({ file: name(1, i, nodeBatches.length, `nodes-${b.type}`), language: 'cypher', statement: b.statement }));

  if (mode === 'ingest')
    plan.push({
      file: '200-delete-stale-edges',
      language: 'cypher',
      statement: `MATCH (a:CodeNode {env:${env}, projectKey:${pk}})-[e]->() WHERE e.scanId <> ${sid} DELETE e`,
    });

  const edgeGroups = new Map();
  for (const edge of bundle.edges ?? []) {
    if (!EDGE_TYPES.includes(edge.type)) throw new Error(`edge ${edge.from} -> ${edge.to}: unknown type ${edge.type}`);
    const { row, keys } = edgeRow(edge, scan);
    if (!edgeGroups.has(edge.type)) edgeGroups.set(edge.type, []);
    edgeGroups.get(edge.type).push({ lit: lit(row), keys });
  }
  const edgeBatches = [...edgeGroups.entries()]
    .sort(([a], [b]) => EDGE_TYPES.indexOf(a) - EDGE_TYPES.indexOf(b))
    .flatMap(([type, items]) => chunk(items, edgeRender(type)).map((statement) => ({ type, statement })));
  edgeBatches.forEach((b, i) =>
    plan.push({ file: name(3, i, edgeBatches.length, `edges-${b.type}`), language: 'cypher', statement: b.statement }));

  if (mode === 'ingest') {
    plan.push({
      file: '900-cleanup',
      language: 'cypher',
      statement: `MATCH (n:CodeNode {env:${env}, projectKey:${pk}}) WHERE n.scanId <> ${sid} DETACH DELETE n`,
    });
    plan.push({
      file: '990-count',
      language: 'cypher',
      statement: `MATCH (n:CodeNode {env:${env}, projectKey:${pk}}) RETURN count(n) AS nodes`,
      expectNodes,
    });
  } else {
    const gapPrefix = lit(`gap:${scan.env}:system:`);
    plan.push({
      file: '900-cleanup-derived',
      language: 'cypher',
      statement: `MATCH ()-[e]->() WHERE e.derived = true AND e.env = ${env} AND e.scanId <> ${sid} DELETE e`,
    });
    plan.push({
      file: '901-cleanup-derived-gaps',
      language: 'cypher',
      statement: `MATCH (g:Gap) WHERE g.uid STARTS WITH ${gapPrefix} AND g.scanId <> ${sid} DETACH DELETE g`,
    });
    // Link rows carry no projectKey; count the shared rows this link run stamped.
    plan.push({
      file: '990-count',
      language: 'cypher',
      statement: `MATCH (n:CodeNode) WHERE n.scanId = ${sid} RETURN count(n) AS nodes`,
      expectNodes,
    });
  }
  return plan;
}

// Separate maintenance command (spec §11): deletes shared nodes that no longer have any edge.
// Never part of a load plan.
export function sharedCleanupStatement() {
  const prefixes = ['ext:', 'lib:', 'tag:', 'ds:', 'ch:', 'sys:'];
  const cond = prefixes.map((p) => `n.uid STARTS WITH '${p}'`).join(' OR ');
  return `MATCH (n:CodeNode) WHERE (${cond}) AND NOT (n)--() DELETE n`;
}
