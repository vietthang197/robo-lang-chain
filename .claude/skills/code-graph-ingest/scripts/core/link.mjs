// Cross-service link plan (spec §7.2): ClientCall -> Endpoint/ExternalSystem/Channel matching,
// Gaps for what cannot be decided, Deployment.hosts patches and L1 rollups.
// Output is a link bundle (scan.projectKey '__system__') loaded with bundle-to-cypher --mode link.
import { createHash } from 'node:crypto';
import { SCHEMA_VERSION } from './model.mjs';
import { serviceUid, parseUid } from './uid.mjs';
import { normalizeUrl, templateToRegex, stripContextPath } from './url.mjs';

const SYSTEM = '__system__';
const RANK = { high: 3, medium: 2, low: 1 };
const VAR = /\{[^}]*\}/g;
const DUMMY = '__var__';

const lower = (s) => (typeof s === 'string' && s.trim() !== '' ? s.trim().toLowerCase() : null);
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniqSorted = (xs) => [...new Set(xs.filter((x) => x !== null && x !== undefined))].sort(byStr);
const isProducer = (kind) => typeof kind === 'string' && kind.endsWith('-producer');
// Endpoint protocols matched by method + path (ruling R21: IRIS REST endpoints link like http).
const PATH_PROTOCOLS = new Set(['http', 'iris']);
const pathProtocol = (p) => PATH_PROTOCOLS.has(p ?? 'http');
const hash12 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

export const gapUidFor = (env, kind, clientCallUid) => `gap:${env}:system:${kind}:${hash12(clientCallUid)}`;

// Call path to match: resolvedPath, else the path part of urlTemplate.
function callPath(call) {
  if (typeof call.resolvedPath === 'string' && call.resolvedPath !== '') return normalizeUrl(call.resolvedPath).path;
  if (typeof call.urlTemplate === 'string' && call.urlTemplate !== '') return normalizeUrl(call.urlTemplate).path;
  return null;
}

function endpointRegex(ep) {
  if (typeof ep.pathRegex === 'string' && ep.pathRegex !== '') {
    try { return new RegExp(ep.pathRegex); } catch { /* fall back to the template */ }
  }
  return typeof ep.path === 'string' && ep.path !== '' ? new RegExp(templateToRegex(ep.path)) : null;
}

const methodOk = (call, ep) => {
  const a = call.httpMethod?.toUpperCase();
  const b = ep.httpMethod?.toUpperCase();
  return !a || !b || a === b || b === 'ANY' || b === '*';
};

