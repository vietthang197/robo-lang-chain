// General bundle validation (spec §10) plus the per-profile rule hook.
import { SCHEMA_VERSION, ENVS, VERTEX_TYPES, EDGE_TYPES, GAP_KINDS } from './model.mjs';
import { checkUid, isShared, parseUid } from './uid.mjs';
import { findSecrets } from './secrets.mjs';
import { profileRules } from './profile-rules/index.mjs';

const SYSTEM_SCAN = '__system__';
const NODE_TYPES = new Set(VERTEX_TYPES.filter((t) => t !== 'CodeNode'));
const EDGE_TYPE_SET = new Set(EDGE_TYPES);
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const DESCRIPTION_SOURCE = new Set(['ai', 'human', 'doc']);
const ASK_WHO = new Set(['BA', 'DevOps', 'Dev']);
const DIAG_LEVELS = new Set(['info', 'warn', 'error']);
const NODE_KEYS = new Set(['type', 'uid', 'props']);
const EDGE_KEYS = new Set(['type', 'from', 'to', 'props']);
const BUNDLE_KEYS = new Set(['schemaVersion', 'scan', 'nodes', 'edges', 'gaps', 'diagnostics']);
const DESCRIBED_STEREOTYPES = new Set(['controller', 'service']);
const COVERAGE_THRESHOLD = 0.95;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// R1: structure per templates/bundle.schema.json. Returns false when the bundle is too broken to go on.
function checkShape(bundle, err) {
  if (!isObj(bundle)) { err('R1-shape', 'bundle is not a JSON object'); return false; }
  for (const k of Object.keys(bundle)) if (!BUNDLE_KEYS.has(k)) err('R1-shape', `unknown top-level key ${k}`);
  if (bundle.schemaVersion !== SCHEMA_VERSION)
    err('R1-shape', `schemaVersion ${JSON.stringify(bundle.schemaVersion)} not supported (want ${SCHEMA_VERSION})`);

  const { scan } = bundle;
  let ok = true;
  if (!isObj(scan)) { err('R1-shape', 'scan block missing'); ok = false; } else {
    if (!nonEmpty(scan.scanId)) err('R1-shape', 'scan.scanId missing');
    if (!ENVS.includes(scan.env)) { err('R1-shape', `scan.env ${JSON.stringify(scan.env)} not in ${ENVS.join(',')}`); ok = false; }
    if (!nonEmpty(scan.projectKey)) { err('R1-shape', 'scan.projectKey missing'); ok = false; }
    const cov = scan.coverage;
    if (cov !== undefined && (!isObj(cov)
      || (cov.filesTotal !== undefined && !(Number.isInteger(cov.filesTotal) && cov.filesTotal >= 0))
      || (cov.filesRead !== undefined && !(Number.isInteger(cov.filesRead) && cov.filesRead >= 0))))
      err('R1-shape', 'scan.coverage must hold non-negative integers filesTotal/filesRead');
  }
  for (const k of ['nodes', 'edges']) if (!Array.isArray(bundle[k])) { err('R1-shape', `${k} must be an array`); ok = false; }
  for (const k of ['gaps', 'diagnostics'])
    if (bundle[k] !== undefined && !Array.isArray(bundle[k])) { err('R1-shape', `${k} must be an array`); ok = false; }
  if (!ok) return false;

  bundle.nodes.forEach((n, i) => {
    if (!isObj(n)) return err('R1-shape', `nodes[${i}] is not an object`);
    const uid = typeof n.uid === 'string' ? n.uid : undefined;
    for (const k of Object.keys(n)) if (!NODE_KEYS.has(k)) err('R1-shape', `nodes[${i}] unknown key ${k} (put it in props)`, uid);
    if (!NODE_TYPES.has(n.type)) err('R1-shape', `nodes[${i}] unknown type ${JSON.stringify(n.type)}`, uid);
    if (!nonEmpty(n.uid)) err('R1-shape', `nodes[${i}] uid missing`);
    if (n.props === undefined) return;
    if (!isObj(n.props)) return err('R1-shape', `nodes[${i}] props must be an object`, uid);
    const p = n.props;
    if (p.confidence !== undefined && !CONFIDENCE.has(p.confidence)) err('R1-shape', `confidence ${JSON.stringify(p.confidence)} invalid`, uid);
    if (p.descriptionSource !== undefined && !DESCRIPTION_SOURCE.has(p.descriptionSource))
      err('R1-shape', `descriptionSource ${JSON.stringify(p.descriptionSource)} invalid`, uid);
    if (p.evidence !== undefined && !(Array.isArray(p.evidence) && p.evidence.every((e) => typeof e === 'string')))
      err('R1-shape', 'evidence must be an array of strings', uid);
    if (p.external !== undefined && typeof p.external !== 'boolean') err('R1-shape', 'external must be boolean', uid);
  });
  bundle.edges.forEach((e, i) => {
    if (!isObj(e)) return err('R1-shape', `edges[${i}] is not an object`);
    for (const k of Object.keys(e)) if (!EDGE_KEYS.has(k)) err('R1-shape', `edges[${i}] unknown key ${k} (put it in props)`);
    if (!EDGE_TYPE_SET.has(e.type)) err('R1-shape', `edges[${i}] unknown type ${JSON.stringify(e.type)}`);
    if (!nonEmpty(e.from) || !nonEmpty(e.to)) err('R1-shape', `edges[${i}] from/to missing`);
    if (e.props !== undefined && !isObj(e.props)) err('R1-shape', `edges[${i}] props must be an object`);
  });
  (bundle.gaps ?? []).forEach((g, i) => {
    if (!isObj(g)) return err('R1-shape', `gaps[${i}] is not an object`);
    if (!nonEmpty(g.uid)) err('R1-shape', `gaps[${i}] uid missing`);
    if (!GAP_KINDS.includes(g.kind)) err('R1-shape', `gaps[${i}] kind ${JSON.stringify(g.kind)} invalid`, g.uid);
    if (!nonEmpty(g.question)) err('R1-shape', `gaps[${i}] question missing`, g.uid);
    if (!ASK_WHO.has(g.askWho)) err('R1-shape', `gaps[${i}] askWho ${JSON.stringify(g.askWho)} invalid`, g.uid);
  });
  (bundle.diagnostics ?? []).forEach((d, i) => {
    if (!isObj(d) || !DIAG_LEVELS.has(d.level) || typeof d.message !== 'string')
      err('R1-shape', `diagnostics[${i}] needs level (info|warn|error) and message`);
  });
  return true;
}

