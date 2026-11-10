// Fixed read-only Cypher queries (spec §7.2, §7.3). The AI runs each one through the ArcadeDB
// MCP `query` tool and saves {<name>: records} to link-input.json / report-data.json.
// The env is inserted as a Cypher string literal, and only after it is checked against ENVS,
// so no caller-supplied text ever reaches a query.
import { ENVS } from './model.mjs';

function envLiteral(env) {
  if (typeof env !== 'string' || !ENVS.includes(env))
    throw new Error(`unknown env "${env}" (allowed: ${ENVS.join('|')})`);
  return `'${env}'`;
}

const q = (lines) => lines.join(' ');

// Inputs for link-plan (Task 6). Every ClientCall of the env is returned. manualTargets lists
// TARGETS {matchedBy:'manual'} already in the DB; it is informational only: catalog gapAnswers
// is the sole source of manual matches (spec §9), so link-plan ignores it.
export function linkQueries(env) {
  const e = envLiteral(env);
  return [
    {
      name: 'clientCalls',
      cypher: q([
        `MATCH (c:ClientCall) WHERE c.env = ${e}`,
        `OPTIONAL MATCH (c)-[t:TARGETS]->(x:CodeNode) WHERE t.matchedBy = 'manual'`,
        'WITH c, collect(x.uid) AS manualTargets',
        'RETURN c.uid AS uid, c.projectKey AS projectKey, c.clientKind AS clientKind,',
        'c.httpMethod AS httpMethod, c.urlTemplate AS urlTemplate, c.baseUrlConfigKey AS baseUrlConfigKey,',
        'c.resolvedHost AS resolvedHost, c.resolvedPort AS resolvedPort, c.resolvedPath AS resolvedPath,',
        'c.discoveryName AS discoveryName, c.signature AS signature, c.topic AS topic,',
        'c.confidence AS confidence, manualTargets',
        'ORDER BY uid',
      ]),
    },
    {
      name: 'endpoints',
      cypher: q([
        `MATCH (n:Endpoint) WHERE n.env = ${e}`,
        'RETURN n.uid AS uid, n.projectKey AS projectKey, n.protocol AS protocol, n.httpMethod AS httpMethod,',
        'n.path AS path, n.pathRegex AS pathRegex, n.signature AS signature',
        'ORDER BY uid',
      ]),
    },
    {
      name: 'deployments',
      cypher: q([
        `MATCH (d:Deployment) WHERE d.env = ${e}`,
        'RETURN d.uid AS uid, d.projectKey AS projectKey, d.port AS port, d.contextPath AS contextPath, d.hosts AS hosts,',
        // linkedHosts: hosts learned by earlier link runs (link.mjs); ingest never writes it.
        'd.linkedHosts AS linkedHosts',
        'ORDER BY projectKey',
      ]),
    },
    {
      name: 'services',
      cypher: q([
        `MATCH (s:Service) WHERE s.env = ${e}`,
        'RETURN s.uid AS uid, s.projectKey AS projectKey, s.name AS name',
        'ORDER BY projectKey',
      ]),
    },
    {
      name: 'accesses',
      cypher: q([
        `MATCH (o:CodeNode)-[a:ACCESSES]->(d:DataStore) WHERE o.env = ${e} AND d.env = ${e}`,
        'RETURN DISTINCT o.projectKey AS projectKey, d.uid AS dataStore, a.mode AS mode',
        'ORDER BY projectKey, dataStore, mode',
      ]),
    },
    {
      name: 'externals',
      cypher: q([
        `MATCH (s:ExternalSystem) WHERE s.env = ${e}`,
        'RETURN s.uid AS uid, s.name AS name, s.host AS host, s.port AS port',
        'ORDER BY uid',
      ]),
    },
    {
      name: 'channels',
      cypher: q([
        `MATCH (c:Channel) WHERE c.env = ${e}`,
        'RETURN c.uid AS uid, c.tech AS tech, c.name AS name, c.env AS env',
        'ORDER BY uid',
      ]),
    },
    {
      name: 'subscriptions',
      cypher: q([
        `MATCH (o:CodeNode)-[:SUBSCRIBES]->(c:Channel) WHERE o.env = ${e} AND c.env = ${e}`,
        'RETURN DISTINCT o.projectKey AS projectKey, c.uid AS channel',
        'ORDER BY projectKey, channel',
      ]),
    },
  ];
}

