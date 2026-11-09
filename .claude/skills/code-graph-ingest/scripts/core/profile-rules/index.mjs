// Per-profile validation rules (spec §10, item 8 of each reader profile).
// Each rule takes the bundle and returns Issue[] ({rule, uid?, message}); issues count as errors.
// Rule ids start with the profile name so callers can filter them.

const HTTP_CLIENT_KINDS = new Set(['feign', 'rest-template', 'web-client', 'rest-client']);
// An absolute URL written in code (http://host/…, lb://name/…) needs no base-url config.
const ABSOLUTE_URL = /^[a-z][\w+.-]*:\/\/[^/]/i;

function index(bundle) {
  const nodes = (bundle?.nodes ?? []).filter((n) => n && typeof n.uid === 'string');
  const edges = (bundle?.edges ?? []).filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string');
  const out = (uid, type) => edges.filter((e) => e.from === uid && e.type === type);
  return { nodes, edges, out };
}

// references/readers/spring-boot.md §8.
function springBoot(bundle) {
  const issues = [];
  const { nodes, out } = index(bundle);
  const byUid = new Map(nodes.map((n) => [n.uid, n]));

  // 1. Every controller Component has >= 1 Operation (CONTAINS) that EXPOSES an Endpoint.
  for (const c of nodes) {
    if (c.type !== 'Component' || c.props?.stereotype !== 'controller' || c.props?.external === true) continue;
    const exposes = out(c.uid, 'CONTAINS')
      .filter((e) => byUid.get(e.to)?.type === 'Operation')
      .some((e) => out(e.to, 'EXPOSES').length > 0);
    if (!exposes)
      issues.push({ rule: 'spring-boot-controller-endpoint', uid: c.uid, message: 'controller has no Operation that EXPOSES an Endpoint' });
  }

  // 2. HTTP client calls carry USES_CONFIG {role:'base-url'} or a HAS_GAP. Exempt: an absolute URL
  // written in code, and a pure service-discovery call (discoveryName set, no base-url config key).
  for (const c of nodes) {
    if (c.type !== 'ClientCall' || !HTTP_CLIENT_KINDS.has(c.props?.clientKind)) continue;
    if (ABSOLUTE_URL.test(c.props?.urlTemplate ?? '')) continue;
    const discoveryOnly = typeof c.props?.discoveryName === 'string' && c.props.discoveryName.trim() !== ''
      && (c.props?.baseUrlConfigKey === null || c.props?.baseUrlConfigKey === undefined);
    if (discoveryOnly) continue;
    const baseUrl = out(c.uid, 'USES_CONFIG').some((e) => e.props?.role === 'base-url');
    if (!baseUrl && out(c.uid, 'HAS_GAP').length === 0)
      issues.push({ rule: 'spring-boot-clientcall-base-url', uid: c.uid, message: `${c.props.clientKind} ClientCall has neither USES_CONFIG {role:'base-url'} nor HAS_GAP` });
  }

  // 3. A resolved ConfigKey server.port is reflected in Deployment.port.
  const deployments = nodes.filter((n) => n.type === 'Deployment');
  for (const k of nodes) {
    if (k.type !== 'ConfigKey') continue;
    const key = k.props?.key ?? k.uid.slice(k.uid.indexOf(':config:') + ':config:'.length);
    if (key !== 'server.port') continue;
    const value = k.props?.value;
    if (value === null || value === undefined || !/^\d+$/.test(String(value).trim())) continue;
    const port = Number(String(value).trim());
    for (const d of deployments)
      if (Number(d.props?.port) !== port)
        issues.push({ rule: 'spring-boot-server-port', uid: d.uid, message: `Deployment.port ${JSON.stringify(d.props?.port ?? null)} != server.port ${port} (${k.uid})` });
  }
  return issues;
}

export const profileRules = {
  'spring-boot': springBoot,
  t24: (_bundle) => [],
  'java-generic': (_bundle) => [],
};
