// Cypher literal rendering and the ArcadeDB schema (spec §4.1, §11).
import { VERTEX_TYPES, EDGE_TYPES } from './model.mjs';

export const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ESCAPES = { '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const quoteString = (s) => `'${s.replace(/[\\'\n\r\t]/g, (c) => ESCAPES[c])}'`;

const mapKey = (k) => {
  if (SAFE_IDENT.test(k)) return k;
  if (k.includes('`')) throw new Error(`cannot render map key containing a backtick: ${k}`);
  return `\`${k}\``;
};

const isPlainObject = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

// Renders a JSON-like value as an inline Cypher literal (no parameters over MCP).
export function toCypherLiteral(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return quoteString(value);
    case 'number':
    {
      if (!Number.isFinite(value)) throw new Error(`non-finite number cannot be stored: ${value}`);
      if (Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error(`number out of safe range: ${value}`);
      const s = String(value);
      // JS renders very small numbers as 1e-7 etc.; only plain integer/decimal forms are emitted.
      if (/e/i.test(s)) throw new Error(`number needs exponent notation, not supported: ${s}`);
      return s;
    }
    case 'boolean':
      return value ? 'true' : 'false';
    default:
      break;
  }
  if (Array.isArray(value)) return `[${value.map(toCypherLiteral).join(', ')}]`;
  if (isPlainObject(value))
    return `{${Object.entries(value).map(([k, v]) => `${mapKey(k)}: ${toCypherLiteral(v)}`).join(', ')}}`;
  throw new Error(`unsupported value for Cypher literal: ${typeof value}`);
}

// SQL statements (send with language sqlscript). All are IF NOT EXISTS, so re-running is safe.
export function schemaStatements() {
  const out = ['CREATE VERTEX TYPE CodeNode IF NOT EXISTS'];
  for (const p of ['uid', 'env', 'projectKey']) out.push(`CREATE PROPERTY CodeNode.${p} IF NOT EXISTS STRING`);
  out.push(
    'CREATE INDEX IF NOT EXISTS ON CodeNode (uid) UNIQUE',
    'CREATE INDEX IF NOT EXISTS ON CodeNode (env) NOTUNIQUE',
    'CREATE INDEX IF NOT EXISTS ON CodeNode (projectKey) NOTUNIQUE',
  );
  for (const t of VERTEX_TYPES) if (t !== 'CodeNode') out.push(`CREATE VERTEX TYPE ${t} IF NOT EXISTS EXTENDS CodeNode`);
  // EXTENDS is an SQL keyword, so every edge type name is backticked.
  for (const t of EDGE_TYPES) out.push(`CREATE EDGE TYPE \`${t}\` IF NOT EXISTS`);
  return out;
}