// Inputs for make-report (Task 7).
export function reportQueries(env) {
  const e = envLiteral(env);
  return [
    {
      name: 'services',
      cypher: q([
        `MATCH (s:Service) WHERE s.env = ${e}`,
        'OPTIONAL MATCH (s)-[:IN_DOMAIN]->(d:Domain)',
        'WITH s, collect(DISTINCT d.name) AS domains',
        'OPTIONAL MATCH (s)-[:IN_LAYER]->(l:Layer)',
        'WITH s, domains, collect(DISTINCT l.name) AS layers',
        'OPTIONAL MATCH (s)-[:PROVIDES_CAPABILITY]->(c:Capability)',
        'WITH s, domains, layers, collect(DISTINCT c.name) AS capabilities',
        'RETURN s.uid AS uid, s.projectKey AS projectKey, s.name AS name, s.summary AS summary,',
        's.responsibilities AS responsibilities, s.notResponsibleFor AS notResponsibleFor,',
        's.businessTerms AS businessTerms, s.techStack AS techStack, s.ownerTeam AS ownerTeam,',
        'head(domains) AS domain, head(layers) AS layer, capabilities, s.coverage AS coverage',
        'ORDER BY projectKey',
      ]),
    },
    {
      name: 'dependencies',
      cypher: q([
        `MATCH (a:Service)-[r:SERVICE_DEPENDS_ON]->(b:CodeNode) WHERE r.env = ${e}`,
        'RETURN a.projectKey AS from, coalesce(b.projectKey, b.name, b.uid) AS to, b.uid AS toUid,',
        "CASE WHEN b.projectKey IS NULL THEN 'external' ELSE 'service' END AS toKind,",
        'r.protocol AS protocol, r.sync AS sync, r.endpointsUsed AS endpointsUsed,',
        'r.callCount AS callCount, r.confidence AS confidence',
        'ORDER BY from, to',
      ]),
    },
    {
      name: 'dataOwnership',
      cypher: q([
        `MATCH (d:DataStore) WHERE d.env = ${e}`,
        'OPTIONAL MATCH (o:Service)-[:OWNS_DATA]->(d)',
        'WITH d, collect(DISTINCT o.projectKey) AS owners',
        'OPTIONAL MATCH (r:Service)-[:READS_DATA]->(d)',
        'WITH d, owners, collect(DISTINCT r.projectKey) AS readers',
        'RETURN d.uid AS dataStore, d.tech AS tech, d.location AS location, owners, readers',
        'ORDER BY dataStore',
      ]),
    },
    {
      name: 'gaps',
      cypher: q([
        `MATCH (g:Gap) WHERE g.env = ${e}`,
        'OPTIONAL MATCH (n:CodeNode)-[:HAS_GAP]->(g)',
        'WITH g, collect(n.uid) AS attachedUids',
        'RETURN g.uid AS uid, g.kind AS kind, g.askWho AS askWho, g.question AS question,',
        // candidates comes back as a JSON string (list of maps is stored as JSON, batches.mjs storable).
        'g.status AS status, g.candidates AS candidates, head(attachedUids) AS attached',
        'ORDER BY askWho, kind, uid',
      ]),
    },
    {
      // For the "Endpoint mới / Endpoint bị mất" diff (spec §7.3).
      name: 'endpoints',
      cypher: q([
        `MATCH (n:Endpoint) WHERE n.env = ${e}`,
        'RETURN n.projectKey AS projectKey, n.uid AS uid, n.protocol AS protocol, n.signature AS signature,',
        'n.httpMethod AS httpMethod, n.path AS path',
        'ORDER BY projectKey, uid',
      ]),
    },
  ];
}

