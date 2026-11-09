# code-graph-ingest Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `code-graph-ingest` Claude Code skill: instructions + reader profiles that teach an AI to read a whole project, plus deterministic Node scripts that validate, merge, diff, convert-to-Cypher, link across services and report on the graph bundles it produces.

**Architecture:** The AI does the reading and writes `bundle.json` files (spec §5). Everything after that is deterministic and tested: `validate-bundle` → `merge-bundles` → `diff-bundle` → `bundle-to-cypher` (batches the AI sends through the ArcadeDB MCP). Cross-service linking and reporting work the same way: the AI runs fixed queries through MCP, saves the results as JSON, a script computes a link bundle or a report, and the link bundle is loaded with the same converter.

**Tech Stack:** Node.js ≥ 20 ES modules (`.mjs`), `node:test` + `node:assert/strict`, one dependency `yaml@2` (catalog parsing). ArcadeDB 26.10.x OpenCypher via MCP. Markdown for SKILL.md and references.

**Spec:** `docs/superpowers/specs/2026-11-09-code-graph-skill-design.md`

## Global Constraints

- Skill root: `.claude/skills/code-graph-ingest/` in this repo. Shared script modules go in `scripts/core/`. **Not `scripts/lib/`**, because the repo `.gitignore` ignores `lib/`.
- Node ≥ 20, ESM only, no npm dependency except `yaml@2`. Tests: `node --test scripts/test/` run from the skill root.
- `schemaVersion` = `"1.0"`. Envs allowed: `dev`, `uat`. Database: `CodeGraph`.
- uid formulas exactly as spec §4.2. `kind-group` ∈ {`module`,`component`,`operation`,`member`,`bean`,`clientcall`}. Shared prefixes: `ext:`, `lib:`, `tag:`, `ds:`, `ch:`, `sys:`, `gap:`, L0 (`env:`, `domain:`, `layer:`, `system:`).
- Vertex types (spec §4.4): `CodeNode` (supertype), `System`, `Environment`, `Domain`, `Layer`, `Service`, `Deployment`, `Capability`, `DataStore`, `Channel`, `ExternalSystem`, `Endpoint`, `ClientCall`, `ConfigKey`, `Bean`, `Component`, `Module`, `Operation`, `Member`, `Library`, `Tag`, `Gap`.
- Edge types (spec §4.5): `IN_ENV`, `IN_DOMAIN`, `IN_LAYER`, `PART_OF`, `DEPLOYED_AS`, `PROVIDES_CAPABILITY`, `REALIZED_BY`, `SERVICE_DEPENDS_ON`, `OWNS_DATA`, `READS_DATA`, `SERVES`, `CONTAINS`, `EXPOSES`, `MAKES_CALL`, `USES_CONFIG`, `TARGETS`, `PUBLISHES`, `SUBSCRIBES`, `ACCESSES`, `READS_CONFIG`, `PROVIDES`, `INJECTS`, `BEAN_TYPE`, `TRIGGERS`, `CALLS`, `OVERRIDES`, `EXTENDS`, `IMPLEMENTS`, `USES_TYPE`, `TAGGED`, `DEPENDS_ON`, `FROM_LIBRARY`, `HAS_GAP`.
- Gap kinds: `unresolved-call`, `missing-config-value`, `ambiguous-target`, `unknown-external`, `low-confidence-description`, `unread-files`, `unknown-datastore`. `askWho` ∈ `BA`,`DevOps`,`Dev`.
- `confidence` ∈ `high`,`medium`,`low`. `descriptionSource` ∈ `ai`,`human`,`doc`. A stored `descriptionSource='human'` description is never overwritten.
- Descriptions in Vietnamese; technical terms stay English.
- Load batch: ≤ 300 rows **and** ≤ 200 000 characters of Cypher per batch.
- Secret key pattern (spec §9): `(?i)(password|passwd|secret|token|apikey|api-key|credential|private|key-store|uri|url)`. Masked value is `***`. URLs keep scheme/host/port/path, drop userinfo and query.

## Review Focus

1. Text with `'`, `\`, newlines, `$`, Windows paths (`D:\upload`) and Vietnamese diacritics in descriptions/paths must round-trip into Cypher literals unchanged. Pinned in Task 4 (`cypher literal escapes`).
2. One node with a very long description must not produce a batch over the size cap; a single oversize row goes in a batch of its own. Pinned in Task 4 (`splits by size`).
3. Re-ingesting one `(env, projectKey)` must never delete nodes of another env, another project, or shared nodes. Pinned in Task 4 (`cleanup is scoped`).
4. A URL taken from a BA document, e.g. `http://localhost:8080/document/rag/process/123?x=1` or with a trailing `/`, must still match the template `/document/rag/process/{documentId}`, including when a context-path is present. Pinned in Task 6 (`normalizes BA urls`).
5. Secrets hiding in values whose key looks harmless, such as `mongodb://u:p@h:27017/db` under `spring.data.mongodb.uri` or a JWT inside a description, must fail validation. Pinned in Task 2 (`detects secrets in values`).

---

### Task 1: Skill scaffold, bundle schema and uid helpers

