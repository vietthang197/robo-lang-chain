// Secret detection and config value masking (spec §9).

const SECRET_PATTERNS = [
  ['url-userinfo', /\w+:\/\/[^/\s:@]+:[^/\s@]+@/],
  ['jwt', /eyJ[\w-]+\.[\w-]+\.[\w-]+/],
  ['pem-private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['assignment', /(password|secret|token|apikey)\s*[=:]\s*\S{3,}/i],
  ['aws-access-key', /AKIA[0-9A-Z]{16}/],
];

// Returns the names of the secret patterns that match text (empty when clean).
export function findSecrets(text) {
  if (typeof text !== 'string' || text === '') return [];
  return SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

const SECRET_KEY = /(password|passwd|secret|token|apikey|api-key|credential|private|key-store|uri|url)/i;
// Keys whose value is a credential in itself (not merely a locator such as a uri/url).
const CREDENTIAL_KEY = /(password|passwd|secret|token|apikey|api-key|credential|private|key-store)/i;
const URL_RE = /^([a-z][\w+.-]*:\/\/)(?:[^/?#@\s]*@)?([^/?#\s]*)([^?#\s]*)/i;
const MASK = '***';

// URL: keep scheme/host/port/path, drop userinfo, query and fragment.
const stripUrl = (value) => {
  const m = URL_RE.exec(value);
  return m ? m[1] + m[2] + m[3] : null;
};

export function maskConfigValue(key, value) {
  if (typeof value !== 'string' || value === '') return { value, masked: false };
  const keyHit = SECRET_KEY.test(String(key ?? ''));
  const valueHit = findSecrets(value).length > 0;
  if (!keyHit && !valueHit) return { value, masked: false };

  const stripped = stripUrl(value);
  if (stripped !== null && findSecrets(stripped).length === 0) {
    return { value: stripped, masked: stripped !== value };
  }
  // A bare placeholder (${ENV_VAR}) carries no secret by itself.
  if (!valueHit && /^\$\{[^}:]*\}$/.test(value)) return { value, masked: false };
  if (valueHit || CREDENTIAL_KEY.test(String(key))) return { value: MASK, masked: true };
  return { value, masked: false };
}
