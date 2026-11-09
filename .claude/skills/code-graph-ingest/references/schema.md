# Mô hình graph chuẩn (schema)

Tài liệu này là **nguồn chuẩn** cho mọi node, edge, thuộc tính và công thức uid. Reader profile nào cũng phải map native artifact vào đúng mô hình này. Không tự đặt thêm loại vertex/edge; đặc thù công nghệ đi vào `kind` và `nativeType`.

Đọc kèm: `bundle-format.md` (cách ghi ra file), `describe-guide.md` (mô tả), `config-and-env.md` (ConfigKey, Deployment), `cross-service.md` (ClientCall, link).

---

## 1. Nguyên tắc

1. Mọi vertex kế thừa supertype `CodeNode`; unique index trên `uid`, index trên `env`, `projectKey`.
2. **Không tạo loại vertex riêng cho từng công nghệ.** Ví dụ Java class là `Component` với `kind=java-class`; T24 VERSION là `Component` với `kind=t24-version`.
3. Node và edge do một lần scan sinh ra đều mang `scanId`, `env`, `projectKey`. **AI không ghi 3 trường này vào từng phần tử**: writer (`bundle-to-cypher`) tự điền từ khối `scan` của bundle.
4. Node dùng chung theo env (`ds:`, `ch:`, `sys:`) có `env` nhưng `projectKey = null`. Node dùng chung không theo env (`ext:`, `lib:`, `tag:`, L0 `env:`/`domain:`/`layer:`/`system:`) không có cả hai.
5. Mô tả ở tầng trên chỉ được tổng hợp từ tầng dưới cộng với bằng chứng trong code. Node nào có `description` thì phải có `evidence[]` + `confidence` (xem `describe-guide.md`).
6. **Hình dạng phần tử (ruling R6):** node là đúng `{type, uid, props}`; edge là đúng `{type, from, to, props}`. Mọi thuộc tính khác (kể cả `external`, `kind`, `name`, …) nằm **trong `props`**. Thêm key ở cấp ngoài là lỗi `R1-shape`.

---

## 2. Công thức uid

| Loại | Công thức | Ví dụ |
|---|---|---|
| Service (**ruling R2**) | `<env>:<projectKey>:service:<projectKey>` | `uat:robo-lang-chain:service:robo-lang-chain` |
| Module, Component, Operation, Member, Bean, ClientCall | `<env>:<projectKey>:<kind-group>:<qualifiedName>` | `uat:robo-lang-chain:operation:com.thanglv.robolangchain.controller.ChatController#chat` |
| Endpoint | `<env>:<projectKey>:endpoint:<protocol>:<signature>` | `uat:robo-lang-chain:endpoint:http:GET /document/rag/process/{documentId}`, `uat:t24:endpoint:ofs:FUNDS.TRANSFER,ACTR` |
| ConfigKey | `<env>:<projectKey>:config:<key>` | `uat:robo-lang-chain:config:nas.path` |
| Deployment | `<env>:<projectKey>:deployment` | `uat:robo-lang-chain:deployment` |
| Capability | `<env>:<projectKey>:capability:<slug>` | `uat:robo-lang-chain:capability:document-rag` |
| Type/operation ngoài | `ext:<fqn>[#op]` | `ext:org.springframework.data.mongodb.repository.MongoRepository#save` |
| Thư viện | `lib:<ecosystem>:<coordinate>` | `lib:maven:dev.langchain4j:langchain4j-qdrant` |
| Tag/annotation | `tag:<language>:<fqn>` | `tag:java:org.springframework.web.bind.annotation.GetMapping` |
| DataStore | `ds:<env>:<tech>:<location>` | `ds:uat:mongodb:app_db.fileManagementDocument`, `ds:uat:t24:F.CUSTOMER` |
| Channel | `ch:<env>:<tech>:<name>` | `ch:uat:kafka:payment.created` |
| Hệ thống ngoài | `sys:<env>:<name>` | `sys:uat:ollama` |
| Gap của project (**ruling R12**) | `gap:<env>:<projectKey>:<kind>:<hash>` | `gap:uat:a-service:missing-config-value:3f9a0c1d22be` |
| Gap của link (**ruling R12**) | `gap:<env>:system:<kind>:<hash>` | `gap:uat:system:ambiguous-target:3f9a0c1d22be` |
| L0 | `env:<name>`, `domain:<slug>`, `layer:<slug>`, `system:<slug>` | `env:uat`, `domain:document-ai` |