**Files:**
- Create: `.claude/skills/code-graph-ingest/package.json` (`"type":"module"`, `"scripts":{"test":"node --test scripts/test/"}`, dependency `yaml@^2`)
- Create: `.claude/skills/code-graph-ingest/templates/bundle.schema.json` (JSON Schema draft 2020-12 of spec §5. Used as documentation for the AI; the scripts check structure themselves)
- Create: `.claude/skills/code-graph-ingest/scripts/core/model.mjs`
- Create: `.claude/skills/code-graph-ingest/scripts/core/uid.mjs`
- Create: `.claude/skills/code-graph-ingest/scripts/core/io.mjs`
- Modify: `.gitignore` (append `code-graph-workspace/` and `.claude/skills/code-graph-ingest/node_modules/`)
- Test: `.claude/skills/code-graph-ingest/scripts/test/uid.test.mjs`

**Interfaces:**
- Produces (`model.mjs`): `VERTEX_TYPES: string[]`, `EDGE_TYPES: string[]`, `GAP_KINDS: string[]`, `ENVS = ['dev','uat']`, `SHARED_PREFIXES = ['ext:','lib:','tag:','ds:','ch:','sys:','gap:','env:','domain:','layer:','system:']`, `SCHEMA_VERSION = '1.0'`.
- Produces (`uid.mjs`): `projectUid(env, projectKey, kindGroup, qualifiedName) -> string`; `endpointUid(env, projectKey, protocol, signature) -> string`; `configUid(env, projectKey, key)`; `deploymentUid(env, projectKey)`; `capabilityUid(env, projectKey, slug)`; `isShared(uid) -> boolean`; `parseUid(uid) -> {scope:'project'|'shared', env?, projectKey?, group?, rest}`; `checkUid(node:{type,uid}, scan:{env,projectKey}) -> string|null` (error message or null).
- Produces (`io.mjs`): `readJson(path)`, `writeJson(path, value)` (2-space, trailing newline), `readCatalog(path) -> object` (via `yaml`).

- [ ] **Step 1: Write failing tests in `uid.test.mjs`**

```js
test('builds project uids', () => {
  assert.equal(projectUid('uat','robo-lang-chain','operation','com.x.ChatController#chat'),
    'uat:robo-lang-chain:operation:com.x.ChatController#chat');
  assert.equal(endpointUid('uat','t24','ofs','FUNDS.TRANSFER,ACTR'), 'uat:t24:endpoint:ofs:FUNDS.TRANSFER,ACTR');
  assert.equal(endpointUid('dev','robo-lang-chain','http','GET /document/rag/process/{documentId}'),
    'dev:robo-lang-chain:endpoint:http:GET /document/rag/process/{documentId}');
});
test('recognises shared uids', () => {
  for (const u of ['ext:a.B#c','lib:maven:g:a','tag:java:x.Y','ds:uat:mongodb:db.c','ch:uat:kafka:t','sys:uat:ollama','gap:uat:system:ambiguous-target:ab12','domain:payments'])
    assert.equal(isShared(u), true, u);
  assert.equal(isShared('uat:svc:component:a.B'), false);
});
test('checkUid rejects wrong env, project or group', () => {
  const scan = { env: 'uat', projectKey: 'svc' };
  assert.equal(checkUid({ type:'Component', uid:'uat:svc:component:a.B' }, scan), null);
  assert.match(checkUid({ type:'Component', uid:'dev:svc:component:a.B' }, scan), /env/);
  assert.match(checkUid({ type:'Component', uid:'uat:other:component:a.B' }, scan), /projectKey/);
  assert.match(checkUid({ type:'Component', uid:'uat:svc:operation:a.B#x' }, scan), /group/);
  assert.equal(checkUid({ type:'Library', uid:'lib:maven:g:a' }, scan), null);
});
```
Type → expected group: `Module→module`, `Component→component`, `Operation→operation`, `Member→member`, `Bean→bean`, `ClientCall→clientcall`, `Endpoint→endpoint`, `ConfigKey→config`, `Deployment→deployment`, `Capability→capability`, `Service→service`. `Library/Tag/DataStore/Channel/ExternalSystem/Gap` and L0 types must be shared uids with the matching prefix (`lib:`,`tag:`,`ds:`,`ch:`,`sys:`,`gap:`,`env:/domain:/layer:/system:`). `Component`/`Operation` may also be `ext:` when `external:true`.

- [ ] **Step 2: Run** `cd .claude/skills/code-graph-ingest && npm install && npm test`. Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement `model.mjs`, `uid.mjs`, `io.mjs`** with the signatures above; write `bundle.schema.json` and append to `.gitignore`.
- [ ] **Step 4: Run** `npm test`. Expected: 3 tests PASS.
- [ ] **Step 5: Commit**

```bash
git add .gitignore .claude/skills/code-graph-ingest
git commit -m "feat(code-graph): scaffold skill, model constants and uid helpers"
```

---

### Task 2: `validate-bundle` (general rules + secret scan + profile rule hook)