export function planLinks(input, { env, scanId, gapAnswers = [] } = {}) {
  if (!env) throw new Error('planLinks: env is required');
  const sid = scanId ?? `${env}-link-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
  const list = (k) => (Array.isArray(input?.[k]) ? input[k] : []);
  const calls = list('clientCalls');
  const endpoints = list('endpoints');
  const deployments = new Map(list('deployments').filter((d) => d?.projectKey).map((d) => [d.projectKey, d]));
  const services = list('services').filter((s) => s?.projectKey);
  const channels = list('channels');
  const answers = new Map();
  for (const a of gapAnswers ?? [])
    if (a?.env === env && typeof a.clientCall === 'string' && a.answer?.targetService) answers.set(a.clientCall, a);

  const httpEndpoints = endpoints.filter((e) => pathProtocol(e.protocol))
    .map((e) => ({ ...e, re: endpointRegex(e) })).filter((e) => e.re);
  const hostsOf = (pk) => uniqSorted((deployments.get(pk)?.hosts ?? []).map(lower));

  // Endpoints of project pk whose path matches the call path after pk's contextPath strip (R16).
  // {x} segments in the call path match any single segment. Best match first.
  function pathMatches(call, pk) {
    const raw = callPath(call);
    if (raw === null) return [];
    const stripped = stripContextPath(raw, deployments.get(pk)?.contextPath ?? null);
    if (stripped === null) return [];
    const probe = stripped.replace(VAR, DUMMY);
    const callTpl = stripped.replace(VAR, '{}');
    return httpEndpoints
      .filter((e) => e.projectKey === pk && methodOk(call, e) && e.re.test(probe))
      .sort((a, b) => {
        const exact = (e) => ((e.path ?? '').replace(VAR, '{}') === callTpl ? 0 : 1);
        const vars = (e) => ((e.path ?? '').match(VAR) ?? []).length;
        return exact(a) - exact(b) || vars(a) - vars(b) || byStr(a.uid, b.uid);
      });
  }
  const projectsWithHttp = uniqSorted(httpEndpoints.map((e) => e.projectKey));
  const matchAll = (call, pks) => pks.map((pk) => ({ pk, ep: pathMatches(call, pk)[0] })).filter((x) => x.ep);
  const candidate = (pk) => {
    const d = deployments.get(pk);
    return { projectKey: pk, hosts: hostsOf(pk), port: d?.port ?? null };
  };

  // Projects (other than the caller) whose Deployment the call reaches by host (port compatible),
  // else by port alone when exactly one Deployment has that port and either the call host is
  // unknown or that Deployment has no known hosts yet (mirrors rule 1).
  function nearMiss(call, host, port) {
    const others = [...deployments.keys()].filter((pk) => pk !== call.projectKey).sort(byStr);
    const portOk = (d) => port === null || d.port == null || d.port === port;
    if (host !== null) {
      const byHost = others.filter((pk) => hostsOf(pk).includes(host) && portOk(deployments.get(pk)));
      if (byHost.length) return byHost;
      if (others.some((pk) => hostsOf(pk).includes(host))) return [];
    }
    // A deployment whose known hosts do not include the call host is another machine on the same
    // port, not a near-miss.
    if (port === null) return [];
    const byPort = others.filter((pk) => deployments.get(pk).port === port && (host === null || hostsOf(pk).length === 0));
    return byPort.length === 1 ? byPort : [];
  }

  // Automatic rules 1-4. Returns {targets:[{uid, matchedBy, confidence, protocol}]} or {gap:{kind, candidates}}
  // or {external:{host, port}}.
  function auto(call) {
    const ofs = call.clientKind === 'ofs';
    if (ofs || call.topic != null) {
      let hits = [];
      if (ofs && call.signature != null) {
        hits = endpoints.filter((e) => e.signature != null && e.signature === call.signature && (e.protocol ?? 'ofs') === 'ofs')
          .map((e) => ({ uid: e.uid, pk: e.projectKey, matchedBy: 'ofs-version', confidence: 'high', protocol: 'ofs' }));
        const pks = uniqSorted(hits.map((h) => h.pk));
        if (pks.length > 1) return { gap: { kind: 'ambiguous-target', candidates: pks.map(candidate) } };
      } else if (!ofs) {
        const tech = typeof call.clientKind === 'string' ? call.clientKind.split('-')[0] : null;
        let chs = channels.filter((c) => c.name != null && c.name === call.topic);
        if (chs.some((c) => c.tech === tech)) chs = chs.filter((c) => c.tech === tech);
        hits = chs.map((c) => ({ uid: c.uid, matchedBy: 'topic', confidence: 'high', protocol: c.tech ?? tech }));
      }
      return hits.length ? { targets: hits } : { gap: { kind: 'unknown-external', candidates: [] } };
    }

    const host = lower(call.resolvedHost) ?? normalizeUrl(call.urlTemplate ?? '').host;
    const port = call.resolvedPort ?? null;
    const http = (pk, ep, matchedBy, confidence) =>
      ({ targets: [{ uid: ep.uid, pk, matchedBy, confidence, protocol: ep.protocol ?? 'http' }] });

    // Rule 1: host membership (and port when both are known) -> high; a deployment with no hosts
    // yet and the same port -> medium. Either way the path must match after the contextPath strip.
    let portOnly = null;
    if (host !== null || port !== null) {
      const high = [];
      const medium = [];
      for (const pk of projectsWithHttp) {
        const d = deployments.get(pk);
        if (!d) continue;
        const hosts = hostsOf(pk);
        let level = null;
        if (hosts.length) {
          if (host !== null && hosts.includes(host) && (port === null || d.port == null || d.port === port)) level = 'high';
        } else if (port !== null && d.port === port) level = 'medium';
        if (!level) continue;
        const ep = pathMatches(call, pk)[0];
        if (ep) (level === 'high' ? high : medium).push({ pk, ep });
      }
      if (high.length === 1) return http(high[0].pk, high[0].ep, 'host+path', 'high');
      if (high.length > 1) return { gap: { kind: 'ambiguous-target', candidates: high.map((x) => candidate(x.pk)) } };
      // A port-only medium match is only a fallback: rule 2 (high) is tried first.
      if (medium.length === 1) portOnly = http(medium[0].pk, medium[0].ep, 'host+path', 'medium');
    }

    // Rule 2: discovery name (lb://x, Feign name; also a host that is a service name) = Service.name.
    for (const name of uniqSorted([lower(call.discoveryName), host])) {
      const svc = services.filter((s) => lower(s.name) === name || lower(s.projectKey) === name);
      const hits = matchAll(call, uniqSorted(svc.map((s) => s.projectKey)));
      if (hits.length === 1) return http(hits[0].pk, hits[0].ep, 'host+path', 'high');
    }
    if (portOnly) return portOnly;

    // Rule 3: path only.
    const hits = matchAll(call, projectsWithHttp);
    if (hits.length === 1) return http(hits[0].pk, hits[0].ep, 'path', 'medium');
    if (hits.length > 1) return { gap: { kind: 'ambiguous-target', candidates: hits.map((x) => candidate(x.pk)) } };

    // Rule 3b (ruling R20): the call reaches the host/port of a scanned project but no endpoint of it
    // matched (typically a base URL without the target's context-path). Ask instead of silently
    // treating the call as external.
    const near = nearMiss(call, host, port);
    if (near.length) {
      const pks = near.join(', ');
      const ctx = near.map((pk) => deployments.get(pk)?.contextPath ?? '(không có)').join(', ');
      const what = [call.httpMethod, call.resolvedPath ?? call.urlTemplate].filter(Boolean).join(' ');
      return { gap: {
        kind: 'unresolved-call',
        candidates: near.map((pk) => ({ ...candidate(pk), contextPath: deployments.get(pk)?.contextPath ?? null })),
        question: `Lời gọi ${what} từ ${call.projectKey} trỏ tới host/port của ${pks} nhưng không khớp endpoint nào (context-path ${ctx}). Base URL có thiếu context-path không?`,
      } };
    }
    if (host !== null) return { external: { host, port } };
    return { gap: { kind: 'unknown-external', candidates: [] } };
  }

  // Rule 5: catalog gapAnswers (R17), overriding rules 1-4.
  function manual(call, a) {
    const pk = a.answer.targetService;
    let ep;
    if (call.clientKind === 'ofs')
      ep = endpoints.find((e) => e.projectKey === pk && e.signature != null && e.signature === call.signature);
    else ep = pathMatches(call, pk)[0];
    return ep ? { uid: ep.uid, pk, matchedBy: 'manual', confidence: 'high', protocol: ep.protocol ?? 'http' } : null;
  }

  const nodes = new Map();
  const edges = [];
  const gaps = [];
  const diagnostics = [];
  const newHosts = new Map(); // projectKey -> Set(host)
  const externals = new Map(); // host -> Set(port)
  const contributions = []; // {call, to, confidence, protocol}
  const derived = { derived: true, env };

  const describe = (call) => [call.httpMethod, call.urlTemplate ?? call.signature ?? call.topic ?? call.uid].filter(Boolean).join(' ');
  function addGap(call, kind, candidates, question, extra = {}) {
    const uid = gapUidFor(env, kind, call.uid);
    const askWho = kind === 'unknown-external' ? 'DevOps' : kind === 'unresolved-call' ? 'Dev' : 'BA';
    const props = { kind, askWho, question, candidates, status: 'open', clientCall: call.uid, ...extra };
    nodes.set(uid, { type: 'Gap', uid, props });
    gaps.push({ uid, ...props });
    edges.push({ type: 'HAS_GAP', from: call.uid, to: uid, props: { ...derived } });
  }
  const questionFor = (call, kind) => (kind === 'ambiguous-target'
    ? `Lời gọi ${describe(call)} từ ${call.projectKey} trỏ tới host/IP nào?`
    : `Lời gọi ${describe(call)} từ ${call.projectKey} trỏ tới hệ thống nào (host/IP hoặc service)?`);
  function target(call, t) {
    edges.push({ type: 'TARGETS', from: call.uid, to: t.uid, props: { matchedBy: t.matchedBy, confidence: t.confidence, ...derived } });
    contributions.push({ call, to: t.uid, confidence: t.confidence, protocol: t.protocol });
  }
  const addHost = (pk, h) => {
    const v = lower(h);
    if (v === null) return;
    if (!newHosts.has(pk)) newHosts.set(pk, new Set());
    newHosts.get(pk).add(v);
  };

  for (const call of [...calls].filter((c) => c?.uid).sort((a, b) => byStr(a.uid, b.uid))) {
    const a = answers.get(call.uid);
    if (a) {
      const t = manual(call, a);
      const r = auto(call);
      if (t) {
        target(call, t);
        // Only the recorded answer.host is trusted; the call's resolvedHost is not (ruling R18).
        if (a.answer.host != null) addHost(t.pk, a.answer.host);
        if (r.gap) addGap(call, r.gap.kind, r.gap.candidates, r.gap.question ?? questionFor(call, r.gap.kind), {
          status: 'answered', answer: `targetService=${a.answer.targetService}${a.answer.host ? `, host=${a.answer.host}` : ''}`,
          ...(a.answeredBy ? { answeredBy: a.answeredBy } : {}),
        });
      } else {
        addGap(call, 'ambiguous-target', [candidate(a.answer.targetService)],
          `Câu trả lời đã ghi trong gapAnswers (targetService=${a.answer.targetService}) không khớp Endpoint nào cho lời gọi ${describe(call)} từ ${call.projectKey}; lời gọi trỏ tới host/IP nào?`);
      }
      continue;
    }
    const r = auto(call);
    if (r.targets) {
      for (const t of r.targets) {
        target(call, t);
        // Fill Deployment.hosts from calls matched for sure (spec §7.2 step 5).
        if (t.confidence === 'high' && pathProtocol(t.protocol) && t.pk && call.resolvedHost != null
          && lower(call.resolvedHost) !== lower(call.discoveryName)
          && !services.some((s) => lower(s.name) === lower(call.resolvedHost)))
          addHost(t.pk, call.resolvedHost);
      }
    } else if (r.external) {
      const uid = `sys:${env}:${r.external.host}`;
      if (!externals.has(r.external.host)) externals.set(r.external.host, new Set());
      if (r.external.port !== null) externals.get(r.external.host).add(r.external.port);
      target(call, { uid, matchedBy: 'host', confidence: 'medium', protocol: 'http' });
    } else {
      addGap(call, r.gap.kind, r.gap.candidates, r.gap.question ?? questionFor(call, r.gap.kind));
    }
  }

  for (const [host, ports] of externals) {
    const uid = `sys:${env}:${host}`;
    const p = [...ports];
    nodes.set(uid, { type: 'ExternalSystem', uid, props: { name: host, host, port: p.length === 1 ? p[0] : null } });
  }

  // Deployment hosts patches, only when the set changes.
  for (const [pk, add] of newHosts) {
    const d = deployments.get(pk);
    if (!d?.uid) {
      diagnostics.push({ level: 'warn', message: `no Deployment for ${pk}; hosts ${[...add].sort().join(',')} not recorded` });
      continue;
    }
    const before = hostsOf(pk);
    const after = uniqSorted([...before, ...add]);
    if (after.length !== before.length) nodes.set(d.uid, { type: 'Deployment', uid: d.uid, props: { hosts: after } });
  }

  // SERVICE_DEPENDS_ON rollup per (caller service, target service or external system).
  // Calls to a Channel roll up async (producer -> every subscriber service of that channel).
  const roll = new Map();
  const channelByUid = new Map(channels.filter((c) => c?.uid).map((c) => [c.uid, c]));
  const subscribers = new Map(); // channel uid -> Set(projectKey)
  for (const s of list('subscriptions')) {
    if (!s?.projectKey || !s.channel) continue;
    if (!subscribers.has(s.channel)) subscribers.set(s.channel, new Set());
    subscribers.get(s.channel).add(s.projectKey);
  }
  const contribute = (from, to, c, protocol, sync) => {
    if (from === to) return;
    const key = `${from}\u0000${to}`;
    if (!roll.has(key)) roll.set(key, { from, to, protocols: new Set(), sync: false, used: new Set(), calls: new Set(), conf: 'high' });
    const r = roll.get(key);
    if (protocol) r.protocols.add(protocol);
    if (sync) r.sync = true;
    r.used.add(c.to);
    r.calls.add(c.call.uid);
    if (RANK[c.confidence] < RANK[r.conf]) r.conf = c.confidence;
  };
  for (const c of contributions) {
    const p = parseUid(c.to);
    const from = serviceUid(env, c.call.projectKey);
    if (p.scope === 'project') contribute(from, serviceUid(env, p.projectKey), c, c.protocol, !isProducer(c.call.clientKind));
    else if (p.group === 'sys') contribute(from, c.to, c, c.protocol, !isProducer(c.call.clientKind));
    else if (p.group === 'ch')
      for (const pk of [...(subscribers.get(c.to) ?? [])].sort(byStr))
        contribute(from, serviceUid(env, pk), c, channelByUid.get(c.to)?.tech ?? 'channel', false);
  }
  for (const r of roll.values())
    edges.push({
      type: 'SERVICE_DEPENDS_ON', from: r.from, to: r.to,
      props: {
        protocol: [...r.protocols].sort(byStr).join(','), sync: r.sync, endpointsUsed: [...r.used].sort(byStr),
        callCount: r.calls.size, confidence: r.conf, ...derived,
      },
    });

  // OWNS_DATA (any write|rw) / READS_DATA per (service, data store).
  const data = new Map();
  for (const x of list('accesses')) {
    if (!x?.projectKey || !x.dataStore) continue;
    const key = `${x.projectKey}\u0000${x.dataStore}`;
    const owns = x.mode === 'write' || x.mode === 'rw';
    data.set(key, { pk: x.projectKey, ds: x.dataStore, owns: (data.get(key)?.owns ?? false) || owns });
  }
  for (const d of data.values())
    edges.push({ type: d.owns ? 'OWNS_DATA' : 'READS_DATA', from: serviceUid(env, d.pk), to: d.ds, props: { source: 'writes', ...derived } });

  const edgeKey = (e) => `${e.type}\u0000${e.from}\u0000${e.to}`;
  const uniqueEdges = [...new Map(edges.map((e) => [edgeKey(e), e])).values()];
  return {
    schemaVersion: SCHEMA_VERSION,
    scan: { scanId: sid, env, projectKey: SYSTEM },
    nodes: [...nodes.values()].sort((a, b) => byStr(a.type, b.type) || byStr(a.uid, b.uid)),
    edges: uniqueEdges.sort((a, b) => byStr(a.type, b.type) || byStr(a.from, b.from) || byStr(a.to, b.to)),
    gaps: gaps.sort((a, b) => byStr(a.uid, b.uid)),
    diagnostics,
  };
}
