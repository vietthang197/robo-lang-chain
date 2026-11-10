# Thiết kế skill `code-graph-ingest`: mô hình hoá source code của hệ sinh thái lên ArcadeDB

- Ngày: 2026-11-09
- Trạng thái: chờ review
- Phạm vi: skill cho AI (Claude Code) đọc toàn bộ source của từng project, mô hình hoá thành graph chuẩn trên ArcadeDB, nối liên service, và xuất báo cáo topology. Không bao gồm phần retriever/embedding của GraphRAG.

---

## 1. Bối cảnh và mục tiêu

Hệ thống gồm nhiều layer và microservice: T24 (core banking), BPM, Spring Boot microservice, micro frontend và mobile. Cần một graph thống nhất trên ArcadeDB để phục vụ:

1. **Review topology:** người xem được toàn cảnh hệ thống: service nào thuộc domain/layer nào, phụ thuộc nhau ra sao, ai sở hữu dữ liệu nào, chỗ nào chưa rõ.
2. **GraphRAG cho Solution Architect agent:** agent vừa hiểu cấu trúc hệ thống, vừa nắm chức năng và nhiệm vụ của từng microservice. Agent trả lời được những câu như "API `/document/rag/process/{documentId}` trong tài liệu BA là của service nào, làm gì, gọi tiếp đến đâu". Khi thông tin mơ hồ, agent biết phải hỏi lại (ví dụ hỏi IP để phân biệt 2 service trùng path).

### Mục tiêu
- Một **skill duy nhất** (`code-graph-ingest`) dạy AI quy trình chuẩn. Kiến thức đặc thù của từng loại project nằm trong các **reader profile** riêng, nhưng profile nào cũng xuất ra **cùng một mô hình graph chuẩn**.
- Graph **nhiều tầng** (L0 Landscape → L1 Service → L2 Interface → L3 Code). Node ở tầng nào cũng có mô tả, kèm bằng chứng và độ tin cậy.
- **Config và môi trường là dữ liệu hạng nhất:** mỗi env có code và config riêng; lời gọi liên service được dựng qua config (base URL → host:port → Deployment → Endpoint).
- **Lỗ hổng là dữ liệu hạng nhất:** cái gì không xác định được thì ghi thành `Gap` kèm câu hỏi, không đoán.
- Chạy lại được (idempotent), diff được giữa các lần scan, và không bao giờ ghi secret lên graph.

### Ngoài phạm vi
- Embedding, vector index, retriever và agent SA (thuộc sub-project GraphRAG). Skill chỉ để sẵn các trường `description`, `evidence`, `confidence` và `embedding` (để trống).
- Môi trường production và pilot (sẽ dùng database riêng, làm sau).
- Reader profile cho BPM, micro frontend và mobile: spec này chỉ định nghĩa hướng mapping. Profile chi tiết viết sau, theo đúng hợp đồng ở mục 6.

### Quyết định đã chốt
| Chủ đề | Quyết định |
|---|---|
| Cách làm | AI đọc code (không dùng parser tĩnh riêng) theo skill, ghi ra **graph bundle JSON**, validate, rồi nạp qua MCP ArcadeDB bằng Cypher `UNWIND` theo lô |
| Môi trường | Chỉ `dev` và `uat`, nằm chung database `CodeGraph`. `prod` và `pilot` để database riêng, làm sau |
| Code theo env | Mỗi env ứng với **một branch**. Skill đọc từ git worktree của branch đó và ghi lại `commitSha` |
| Nguồn config | File config trong repo, trên branch của env (`application-{env}.yml/properties`; với T24 là record OFS.SOURCE, `tafj.properties`, …) |
| Domain/Layer | AI chỉ **đề xuất**; kết quả cuối lấy từ `system-catalog.yaml` do người duyệt |
| Tổ chức skill | Một skill, có reader profile theo từng loại project, script Node để validate/convert/diff |

---

## 2. Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| **Bundle** | File JSON chứa node và edge của một lần scan (một project, một env) |
| **Reader profile** | Tài liệu hướng dẫn AI đọc một loại project (spring-boot, t24, …), gồm 8 mục bắt buộc |
| **Native artifact** | Thành phần gốc của từng công nghệ (Java class, T24 VERSION, BPMN task…) |
| **Mô hình chuẩn** | Tập node/edge ở mục 4. Mọi profile đều phải map vào đây |
| **Rollup** | Cạnh gộp, tính ra từ các cạnh chi tiết (ví dụ `SERVICE_DEPENDS_ON`) |
| **Gap** | Một điều chưa xác định được, kèm câu hỏi cho BA/DevOps |
| **scanId** | Định danh một lần scan, dùng để dọn node cũ |

---

## 3. Kiến trúc skill