### 2.1 Quy tắc chi tiết

- `<kind-group>` ∈ {`module`, `component`, `operation`, `member`, `bean`, `clientcall`}.
- `qualifiedName`:
  - Module: tên package/thư mục, ví dụ `com.example.a.controller`.
  - Component: FQN của type, ví dụ `com.example.a.controller.ItemProxyController`. Nested class dùng `$`: `com.x.Outer$Inner`.
  - Operation: `<FQN component>#<tên method>`, **không** kèm chữ ký. Overload thứ 2, 3… thêm hậu tố `~2`, `~3` theo thứ tự xuất hiện trong file (overload đầu tiên không có hậu tố); chữ ký thật để ở `props.signature` (ví dụ `getItem(String)`).
  - Member: `<FQN component>#<tên field>`.
  - Bean: tên bean (Spring mặc định: tên class viết thường chữ đầu, `@Bean` thì tên method; có `@Qualifier`/tên tường minh thì dùng tên đó).
  - ClientCall: `<qualifiedName của Operation>-><clientKind>:<httpMethod> <urlTemplate>`. Không có httpMethod (OFS, producer) thì bỏ phần method: `com.x.T24Client#transfer->ofs:FUNDS.TRANSFER,ACTR`, `com.x.PaymentPublisher#publish->kafka-producer:payment.created`. Trùng thì thêm `~2`, `~3` theo thứ tự xuất hiện.
- Endpoint `signature`: http là `<METHOD> <path>` (method viết hoa, `path` theo **ruling R16**: không gồm context-path); ofs là `APP,VERSION` hoặc `ENQ <NAME>`; langchain4j-tool là tên tool.
- **Không dùng số dòng trong uid**, để sửa code ở chỗ khác không làm uid đổi.
- `projectKey` (**ruling R12, validator rule `R1-projectKey`**): không được là `system`, `__system__`, và không chứa `:`. `__system__` dành riêng cho link bundle.
- `<hash>` của Gap: 12 ký tự hex đầu của `sha1(<uid của node mà Gap gắn vào>)`; Gap gom theo module (`unread-files`) thì hash trên `<uid của Module>`. Cùng chủ thể và cùng kind thì cùng uid ở mọi lần scan.
  ```bash
  node -e "console.log(require('crypto').createHash('sha1').update(process.argv[1]).digest('hex').slice(0,12))" "<uid>"
  ```
- Gap project (`gap:<env>:<projectKey>:…`) thuộc project đó: được gắn `projectKey` khi nạp và **bị dọn khi ingest lại** project. Gap `gap:<env>:system:…` **chỉ do `link` sinh ra**; ingest không bao giờ ghi loại này.
- `ext:` chỉ dùng cho `Component` (type ngoài, ví dụ `ext:org.springframework.data.mongodb.repository.MongoRepository`) hoặc `Operation` (method ngoài, `ext:<fqn>#<op>`), và bắt buộc `props.external = true`. **Một uid `ext:` phải luôn là cùng một loại vertex ở mọi project** (type → `Component`, `#op` → `Operation`); nếu một project ghi `Component` và project khác ghi `Operation` cho cùng uid thì unique index từ chối cả lô nạp.
- Node dùng chung (`ext:`, `lib:`, `tag:`, `ds:`, `ch:`, `sys:`, L0) mà bundle có cạnh tới thì **phải có mặt trong `nodes[]`** của bundle đó: lô edge dùng `MATCH` hai đầu, thiếu node thì cạnh không được tạo.

---

## 3. Thuộc tính chung của `CodeNode` (`props`)

