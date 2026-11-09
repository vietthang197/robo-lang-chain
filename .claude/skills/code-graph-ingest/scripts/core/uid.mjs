// uid formulas (spec §4.2) and per-node uid checks.
import { SHARED_PREFIXES } from './model.mjs';

export const projectUid = (env, projectKey, kindGroup, qualifiedName) =>
  `${env}:${projectKey}:${kindGroup}:${qualifiedName}`;
export const endpointUid = (env, projectKey, protocol, signature) =>
  `${env}:${projectKey}:endpoint:${protocol}:${signature}`;
export const configUid = (env, projectKey, key) => `${env}:${projectKey}:config:${key}`;
export const deploymentUid = (env, projectKey) => `${env}:${projectKey}:deployment`;
export const capabilityUid = (env, projectKey, slug) => `${env}:${projectKey}:capability:${slug}`;
export const serviceUid = (env, projectKey) => `${env}:${projectKey}:service:${projectKey}`;

export const isShared = (uid) => SHARED_PREFIXES.some((p) => uid.startsWith(p));

// Shared prefixes whose second segment is an env.
const ENV_SCOPED_SHARED = new Set(['ds', 'ch', 'sys', 'gap']);

export function parseUid(uid) {
  if (isShared(uid)) {
    const i = uid.indexOf(':');
    const group = uid.slice(0, i);
    const tail = uid.slice(i + 1);
    if (ENV_SCOPED_SHARED.has(group)) {
      const j = tail.indexOf(':');
      return j < 0
        ? { scope: 'shared', env: tail, group, rest: '' }
        : { scope: 'shared', env: tail.slice(0, j), group, rest: tail.slice(j + 1) };
    }
    return { scope: 'shared', group, rest: tail };
  }
  const [env = '', projectKey = '', group = '', ...rest] = uid.split(':');
  return { scope: 'project', env, projectKey, group, rest: rest.join(':') };
}

const PROJECT_GROUP = {
  Module: 'module', Component: 'component', Operation: 'operation', Member: 'member',
  Bean: 'bean', ClientCall: 'clientcall', Endpoint: 'endpoint', ConfigKey: 'config',
  Deployment: 'deployment', Capability: 'capability', Service: 'service',
};
const SHARED_GROUP = {
  Library: 'lib', Tag: 'tag', DataStore: 'ds', Channel: 'ch', ExternalSystem: 'sys', Gap: 'gap',
  Environment: 'env', Domain: 'domain', Layer: 'layer', System: 'system',
};
const EXT_ALLOWED = new Set(['Component', 'Operation']);
const SYSTEM_SCAN = '__system__';

// Returns an error message, or null when node.uid fits node.type and the scan.
export function checkUid(node, scan) {
  const { type, uid } = node;
  if (typeof uid !== 'string' || uid === '') return `${type}: uid missing`;
  const p = parseUid(uid);
  const linkBundle = scan.projectKey === SYSTEM_SCAN;

  if (p.scope === 'shared') {
    if (p.group === 'ext' && EXT_ALLOWED.has(type)) {
      const external = node.external === true || node.props?.external === true;
      return external ? null : `${type} ${uid}: ext: uid requires external:true`;
    }
    const want = SHARED_GROUP[type];
    if (!want) {
      if (PROJECT_GROUP[type]) return `${type} ${uid}: expected project uid, got shared prefix ${p.group}:`;
      return `${uid}: unknown node type ${type}`;
    }
    if (p.group !== want) return `${type} ${uid}: expected prefix ${want}:, got ${p.group}:`;
    if (p.env !== undefined && p.env !== scan.env) return `${type} ${uid}: env ${p.env} != scan env ${scan.env}`;
    if (p.rest === '') return `${type} ${uid}: empty name after prefix`;
    return null;
  }

  const want = PROJECT_GROUP[type];
  if (!want) {
    if (SHARED_GROUP[type]) return `${type} ${uid}: expected shared prefix ${SHARED_GROUP[type]}:`;
    return `${uid}: unknown node type ${type}`;
  }
  if (p.env !== scan.env) return `${type} ${uid}: env ${p.env} != scan env ${scan.env}`;
  if (!linkBundle && p.projectKey !== scan.projectKey)
    return `${type} ${uid}: projectKey ${p.projectKey} != scan projectKey ${scan.projectKey}`;
  if (p.group !== want) return `${type} ${uid}: expected group ${want}, got ${p.group}`;
  if (type === 'Deployment') return p.rest === '' ? null : `${type} ${uid}: Deployment uid has no name part`;
  if (p.rest === '') return `${type} ${uid}: empty qualified name`;
  if (type === 'Service' && p.rest !== p.projectKey)
    return `Service ${uid}: expected ${serviceUid(p.env, p.projectKey)}`;
  return null;
}