```
.claude/skills/code-graph-ingest/
  SKILL.md                      # quy trình 3 lệnh, các pha, quy tắc chung, checklist
  references/
    schema.md                   # mô hình chuẩn: node, edge, thuộc tính, công thức uid
    bundle-format.md            # định dạng bundle + ví dụ
    describe-guide.md           # cách viết mô tả, thẻ service, capability, evidence, confidence
    config-and-env.md           # đọc config theo env, placeholder, secret, Deployment
    cross-service.md            # ClientCall, quy tắc link, Gap
    review-outputs.md           # mẫu topology-report.md, studio-queries.md
    readers/
      _contract.md              # hợp đồng 8 mục mà mọi profile phải theo
      spring-boot.md
      java-generic.md           # dùng chung cho TAFJ Java extension, thư viện Java
      t24.md
      (sau này) bpm.md, micro-frontend.md, mobile.md
  scripts/                      # Node.js (>= 20), không phụ thuộc gói ngoài nếu tránh được
    validate-bundle.mjs         # schema + rule chung + rule theo profile
    merge-bundles.mjs           # gộp bundle.part-*.json
    bundle-to-cypher.mjs        # sinh các lô Cypher UNWIND theo thứ tự nạp
    diff-bundle.mjs             # so với bundle lần trước
    make-report.mjs             # dựng topology-report.md từ kết quả query (JSON)
  templates/
    bundle.schema.json
    system-catalog.example.yaml
    fixtures/                   # fixture nhỏ cho từng profile + bundle kỳ vọng
```

Workspace của mỗi lần chạy (ngoài repo được scan), mặc định là `code-graph-workspace/<env>/<projectKey>/`:
```
inventory.json
bundle.part-<module>.json
bundle.json                     # bản đã gộp, đã validate
bundle.prev.json                # bản trước để diff
diff.md
catalog-proposal.yaml
load-batches/NNN-*.cypher
```
`code-graph-workspace/system-catalog.yaml` dùng chung cho mọi project.

---

## 4. Mô hình graph chuẩn

### 4.1 Nguyên tắc
1. Mọi vertex kế thừa từ supertype `CodeNode`, có unique index trên `uid` và index trên `env`, `projectKey`.
2. **Không tạo loại vertex riêng cho từng công nghệ.** Đặc thù công nghệ đi vào `kind` (ví dụ `t24-version`, `java-class`) và `nativeType`.
3. Mọi node và edge do lần scan sinh ra đều mang `scanId`, `env`, `projectKey`. Riêng node dùng chung (`lib:`, `ext:`, `tag:`, `ds:`, `sys:`) có `projectKey = null`.
4. Mô tả ở tầng trên chỉ được tổng hợp từ tầng dưới cộng với bằng chứng trong code. Mô tả nào cũng phải có `evidence[]`.

### 4.2 Công thức uid
| Loại | Công thức | Ví dụ |
|---|---|---|
| Node thuộc project | `<env>:<projectKey>:<kind-group>:<qualifiedName>` | `uat:robo-lang-chain:operation:com.thanglv.robolangchain.controller.ChatController#chat` |
| Endpoint | `<env>:<projectKey>:endpoint:<protocol>:<signature>` | `uat:robo-lang-chain:endpoint:http:GET /document/rag/process/{documentId}`, `uat:t24:endpoint:ofs:FUNDS.TRANSFER,ACTR` |
| ConfigKey | `<env>:<projectKey>:config:<key>` | `uat:robo-lang-chain:config:nas.path` |
| Deployment | `<env>:<projectKey>:deployment` | `uat:robo-lang-chain:deployment` |
| Type/operation ngoài | `ext:<fqn>[#op]` | `ext:org.springframework.data.mongodb.repository.MongoRepository#save` |
| Thư viện | `lib:<ecosystem>:<coordinate>` | `lib:maven:dev.langchain4j:langchain4j-qdrant` |
| Tag/annotation | `tag:<language>:<fqn>` | `tag:java:org.springframework.web.bind.annotation.GetMapping` |
| DataStore | `ds:<env>:<tech>:<location>` | `ds:uat:mongodb:app_db.fileManagementDocument`, `ds:uat:t24:F.CUSTOMER` |
| Channel | `ch:<env>:<tech>:<name>` | `ch:uat:kafka:payment.created` |
| Hệ thống ngoài | `sys:<env>:<name>` | `sys:uat:ollama` |
| Capability | `<env>:<projectKey>:capability:<slug>` | `uat:robo-lang-chain:capability:document-rag` |
| Gap | `gap:<env>:<projectKey|system>:<kind>:<hash>` | `gap:uat:system:ambiguous-target:3f9a…` |
| L0 | `env:<name>`, `domain:<slug>`, `layer:<slug>`, `system:<slug>` | `domain:document-ai` |

`<kind-group>` ∈ {`module`, `component`, `operation`, `member`, `bean`, `clientcall`}. `qualifiedName` của Operation **không** kèm chữ ký; overload được phân biệt bằng hậu tố `~<n>` và có thuộc tính `signature`. `qualifiedName` của ClientCall là `<qualifiedName của Operation>-><clientKind>:<httpMethod> <urlTemplate>`; nếu trùng thì thêm `~<n>` theo thứ tự xuất hiện. Không dùng số dòng trong uid, để sửa code ở chỗ khác không làm uid đổi.

Node dùng chung theo env (`ds:`, `ch:`, `sys:`) có `env` nhưng `projectKey = null`. Node dùng chung không theo env (`ext:`, `lib:`, `tag:`, L0) thì không có cả hai.

