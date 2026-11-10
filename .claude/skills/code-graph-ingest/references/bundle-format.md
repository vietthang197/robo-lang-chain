# Định dạng bundle

Bundle là file JSON chứa node và edge của **một lần scan** (một project, một env). Schema máy đọc: `templates/bundle.schema.json`. Validator: `node <skill>/scripts/validate-bundle.mjs <bundle.json> --profile <profile>`. (`<skill>` = thư mục skill `.claude/skills/code-graph-ingest`.)

## 1. Cấu trúc

```json
{
  "schemaVersion": "1.0",
  "scan": {
    "scanId": "uat-robo-lang-chain-20261109T101500Z",
    "env": "uat", "projectKey": "robo-lang-chain",
    "repoPath": "D:/IdeaProjects/robo-lang-chain", "branch": "uat", "commitSha": "f2b3b30…",
    "readerProfiles": ["spring-boot"], "scannedAt": "2026-11-09T10:15:00Z",
    "coverage": { "filesTotal": 34, "filesRead": 34, "skipped": [{"path": "target/**", "reason": "build output"}] }
  },
  "nodes": [ { "type": "<Vertex>", "uid": "<uid>", "props": { } } ],
  "edges": [ { "type": "<EDGE>", "from": "<uid>", "to": "<uid>", "props": { } } ],
  "gaps": [],
  "diagnostics": [{ "level": "warn", "file": "…", "message": "…" }]
}
```

| Trường | Quy tắc |
|---|---|
| `schemaVersion` | luôn `"1.0"` |
| `scan.scanId` | `<env>-<projectKey>-<UTC yyyyMMddTHHmmssZ>`; mọi part của cùng một lần scan dùng chung scanId |
| `scan.env` | `dev` hoặc `uat` |
| `scan.projectKey` | key trong catalog; không được là `system`, `__system__`, không chứa `:` (rule `R1-projectKey`) |
| `scan.readerProfiles` | các profile đã khớp ở pha Detection; validator chạy rule của các profile này |
| `scan.coverage` | `filesTotal` = số file trong inventory, `filesRead` = số file đã đọc thật; mỗi file bỏ qua có `{path, reason}`. Trong `bundle.part-<module>.json`, chỉ đếm file của module đó (merge cộng dồn) |
| `nodes[]` | đúng 3 key `type`, `uid`, `props` (**ruling R6**); mọi thuộc tính khác nằm trong `props`, kể cả `external` |
| `edges[]` | đúng 4 key `type`, `from`, `to`, `props` (**ruling R6**); `props` có thể là `{}` |
| `gaps[]` | danh sách đọc nhanh: `{uid, kind, question, askWho, candidates?, status?, answer?}`. Gap nào cũng **đồng thời** là node `Gap` + cạnh `HAS_GAP` từ node liên quan |
| `diagnostics[]` | `{level: info|warn|error, file?, message}`: file không đọc được, chỗ khó hiểu |

**Không ghi** `env`, `projectKey`, `scanId` vào từng node/edge: writer tự điền từ `scan`. `Service.coverage` cũng được chép tự động từ `scan.coverage`.

## 2. Ví dụ tối thiểu hoàn chỉnh (qua validate)

