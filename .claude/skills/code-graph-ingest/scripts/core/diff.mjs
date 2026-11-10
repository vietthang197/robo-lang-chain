// Diff two bundles (previous scan vs next scan) and render a markdown summary.
import { edgeKey } from './merge.mjs';

const IGNORED = new Set(['scanId', 'contentHash', 'lineStart', 'lineEnd']);

const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  }
  return v;
};
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function changedFields(a, b) {
  const fields = [];
  if (a.type !== b.type) fields.push('type');
  const pa = a.props ?? {};
  const pb = b.props ?? {};
  const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].sort();
  for (const k of keys) if (!IGNORED.has(k) && !same(pa[k], pb[k])) fields.push(k);
  return fields;
}

/** diffBundles(prev|null, next) -> {addedNodes, removedNodes, changedNodes, addedEdges, removedEdges} */
export function diffBundles(prev, next) {
  const prevNodes = new Map((prev?.nodes ?? []).map((n) => [n.uid, n]));
  const nextNodes = new Map((next?.nodes ?? []).map((n) => [n.uid, n]));
  const prevEdges = new Map((prev?.edges ?? []).map((e) => [edgeKey(e), e]));
  const nextEdges = new Map((next?.edges ?? []).map((e) => [edgeKey(e), e]));

  const addedNodes = [];
  const changedNodes = [];
  for (const [uid, n] of nextNodes) {
    const old = prevNodes.get(uid);
    if (!old) addedNodes.push(n);
    else {
      const fields = changedFields(old, n);
      if (fields.length) changedNodes.push({ uid, type: n.type, fields });
    }
  }
  const removedNodes = [...prevNodes].filter(([uid]) => !nextNodes.has(uid)).map(([, n]) => n);
  const addedEdges = [...nextEdges].filter(([k]) => !prevEdges.has(k)).map(([, e]) => e);
  const removedEdges = [...prevEdges].filter(([k]) => !nextEdges.has(k)).map(([, e]) => e);
  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges };
}

function groupBy(items, keyOf) {
  const m = new Map();
  for (const it of items) {
    const k = keyOf(it) ?? '(unknown)';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return [...m].sort(([a], [b]) => a.localeCompare(b));
}

function section(title, items, keyOf, line) {
  const out = [`## ${title} (${items.length})`, ''];
  if (!items.length) return [...out, '_none_', ''];
  for (const [k, list] of groupBy(items, keyOf)) {
    out.push(`### ${k} (${list.length})`, '');
    for (const it of list) out.push(`- ${line(it)}`);
    out.push('');
  }
  return out;
}

/** renderDiff(diff) -> markdown: counts first, then lists grouped by vertex (or edge) type. */
export function renderDiff(d) {
  const code = (s) => '`' + s + '`';
  const edgeLine = (e) => `${code(e.from)} -[${e.type}]-> ${code(e.to)}`;
  return [
    '# Graph diff',
    '',
    '| Change | Count |',
    '|---|---|',
    `| Added nodes | ${d.addedNodes.length} |`,
    `| Removed nodes | ${d.removedNodes.length} |`,
    `| Changed nodes | ${d.changedNodes.length} |`,
    `| Added edges | ${d.addedEdges.length} |`,
    `| Removed edges | ${d.removedEdges.length} |`,
    '',
    ...section('Added nodes', d.addedNodes, (n) => n.type, (n) => code(n.uid)),
    ...section('Removed nodes', d.removedNodes, (n) => n.type, (n) => code(n.uid)),
    ...section('Changed nodes', d.changedNodes, (c) => c.type, (c) => `${code(c.uid)}: ${c.fields.join(', ')}`),
    ...section('Added edges', d.addedEdges, (e) => e.type, edgeLine),
    ...section('Removed edges', d.removedEdges, (e) => e.type, edgeLine),
  ].join('\n');
}
