// URL and path-template helpers for cross-service linking (spec §7.2).

const DEFAULT_PORT = { http: 80, https: 443 };

// Drops query/fragment and the trailing '/'; '' becomes '/'.
function cleanPath(path) {
  let p = path.replace(/[?#].*$/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

// url -> {host, port, path}. Drops scheme, userinfo, query, fragment and trailing '/'.
// Port defaults to 80/443 for http/https. A bare path (or `${base}/path`) has host/port null.
export function normalizeUrl(url) {
  const s = String(url ?? '').trim();
  const m = /^([a-z][\w+.-]*):\/\/([^/?#]*)(.*)$/i.exec(s);
  if (!m) {
    // `${some.base-url}/items/{id}`: the base is unresolved, keep only the path part.
    const rest = s.startsWith('${') ? s.slice(s.indexOf('}') + 1) : s;
    return { host: null, port: null, path: cleanPath(rest) };
  }
  const scheme = m[1].toLowerCase();
  let auth = m[2];
  const at = auth.lastIndexOf('@');
  if (at >= 0) auth = auth.slice(at + 1);
  let host = auth;
  let port = null;
  const hp = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(auth);
  if (hp) {
    host = hp[1];
    if (hp[2] !== undefined) port = Number(hp[2]);
  }
  if (port === null) port = DEFAULT_PORT[scheme] ?? null;
  return { host: host === '' ? null : host.toLowerCase(), port, path: cleanPath(m[3]) };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, (c) => (c === '/' ? '/' : `\\${c}`));

// '/a/{id}' -> '^/a/[^/]+$'. Every {x} (also Spring {x:regex}) is one path segment.
export function templateToRegex(template) {
  const parts = String(template).split(/(\{[^}]*\})/);
  return `^${parts.map((p) => (/^\{[^}]*\}$/.test(p) ? '[^/]+' : escapeRe(p))).join('')}$`;
}

// Removes contextPath from path. No contextPath (or '/') returns path unchanged; a path outside
// the contextPath returns null.
export function stripContextPath(path, contextPath) {
  if (contextPath === null || contextPath === undefined) return path;
  let ctx = String(contextPath).trim();
  if (!ctx.startsWith('/')) ctx = `/${ctx}`;
  while (ctx.length > 1 && ctx.endsWith('/')) ctx = ctx.slice(0, -1);
  if (ctx === '/') return path;
  if (path === ctx) return '/';
  return path.startsWith(`${ctx}/`) ? path.slice(ctx.length) : null;
}