// Calls visit(path, string) for every string value nested in value.
function walkStrings(value, path, visit) {
  if (typeof value === 'string') visit(path, value);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) walkStrings(v, `${path}.${k}`, visit);
}

export function validateBundle(bundle, options = {}) {
  const errors = [];
  const warnings = [];
  const issue = (list) => (rule, message, uid) => list.push(uid === undefined ? { rule, message } : { rule, uid, message });
  const err = issue(errors);
  const warn = issue(warnings);

  if (!checkShape(bundle, err)) return { errors, warnings };

  const { scan } = bundle;
  const link = scan.projectKey === SYSTEM_SCAN;
  const nodes = bundle.nodes.filter((n) => isObj(n) && nonEmpty(n.uid));
  const edges = bundle.edges.filter((e) => isObj(e) && nonEmpty(e.from) && nonEmpty(e.to));
  const byUid = new Map();
  const ofType = (t) => nodes.filter((n) => n.type === t);
  const outEdges = (uid, type) => edges.filter((e) => e.from === uid && (!type || e.type === type));
  const inEdges = (uid, type) => edges.filter((e) => e.to === uid && (!type || e.type === type));

  // R2: unique uids that fit their type and the scan.
  for (const n of nodes) {
    if (byUid.has(n.uid)) err('R2-uid', 'duplicate uid', n.uid);
    else byUid.set(n.uid, n);
    if (NODE_TYPES.has(n.type)) {
      const problem = checkUid(n, scan);
      if (problem) err('R2-uid', problem, n.uid);
    }
  }

  // R3: no dangling edges (link bundles patch the DB, so their endpoints may live there).
  if (!link) {
    const resolvable = (uid, edge, end) => {
      if (byUid.has(uid)) return true;
      if (isShared(uid) && !uid.startsWith('gap:')) return true;
      if (end === 'to' && edge.type === 'TARGETS') {
        const p = parseUid(uid);
        return p.scope === 'project' && p.group === 'endpoint' && p.env === scan.env && p.projectKey !== scan.projectKey;
      }
      return false;
    };
    for (const e of edges)
      for (const end of ['from', 'to'])
        if (!resolvable(e[end], e, end)) err('R3-dangling', `${e.type} ${end} ${e[end]} is not in the bundle`, e[end]);
  }

  if (!link) {
    // R4: exactly one Service and one Deployment.
    for (const t of ['Service', 'Deployment']) {
      const count = ofType(t).length;
      if (count !== 1) err('R4-service-deployment', `expected exactly 1 ${t} for ${scan.env}:${scan.projectKey}, found ${count}`);
    }
    // R5: the service has a visible surface.
    const surface = ofType('Endpoint').length + ofType('Channel').length + ofType('Gap').length + (bundle.gaps?.length ?? 0);
    if (surface === 0)
      for (const s of ofType('Service')) err('R5-service-surface', 'Service has no Endpoint, Channel or Gap', s.uid);
  }
  // R5: every ClientCall has a urlTemplate or a Gap.
  for (const c of ofType('ClientCall'))
    if (!nonEmpty(c.props?.urlTemplate) && outEdges(c.uid, 'HAS_GAP').length === 0)
      err('R5-clientcall-url', 'ClientCall has neither urlTemplate nor HAS_GAP', c.uid);

  // R6: descriptions carry evidence + confidence; key nodes must be described.
  for (const n of nodes) {
    const p = n.props ?? {};
    if (nonEmpty(p.description)) {
      if (!Array.isArray(p.evidence) || p.evidence.length === 0)
        err('R6-description-evidence', 'description without evidence[]', n.uid);
      if (!CONFIDENCE.has(p.confidence)) err('R6-description-evidence', 'description without confidence', n.uid);
    } else if (!link && p.external !== true) {
      const needs = n.type === 'Endpoint' || n.type === 'Capability'
        || (n.type === 'Component' && DESCRIBED_STEREOTYPES.has(p.stereotype));
      if (needs) err('R6-required-description', `${n.type}${p.stereotype ? ` (${p.stereotype})` : ''} needs a description`, n.uid);
    }
  }

  // R7: no secrets anywhere.
  const scanSecrets = (list, name, uidOf) => (list ?? []).forEach((item, i) =>
    walkStrings(item, `${name}[${i}]`, (path, s) => {
      const hits = findSecrets(s);
      if (hits.length) err('R7-secret', `${path} matches secret pattern ${hits.join(',')}`, uidOf(item));
    }));
  scanSecrets(bundle.nodes, 'nodes', (n) => n?.uid);
  scanSecrets(bundle.edges, 'edges', (e) => e?.from);
  scanSecrets(bundle.gaps, 'gaps', (g) => g?.uid);
  scanSecrets(bundle.diagnostics, 'diagnostics', () => undefined);

  // Warnings.
  const cov = scan.coverage;
  if (!link && cov && cov.filesTotal > 0 && typeof cov.filesRead === 'number'
    && cov.filesRead / cov.filesTotal < COVERAGE_THRESHOLD)
    warn('W-coverage', `coverage ${cov.filesRead}/${cov.filesTotal} below ${COVERAGE_THRESHOLD * 100}%`);

  for (const o of ofType('Operation')) {
    if (o.props?.external === true || o.props?.entry === true) continue;
    const called = inEdges(o.uid).some((e) => ['CALLS', 'TRIGGERS', 'REALIZED_BY'].includes(e.type));
    const entry = outEdges(o.uid).some((e) => ['EXPOSES', 'SUBSCRIBES', 'OVERRIDES'].includes(e.type));
    if (!called && !entry) warn('W-unreachable-operation', 'Operation is never called and is not an entry point', o.uid);
  }

  for (const c of ofType('Capability')) {
    const endpoints = outEdges(c.uid, 'REALIZED_BY').filter((e) => {
      const p = parseUid(e.to);
      return p.scope === 'project' && p.group === 'endpoint';
    });
    if (endpoints.length === 1) warn('W-single-endpoint-capability', 'Capability is realized by a single Endpoint', c.uid);
  }

  // Profile rules: explicit list, else the profiles the scan used.
  const profiles = options.profiles ?? scan.readerProfiles ?? [];
  for (const name of profiles) {
    const rule = profileRules[name];
    if (typeof rule !== 'function') { warn('W-profile-unknown', `no validation rules for profile ${name}`); continue; }
    for (const i of rule(bundle) ?? []) errors.push(i);
  }

  return { errors, warnings };
}