### 4.3 Thuộc tính chung của `CodeNode`
`uid`, `env`, `projectKey`, `kind`, `nativeType`, `name`, `qualifiedName`, `language`, `filePath`, `lineStart`, `lineEnd`, `contentHash`, `external` (bool), `scanId`, `description`, `descriptionSource` (`ai`, `human`, `doc`), `evidence` (list uid hoặc `file:line`), `confidence` (`high`, `medium`, `low`), `embedding` (để trống).

### 4.4 Vertex theo tầng

**L0 Landscape**
| Vertex | Thuộc tính riêng | Ghi chú |
|---|---|---|
| `System` | name | toàn hệ sinh thái (thường chỉ có 1) |
| `Environment` | name (`dev`, `uat`), database | |
| `Domain` | name, description | lấy từ catalog |
| `Layer` | name (`channel-mobile`, `micro-frontend`, `bff-gateway`, `core-service`, `integration`, `bpm`, `core-banking`) | lấy từ catalog |

**L1 Service**
| Vertex | Thuộc tính riêng | Ghi chú |
|---|---|---|
| `Service` | summary, responsibilities[], notResponsibleFor[], businessTerms[], techStack[], ownerTeam, readerProfiles[], repoUrl, coverage {filesRead, filesTotal} | thẻ service, là nút đầu tiên agent SA đọc |
| `Deployment` | port, contextPath, hosts[], branch, commitSha, profilesActive[] | một Service chạy ở một env |
| `Capability` | name, description, businessTerms[] | chức năng nghiệp vụ; gom từ Endpoint/Channel/Job |
| `DataStore` | tech, location, kind | collection, bảng, T24 APPLICATION, thư mục file, vector collection |
| `Channel` | tech, name | topic, queue, IF event, DE message |
| `ExternalSystem` | host, port, description | đích nằm ngoài các project đã scan |

**L2 Interface**
| Vertex | Thuộc tính riêng | Ghi chú |
|---|---|---|
| `Endpoint` | protocol (`http`, `ofs`, `iris`, `grpc`, `ui-route`, `deep-link`, `human-task`, `batch`, `langchain4j-tool`), httpMethod, path, pathRegex, signature | điểm vào của service |
| `ClientCall` | clientKind (`feign`, `rest-template`, `web-client`, `http-client`, `ofs`, `tif`, `callj`, `kafka-producer`, `fetch`, …), httpMethod, urlTemplate, baseUrlConfigKey, resolvedBaseUrl, resolvedHost, resolvedPort, resolvedPath, confidence | một chỗ trong code gọi ra ngoài |
| `ConfigKey` | key, value (secret được thay bằng `***`), masked, isPlaceholder, placeholderExpr, defaultValue, sourceFile, profile | theo env |
| `Bean` | framework, scope, source | DI (Spring bean, provider Angular, …) |
| `Component` | stereotype (`controller`, `service`, `repository`, `config`, `entity`, `dto`, `t24-routine`, `t24-version`, `t24-enquiry`, `bpmn-process`, `ui-component`, `screen`, …) | |

**L3 Code**
| Vertex | Ghi chú |
|---|---|
| `Module` | package, BP folder, MFE module, … |
| `Operation` | method, routine entry, GOSUB paragraph, BPMN task, hàm TS |
| `Member` | field, T24 field (STANDARD.SELECTION/LOCAL.REF), prop |
| `Library` | dependency ngoài |
| `Tag` | annotation, decorator, extension |

**Xuyên tầng**
| Vertex | Thuộc tính | Ghi chú |
|---|---|---|
| `Gap` | kind, question, askWho (`BA`, `DevOps`, `Dev`), candidates[], status (`open`, `answered`), answer | kind ∈ {`unresolved-call`, `missing-config-value`, `ambiguous-target`, `unknown-external`, `low-confidence-description`, `unread-files`, `unknown-datastore`} |