**Files:**
- Create: `scripts/core/validate.mjs`, `scripts/core/secrets.mjs`, `scripts/core/profile-rules/index.mjs`, `scripts/validate-bundle.mjs` (CLI)
- Create: `scripts/test/fixtures/valid-min.bundle.json` (1 Service, 1 Deployment, 1 Component controller, 1 Operation, 1 Endpoint, edges CONTAINS/DEPLOYED_AS/EXPOSES/SERVES; all descriptions with evidence and confidence)
- Test: `scripts/test/validate.test.mjs`, `scripts/test/secrets.test.mjs`
(paths relative to the skill root from here on)

**Interfaces:**
- Consumes: `model.mjs`, `uid.checkUid`, `uid.isShared`.
- Produces: `validateBundle(bundle, {profiles?: string[]}) -> {errors: Issue[], warnings: Issue[]}` where `Issue = {rule: string, uid?: string, message: string}`; `findSecrets(text: string) -> string[]` (matched pattern names); `maskConfigValue(key, value) -> {value, masked}`; `profileRules: Record<string, (bundle) => Issue[]>` (empty functions for `spring-boot`, `t24`, `java-generic` until Tasks 8–9 fill them).
- CLI: `node scripts/validate-bundle.mjs <bundle.json> [--profile spring-boot,t24]` prints issues, exits 1 on errors.

Rule ids (spec §10): `R1-shape`, `R2-uid`, `R3-dangling`, `R4-service-deployment`, `R5-service-surface`, `R5-clientcall-url`, `R6-description-evidence`, `R6-required-description`, `R7-secret`, warnings `W-coverage`, `W-unreachable-operation`, `W-single-endpoint-capability`.

**Link bundles** (`scan.projectKey === '__system__'`, produced by Task 6): `checkUid` skips the projectKey comparison (rows may patch nodes of any project in the same env); R3 does not require the endpoints of edges to be in the bundle; R4, R5, R6-required-description and W-coverage are skipped. R2, R6-description-evidence and R7 still apply.

- [ ] **Step 1: Write failing tests**

`validate.test.mjs` (each test clones `valid-min` and breaks one thing):
- `valid bundle passes`: `errors.length === 0`.
- `duplicate uid` → rule `R2-uid`.
- `edge to unknown project uid` → `R3-dangling`; an edge `TARGETS` to `uat:other:endpoint:http:GET /x` is **allowed**; a `CALLS` to `uat:other:operation:a#b` is **not**.
- `missing Deployment` → `R4-service-deployment`.
- `service with no Endpoint, Channel or Gap` → `R5-service-surface`.
- `ClientCall without urlTemplate and without HAS_GAP` → `R5-clientcall-url`.
- `description without evidence` → `R6-description-evidence`; `controller Component without description` → `R6-required-description`.
- `coverage 30/34` → warning `W-coverage` (threshold 0.95).
- `link bundle skips service rules`: a bundle with `scan.projectKey:'__system__'`, one `TARGETS` edge between two uids not in the bundle and one Deployment patch row `{uid:'uat:b-service:deployment', hosts:['10.1.2.3']}` → `errors.length === 0`.

`secrets.test.mjs`:
- `detects secrets in values`: `findSecrets('mongodb://u:p@h:27017/db')` non-empty; JWT `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig` non-empty; `-----BEGIN PRIVATE KEY-----` non-empty; `'password=abc123'` non-empty; `http://10.1.2.3:8081/api` empty; `${QDRANT_HOST:localhost}` empty.
- `masks config values`: `maskConfigValue('spring.data.mongodb.uri','mongodb://u:p@h:27017/db')` → `{value:'mongodb://h:27017/db', masked:true}`; `maskConfigValue('b-service.url','http://10.1.2.3:8081/api?token=x')` → `{value:'http://10.1.2.3:8081/api', masked:true}`; `maskConfigValue('db.password','x')` → `{value:'***', masked:true}`; `maskConfigValue('server.port','8080')` → `{value:'8080', masked:false}`.
- `validator fails on secret anywhere`: put the JWT into a description in `valid-min` → `R7-secret`.

- [ ] **Step 2: Run** `npm test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** `validate.mjs`, `secrets.mjs`, `profile-rules/index.mjs` and the CLI. `findSecrets` patterns: URL userinfo `\w+://[^/\s:@]+:[^/\s@]+@`, JWT `eyJ[\w-]+\.[\w-]+\.[\w-]+`, PEM `-----BEGIN [A-Z ]*PRIVATE KEY-----`, assignment `(?i)(password|secret|token|apikey)\s*[=:]\s*\S{3,}`, AWS `AKIA[0-9A-Z]{16}`. R7 scans every string value in nodes, edges, gaps and diagnostics.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(code-graph): validate-bundle with general rules and secret scan"`

---

### Task 3: `merge-bundles` and `diff-bundle`

**Files:**
- Create: `scripts/core/merge.mjs`, `scripts/core/diff.mjs`, `scripts/merge-bundles.mjs`, `scripts/diff-bundle.mjs`
- Test: `scripts/test/merge.test.mjs`, `scripts/test/diff.test.mjs`