```json
{
  "schemaVersion": "1.0",
  "scan": {
    "scanId": "uat-demo-svc-20261110T090000Z", "env": "uat", "projectKey": "demo-svc",
    "repoPath": "D:/repos/demo-svc", "branch": "uat", "commitSha": "a1b2c3d",
    "readerProfiles": ["spring-boot"], "scannedAt": "2026-11-10T09:00:00Z",
    "coverage": { "filesTotal": 3, "filesRead": 3, "skipped": [] }
  },
  "nodes": [
    { "type": "Service", "uid": "uat:demo-svc:service:demo-svc",
      "props": { "kind": "service", "name": "demo-svc",
                 "summary": "demo-svc trả lời health check cho hệ thống giám sát.",
                 "responsibilities": ["Cung cấp API GET /ping"], "notResponsibleFor": ["Không lưu dữ liệu"],
                 "businessTerms": ["health check"], "techStack": ["java", "spring-boot"], "readerProfiles": ["spring-boot"],
                 "description": "demo-svc chỉ có một API GET /ping trả về chuỗi pong.",
                 "evidence": ["uat:demo-svc:endpoint:http:GET /ping"], "confidence": "high", "descriptionSource": "ai" } },
    { "type": "Deployment", "uid": "uat:demo-svc:deployment",
      "props": { "kind": "deployment", "port": 8080, "contextPath": null, "hosts": [], "branch": "uat", "commitSha": "a1b2c3d", "profilesActive": ["uat"] } },
    { "type": "Environment", "uid": "env:uat", "props": { "kind": "environment", "name": "uat", "database": "CodeGraph" } },
    { "type": "Module", "uid": "uat:demo-svc:module:com.demo", "props": { "kind": "java-package", "name": "com.demo", "qualifiedName": "com.demo" } },
    { "type": "Component", "uid": "uat:demo-svc:component:com.demo.PingController",
      "props": { "kind": "java-class", "stereotype": "controller", "name": "PingController", "qualifiedName": "com.demo.PingController",
                 "filePath": "src/main/java/com/demo/PingController.java", "lineStart": 6,
                 "description": "REST controller cung cấp API kiểm tra sống (ping).",
                 "evidence": ["src/main/java/com/demo/PingController.java:5"], "confidence": "high", "descriptionSource": "ai" } },
    { "type": "Operation", "uid": "uat:demo-svc:operation:com.demo.PingController#ping",
      "props": { "kind": "java-method", "name": "ping", "qualifiedName": "com.demo.PingController#ping", "signature": "ping()",
                 "filePath": "src/main/java/com/demo/PingController.java", "lineStart": 8 } },
    { "type": "Endpoint", "uid": "uat:demo-svc:endpoint:http:GET /ping",
      "props": { "kind": "http", "protocol": "http", "httpMethod": "GET", "path": "/ping", "pathRegex": "^/ping$", "signature": "GET /ping",
                 "description": "Kiểm tra service còn sống; không có input, trả về chuỗi pong, không có tác dụng phụ.",
                 "evidence": ["src/main/java/com/demo/PingController.java:7"], "confidence": "high", "descriptionSource": "ai" } },
    { "type": "ConfigKey", "uid": "uat:demo-svc:config:server.port",
      "props": { "kind": "config", "key": "server.port", "value": "8080", "masked": false, "isPlaceholder": false,
                 "sourceFile": "src/main/resources/application.yml", "profile": "default" } }
  ],
  "edges": [
    { "type": "IN_ENV", "from": "uat:demo-svc:service:demo-svc", "to": "env:uat", "props": {} },
    { "type": "IN_ENV", "from": "uat:demo-svc:deployment", "to": "env:uat", "props": {} },
    { "type": "DEPLOYED_AS", "from": "uat:demo-svc:service:demo-svc", "to": "uat:demo-svc:deployment", "props": {} },
    { "type": "CONTAINS", "from": "uat:demo-svc:service:demo-svc", "to": "uat:demo-svc:module:com.demo", "props": {} },
    { "type": "CONTAINS", "from": "uat:demo-svc:module:com.demo", "to": "uat:demo-svc:component:com.demo.PingController", "props": {} },
    { "type": "CONTAINS", "from": "uat:demo-svc:component:com.demo.PingController", "to": "uat:demo-svc:operation:com.demo.PingController#ping", "props": {} },
    { "type": "CONTAINS", "from": "uat:demo-svc:service:demo-svc", "to": "uat:demo-svc:config:server.port", "props": {} },
    { "type": "EXPOSES", "from": "uat:demo-svc:operation:com.demo.PingController#ping", "to": "uat:demo-svc:endpoint:http:GET /ping", "props": {} },
    { "type": "SERVES", "from": "uat:demo-svc:deployment", "to": "uat:demo-svc:endpoint:http:GET /ping", "props": {} },
    { "type": "USES_CONFIG", "from": "uat:demo-svc:deployment", "to": "uat:demo-svc:config:server.port", "props": { "role": "port" } }
  ],
  "gaps": [],
  "diagnostics": []
}
```

Ví dụ đầy đủ hơn (Feign, repository, DataStore, Bean, Tag, Library, config có secret): `templates/fixtures/spring-boot/expected/*.uat.bundle.json`.