### 4.5 Edge
| Edge | Từ → Đến | Thuộc tính | Tầng |
|---|---|---|---|
| `IN_ENV` | Service/Deployment → Environment | | L0 |
| `IN_DOMAIN` | Service → Domain | source (`catalog`) | L0 |
| `IN_LAYER` | Service → Layer | source | L0 |
| `PART_OF` | Domain → System | | L0 |
| `DEPLOYED_AS` | Service → Deployment | | L1 |
| `PROVIDES_CAPABILITY` | Service → Capability | | L1 |
| `REALIZED_BY` | Capability → Endpoint/Channel/Operation | | L1 |
| `SERVICE_DEPENDS_ON` | Service → Service/ExternalSystem | env, protocol, sync, endpointsUsed[], callCount, confidence, derived:true | L1 rollup |
| `OWNS_DATA` / `READS_DATA` | Service → DataStore | derived, source (`writes`, `catalog`) | L1 rollup |
| `SERVES` | Deployment → Endpoint | | L1–L2 |
| `CONTAINS` | Service → Module → Component → Operation/Member; Service → ConfigKey | | cấu trúc |
| `EXPOSES` | Operation → Endpoint | | L2 |
| `MAKES_CALL` | Operation → ClientCall | line | L2 |
| `USES_CONFIG` | ClientCall/Operation/Component/Deployment → ConfigKey | role (`base-url`, `credential`, `tuning`, `port`, `context-path`) | L2 |
| `TARGETS` | ClientCall → Endpoint/ExternalSystem/Channel | matchedBy (`host+path`, `path`, `ofs-version`, `topic`, `manual`), confidence | L2 liên service |
| `PUBLISHES` / `SUBSCRIBES` | Operation → Channel | | L2 |
| `ACCESSES` | Operation/Component → DataStore | mode (`read`, `write`, `rw`, `admin`, `maps`) | L2 |
| `READS_CONFIG` | Component/Operation → ConfigKey | via | L2 |
| `PROVIDES` / `INJECTS` / `BEAN_TYPE` | như bản demo | via, qualifier | L2 |
| `TRIGGERS` | Component/Endpoint → Operation | event (`INPUT.ROUTINE`, `@EventListener`, `@Scheduled`, `bpmn-listener`, …) | L2 |
| `CALLS` | Operation → Operation | dispatch (`static`, `interface`, `gosub`, `call`), lines[], resolved | L3 |
| `OVERRIDES` | Operation → Operation | | L3 |
| `EXTENDS` / `IMPLEMENTS` | Component → Component | typeArgs | L3 |
| `USES_TYPE` | Operation/Component → Component | role | L3 |
| `TAGGED` | * → Tag | attributes | L3 |
| `DEPENDS_ON` | Service → Library | version, scope, transitive, via | L3 |
| `FROM_LIBRARY` | Component(ext) → Library | inferred | L3 |
| `HAS_GAP` | * → Gap | | xuyên tầng |

Bằng chứng của mô tả được lưu trong thuộc tính `evidence[]`, không tạo cạnh riêng, để graph không bị rối.

**Quy tắc gọi qua repository/thư viện kế thừa:** khi code gọi method kế thừa trên một receiver cụ thể (ví dụ `fileManagementRepository.findById`), cạnh `CALLS` trỏ tới Operation của **chính component nhận lời gọi** (`...FileManagementRepository#findById`, `kind=inherited`). Operation đó có `OVERRIDES` tới `ext:...MongoRepository#findById`. Làm vậy thì chuỗi Endpoint → DataStore không bị đứt; đây là lỗi đã gặp ở bản demo.

---

## 5. Định dạng bundle

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
  "nodes": [
    { "type": "Endpoint", "uid": "uat:robo-lang-chain:endpoint:http:GET /document/rag/process/{documentId}",
      "props": { "kind": "http", "protocol": "http", "httpMethod": "GET", "path": "/document/rag/process/{documentId}",
                 "pathRegex": "^/document/rag/process/[^/]+$", "description": "…", "evidence": ["src/main/java/…/DocumentRagController.java:15"], "confidence": "high" } }
  ],
  "edges": [
    { "type": "EXPOSES", "from": "uat:robo-lang-chain:operation:…DocumentRagController#process", "to": "uat:robo-lang-chain:endpoint:http:GET /document/rag/process/{documentId}", "props": {} }
  ],
  "gaps": [],
  "diagnostics": [{ "level": "warn", "file": "…", "message": "…" }]
}
```
- Gap vừa được ghi thành node `Gap` + cạnh `HAS_GAP`, vừa được liệt kê ở `gaps[]` để đọc nhanh.
- `env`, `projectKey`, `scanId` được writer tự điền vào từng node/edge từ khối `scan`. AI không phải lặp lại ở mỗi phần tử.

---

## 6. Hợp đồng reader profile

### 6.1 Tám mục bắt buộc (`readers/_contract.md`)
1. **Detection:** dấu hiệu nhận diện (file, thư mục, nội dung). Một project có thể khớp nhiều profile.
2. **Inventory:** đọc file nào, bỏ qua file nào (output build, file sinh tự động, vendor) và lý do; thứ tự đọc; cách chia module để giao cho subagent.
3. **Bảng mapping:** native artifact → vertex chuẩn + `kind` + công thức `qualifiedName`.
4. **Công thức trích xuất** cho: Endpoint, ClientCall, DataStore + mode, Channel, CALLS, TRIGGERS, Bean/DI, Member.
5. **Config theo env:** file nào ứng với env nào, cách giải placeholder, nguồn port/contextPath/base URL, key nào là secret.
6. **Gợi ý mô tả:** "trách nhiệm" và "capability" nên diễn đạt thế nào với loại project này; các thuật ngữ nghiệp vụ hay gặp.
7. **Bẫy thường gặp.**
8. **Conformance:** fixture trong `templates/fixtures/<profile>/` + trích đoạn bundle kỳ vọng + rule riêng (`validate-bundle --profile <x>`).

### 6.2 Profile `spring-boot`
| Native | Chuẩn |
|---|---|
| Maven/Gradle project có `@SpringBootApplication` | `Service` (+ `DEPENDS_ON` Library) |
| package | `Module` |
| class/interface/enum/record | `Component` (`stereotype` lấy từ `@RestController`, `@Service`, `@Repository`, `@Configuration`, `@Document`/`@Entity`, dto) |
| method | `Operation` |
| `@*Mapping` (+ `@RequestMapping` của class + `server.servlet.context-path`) | `Endpoint` http; `pathRegex` sinh từ template |
| `@Tool` (langchain4j), `@KafkaListener`, `@JmsListener`, `@Scheduled` | `Endpoint` (`langchain4j-tool`) / `SUBSCRIBES` Channel / `TRIGGERS` |
| `@FeignClient(url=…, name=…)` + method mapping; `RestTemplate`/`WebClient`/`RestClient` với URL ghép từ `@Value`/`@ConfigurationProperties` | `ClientCall` + `USES_CONFIG {role:base-url}` |
| `KafkaTemplate.send(topic)` | `PUBLISHES` Channel |
| Spring Data repository + entity | `ACCESSES` DataStore (collection/bảng lấy từ `@Document(collection)`/`@Table`, mặc định theo quy ước đặt tên) |
| `@Bean`, stereotype, inject qua constructor/field/param | `Bean`, `PROVIDES`, `INJECTS`, `BEAN_TYPE` |
| `application.yml/properties`, `application-<env>.yml` | `ConfigKey` theo env; `server.port`, `server.servlet.context-path` → `Deployment` |

Bẫy thường gặp: Lombok sinh ra method không thấy trong source (không tạo Operation cho getter/setter); lời gọi qua interface (dùng `OVERRIDES`); lời gọi method kế thừa của repository (xem 4.5); URL ghép chuỗi trong code (ghi `urlTemplate` kèm `confidence=medium`); service discovery (`lb://service-name`) thì khớp theo tên service, không theo host.

