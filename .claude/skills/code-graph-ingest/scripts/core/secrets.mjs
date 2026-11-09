// Secret detection and config value masking (spec §9).

// `key = value` / `key: value` assignments. The value must look like a credential:
// printable ASCII only (excludes Vietnamese prose), not a mask (***), not a ${...} placeholder,
// and either contain a digit/symbol or be long (>= 16 chars) so ordinary words do not trip it.
const ASSIGNMENT = /(password|secret|token|apikey)["']?\s*[=:]\s*["']?([^\s"',;&]+)/gi;
const credentialLike = (v) =>
  v.length >= 3
  && /^[\x21-\x7E]+$/.test(v)
  && !/^\*+$/.test(v)
  && !v.startsWith('${')
  && (/[\d_\-+/=.!@#$%^*~]/.test(v) || v.length >= 16);
const hasAssignment = (text) => [...text.matchAll(ASSIGNMENT)].some((m) => credentialLike(m[2]));

const SECRET_PATTERNS = [
  ['url-userinfo', (t) => /\w+:\/\/[^/\s:@]+:[^/\s@]+@/.test(t)],
  ['jwt', (t) => /eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(t)],
  ['pem-private-key', (t) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t)],
  ['assignment', hasAssignment],
  ['aws-access-key', (t) => /AKIA[0-9A-Z]{16}/.test(t)],
];

// Returns the names of the secret patterns that match text (empty when clean).
export function findSecrets(text) {
  if (typeof text !== 'string' || text === '') return [];
  return SECRET_PATTERNS.filter(([, match]) => match(text)).map(([name]) => name);
}

const SECRET_KEY = /(password|passwd|secret|token|apikey|api-key|credential|private|key-store|uri|url)/i;
// Keys whose value is a credential in itself (not merely a locator such as a uri/url).
const CREDENTIAL_KEY = /(password|passwd|secret|token|apikey|api-key|credential|private|key-store)/i;
const BARE_PLACEHOLDER = /^\$\{[^}:]*\}$/;
const MASK = '***';

// URL: keep scheme/host/port/path, drop userinfo, query and fragment. Returns null when value
// is not a URL, MASK when the host cannot be separated from the credentials.
function stripUrl(value) {
  const m = /^([a-z][\w+.-]*:\/\/)(\S*)$/i.exec(value);
  if (!m) return null;
  let rest = m[2];
  // Userinfo runs to the LAST '@' when a ':' precedes it (passwords may contain @ ? / #);
  // otherwise only an '@' inside the authority (before / ? #) marks userinfo.
  const lastAt = rest.lastIndexOf('@');
  if (lastAt >= 0 && rest.slice(0, lastAt).includes(':')) rest = rest.slice(lastAt + 1);
  else {
    const authEnd = rest.search(/[/?#]/);
    const at = rest.slice(0, authEnd < 0 ? rest.length : authEnd).lastIndexOf('@');
    if (at >= 0) rest = rest.slice(at + 1);
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