| Thuộc tính | Ý nghĩa |
|---|---|
| `kind` | loại cụ thể theo công nghệ: `java-class`, `java-interface`, `java-record`, `java-enum`, `java-method`, `inherited`, `java-field`, `java-package`, `http`, `feign`, `t24-version`, … |
| `nativeType` | tên gốc của công nghệ (`class`, `interface`, `record`, `VERSION`, …) hoặc kiểu Java của Member |
| `name`, `qualifiedName` | tên ngắn, tên đầy đủ (khớp phần cuối uid) |
| `language` | `java`, `jbc`, `typescript`, … |
| `filePath`, `lineStart`, `lineEnd` | đường dẫn tương đối từ gốc repo, dòng bắt đầu/kết thúc |
| `contentHash` | tuỳ chọn; hash nội dung để diff |
| `external` | `true` cho node `ext:` (và có thể cho `lib:`/`tag:`); nằm trong `props` (ruling R6) |
| `description`, `descriptionSource` (`ai`, `human`, `doc`), `evidence[]`, `confidence` (`high`, `medium`, `low`) | xem `describe-guide.md` |
| `embedding` | để trống (thuộc sub-project GraphRAG) |
| `scanId`, `env`, `projectKey` | **không ghi**; writer tự điền |

---

## 4. Vertex theo tầng

### L0 Landscape
| Vertex | Thuộc tính riêng | Ghi chú |
|---|---|---|
| `System` | name | toàn hệ sinh thái (thường chỉ có 1), `system:<slug>` |
| `Environment` | name (`dev`, `uat`), database (`CodeGraph`) | `env:<name>`; mỗi bundle có node này và cạnh `IN_ENV` |
| `Domain` | name, description | chỉ lấy từ catalog đã duyệt |
| `Layer` | name (`channel-mobile`, `micro-frontend`, `bff-gateway`, `core-service`, `integration`, `bpm`, `core-banking`) | chỉ lấy từ catalog đã duyệt |

### L1 Service
| Vertex | Thuộc tính riêng | Ghi chú |
|---|---|---|
| `Service` | summary, responsibilities[], notResponsibleFor[], businessTerms[], techStack[], ownerTeam, readerProfiles[], repoUrl, coverage {filesRead, filesTotal} | thẻ service, nút đầu tiên agent SA đọc. `coverage` **không cần ghi**: writer chép từ `scan.coverage` |
| `Deployment` | port, contextPath, hosts[], branch, commitSha, profilesActive[] | một Service chạy ở một env. `contextPath` lấy từ `server.servlet.context-path` (ruling R16); `hosts[]` để `[]` lúc ingest nếu config của chính service không cho biết, `link` sẽ điền |
| `Capability` | name, description, businessTerms[] | chức năng nghiệp vụ; gom từ Endpoint/Channel/Job |
| `DataStore` | tech, location, kind | collection, bảng, T24 APPLICATION, thư mục file, vector collection |
| `Channel` | tech, name | topic, queue, IF event, DE message |
| `ExternalSystem` | host, port, description | đích nằm ngoài các project đã scan |

### L2 Interface
| Vertex | Thuộc tính riêng | Ghi chú |
|---|---|---|
| `Endpoint` | protocol (`http`, `ofs`, `iris`, `grpc`, `ui-route`, `deep-link`, `human-task`, `batch`, `langchain4j-tool`), httpMethod, path, pathRegex, signature | điểm vào của service. **Ruling R16:** `path` = `@RequestMapping` của class + mapping của method, **không gồm** servlet context-path; `pathRegex` sinh từ `path` |
| `ClientCall` | clientKind, httpMethod, urlTemplate, baseUrlConfigKey, resolvedBaseUrl, resolvedHost, resolvedPort, resolvedPath, **discoveryName**, **signature**, **topic**, confidence | một chỗ trong code gọi ra ngoài. Ba trường in đậm theo **ruling R15**; giá trị `null` nghĩa là "không biết / không áp dụng" |
| `ConfigKey` | key, value (secret thay bằng `***`), masked, isPlaceholder, placeholderExpr, defaultValue, sourceFile, profile | theo env, xem `config-and-env.md` |
| `Bean` | framework, scope, source | DI (Spring bean, provider Angular, …) |
| `Component` | stereotype (`controller`, `service`, `repository`, `config`, `entity`, `dto`, `feign-client`, `t24-routine`, `t24-version`, `t24-enquiry`, `bpmn-process`, `ui-component`, `screen`, …) | |