### 6.3 Profile `t24` (cộng với `java-generic` cho TAFJ extension)
Repo T24 có đủ cả: routine jBC/InfoBasic; record VERSION/ENQUIRY/APPLICATION (STANDARD.SELECTION, LOCAL.TABLE, EB.API…); integration (OFS.SOURCE, IF.INTEGRATION.FLOW/IF events, IRIS/TIF); TAFJ/Java extension.

| Native | Chuẩn |
|---|---|
| Instance T24 (một env) | `Service` (`techStack=[t24, tafj]`); chia theo product bằng `Module` |
| Thư mục BP / product (FT, AC, AA, ST…) | `Module` |
| `SUBROUTINE X(...)` | `Component` `t24-routine` + `Operation` entry (`kind=routine-entry`) |
| Nhãn `GOSUB` | `Operation` `kind=paragraph`; `CALLS {dispatch:gosub}` |
| `CALL Y` | `CALLS {dispatch:call}` tới entry của Y (giải tên qua EB.API nếu có) |
| `CALLJ` / gọi Java | `CALLS` sang Operation của profile java-generic |
| VERSION `APP,NAME` | `Component` `t24-version` + `Endpoint` `ofs` (`signature=APP,NAME`), vì OFS vào qua VERSION |
| Hook của VERSION (INPUT/VALIDATION/AUTH/CHECK.REC/AFTER.UNAU… routine) | `TRIGGERS {event:<tên field hook>}` VERSION → routine entry |
| ENQUIRY | `Component` `t24-enquiry` + `Endpoint` `ofs` (`signature=ENQ <NAME>`); FILE.NAME → `ACCESSES {mode:read}` |
| APPLICATION / file `F.<APP>` | `DataStore` `t24-application`; field lấy từ STANDARD.SELECTION/LOCAL.REF → `Member` |
| `F.READ`/`CACHE.READ`/`EB.READ…`/`F.READU` | `ACCESSES` read (read-lock) ; `F.WRITE`/`F.DELETE` → write |
| IRIS / REST API provider | `Endpoint` `iris` (method + path) |
| IF.INTEGRATION.FLOW / IF event, DE message | `Channel` + `PUBLISHES` |
| Gọi ra ngoài qua TIF/HTTP/CALLJ client | `ClientCall` |
| OFS.SOURCE | `ConfigKey` (nguồn OFS được phép) + `Endpoint` kênh OFS tổng |
| TSA.SERVICE / BATCH (COB) | `Endpoint` `batch` + `TRIGGERS` các job routine |
| `tafj.properties`, environment | `ConfigKey` theo env |

Khớp liên hệ thống: ClientCall phía Spring/BPM có `clientKind=ofs` và message `APP,VERSION/I/PROCESS` sẽ khớp `uat:t24:endpoint:ofs:APP,VERSION` (`matchedBy=ofs-version`). Gọi IRIS thì khớp theo method + path như http.

Gợi ý mô tả: capability T24 diễn đạt theo nghiệp vụ ngân hàng (ví dụ "Hạch toán chuyển khoản nội bộ"), kèm product và APPLICATION liên quan.

Bẫy thường gặp: hằng số và common block (`I_COMMON`, `I_EQUATE`) không phải logic, chỉ đọc để giải tên; tên routine trong record có thể khác tên file (giải qua EB.API); VERSION có thể không có hook nào (vẫn là Endpoint).

