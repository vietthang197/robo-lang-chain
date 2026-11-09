// Secret detection and config value masking (spec §9).

// `key = value` / `key: value` assignments. The value must look like a credential:
// printable ASCII only (excludes Vietnamese prose), not a mask (***), not a ${...} placeholder,
// and either contain a digit/symbol or be long (>= 16 chars) so ordinary words do not trip it.
// For a ${VAR:default} placeholder only the default is judged; a bare ${VAR} is never a secret.
const ASSIGNMENT = /(password|secret|token|apikey)["']?\s*[=:]\s*["']?([^\s"',;&]+)/gi;
function credentialLike(v) {
  if (v.startsWith('${')) {
    const body = v.slice(2).replace(/\}+$/, '');
    const colon = body.indexOf(':');
    return colon >= 0 && credentialLike(body.slice(colon + 1));
  }
  return v.length >= 3
    && /^[\x21-\x7E]+$/.test(v)
    && !/^\*+$/.test(v)
    && (/[\d_\-+/=.!@#$%^*~]/.test(v) || v.length >= 16);
}
const hasAssignment = (text) => [...text.matchAll(ASSIGNMENT)].some((m) => credentialLike(m[2]));

// T24 OFS request with a credential segment: <APP>,<VERSION>[/<FUNC>/<PROCESS>…],<user>/<pass>[/<company>],…
// e.g. FUNDS.TRANSFER,ACTR/I/PROCESS,USER/PASS,… or ENQUIRY.SELECT,,USER/PASS,ENQ.NAME. A bare signature
// (FUNDS.TRANSFER,ACTR) has no second comma and a masked password (***) is not flagged.
const OFS_REQUEST = /\b[A-Z][A-Z0-9.]*,[A-Z0-9.]*(?:\/[A-Z0-9.]*)*,([^/,\s"'`]+)\/([^/,\s"'`]+)/g;
const hasOfsCredential = (text) => [...text.matchAll(OFS_REQUEST)].some((m) => !/^\*+$/.test(m[2]));

const SECRET_PATTERNS = [
  ['url-userinfo', (t) => /\w+:\/\/[^/\s:@]+:[^/\s@]+@/.test(t)],
  ['jwt', (t) => /eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(t)],
  ['pem-private-key', (t) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)],
  ['assignment', hasAssignment],
  ['ofs-credential', hasOfsCredential],
  ['aws-access-key', (t) => /AKIA[0-9A-Z]{16}/.test(t)],
];

// Returns the names of the secret patterns that match text (empty when clean).
export function findSecrets(text) {
  if (typeof text !== 'string' || text === '') return [];
  return SECRET_PATTERNS.filter(([, match]) => match(text)).map(([name]) => name);
}

export const SECRET_KEY = /(password|passwd|secret|token|apikey|api-key|credential|private|key-store|jaas|uri|url)/i;
// Keys whose value is a credential in itself (not merely a locator such as a uri/url).
export const CREDENTIAL_KEY = /(password|passwd|secret|token|apikey|api-key|credential|private|key-store|jaas)/i;
const BARE_PLACEHOLDER = /^\$\{[^}:]*\}$/;
const MASK = '***';
// host[:port], or a comma-separated list of them (mongodb replica sets); IPv6 in brackets.
const HOST = String.raw`(?:[\w.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?`;
const HOST_PORT = new RegExp(`^${HOST}(?:,${HOST})*$`, 'i');

// URL: keep scheme/host/port/path, drop userinfo, query and fragment. Returns null when value
// is not a URL, MASK when the host cannot be separated from the credentials.
function stripUrl(value) {
  const m = /^([a-z][\w+.-]*:\/\/)(\S*)$/i.exec(value);
  if (!m) return null;
  let rest = m[2];
  const authOf = (s) => s.slice(0, s.search(/[/?#]/) < 0 ? s.length : s.search(/[/?#]/));
  const auth = authOf(rest);
  // Userinfo exists only when the plain authority is not already a clean host[:port] list
  // (so an '@' in the path or query is left alone). Passwords may contain @ ? / #, so the
  // userinfo then runs to the LAST '@' that is followed by a valid host[:port] authority.
  if (auth.includes('@') || !HOST_PORT.test(auth)) {
    let cut = -1;
    for (let i = rest.indexOf('@'); i >= 0; i = rest.indexOf('@', i + 1))
      if (HOST_PORT.test(authOf(rest.slice(i + 1)))) cut = i;
    if (cut < 0 && auth.includes('@')) return MASK;
    if (cut >= 0) rest = rest.slice(cut + 1);
  }
  const hp = /^([^/?#]*)([^?#]*)/.exec(rest);
  const host = hp[1];
  if (host === '' || host.includes('@')) return MASK;
  const out = m[1] + host + hp[2];
  return findSecrets(out).length ? MASK : out;
}

export function maskConfigValue(key, value) {
  if (typeof value !== 'string' || value === '') return { value, masked: false };
  const k = String(key ?? '');
  const valueHit = findSecrets(value).length > 0;
  // A bare placeholder (${ENV_VAR}) carries no secret by itself.
  if (!valueHit && BARE_PLACEHOLDER.test(value)) return { value, masked: false };
  // Credential keys are masked whole, even when the value looks like a URL.
  if (CREDENTIAL_KEY.test(k)) return { value: MASK, masked: true };
  if (!SECRET_KEY.test(k) && !valueHit) return { value, masked: false };

  const stripped = stripUrl(value);
  if (stripped !== null) return { value: stripped, masked: stripped !== value };
  return valueHit ? { value: MASK, masked: true } : { value, masked: false };
}