**Interfaces:**
- Produces: `mergeBundles(parts: Bundle[]) -> Bundle`. All parts must share `scan.env/projectKey/scanId`, otherwise throw `Error('scan mismatch')`. Nodes are deduped by uid; for a shared uid seen twice, props are merged and the first non-empty value wins. Edges are deduped by `type|from|to`. `gaps` and `diagnostics` are concatenated, gaps deduped by uid. `coverage` is summed.
- Produces: `diffBundles(prev: Bundle|null, next: Bundle) -> {addedNodes, removedNodes, changedNodes: {uid, fields: string[]}[], addedEdges, removedEdges}`; `renderDiff(diff) -> string` (markdown with counts, then lists grouped by vertex type). Fields ignored when comparing: `scanId`, `contentHash`, `lineStart`, `lineEnd`.
- CLI: `merge-bundles.mjs <out.json> <part1.json> ...`; `diff-bundle.mjs <prev.json|-> <next.json> <out.md>`.

- [ ] **Step 1: Write failing tests**: `merges parts and dedupes` (two parts sharing `lib:maven:g:a` and one edge → 1 node, 1 edge, coverage summed); `rejects mismatched scans`; `diff detects add/remove/change` (changed description shows `fields:['description']`); `diff ignores line moves` (only `lineStart` changed → no change); `null prev means everything added`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules and CLIs.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(code-graph): merge and diff bundles"`

---

### Task 4: `bundle-to-cypher` (schema, upsert batches, scoped cleanup)

**Files:**
- Create: `scripts/core/cypher.mjs`, `scripts/core/batches.mjs`, `scripts/bundle-to-cypher.mjs`
- Test: `scripts/test/cypher.test.mjs`, `scripts/test/batches.test.mjs`

**Interfaces:**
- Produces (`cypher.mjs`): `toCypherLiteral(value) -> string` (string, number, boolean, null, array, plain object; strings single-quoted with `\\`, `\'`, `\n`, `\r`, `\t` escaped; non-finite numbers throw); `schemaStatements() -> string[]` (one `CREATE VERTEX TYPE <T> IF NOT EXISTS EXTENDS CodeNode` per vertex type, `CREATE EDGE TYPE` per edge type with `` `EXTENDS` `` backticked, unique index `CodeNode(uid)`, notunique indexes `CodeNode(env)`, `CodeNode(projectKey)`; these are **SQL**, sent with `language: sqlscript`).
- Produces (`batches.mjs`): `toLoadPlan(bundle, {mode: 'ingest'|'link'}) -> {file: string, language: 'sqlscript'|'cypher', statement: string}[]`, ordered: `000-schema` → `1NN-nodes-<Type>` → `2NN-delete-stale-edges` → `3NN-edges-<Type>` → `900-cleanup` (ingest) / `900-cleanup-derived` (link) → `990-count`.
  - Ingest mode: every node row gets `env`, `projectKey`, `scanId` from `bundle.scan` (shared uids: `env` only for `ds:`,`ch:`,`sys:`,`gap:<env>`; no `projectKey`).
  - Link mode: rows with shared uids (`gap:`, `sys:`) get `env` + `scanId`; rows with project uids are **patches**: only their own props are set, and `env`/`projectKey`/`scanId` are never written. A Deployment `hosts` patch therefore survives the next ingest, because ingest rows do not carry `hosts`.
  - Node statement: `UNWIND [<rows>] AS r MERGE (n:<Type> {uid: r.uid}) SET n.<k> = r.<k>, …` over the union of keys in the batch, except `description`/`descriptionSource`, which use `CASE WHEN n.descriptionSource = 'human' THEN n.<k> ELSE r.<k> END`.
  - Delete stale edges (ingest): `MATCH (a:CodeNode {env:'<env>', projectKey:'<pk>'})-[e]->() WHERE e.scanId <> '<scanId>' DELETE e`.
  - Edge statement: `UNWIND [<rows>] AS r MATCH (a:CodeNode {uid:r.from}), (b:CodeNode {uid:r.to}) MERGE (a)-[e:<TYPE>]->(b) SET e.scanId = r.scanId, e.<k> = r.<k>, …`.
  - Cleanup (ingest): `MATCH (n:CodeNode {env:'<env>', projectKey:'<pk>'}) WHERE n.scanId <> '<scanId>' DETACH DELETE n`.
  - Cleanup (link): `MATCH ()-[e]->() WHERE e.derived = true AND e.env = '<env>' AND e.scanId <> '<scanId>' DELETE e` and `MATCH (g:Gap) WHERE g.uid STARTS WITH 'gap:<env>:system:' AND g.scanId <> '<scanId>' DETACH DELETE g`.
  - `sharedCleanupStatement() -> string`: `MATCH (n:CodeNode) WHERE (n.uid STARTS WITH 'ext:' OR n.uid STARTS WITH 'lib:' OR n.uid STARTS WITH 'tag:' OR n.uid STARTS WITH 'ds:' OR n.uid STARTS WITH 'ch:' OR n.uid STARTS WITH 'sys:') AND NOT (n)--() DELETE n`. This is the separate maintenance command of spec §11 and is never part of a load plan.
  - Count: `MATCH (n:CodeNode {env:'<env>', projectKey:'<pk>'}) RETURN count(n) AS nodes`.
  - Batching: ≤ 300 rows **and** ≤ 200 000 chars per statement; a single row that alone exceeds the char cap becomes its own batch.