> Bảng mapping T24 ở trên **phải được kiểm chứng** trên một fixture rút từ repo T24 thật trước khi đóng profile. Định dạng export record (DL.DEFINE hay text) sẽ quyết định phần Inventory.

### 6.4 Hướng mapping các profile sau này (chưa trong phạm vi)
| Profile | Service | Endpoint | ClientCall | Khác |
|---|---|---|---|---|
| bpm | process application | user task (`human-task`), start event/message (`http`/`channel`) | service task / connector | process = Component, task = Operation, listener = TRIGGERS |
| micro-frontend | remote/host app | route (`ui-route`), exposed module | fetch/axios/BFF client | component UI = Component |
| mobile | app | màn hình/deep link (`deep-link`) | gọi API | màn hình = Component |

---

## 7. Lệnh và các pha

### 7.1 `ingest <repoPath> --project <key> --env <dev|uat>`
| Pha | Việc làm | Điều kiện qua pha |
|---|---|---|
| 0. Chuẩn bị | Tạo `git worktree` cho branch ứng với env (ánh xạ env → branch lấy từ catalog), ghi `commitSha`; nạp catalog và `bundle.prev.json` | Đúng branch, worktree sạch |
| 1. Detection + Inventory | Chạy Detection của mọi profile; lập `inventory.json` theo các profile khớp; chia module | Có số liệu độ phủ; mọi file bị bỏ qua đều có lý do |
| 2. Cấu trúc (L3) | Module, Component, Operation, Member, Tag, Library, CALLS, OVERRIDES, EXTENDS/IMPLEMENTS, USES_TYPE, TRIGGERS | Bundle một phần cho từng module |
| 3. Giao tiếp (L2) | Endpoint, ClientCall, Channel, DataStore + ACCESSES, Bean/DI | ClientCall nào cũng có `urlTemplate` hoặc Gap `unresolved-call` |
| 4. Config + Deployment | Đọc config của env; tạo ConfigKey, ẩn secret, giải placeholder; tạo Deployment (port, contextPath); điền `resolved*` cho ClientCall | Placeholder thiếu giá trị thì sinh Gap `missing-config-value` (askWho=DevOps) |
| 5. Mô tả | Từ dưới lên: Operation (entry, handler, method public có logic) → Component → Endpoint → Capability → thẻ Service; ghi `catalog-proposal.yaml` | Mọi mô tả có `evidence` + `confidence`; mô tả có confidence thấp sinh Gap |
| 6. Ghép + validate | `merge-bundles` → `validate-bundle --profile …` → `diff-bundle` | Validate pass (lặp sửa cho đến khi pass); có `diff.md` |
| 7. Nạp | `bundle-to-cypher` → nạp qua MCP theo thứ tự: đảm bảo schema → node → edge → dọn node cũ theo `(env, projectKey, scanId)` → đếm lại | Số node/edge trong DB khớp bundle; lô nào lỗi thì **không** dọn |

**Repo lớn:** pha 2–4 chạy song song, mỗi module một subagent. Mỗi subagent nhận: danh sách file của module, reader profile, `schema.md` và bảng uid; trả về `bundle.part-<module>.json`. Agent chính chỉ gộp và làm pha 5 ở tầng Capability/Service. Lời gọi `CALLS` sang module khác dùng uid dự kiến; `validate` sẽ bắt các cạnh treo sau khi gộp.

### 7.2 `link --env <env>`
1. Lấy mọi `ClientCall` của env chưa có `TARGETS` (hoặc có `matchedBy != manual`).
2. Khớp theo thứ tự ưu tiên:
   1. `resolvedHost:resolvedPort` ∈ `Deployment.hosts`/port, và `contextPath + path` khớp `Endpoint.pathRegex`, thì `matchedBy=host+path`, `confidence=high`.
   2. Tên service discovery (`lb://x`, Feign `name`) = `Service.name`, và path khớp, thì `confidence=high`.
   3. Chỉ path khớp, thì `matchedBy=path`, `confidence=medium` nếu có đúng 1 ứng viên.
   4. OFS `APP,VERSION` thì `ofs-version`; topic/queue thì `topic`.
3. Có nhiều ứng viên: tạo Gap `ambiguous-target` với `candidates[]` (Service, Deployment, hosts) và câu hỏi dạng *"Lời gọi `<urlTemplate>` từ `<Service>` trỏ tới host/IP nào?"*, askWho=BA hoặc DevOps.
4. Không có ứng viên: trỏ tới `ExternalSystem` (theo host) hoặc tạo Gap `unknown-external`.
5. Điền `Deployment.hosts[]` từ `resolvedHost` của các ClientCall đã khớp chắc chắn.
6. Tính lại rollup: xóa các cạnh `derived:true` của env, sinh lại `SERVICE_DEPENDS_ON`, `OWNS_DATA`, `READS_DATA`.
7. Đọc `gapAnswers` trong catalog (mục 9): mục nào khớp ClientCall thì tạo `TARGETS {matchedBy:manual}` và đánh dấu Gap tương ứng `status=answered`.