`pathRegex` sinh từ `path`: escape ký tự đặc biệt, mỗi `{x}` (kể cả `{x:regex}` của Spring) thay bằng `[^/]+`, bọc `^…$`. Ví dụ `/items/{id}` → `^/items/[^/]+$`; `/document/rag/process/{documentId}` → `^/document/rag/process/[^/]+$`.

#### ClientCall: ý nghĩa từng trường (ruling R15)
| Trường | Ý nghĩa | Ví dụ |
|---|---|---|
| `clientKind` | `feign`, `rest-template`, `web-client`, `rest-client`, `http-client`, `ofs`, `tif`, `callj`, `kafka-producer`, `jms-producer`, `fetch`, … | `feign` |
| `httpMethod` | method HTTP viết hoa, `null` nếu không phải HTTP | `GET` |
| `urlTemplate` | phần URL viết trong code, **không** gồm base URL lấy từ config; URL tuyệt đối viết cứng thì ghi nguyên | `/items/{id}`, `http://api.partner.com/v1/x` |
| `baseUrlConfigKey` | key config chứa base URL | `b-service.url` |
| `resolvedBaseUrl` | giá trị base URL ở env này (đã bỏ userinfo/query) | `http://10.1.2.3:8081/b` |
| `resolvedHost`, `resolvedPort` | host/port tách từ base URL (port mặc định 80/443 theo scheme) | `10.1.2.3`, `8081` |
| `resolvedPath` | path của base URL + `urlTemplate` | `/b/items/{id}` |
| `discoveryName` | tên service discovery: Feign `name`/`value`, `lb://<name>`, tên k8s service | `b-service` |
| `signature` | OFS `APP,VERSION` khi `clientKind=ofs` | `FUNDS.TRANSFER,ACTR` |
| `topic` | topic/queue của lời gọi producer (`*-producer`) | `payment.created` |

### L3 Code
| Vertex | Ghi chú |
|---|---|
| `Module` | package, BP folder, MFE module, … |
| `Operation` | method, routine entry, GOSUB paragraph, BPMN task, hàm TS. `props.entry=true` cho điểm vào không có ai gọi (ví dụ `main`) |
| `Member` | field, T24 field (STANDARD.SELECTION/LOCAL.REF), prop |
| `Library` | dependency ngoài |
| `Tag` | annotation, decorator, extension |

### Xuyên tầng
| Vertex | Thuộc tính | Ghi chú |
|---|---|---|
| `Gap` | kind, question, askWho (`BA`, `DevOps`, `Dev`), candidates[], status (`open`, `answered`), answer | kind ∈ {`unresolved-call`, `missing-config-value`, `ambiguous-target`, `unknown-external`, `low-confidence-description`, `unread-files`, `unknown-datastore`} |

---

## 5. Edge