- CLI: `bundle-to-cypher.mjs <bundle.json> <outDir> [--mode ingest|link]` writes `NNN-*.cypher` files plus `plan.json` (`[{file, language}]`) for the AI to send in order.

- [ ] **Step 1: Write failing tests**
  - `cypher literal escapes`: `toCypherLiteral("O'Brien \\ D:\\upload\nđã xử lý $x")` equals `'O\\'Brien \\\\ D:\\\\upload\\nđã xử lý $x'` (as JS source); objects render as `{a: 1, b: 'x'}`; arrays as `[1, 'a']`; `NaN` throws.
  - `orders statements`: for `valid-min`, file names start `000-schema`, then all `1`, then `2`, then `3`, then `900-cleanup`, then `990-count`.
  - `splits by count`: 650 Operation nodes → 3 node batches of 300/300/50.
  - `splits by size`: 3 nodes, one with a 250 000-char description → that node alone in one batch.
  - `cleanup is scoped`: the cleanup statement contains `env:'uat'`, `projectKey:'svc'` and `scanId <> '<scanId>'`, and no statement deletes on `ext:`/`lib:`.
  - `protects human descriptions`: node statement contains `CASE WHEN n.descriptionSource = 'human'`.
  - `link mode`: no `delete-stale-edges` file, has `900-cleanup-derived`; the node statement for a Deployment patch row sets `hosts` and does not mention `projectKey`.
  - `shared cleanup only touches orphans`: `sharedCleanupStatement()` contains `NOT (n)--()` and every prefix above.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `cypher.mjs`, `batches.mjs` and the CLI.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Verify against ArcadeDB**: run `bundle-to-cypher` on `valid-min` (env `dev`, projectKey `__plan_smoke__`), send each file through MCP `execute_command` on `CodeGraph` in `plan.json` order, check the `990-count` result equals the node count of the bundle, run it a second time (count unchanged), then delete with `MATCH (n:CodeNode {projectKey:'__plan_smoke__'}) DETACH DELETE n`. If `MERGE … SET` with `UNWIND` errors on ArcadeDB, fix the generator and add a regression test before moving on.
- [ ] **Step 6: Commit** `git commit -m "feat(code-graph): bundle-to-cypher load plan with scoped cleanup"`

---

### Task 5: Fixed queries for link and report

**Files:**
- Create: `scripts/core/queries.mjs`, `scripts/print-queries.mjs`
- Test: `scripts/test/queries.test.mjs`

**Interfaces:**
- Produces: `linkQueries(env) -> {name: string, cypher: string}[]` with names `clientCalls` (uid, service projectKey, clientKind, httpMethod, urlTemplate, resolvedHost, resolvedPort, resolvedPath, discoveryName), `endpoints` (uid, projectKey, protocol, httpMethod, path, pathRegex, signature), `deployments` (projectKey, port, contextPath, hosts), `services` (projectKey, name), `accesses` (projectKey, dataStore uid, mode), `externals` (sys uid, host, port).
- Produces: `reportQueries(env) -> {name, cypher}[]` with names `services` (card fields + domain + layer + coverage), `dependencies` (from, to, protocol, sync, endpointsUsed, callCount, confidence), `dataOwnership` (dataStore, owners[], readers[]), `gaps` (uid, kind, askWho, question, status, attached uid).
- Produces: `studioQueries() -> {title, cypher}[]` (L1 overview, by domain (param placeholder `<domain>`), one service L1→L2, Endpoint→DataStore chain, open gaps).
- CLI: `print-queries.mjs link|report|studio|maintenance --env uat` prints JSON `[{name, cypher}]` (`maintenance` prints `sharedCleanupStatement()` from Task 4). The AI runs each query through MCP and saves `{<name>: records}` to `link-input.json` / `report-data.json`.

- Consumes: `sharedCleanupStatement()` from Task 4 (only for the `maintenance` CLI mode).

- [ ] **Step 1: Write failing tests**: every query string contains `'<env>'` substituted (no literal `<env>` left); every `linkQueries` name listed above exists; `studioQueries` returns ≥ 5 entries; `linkQueries`, `reportQueries` and `studioQueries` only use `MATCH`/`OPTIONAL MATCH`/`RETURN`/`WITH` (regex: no `CREATE|MERGE|DELETE|SET`).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `queries.mjs` and the CLI.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then run each query once through MCP against `CodeGraph` (demo data may return empty arrays; there must be no syntax error).
- [ ] **Step 5: Commit** `git commit -m "feat(code-graph): fixed link/report/studio queries"`

---

### Task 6: `link-plan` (cross-service matching, gaps, rollups)

**Files:**
- Create: `scripts/core/url.mjs`, `scripts/core/link.mjs`, `scripts/link-plan.mjs`
- Test: `scripts/test/url.test.mjs`, `scripts/test/link.test.mjs`, fixture `scripts/test/fixtures/link-input.json` (services `a-service`, `b-service`, `c-service`; `a` calls `GET /items/{id}` via base URL `http://10.1.2.3:8081`; `b` and `c` both expose `GET /items/{id}`; `b` deployment port 8081, contextPath `/b`, `c` port 8082; plus one OFS call to `uat:t24:endpoint:ofs:FUNDS.TRANSFER,ACTR`; plus one call to `http://api.partner.com/v1/x`)