### 7.3 `report --env <env>`
Xuất `code-graph-workspace/<env>/topology-report.md`:
- Danh sách service theo Domain/Layer, kèm thẻ service (summary, responsibilities, capabilities, độ phủ)
- Ma trận `SERVICE_DEPENDS_ON` (protocol, sync, số endpoint dùng)
- Bảng dữ liệu: DataStore → owner/readers
- Gap đang mở, gom theo askWho
- Thay đổi so với report trước (service/endpoint/phụ thuộc mới hoặc mất)

Kèm `studio-queries.md`: toàn cảnh L1, theo domain, một service từ L1 xuống L2, chuỗi Endpoint → DataStore, các Gap.

---

## 8. Hướng dẫn mô tả (`describe-guide.md`)
- Ngôn ngữ: tiếng Việt cho `description`/`summary`; giữ nguyên thuật ngữ kỹ thuật tiếng Anh; `businessTerms[]` ghi cả tiếng Việt lẫn tiếng Anh nếu có.
- Operation: 1–2 câu: làm gì, đọc/ghi gì, gọi đi đâu. Không mô tả getter/setter/hàm tiện ích tầm thường.
- Component: 1–3 câu: vai trò trong service, nhận gì, giao việc cho ai.
- Endpoint: input chính, kết quả, tác dụng phụ (ghi DB, gọi hệ thống khác), điều kiện lỗi chính.
- Capability: gom các Endpoint/Channel/Job phục vụ cùng một mục đích nghiệp vụ; tên dạng động từ + đối tượng ("Xử lý RAG tài liệu PDF").
- Thẻ Service: `summary` 2–3 câu; `responsibilities` 3–7 ý; `notResponsibleFor` gồm những việc dễ bị gán nhầm (ví dụ "không lưu file gốc lâu dài"); `businessTerms`.
- Mỗi mô tả có `evidence[]` (uid hoặc `file:line`). Nếu phải suy luận, ghi `confidence=low` và sinh Gap `low-confidence-description`.
- Cấm: bịa tên hệ thống, URL hay nghiệp vụ không thấy trong code/config; chép secret hoặc dữ liệu cá nhân vào mô tả.
- Mô tả có `descriptionSource=human` (sửa tay trong DB hoặc catalog) **không bao giờ bị ghi đè** ở lần scan sau.

---

## 9. Config, môi trường và secret
- Ánh xạ env → branch và env → file profile lấy từ `system-catalog.yaml`:
  ```yaml
  system: { name: core-ecosystem }
  environments:
    dev: { database: CodeGraph }
    uat: { database: CodeGraph }
  services:
    robo-lang-chain:
      repo: D:/IdeaProjects/robo-lang-chain
      readerProfiles: [spring-boot]
      branches: { dev: develop, uat: uat }
      domain: document-ai
      layer: core-service
      ownerTeam: ai-platform
  gapAnswers:                      # nguồn bền vững cho câu trả lời của Gap; link đọc mục này
    - env: uat
      clientCall: "uat:a-service:clientcall:com.x.BClient#get->feign:GET /b/items/{id}"
      answer: { targetService: b-service, host: 10.1.2.3 }
      answeredBy: BA
  ```
  Người trả lời Gap sẽ ghi vào `gapAnswers` (không sửa trực tiếp trong DB). `link` dựng `TARGETS {matchedBy:manual}` từ mục này, nên ingest lại cũng không mất.
- Thứ tự giải giá trị (Spring): `application-<env>` > `application` > default trong `${KEY:default}`. Giá trị lấy từ biến môi trường không có trong repo: `isPlaceholder=true` và tạo Gap `missing-config-value`.
- Secret: key khớp `(?i)(password|passwd|secret|token|apikey|api-key|credential|private|key-store|uri|url).*` **và** giá trị có dạng chứa thông tin xác thực (`user:pass@`, chuỗi dài ngẫu nhiên…) thì value thay bằng `***`, `masked=true`. Riêng URL: giữ scheme/host/port/path, bỏ phần userinfo và query. `validate-bundle` quét lại toàn bộ bundle theo các mẫu secret phổ biến; gặp là fail.
- Không đọc file `.env`, keystore, hay file nằm trong `.gitignore` chứa secret.

---

## 10. Validate (`validate-bundle.mjs`)
**Rule chung**
1. Bundle đúng `bundle.schema.json`; `schemaVersion` được hỗ trợ.
2. uid duy nhất và đúng công thức theo loại; `env`, `projectKey` khớp khối `scan`.
3. Không có cạnh treo: `from`/`to` có trong bundle, hoặc là uid dùng chung (`ext:`, `lib:`, `tag:`, `ds:`, `ch:`, `sys:`, L0), hoặc là Endpoint của project khác (chỉ cho phép trong `TARGETS`).
4. Có đúng 1 `Service` và 1 `Deployment` cho mỗi `(env, projectKey)`.
5. `Service` có ≥1 Endpoint, Channel hoặc Gap; mọi `ClientCall` có `urlTemplate` hoặc Gap.
6. Mọi node có `description` thì phải có `evidence` + `confidence`; mọi Component có stereotype controller/service, Endpoint và Capability đều phải có description.
7. Không có chuỗi nào khớp mẫu secret.
8. Cảnh báo (không fail): độ phủ < 95%, Operation không ai gọi và không phải entry, Capability chỉ có 1 Endpoint.