## 3. Ghi Gap

Mỗi Gap ghi **3 chỗ**: node `Gap`, cạnh `HAS_GAP` từ node liên quan, và một dòng trong `gaps[]`.

```json
{ "type": "Gap", "uid": "gap:uat:a-service:missing-config-value:<sha1('uat:a-service:config:b-service.url')[0:12]>",
  "props": { "kind": "missing-config-value", "askWho": "DevOps", "status": "open", "candidates": [],
             "question": "Ở env uat, b-service.url (base URL của BClient) có giá trị gì? Key không có trong application-uat.yml/application.yml." } }
```
```json
{ "type": "HAS_GAP", "from": "uat:a-service:config:b-service.url", "to": "gap:uat:a-service:missing-config-value:<hash>", "props": {} }
{ "type": "HAS_GAP", "from": "uat:a-service:clientcall:com.example.a.client.BClient#getItem->feign:GET /items/{id}",
  "to": "gap:uat:a-service:missing-config-value:<hash>", "props": {} }
```
`missing-config-value` là **một Gap cho mỗi ConfigKey** (hash trên uid ConfigKey), có `HAS_GAP` từ ConfigKey và từ mọi ClientCall dùng key đó. Các kind khác hash trên uid của node mà Gap gắn vào (`schema.md` §2.1).

ConfigKey của key credential dùng placeholder có default: `"placeholderExpr": "${DB_PASS:***}"`, `"value": "***"`, `"masked": true`, `defaultValue` bỏ hoặc `"***"` (rule `R7-config-default`, `config-and-env.md` §2).

Gap trong bundle ingest luôn dùng `gap:<env>:<projectKey>:…` (**ruling R12**); `gap:<env>:system:…` chỉ do `link` sinh. Câu hỏi viết tiếng Việt, cụ thể, nêu đủ để người được hỏi trả lời mà không cần mở code.

## 4. Chia part và gộp

- Repo lớn: mỗi subagent trả về `bundle.part-<module>.json` (cùng `scan` trừ `coverage`). Cạnh `CALLS` sang module khác dùng uid dự kiến theo công thức; validate sau khi gộp sẽ bắt cạnh treo.
- Node trùng uid giữa các part được gộp props: prop còn rỗng được điền từ part sau, prop đã có giá trị ở part trước thì giữ nguyên. Cạnh trùng `(type, from, to)` và gap trùng uid chỉ giữ bản đầu tiên. Vì vậy node dùng chung (Tag, Library, ext:) nên ghi giống hệt nhau ở mọi part.
- Lệnh:
  ```bash
  node <skill>/scripts/merge-bundles.mjs bundle.json bundle.part-*.json
  node <skill>/scripts/validate-bundle.mjs bundle.json --profile spring-boot
  node <skill>/scripts/diff-bundle.mjs bundle.prev.json bundle.json diff.md      # "-" thay prev ở lần đầu
  ```

## 5. Validate: các rule