| Edge | Từ → Đến | Thuộc tính | Tầng |
|---|---|---|---|
| `IN_ENV` | Service/Deployment → Environment | | L0 |
| `IN_DOMAIN` | Service → Domain | source (`catalog`) | L0 |
| `IN_LAYER` | Service → Layer | source | L0 |
| `PART_OF` | Domain → System | | L0 |
| `DEPLOYED_AS` | Service → Deployment | | L1 |
| `PROVIDES_CAPABILITY` | Service → Capability | | L1 |
| `REALIZED_BY` | Capability → Endpoint/Channel/Operation | | L1 |
| `SERVICE_DEPENDS_ON` | Service → Service/ExternalSystem | env, protocol, sync, endpointsUsed[], callCount, confidence, derived:true | L1 rollup (chỉ `link` sinh) |
| `OWNS_DATA` / `READS_DATA` | Service → DataStore | derived, source (`writes`, `catalog`) | L1 rollup (chỉ `link` sinh) |
| `SERVES` | Deployment → Endpoint | | L1–L2 |
| `CONTAINS` | Service → Module → Component → Operation/Member; Service → ConfigKey | | cấu trúc |
| `EXPOSES` | Operation → Endpoint | | L2 |
| `MAKES_CALL` | Operation → ClientCall | line | L2 |
| `USES_CONFIG` | ClientCall/Operation/Component/Deployment → ConfigKey | role (`base-url`, `credential`, `tuning`, `port`, `context-path`) | L2 |
| `TARGETS` | ClientCall → Endpoint/ExternalSystem/Channel | matchedBy (`host+path`, `path`, `ofs-version`, `topic`, `manual`, `host`), confidence | L2 liên service (chỉ `link` sinh) |
| `PUBLISHES` / `SUBSCRIBES` | Operation → Channel | | L2 |
| `ACCESSES` | Operation/Component → DataStore | mode (`read`, `write`, `rw`, `admin`, `maps`) | L2 |
| `READS_CONFIG` | Component/Operation → ConfigKey | via | L2 |
| `PROVIDES` | Component → Bean | via (`stereotype`, `bean-method`, `feign-client`, `spring-data-repository`, …) | L2 |
| `INJECTS` | Component → Bean | via (`constructor`, `field`, `param`), qualifier | L2 |
| `BEAN_TYPE` | Bean → Component | | L2 |
| `TRIGGERS` | Component/Endpoint → Operation | event (`INPUT.ROUTINE`, `@EventListener`, `@Scheduled`, `bpmn-listener`, …) | L2 |
| `CALLS` | Operation → Operation | dispatch (`static`, `interface`, `gosub`, `call`), lines[], resolved | L3 |
| `OVERRIDES` | Operation → Operation | | L3 |
| `EXTENDS` / `IMPLEMENTS` | Component → Component | typeArgs | L3 |
| `USES_TYPE` | Operation/Component → Component | role (`param`, `return`, `field`, `type-arg`) | L3 |
| `TAGGED` | * → Tag | attributes (map) | L3 |
| `DEPENDS_ON` | Service → Library | version, scope, transitive, via | L3 |
| `FROM_LIBRARY` | Component(ext) → Library | inferred | L3 |
| `HAS_GAP` | * → Gap | | xuyên tầng |

Bằng chứng của mô tả lưu trong `props.evidence[]`, **không** tạo cạnh riêng.

Ingest **không** ghi `TARGETS`, `SERVICE_DEPENDS_ON`, `OWNS_DATA`, `READS_DATA`: các cạnh này do `link` tính (xem `cross-service.md`).

---

## 6. Quy tắc gọi method kế thừa (repository/thư viện)

Khi code gọi method kế thừa trên một receiver cụ thể (ví dụ `itemRepository.findById(id)` với `ItemRepository extends MongoRepository<Item, String>`):

1. Tạo `Operation` thuộc **chính component nhận lời gọi**: `uat:b-service:operation:com.example.b.repository.ItemRepository#findById`, `props.kind = "inherited"`, `filePath`/`lineStart` là dòng khai báo interface.
2. `CALLS` từ caller trỏ tới Operation đó (`dispatch: "interface"`), **không** trỏ thẳng tới `ext:`.
3. Operation đó có `OVERRIDES` tới `ext:<FQN của supertype ghi trong mệnh đề extends>#<method>`, ví dụ `ext:org.springframework.data.mongodb.repository.MongoRepository#findById` (node `Operation`, `external: true`). Dùng supertype viết trong code, không cần tra xem method thật sự khai báo ở interface cha nào.
4. `ACCESSES` DataStore đặt trên Operation kế thừa đó (mode theo tên method: `find*`/`get*`/`count*`/`exists*` → `read`; `save*`/`insert*`/`delete*`/`update*` → `write`).

Nhờ vậy chuỗi Endpoint → Operation → … → DataStore không bị đứt (đây là lỗi đã gặp ở bản demo). Ví dụ đầy đủ: `templates/fixtures/spring-boot/expected/b-service.uat.bundle.json`.