**Interfaces:**
- Consumes: `link-input.json` shape from Task 5; catalog `gapAnswers` (spec §9).
- Produces (`url.mjs`): `normalizeUrl(url) -> {host: string|null, port: number|null, path: string}` (drops scheme, userinfo, query, fragment and trailing `/`; default port 80/443 by scheme); `templateToRegex(template) -> string` (`{x}` → `[^/]+`, other regex chars escaped, anchored `^…$`); `stripContextPath(path, contextPath) -> string|null`.
- Produces (`link.mjs`): `planLinks(input, {env, scanId, gapAnswers}) -> Bundle` with `scan.projectKey = '__system__'`, containing:
  - `TARGETS` edges `{matchedBy, confidence, derived: true, env}` per spec §7.2 priority: (1) host:port ∈ deployment hosts/port and path (after context-path) matches → `host+path`/`high`; (2) `discoveryName` = service name and path matches → `host+path`/`high`; (3) path only, exactly one candidate → `path`/`medium`; (4) `clientKind=ofs` signature equality → `ofs-version`/`high`; topic equality → `topic`/`high`; (5) `gapAnswers` entry → `manual`/`high` (overrides 1–4).
  - Multiple candidates → `Gap` node `kind:'ambiguous-target'`, `askWho:'BA'`, `candidates:[{projectKey, hosts, port}]`, `question` = `Lời gọi <httpMethod> <urlTemplate> từ <projectKey> trỏ tới host/IP nào?` plus `HAS_GAP` from the ClientCall.
  - No candidate with a host → `ExternalSystem` node `sys:<env>:<host>` + `TARGETS` `matchedBy:'host'`, `confidence:'medium'`; no host and no candidate → Gap `unknown-external`.
  - `Deployment` hosts update rows (node rows with only `uid` + `hosts`) built from high-confidence matches.
  - Rollups: one `SERVICE_DEPENDS_ON` per (caller service, target service or external) with `protocol`, `sync` (true unless clientKind is a producer), `endpointsUsed` (sorted unique target uids), `callCount`, `confidence` (min of the contributing edges), `derived:true`, `env`; `OWNS_DATA` for services with `ACCESSES` mode `write|rw`, otherwise `READS_DATA`, both `derived:true`.
- CLI: `link-plan.mjs <link-input.json> <catalog.yaml> <env> <out-bundle.json>`; the output is loaded with `bundle-to-cypher --mode link`.

- [ ] **Step 1: Write failing tests**
  - `url.test.mjs` `normalizes BA urls`: `normalizeUrl('http://localhost:8080/document/rag/process/123?x=1')` → `{host:'localhost', port:8080, path:'/document/rag/process/123'}`; a trailing `/` is removed; `new RegExp(templateToRegex('/document/rag/process/{documentId}')).test('/document/rag/process/123')` is true and `.test('/document/rag/process/123/x')` is false; `templateToRegex('/a.b/{id}')` does not match `/aXb/1`; `stripContextPath('/b/items/1','/b')` → `/items/1`, `stripContextPath('/items/1','/b')` → `null`.
  - `link.test.mjs`: `host+path match` (a→b high, not c); `ambiguous without host` (drop resolvedHost → Gap with 2 candidates and Vietnamese question); `ofs match`; `external host` (partner → `sys:uat:api.partner.com`); `manual answer wins` (gapAnswers points to c → TARGETS to c `manual`); `rollup` (one `SERVICE_DEPENDS_ON` a→b with `callCount` = number of a→b calls); `output validates` (`validateBundle(out).errors` is empty).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `url.mjs`, `link.mjs` and the CLI. Gap uid = `gap:<env>:system:<kind>:` + the first 12 hex chars of sha1(clientCall uid).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(code-graph): cross-service link plan with gaps and rollups"`

---

### Task 7: `make-report`

**Files:**
- Create: `scripts/core/report.mjs`, `scripts/make-report.mjs`
- Test: `scripts/test/report.test.mjs`, fixture `scripts/test/fixtures/report-data.json`

**Interfaces:**
- Consumes: `report-data.json` (`{services, dependencies, dataOwnership, gaps}` from Task 5); optional previous `report-data.json`.
- Produces: `renderReport(data, prev|null, {env, generatedAt}) -> string` with sections in this order: `# Topology <env>`, `## Services theo Domain/Layer` (table: Service, Domain, Layer, Summary, Capabilities, Độ phủ), `## Phụ thuộc` (matrix rows = callers, columns = targets, cell = `protocol×callCount`), `## Dữ liệu` (DataStore, Owner, Readers), `## Gap đang mở` (grouped by askWho, each with question), `## Thay đổi so với lần trước` (services/endpoints/dependencies added or removed; `Lần đầu tạo report` when prev is null). Services without a domain go under `(chưa phân loại)`.
- CLI: `make-report.mjs <report-data.json> <out.md> --env uat [--prev <old.json>]`; also writes `studio-queries.md` next to it from `studioQueries()`.

