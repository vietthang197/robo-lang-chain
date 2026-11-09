// Merge several partial bundles of the same scan into one bundle.
const SCAN_KEYS = ['env', 'projectKey', 'scanId'];

export const isEmpty = (v) =>
  v === undefined ||
  v === null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

export const edgeKey = (e) => `${e.type}|${e.from}|${e.to}`;

/** mergeBundles(parts) -> Bundle. Throws Error('scan mismatch') when parts belong to different scans. */
export function mergeBundles(parts) {
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('no bundles to merge');
  const first = parts[0];
  for (const p of parts) {
    if (SCAN_KEYS.some((k) => p?.scan?.[k] !== first.scan?.[k])) throw new Error('scan mismatch');
  }

  const coverage = { filesTotal: 0, filesRead: 0, skipped: [] };
  const nodes = new Map();
  const edges = new Map();
  const gaps = new Map();
  const diagnostics = [];

  for (const p of parts) {
    const c = p.scan.coverage ?? {};
    coverage.filesTotal += c.filesTotal ?? 0;
    coverage.filesRead += c.filesRead ?? 0;
    coverage.skipped.push(...structuredClone(c.skipped ?? []));

    for (const n of p.nodes ?? []) {
      const seen = nodes.get(n.uid);
      if (!seen) {
        nodes.set(n.uid, structuredClone(n));
        continue;
      }
      seen.props ??= {};
      for (const [k, v] of Object.entries(n.props ?? {})) {
        if (isEmpty(seen.props[k]) && !isEmpty(v)) seen.props[k] = structuredClone(v);
      }
    }
    for (const e of p.edges ?? []) {
      const key = edgeKey(e);
      if (!edges.has(key)) edges.set(key, structuredClone(e));
    }
    for (const g of p.gaps ?? []) {
      if (!gaps.has(g.uid)) gaps.set(g.uid, structuredClone(g));
    }
    diagnostics.push(...structuredClone(p.diagnostics ?? []));
  }

  return {
    schemaVersion: first.schemaVersion,
    scan: { ...structuredClone(first.scan), coverage },
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    gaps: [...gaps.values()],
    diagnostics,
  };
}
