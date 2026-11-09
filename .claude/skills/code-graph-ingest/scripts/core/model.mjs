// Canonical graph model constants (spec §4.4, §4.5, §5).

export const SCHEMA_VERSION = '1.0';

export const ENVS = ['dev', 'uat'];

export const VERTEX_TYPES = [
  'CodeNode',
  'System', 'Environment', 'Domain', 'Layer',
  'Service', 'Deployment', 'Capability', 'DataStore', 'Channel', 'ExternalSystem',
  'Endpoint', 'ClientCall', 'ConfigKey', 'Bean', 'Component',
  'Module', 'Operation', 'Member', 'Library', 'Tag',
  'Gap',
];

export const EDGE_TYPES = [
  'IN_ENV', 'IN_DOMAIN', 'IN_LAYER', 'PART_OF',
  'DEPLOYED_AS', 'PROVIDES_CAPABILITY', 'REALIZED_BY', 'SERVICE_DEPENDS_ON',
  'OWNS_DATA', 'READS_DATA', 'SERVES', 'CONTAINS', 'EXPOSES', 'MAKES_CALL',
  'USES_CONFIG', 'TARGETS', 'PUBLISHES', 'SUBSCRIBES', 'ACCESSES', 'READS_CONFIG',
  'PROVIDES', 'INJECTS', 'BEAN_TYPE', 'TRIGGERS', 'CALLS', 'OVERRIDES',
  'EXTENDS', 'IMPLEMENTS', 'USES_TYPE', 'TAGGED', 'DEPENDS_ON', 'FROM_LIBRARY',
  'HAS_GAP',
];

export const GAP_KINDS = [
  'unresolved-call', 'missing-config-value', 'ambiguous-target', 'unknown-external',
  'low-confidence-description', 'unread-files', 'unknown-datastore',
];

export const SHARED_PREFIXES = ['ext:', 'lib:', 'tag:', 'ds:', 'ch:', 'sys:', 'gap:', 'env:', 'domain:', 'layer:', 'system:'];