// Endpoint -> DataStore walk shared by the two chain queries.
// Ruling R22: start from the exposing Operation AND the Component that CONTAINS it, so hooks
// triggered from a Component (T24 VERSION -TRIGGERS-> routine) are followed too.
// Interface dispatch (spring-boot §4.5): CALLS stops at the interface Operation and the
// implementation reaches it only by OVERRIDES (impl -> iface). Each of the 3 junctions may hop
// back over one OVERRIDES edge (0..1), so up to 3 interface dispatches are followed, with up to
// 3 CALLS|TRIGGERS hops per segment (4 segments, at most 12 call hops in total). CALLS is never
// walked backwards.
function chainWalk(e) {
  return [
    `MATCH (ep:Endpoint)<-[:EXPOSES]-(op:Operation) WHERE ep.env = ${e}`,
    'OPTIONAL MATCH (c:Component)-[:CONTAINS]->(op)',
    'WITH ep, op, [x IN [op, c] WHERE x IS NOT NULL] AS starts',
    'UNWIND starts AS s',
    'MATCH p1 = (s)-[:CALLS|TRIGGERS*0..3]->(m1:CodeNode)',
    'MATCH p2 = (m1)<-[:OVERRIDES*0..1]-(i1:CodeNode)',
    'MATCH p3 = (i1)-[:CALLS|TRIGGERS*0..3]->(m2:CodeNode)',
    'MATCH p4 = (m2)<-[:OVERRIDES*0..1]-(i2:CodeNode)',
    'MATCH p5 = (i2)-[:CALLS|TRIGGERS*0..3]->(m3:CodeNode)',
    'MATCH p6 = (m3)<-[:OVERRIDES*0..1]-(i3:CodeNode)',
    'MATCH p7 = (i3)-[:CALLS|TRIGGERS*0..3]->(n:CodeNode)-[:ACCESSES]->(ds:DataStore)',
  ];
}

// Queries to paste into ArcadeDB Studio (graph view). <domain> and <projectKey> are
// placeholders the reader fills in by hand.
export function studioQueries(env) {
  const e = envLiteral(env);
  return [
    {
      title: 'Toàn cảnh L1: service và phụ thuộc',
      cypher: q([
        `MATCH (s:Service) WHERE s.env = ${e}`,
        `OPTIONAL MATCH (s)-[r:SERVICE_DEPENDS_ON]->(t:CodeNode) WHERE r.env = ${e}`,
        'RETURN s, r, t',
      ]),
    },
    {
      title: 'Theo domain (thay <domain> bằng slug của domain)',
      cypher: q([
        `MATCH (d:Domain)<-[i:IN_DOMAIN]-(s:Service) WHERE d.uid = 'domain:<domain>' AND s.env = ${e}`,
        `OPTIONAL MATCH (s)-[r:SERVICE_DEPENDS_ON]->(t:CodeNode) WHERE r.env = ${e}`,
        'RETURN d, i, s, r, t',
      ]),
    },
    {
      title: 'Một service từ L1 xuống L2 (thay <projectKey>)',
      cypher: q([
        `MATCH (s:Service) WHERE s.env = ${e} AND s.projectKey = '<projectKey>'`,
        'OPTIONAL MATCH (s)-[pc:PROVIDES_CAPABILITY]->(c:Capability)',
        'OPTIONAL MATCH (s)-[da:DEPLOYED_AS]->(dep:Deployment)',
        'OPTIONAL MATCH (dep)-[sv:SERVES]->(ep:Endpoint)',
        'RETURN s, pc, c, da, dep, sv, ep',
      ]),
    },
    {
      // Graph view. LIMIT counts path rows, not (endpoint, datastore) pairs: one pair can come
      // back as many rows (one per path variant), so a large env may show only part of the chains.
      title: 'Chuỗi Endpoint → DataStore',
      cypher: q([...chainWalk(e), 'RETURN ep, op, p1, p2, p3, p4, p5, p6, p7 LIMIT 200']),
    },
    {
      // Table view: one row per (endpoint, start operation, datastore).
      title: 'Chuỗi Endpoint → DataStore (bảng)',
      cypher: q([
        ...chainWalk(e),
        'RETURN DISTINCT ep.signature AS endpoint, op.qualifiedName AS startOp, ds.uid AS dataStore',
        'ORDER BY endpoint, startOp, dataStore',
      ]),
    },
    {
      title: 'Gap đang mở',
      cypher: q([
        `MATCH (g:Gap) WHERE g.env = ${e} AND g.status = 'open'`,
        'OPTIONAL MATCH (n:CodeNode)-[h:HAS_GAP]->(g)',
        'RETURN g, h, n',
      ]),
    },
  ];
}