- [ ] **Step 1: Write failing tests**: `renders sections in order`; `matrix cell` shows `http×3`; `unclassified service` listed under `(chưa phân loại)`; `gaps grouped by askWho`; `diff section` lists a removed dependency; `first report` text when prev null.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `report.mjs` and the CLI.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(code-graph): topology report renderer"`

---

### Task 8: Core references + Spring Boot and Java reader profiles

**Files:**
- Create: `references/schema.md` (spec §4 fully: uid table, vertex/edge tables, inherited-call rule; plus the optional ClientCall prop `discoveryName` (Feign `name`, `lb://<name>`) that Task 6 matches on), `references/bundle-format.md` (spec §5 + one complete minimal example), `references/describe-guide.md` (spec §8, with one good and one bad example per level: Operation, Component, Endpoint, Capability, Service card), `references/config-and-env.md` (spec §9 + catalog example), `references/cross-service.md` (ClientCall extraction rules, link priorities, Gap question wording), `references/review-outputs.md` (how to run report/studio queries and read the report)
- Create: `references/readers/_contract.md` (the 8 mandatory sections of spec §6.1, each with what must be written)
- Create: `references/readers/spring-boot.md` (spec §6.2 in all 8 sections), `references/readers/java-generic.md` (plain Java/TAFJ extension: classes, methods, CALLS, no Spring semantics)
- Create: `templates/system-catalog.example.yaml` (spec §9 example incl. `gapAnswers`)
- Create: `templates/fixtures/spring-boot/` with two tiny services: `a-service` (controller → service → Feign client `BClient` with `url = "${b-service.url}"` → `GET /items/{id}`; `application-uat.yml` with `b-service.url: http://10.1.2.3:8081` and `spring.datasource.password: secret`) and `b-service` (`server.port: 8081`, `server.servlet.context-path: /b`, controller `GET /items/{id}` → repository → `@Document(collection="items")`), and `expected/a-service.uat.bundle.json` + `expected/b-service.uat.bundle.json` written by hand following the references
- Modify: `scripts/core/profile-rules/index.mjs` (spring-boot rules: every Component with stereotype `controller` has ≥ 1 Operation with `EXPOSES`; every ClientCall with `clientKind` `feign|rest-template|web-client|rest-client` has `USES_CONFIG {role:'base-url'}` or `HAS_GAP`; every ConfigKey `server.port` is reflected in `Deployment.port`)
- Test: `scripts/test/profile-spring.test.mjs`

**Interfaces:**
- Consumes: `validateBundle(bundle, {profiles:['spring-boot']})`, `planLinks`.
- Produces: the two expected bundles that later serve as acceptance fixtures.

- [ ] **Step 1: Write failing tests**: `expected spring bundles validate` (both pass with profile `spring-boot`); `masked password` (a-service ConfigKey `spring.datasource.password` value `***`); `link of the two fixtures` (build `link-input.json` from both expected bundles in-test → `TARGETS` a→b with `matchedBy:'host+path'`); `spring rule catches controller without endpoint` (remove the EXPOSES edge → `spring-boot` issue).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Write** the references, profiles, catalog example, fixtures, expected bundles and spring rules.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(code-graph): core references, spring-boot/java profiles and fixtures"`

---

### Task 9: T24 reader profile and fixture

**Files:**
- Create: `references/readers/t24.md` (spec §6.3 in all 8 sections; the Detection section covers `*.BP` folders, `SUBROUTINE` headers, record exports; Inventory skips `I_COMMON`/`I_EQUATE` as logic but reads them for name resolution; it states the export-format assumption explicitly as **to be verified on the real repo**)
- Create: `templates/fixtures/t24/` containing: `BP/FT.LOCAL.INPUT` (SUBROUTINE with `GOSUB` paragraphs, `CALL FT.LOCAL.CHECK`, `F.READ ... F.CUSTOMER`, `F.WRITE ... F.FUNDS.TRANSFER`), `BP/FT.LOCAL.CHECK`, `records/VERSION/FUNDS.TRANSFER,ACTR.txt` (INPUT.ROUTINE = FT.LOCAL.INPUT), `records/ENQUIRY/ENQ.CUST.LIST.txt` (FILE.NAME = CUSTOMER), `records/OFS.SOURCE/BROWSERTC.txt`, `records/EB.API/FT.LOCAL.INPUT.txt`, `expected/t24.uat.bundle.json`
- Modify: `scripts/core/profile-rules/index.mjs` (t24 rules: every Component `t24-version` has an Endpoint with `protocol:'ofs'`; every `TRIGGERS` target exists; every routine Component has an `Operation` with `kind:'routine-entry'`)
- Test: `scripts/test/profile-t24.test.mjs`

**Interfaces:**
- Consumes: `validateBundle`, `planLinks`.
- Produces: `expected/t24.uat.bundle.json` with Endpoint uid `uat:t24:endpoint:ofs:FUNDS.TRANSFER,ACTR`.