**Rule theo profile:** khai báo ở mục 8 của mỗi reader profile (ví dụ spring-boot: mọi `@*Mapping` đều có Endpoint; t24: mọi VERSION có Endpoint ofs, mọi routine được hook trỏ tới đều tồn tại).

---

## 11. Nạp và tính idempotent
- `bundle-to-cypher` sinh các file `load-batches/NNN-<phase>.cypher` theo thứ tự: `000-schema` (`CREATE ... IF NOT EXISTS`, index) → `1xx-nodes-<Type>` → `2xx-edges-<Type>` → `900-cleanup`.
- Node được upsert: `UNWIND $rows AS r MERGE (n:<Type> {uid:r.uid}) SET n += r.props`. Nếu `descriptionSource='human'` thì giữ nguyên `description` cũ.
- Edge: xóa các cạnh **đi ra** từ node của `(env, projectKey)` có `scanId` khác lần này, sau đó `MERGE` cạnh theo `(from, type, to)`. Vì vậy các cạnh `TARGETS` của project vừa ingest lại sẽ mất, kể cả cạnh `matchedBy=manual`; câu trả lời của Gap được giữ trong catalog/Gap nên `link` dựng lại được. Sau mỗi lần `ingest` phải chạy lại `link --env <env>`, và skill sẽ nhắc việc này ở cuối pha 7.
- Mỗi lô tối đa khoảng 300 phần tử để vừa một lần gọi MCP. Lô nào lỗi thì dừng, ghi lại vị trí; chạy lại sẽ tiếp tục từ lô đó.
- `900-cleanup` xóa node có `env`, `projectKey` khớp và `scanId` cũ. Node dùng chung không bao giờ bị xóa ở bước này; chúng được dọn định kỳ bằng lệnh riêng (node dùng chung không còn cạnh nào).
- Sau khi nạp, đếm theo type rồi so với bundle; lệch thì báo lỗi.

---

## 12. Xử lý lỗi
| Tình huống | Cách xử lý |
|---|---|
| File không đọc hoặc không hiểu được | `diagnostics` + Gap `unread-files` (gom theo module); không dừng cả lần scan |
| Không giải được tên routine/method được gọi | `CALLS` tới `ext:`/placeholder với `resolved=false` |
| Branch của env không tồn tại | Dừng ở pha 0, báo người dùng |
| Validate fail | Quay lại sửa bundle (không nạp) |
| Lỗi giữa chừng khi nạp | Dừng, không cleanup; chạy lại tiếp tục từ lô lỗi |
| MCP ArcadeDB không kết nối được | Dừng ở pha 7; bundle vẫn còn để nạp sau |

---

## 13. Kiểm thử và nghiệm thu
1. **Script:** unit test cho `validate-bundle`, `merge-bundles`, `bundle-to-cypher`, `diff-bundle` (`node --test`), với bundle hợp lệ và các bundle lỗi cố ý (uid trùng, cạnh treo, secret).
2. **Fixture theo profile:** `templates/fixtures/spring-boot/` (controller → service → repository; Feign client gọi sang service khác; `application-uat.yml`) và `templates/fixtures/t24/` (một VERSION có hook, một routine có `CALL` và `F.READ/F.WRITE`, một ENQUIRY, một OFS.SOURCE). Skill chạy trên fixture phải ra đúng các phần tử trong bundle kỳ vọng.
3. **Nghiệm thu trên project thật:**
   - Ingest `robo-lang-chain` với env `dev` (branch `master`) và nạp vào `CodeGraph` (thay cho dữ liệu demo hiện có).
   - Query từ path `/document/rag/process/{documentId}` ra được Service robo-lang-chain, thẻ service, chuỗi gọi tới `ds:dev:mongodb:…fileManagementDocument` và `ds:dev:qdrant:documents`.
   - Ingest lần 2 không đổi code thì diff rỗng, số node không đổi; xóa một class rồi ingest lại thì node của class đó biến mất.
4. **Nghiệm thu link:** dùng hai fixture Spring (A gọi B qua Feign với base URL trong `application-uat.yml`) để kiểm tra `TARGETS` và `SERVICE_DEPENDS_ON`; thêm fixture thứ ba trùng path để sinh Gap `ambiguous-target` kèm câu hỏi về host/IP.

---

## 14. Chuyển từ dữ liệu demo
Dữ liệu demo hiện có trong `CodeGraph` (uid chưa có env, chưa có ClientCall/Deployment) sẽ bị xóa trước lần ingest thật đầu tiên. Schema sẽ được tạo lại theo mục 4.

## 15. Việc để sau
- Sub-project GraphRAG: sinh embedding cho `description`, tạo index `LSM_VECTOR`, retriever dạng hybrid search + mở rộng theo graph (L1 → L2 → L3), MCP tool cho agent SA.
- Database `prod`/`pilot`.
- Reader profile cho bpm, micro-frontend, mobile.
- Kiểm chứng profile T24 trên repo thật (định dạng export record).