| Rule | Nội dung |
|---|---|
| `R1-shape` | đúng cấu trúc; `schemaVersion` hỗ trợ; enum `confidence`/`descriptionSource`/`askWho`/gap kind hợp lệ |
| `R1-projectKey` | projectKey không là `system`/`__system__`, không chứa `:` |
| `R2-uid` | uid duy nhất, đúng công thức theo type, `env`/`projectKey` khớp `scan`; `ext:` cần `props.external=true`; Gap (node và `gaps[]`) của bundle ingest phải là `gap:<scan.env>:<scan.projectKey>:…`, của link bundle là `gap:<scan.env>:system:…` (ruling R12) |
| `R1-profile-unknown` | profile nêu rõ bằng `--profile` phải có rule (profile lạ trong `scan.readerProfiles` chỉ là cảnh báo `W-profile-unknown`) |
| `R3-dangling` | `from`/`to` có trong bundle, hoặc là uid dùng chung (trừ `gap:`) |
| `R3-derived-in-ingest` | bundle ingest không chứa cạnh `TARGETS`, `SERVICE_DEPENDS_ON`, `OWNS_DATA`, `READS_DATA` hay cạnh có `props.derived=true` (chỉ `link` sinh) |
| `R4-service-deployment` | đúng 1 `Service` và 1 `Deployment` |
| `R5-service-surface` / `R5-clientcall-url` | Service có ≥1 Endpoint/Channel/Gap; ClientCall có `urlTemplate` hoặc `HAS_GAP` |
| `R6-description-evidence` / `R6-required-description` | có `description` thì phải có `evidence[]` + `confidence`; Component `controller`/`service`, Endpoint, Capability (không external) bắt buộc có description |
| `W-shared-endpoint-missing` | (cảnh báo) cạnh trỏ tới node dùng chung không có trong bundle: cạnh bị bỏ qua nếu node chưa có trong DB |
| `R7-secret` | không chuỗi nào khớp mẫu secret (URL có userinfo, Oracle thin `USER/PASS@`, JWT, PEM, `password=…`, AWS key, `Bearer <token>`, `sk-…`/`ghp_…`/`xoxb-…`) |
| `R7-config-default` | ConfigKey có key credential (`CREDENTIAL_KEY`, xem `config-and-env.md` §4): default trong `placeholderExpr` phải là `***`, rỗng hoặc placeholder khác; `defaultValue` bỏ hoặc `***` |
| `R7-config-value` | ConfigKey có key credential: `value` chỉ được là null, `""`, `***` (kèm `masked:true`), `${VAR}` hoặc `${VAR:***}` (`value: "Hunter2024"` là fail dù mẫu secret không nhận ra); key `url`/`uri`: `value` phải đã che sẵn (bằng kết quả `maskConfigValue`) |
| `<profile>-…` | rule riêng của profile, xem mục 8 của profile |
| `W-*` | cảnh báo, không fail: độ phủ < 95%, Operation không ai gọi và không phải entry, Capability chỉ có 1 Endpoint |

Validate fail thì sửa bundle và chạy lại; **không nạp** bundle chưa pass.

## 6. Nạp (tóm tắt các điểm dễ sai)

```bash
node <skill>/scripts/bundle-to-cypher.mjs bundle.json load-batches            # --mode ingest (mặc định)
```
- Lệnh ghi `load-batches/NNN-*.cypher` và `plan.json` (`[{file, language, expectNodes?}]`). Gửi từng file **theo đúng thứ tự trong `plan.json`** qua MCP ArcadeDB (`language` = `sqlscript` cho `000-schema`, `cypher` cho phần còn lại).
- Mỗi lô ≤ 300 dòng **và** ≤ 200 000 ký tự Cypher (script tự chia).
- Kết quả `990-count` phải bằng `expectNodes` trong `plan.json` (số node thuộc project, **gồm cả Gap của project**), **không** so với tổng số node của bundle (bundle còn chứa node dùng chung `ext:`/`lib:`/`tag:`/`ds:`/`env:`… không mang projectKey).
- `990-count` (ingest) trả `nodes` và `edges`; `edges` phải bằng `expectEdges` (số cạnh khác nhau `(type, from, to)` đi ra từ node thuộc project của bundle, đếm theo `scanId`). Lô cạnh `MATCH` hai đầu nên cạnh có đầu mút không tồn tại bị **bỏ qua im lặng**: node dùng chung mà cạnh trỏ tới nhưng không có trong bundle được validator báo `W-shared-endpoint-missing`.
- Nhóm dòng node: node project gộp theo nhãn; node dùng chung (`ds:`, `ext:`, `lib:`, `tag:`, `ch:`, `sys:`…) gộp theo nhãn **và tập key**, để một dòng thiếu key không ghi `null` đè giá trị project khác đã ghi.
- Trong DB, prop dạng map và list-of-map (`Service.coverage`, `Gap.candidates`, `TAGGED.attributes`, …) là **chuỗi JSON** (ArcadeDB không nhận map); đọc ra thì parse lại (`schema.md` §3). Bundle vẫn ghi chúng dạng object.
- Lô nào lỗi thì dừng, **không** chạy cleanup; chạy lại tiếp từ lô lỗi.
- Uid `ext:` phải cùng loại vertex ở mọi project (xem `schema.md` §2.1), nếu không unique index từ chối cả lô.
- Sau mỗi ingest phải chạy lại `link --env <env>` (xem `cross-service.md`).