- [ ] **Step 1: Write failing tests**: `expected t24 bundle validates` with profile `t24`; `version hook edge` (TRIGGERS `{event:'INPUT.ROUTINE'}` from the VERSION Component to the routine entry); `t24 accesses` (read `ds:uat:t24:F.CUSTOMER`, write `ds:uat:t24:F.FUNDS.TRANSFER`); `ofs link from spring` (a ClientCall with `clientKind:'ofs'`, signature `FUNDS.TRANSFER,ACTR` → `TARGETS` `ofs-version`); `t24 rule catches version without endpoint`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Write** `t24.md`, the fixture, the expected bundle and the t24 rules.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(code-graph): t24 reader profile and fixture"`

---

### Task 10: `SKILL.md` (commands, phases, checklists)

**Files:**
- Create: `SKILL.md` with frontmatter `name: code-graph-ingest` and `description` (triggers: "scan/ingest project vào graph", "mô hình hoá source lên ArcadeDB", "link service", "topology report"), then:
  - When to use; the 3 commands `ingest <repoPath> --project <key> --env <dev|uat>`, `link --env <env>`, `report --env <env>`; workspace layout (spec §3).
  - `ingest` phases 0–7 exactly as spec §7.1, each with: inputs, exact actions, which reference/profile to read, which script to run (full command), exit condition. Phase 0 uses `git worktree add <workspace>/<env>/<projectKey>/src <branch>` with the branch taken from the catalog, and records `git rev-parse HEAD`. Phases 2–4 tell the agent to dispatch one subagent per module when the inventory exceeds 150 files, giving each subagent: file list, profile path, `references/schema.md`, uid rules, and the output path `bundle.part-<module>.json`. Phase 7 sends `plan.json` files in order through MCP (`sqlscript` for schema, `cypher` otherwise), compares `990-count` with the bundle, never runs `900-cleanup` after a failed batch, and ends by reminding the user to run `link`. When a batch fails, the agent stops, records the failing file name in `load-state.json`, and on the next run resumes from that file (re-sending earlier node/edge files is harmless because they MERGE).
  - `## Bảo trì`: running `sharedCleanupStatement()` (print it with `node scripts/print-queries.mjs maintenance`) to remove orphan shared nodes, only when the user asks.
  - `link`: `print-queries link` → run through MCP → `link-input.json` → `link-plan.mjs` → `validate-bundle` → `bundle-to-cypher --mode link` → load.
  - `report`: `print-queries report` → `report-data.json` → `make-report.mjs` (with `--prev` when present).
  - Hard rules: never read `.env*`, keystores or git-ignored secret files; never write secrets; never invent URLs, systems or behaviour; every description needs evidence and confidence; never overwrite `descriptionSource=human`; never edit the scanned repo; use only MCP for DB writes.
- Test: `scripts/test/skill-md.test.mjs`

- [ ] **Step 1: Write failing test** `skill references exist`: parse `SKILL.md`; every `references/...md`, `scripts/...mjs` and `templates/...` path mentioned exists on disk; frontmatter has `name` and `description`; the headings `## ingest`, `## link`, `## report` exist; phase headings `Pha 0` … `Pha 7` all appear.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Write** `SKILL.md`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(code-graph): SKILL.md with ingest/link/report workflow"`

---

### Task 11: Acceptance on robo-lang-chain (dev)

**Files:**
- Create: `code-graph-workspace/system-catalog.yaml` (not committed; `robo-lang-chain` with `branches: {dev: master}`, `readerProfiles: [spring-boot]`, `domain: document-ai`, `layer: core-service`)
- Create: `docs/superpowers/acceptance/2026-11-09-code-graph-acceptance.md` (results log, committed)

- [ ] **Step 1: Reset demo data** (spec §14): through MCP on `CodeGraph`, `MATCH (n:CodeNode) DETACH DELETE n`, then confirm `MATCH (n:CodeNode) RETURN count(n)` = 0. Ask the user before running it, because it deletes the demo graph.
- [ ] **Step 2: Run the skill** `ingest D:/IdeaProjects/robo-lang-chain --project robo-lang-chain --env dev`, following SKILL.md only. Expected: validate passes, `990-count` equals the bundle node count.
- [ ] **Step 3: Verify the BA lookup**: run the spec §13.3 query from path `/document/rag/process/{documentId}`. Expected: Service `robo-lang-chain` with summary/responsibilities, chain reaching `ds:dev:mongodb:app_db.fileManagementDocument` and `ds:dev:qdrant:documents`.
- [ ] **Step 4: Verify idempotency**: re-run ingest without code changes. Expected: `diff.md` reports 0 added/removed/changed and the node count is unchanged. Then, in a scratch worktree, delete `DocumentRagController.java`, ingest, and expect its nodes gone and no `ext:`/`lib:` node removed. Restore the worktree and ingest again.
- [ ] **Step 5: Run** `link --env dev` and `report --env dev`. Expected: report lists robo-lang-chain under `document-ai`; external Ollama/MCP servers appear as `ExternalSystem`; no validator errors.
- [ ] **Step 6: Record** the counts, query outputs and any skill fixes in the acceptance log; commit with `git commit -m "test(code-graph): acceptance on robo-lang-chain dev"`.
