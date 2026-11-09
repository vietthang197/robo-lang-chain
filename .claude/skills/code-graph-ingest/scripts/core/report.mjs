// Topology report renderer (spec §7.3). Pure: report-data.json (+ optional previous one) -> markdown.
// Input rows come from reportQueries(); any field may be null/missing, so every access is defensive.
// Output is deterministic: every list is sorted by plain code-unit order (no locale).

const UNCLASSIFIED = '(chưa phân loại)';
const UNKNOWN_ASKER = '(chưa rõ)';

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (v === null || v === undefined ? '' : String(v));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (xs) => [...xs].sort(cmp);
const uniq = (xs) => sorted(new Set(xs));

/** Escape a value for a markdown table cell: `|` -> `\|`, newlines -> `<br>`. */
export const cell = (v) => str(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;
const table = (header, rows) => [row(header), `|${header.map(() => '---').join('|')}|`, ...rows.map(row)];

const serviceKey = (s) => str(s?.projectKey ?? s?.name ?? s?.uid);
const serviceName = (s) => str(s?.name ?? s?.projectKey ?? s?.uid);
const capabilityNames = (s) =>
  uniq(arr(s?.capabilities).map((c) => (c && typeof c === 'object' ? str(c.name ?? c.uid) : str(c))).filter(Boolean));
const coverage = (c) =>
  c && c.filesRead !== null && c.filesRead !== undefined && c.filesTotal !== null && c.filesTotal !== undefined
    ? `${c.filesRead}/${c.filesTotal}` : '—';
const depKey = (d) => `${str(d?.from)}→${str(d?.to)}`;
const isOpen = (g) => g?.status === undefined || g?.status === null || g.status === 'open';

function servicesSection(services) {
  const keyed = services.map((s) => ({
    domain: s?.domain ? str(s.domain) : null,
    layer: s?.layer ? str(s.layer) : '—',
    name: serviceName(s),
    s,
  }));
  // Classified domains first (sorted), unclassified last; then layer, then name.
  keyed.sort((a, b) => (a.domain === null) - (b.domain === null)
    || cmp(a.domain ?? '', b.domain ?? '') || cmp(a.layer, b.layer) || cmp(a.name, b.name));
  const out = ['## Services theo Domain/Layer', ''];
  if (!keyed.length) return [...out, '_Không có service._'];
  return [...out, ...table(['Service', 'Domain', 'Layer', 'Summary', 'Capabilities', 'Độ phủ'],
    keyed.map(({ domain, layer, name, s }) =>
      [name, domain ?? UNCLASSIFIED, layer, str(s?.summary), capabilityNames(s).join(', '), coverage(s?.coverage)]))];
}

function matrixCell(d) {
  const base = `${str(d?.protocol) || '?'}×${d?.callCount ?? 0}`;
  return d?.sync === false ? `${base} (async)` : base;
}

function dependencySection(deps) {
  const out = ['## Phụ thuộc', ''];
  if (!deps.length) return [...out, '_Không có phụ thuộc._'];
  const callers = uniq(deps.map((d) => str(d?.from)));
  const targets = uniq(deps.map((d) => str(d?.to)));
  const cells = new Map();
  for (const d of deps) {
    const k = depKey(d);
    cells.set(k, [...(cells.get(k) ?? []), matrixCell(d)]);
  }
  const rows = callers.map((c) => [c, ...targets.map((t) => sorted(cells.get(`${c}→${t}`) ?? []).join('; '))]);
  return [...out, ...table(['Caller', ...targets], rows)];
}

function dataSection(stores) {
  const out = ['## Dữ liệu', ''];
  if (!stores.length) return [...out, '_Không có DataStore._'];
  const rows = stores
    .map((d) => [d?.tech ? `${str(d.dataStore)} (${str(d.tech)})` : str(d?.dataStore),
      uniq(arr(d?.owners).map(str)).join(', '), uniq(arr(d?.readers).map(str)).join(', ')])
    .sort((a, b) => cmp(a[0], b[0]));
  return [...out, ...table(['DataStore', 'Owner', 'Readers'], rows)];
}

function gapSection(gaps) {
  const out = ['## Gap đang mở', ''];
  const open = gaps.filter(isOpen);
  if (!open.length) return [...out, '_Không có gap đang mở._'];
  const groups = new Map();
  for (const g of open) {
    const who = g?.askWho ? str(g.askWho) : UNKNOWN_ASKER;
    groups.set(who, [...(groups.get(who) ?? []), g]);
  }
  const names = [...groups.keys()].sort((a, b) => (a === UNKNOWN_ASKER) - (b === UNKNOWN_ASKER) || cmp(a, b));
  for (const who of names) {
    out.push(`### ${who}`, '');
    const items = groups.get(who).sort((a, b) => cmp(str(a?.uid), str(b?.uid)) || cmp(str(a?.question), str(b?.question)));
    for (const g of items) {
      const kind = g?.kind ? ` _(${str(g.kind)})_` : '';
      const attached = g?.attached ? ` — \`${str(g.attached)}\`` : '';
      out.push(`- ${str(g?.question).replace(/\r?\n/g, ' ') || '(không có câu hỏi)'}${kind}${attached}`);
    }
    out.push('');
  }
  return out.slice(0, -1);
}

const added = (now, before) => sorted([...now].filter((x) => !before.has(x)));

function capabilityPairs(services, keep) {
  const pairs = new Set();
  for (const s of services) {
    const k = serviceKey(s);
    if (keep.has(k)) for (const c of capabilityNames(s)) pairs.add(`${k}: ${c}`);
  }
  return pairs;
}

function diffSection(data, prev) {
  const out = ['## Thay đổi so với lần trước', ''];
  if (!prev) return [...out, 'Lần đầu tạo report'];
  const nowSvc = new Set(arr(data.services).map(serviceKey));
  const oldSvc = new Set(arr(prev.services).map(serviceKey));
  const both = new Set([...nowSvc].filter((k) => oldSvc.has(k)));
  const nowDep = new Set(arr(data.dependencies).map(depKey));
  const oldDep = new Set(arr(prev.dependencies).map(depKey));
  const nowCap = capabilityPairs(arr(data.services), both);
  const oldCap = capabilityPairs(arr(prev.services), both);
  const parts = [
    ['Service mới', added(nowSvc, oldSvc)],
    ['Service bị mất', added(oldSvc, nowSvc)],
    ['Phụ thuộc mới', added(nowDep, oldDep)],
    ['Phụ thuộc bị mất', added(oldDep, nowDep)],
    ['Capability mới', added(nowCap, oldCap)],
    ['Capability bị mất', added(oldCap, nowCap)],
  ].filter(([, items]) => items.length);
  if (!parts.length) return [...out, 'Không có thay đổi.'];
  for (const [title, items] of parts) out.push(`### ${title}`, '', ...items.map((i) => `- ${i}`), '');
  return out.slice(0, -1);
}

/**
 * @param {object} data report-data.json ({services, dependencies, dataOwnership, gaps})
 * @param {object|null} prev previous report-data.json, or null for the first report
 * @param {{env: string, generatedAt?: string}} opts
 * @returns {string} markdown
 */
export function renderReport(data, prev, { env, generatedAt } = {}) {
  const d = data ?? {};
  const lines = [
    `# Topology ${str(env)}`,
    '',
    ...(generatedAt ? [`_Tạo lúc ${str(generatedAt)}_`, ''] : []),
    ...servicesSection(arr(d.services)), '',
    ...dependencySection(arr(d.dependencies)), '',
    ...dataSection(arr(d.dataOwnership)), '',
    ...gapSection(arr(d.gaps)), '',
    ...diffSection(d, prev ?? null),
  ];
  return lines.join('\n') + '\n';
}

/** studio-queries.md body from studioQueries(env) output. */
export function renderStudioQueries(queries, env) {
  const out = [`# Studio queries ${str(env)}`, ''];
  for (const { title, cypher } of arr(queries)) out.push(`## ${str(title)}`, '', '```cypher', str(cypher), '```', '');
  return out.join('\n');
}
