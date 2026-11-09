# Reader profile: `spring-boot`

Đọc ứng dụng Spring Boot (Java) và map vào mô hình chuẩn (`../schema.md`). Phần L3 thuần Java (class, method, CALLS, kế thừa) dùng chung quy tắc với `java-generic.md`; file này thêm ngữ nghĩa Spring (endpoint, DI, client HTTP, Spring Data, config). Ví dụ chạy được: `templates/fixtures/spring-boot/` (a-service gọi b-service qua Feign).

## 1. Detection

Khớp khi **cả hai** đúng:
1. Có `pom.xml` chứa `spring-boot` (parent `spring-boot-starter-parent` hoặc dependency `org.springframework.boot:*`), hoặc `build.gradle`/`build.gradle.kts` chứa plugin/dependency `org.springframework.boot`.
2. Có ít nhất một class mang `@SpringBootApplication` (Grep `@SpringBootApplication` trong `src/main/java`).

Thường đi kèm `java-generic` cho phần L3 (không cần ghi `java-generic` vào `readerProfiles` nếu repo chỉ là Spring Boot; mọi quy tắc L3 của nó đã nằm trong profile này). Repo có nhiều class `@SpringBootApplication` ở các Maven/Gradle module khác nhau = nhiều ứng dụng deploy riêng: **dừng và hỏi người dùng** projectKey cho từng ứng dụng (mỗi ứng dụng một Service, một bundle).

## 2. Inventory

Đọc (đường dẫn tương đối từ gốc repo, hoặc gốc module của ứng dụng):
| Glob | Ghi chú |
|---|---|
| `pom.xml`, `build.gradle*`, `settings.gradle*`, `gradle.properties` | Library, version, module |
| `src/main/resources/application*.{yml,yaml,properties}`, `src/main/resources/bootstrap*.{yml,yaml,properties}`, `config/application*.{yml,yaml,properties}` | ConfigKey, Deployment |
| `src/main/java/**/*.java` (và `src/main/kotlin/**/*.kt`, cùng mapping, `language=kotlin`) | code |
| `src/main/resources/**/*.{yml,yaml,json}` là OpenAPI spec dùng để sinh client/server | Endpoint/ClientCall khi code được sinh tự động |
| `Dockerfile`, `k8s/**`, `helm/**/values*.yaml`, `deploy/**` (nếu có) | port/host/tên k8s service cho Deployment |

Bỏ qua (ghi vào `coverage.skipped` với lý do):
| Glob | Lý do |
|---|---|
| `target/**`, `build/**`, `out/**`, `.gradle/**`, `bin/**` | build output |
| `**/generated-sources/**`, `**/generated/**` | file sinh tự động (đọc spec nguồn thay thế) |
| `src/test/**` | test code, không thuộc topology runtime |
| `.idea/**`, `.vscode/**`, `node_modules/**`, `src/main/resources/static/**`, `src/main/resources/templates/**` | IDE/vendor/tài nguyên giao diện |
| `.env`, `.env.*`, `**/*.jks`, `**/*.p12`, `**/*.keystore`, `**/*.pem` | secret file, không đọc |

Thứ tự đọc: build file → config (để biết base URL, port, context-path, database trước) → class `@SpringBootApplication` → controller → service → client (Feign/RestTemplate/WebClient) → repository/entity → config class (`@Configuration`, `@ConfigurationProperties`) → còn lại.

Đếm: `filesTotal` = số file thuộc danh sách "Đọc"; `filesRead` = số file đã đọc thật. File đọc không hiểu được: `diagnostics` + Gap `unread-files` gom theo module.

Chia subagent (repo lớn, > ~40 file Java): mỗi package con cấp 1 dưới package gốc (`com.x.controller`, `com.x.service`, …) hoặc mỗi Maven module là một phần; mỗi phần ≤ ~40 file. Agent chính đọc config trước và đưa bảng ConfigKey đã giải cho mọi subagent.

## 3. Bảng mapping

| Native | Vertex chuẩn | kind / stereotype | qualifiedName |
|---|---|---|---|
| Ứng dụng có `@SpringBootApplication` | `Service` (+ `Deployment`, `DEPENDS_ON` Library) | `kind=service` | projectKey (uid `<env>:<projectKey>:service:<projectKey>`); `name` = `spring.application.name` nếu có, không thì projectKey |
| package | `Module` | `kind=java-package` | tên package; `Service -CONTAINS-> Module` (phẳng, mọi package) |
| class / interface / enum / record | `Component` | `kind=java-class|java-interface|java-enum|java-record`; `stereotype` từ annotation: `@RestController`/`@Controller` → `controller`, `@Service` → `service`, `@Repository` hoặc interface extends `*Repository` → `repository`, `@Configuration`/`@SpringBootApplication` → `config`, `@ConfigurationProperties` → `config-properties`, `@Document`/`@Entity` → `entity`, `@FeignClient` → `feign-client`, `@Component` → `component`, record/class chỉ chứa dữ liệu (`*Dto`, `*Request`, `*Response`) → `dto` | FQN; `Module -CONTAINS-> Component` |
| method (có thân hoặc khai báo trong interface) | `Operation` | `kind=java-method`; method kế thừa được gọi qua repository → `kind=inherited` | `<FQN>#<method>`, overload `~2`…; `props.signature` = `name(ParamType,…)` |
| field | `Member` | `kind=java-field`, `nativeType` = kiểu | `<FQN>#<field>` |
| `@GetMapping`/`@PostMapping`/`@PutMapping`/`@DeleteMapping`/`@PatchMapping`/`@RequestMapping` (+ `@RequestMapping` của class) | `Endpoint` http | `kind=http` | uid `<env>:<pk>:endpoint:http:<METHOD> <path>`; **không gồm context-path (ruling R16)** |
| `@Tool` (langchain4j) | `Endpoint` | `protocol=langchain4j-tool` | signature = `@Tool(name)` hoặc tên method |
| `@KafkaListener` / `@JmsListener` / `@RabbitListener` | `Operation -SUBSCRIBES-> Channel` | | `ch:<env>:kafka|jms|rabbitmq:<topic/queue>` |
| `@Scheduled`, `@EventListener` | `Component -TRIGGERS-> Operation` | `event=@Scheduled` (thêm `cron`/`fixedRate` vào props cạnh) hoặc `@EventListener` | |
| `@FeignClient` method; lời gọi `RestTemplate`/`WebClient`/`RestClient`/`HttpClient` | `ClientCall` + `MAKES_CALL` + `USES_CONFIG {role:'base-url'}` | `clientKind=feign|rest-template|web-client|rest-client|http-client` | xem §4.2 |
| `KafkaTemplate.send(topic, …)`, `JmsTemplate.convertAndSend(dest, …)`, `RabbitTemplate.convertAndSend(exchange, …)` | `ClientCall` (`clientKind=kafka-producer|jms-producer|rabbitmq-producer`, `topic`) + `Operation -PUBLISHES-> Channel` | | |
| Spring Data repository + entity | `ACCESSES` DataStore | | §4.3 |
| Stereotype, `@Bean`, repository, Feign client | `Bean` + `PROVIDES`/`BEAN_TYPE`; inject → `INJECTS` | `kind=spring-bean`, `framework=spring` | tên bean |
| `application*.yml/properties` | `ConfigKey` theo env; `server.port`, `server.servlet.context-path` → `Deployment` | `kind=config` | key phẳng |
| dependency trong build file | `Library` + `Service -DEPENDS_ON-> Library` | `kind=maven|gradle` | `lib:maven:<groupId>:<artifactId>` |
| annotation có ý nghĩa (stereotype, mapping, `@FeignClient`, `@Document`/`@Entity`/`@Table`, `@Transactional`, `@Scheduled`, listener, `@Tool`, `@Id`) | `Tag` + `TAGGED {attributes}` | `kind=java-annotation` | `tag:java:<FQN annotation>` |
| supertype ngoài project (`MongoRepository`, `JpaRepository`, …) | `Component` `ext:<FQN>` (`external:true`) + `EXTENDS`/`IMPLEMENTS {typeArgs}` + `FROM_LIBRARY` | | |

Không tạo Operation cho: getter/setter/`equals`/`hashCode`/`toString` (kể cả do Lombok hay record sinh ra), constructor chỉ gán field inject (DI thể hiện bằng `INJECTS`).

## 4. Công thức trích xuất

### 4.1 Endpoint (http)
1. `prefix` = giá trị `@RequestMapping` của class (`value`/`path`, có thể rỗng). Method mapping cho `suffix` và method HTTP (`@GetMapping` → `GET`; `@RequestMapping(method=RequestMethod.POST)` → `POST`; `@RequestMapping` không có `method` → `ANY`).
2. `path` = chuẩn hoá(`prefix` + `suffix`): bắt đầu bằng `/`, gộp `//`, bỏ `/` cuối (trừ path `/`). Placeholder `${…}` trong mapping: giải từ config; không giải được thì giữ nguyên và `confidence=medium`.
3. **Không** cộng `server.servlet.context-path` (**ruling R16**, thay cho chữ "(+ server.servlet.context-path)" của spec §6.2). Context-path chỉ nằm ở `Deployment.contextPath`.
4. Mapping có nhiều path (`@GetMapping({"/a", "/b"})`) hoặc nhiều method → mỗi tổ hợp một Endpoint.
5. `pathRegex` sinh từ `path` (`{x}` và `{x:regex}` → `[^/]+`, bọc `^…$`); `signature` = `<METHOD> <path>`; `protocol=http`.
6. Cạnh: `Operation(handler) -EXPOSES-> Endpoint`, `Deployment -SERVES-> Endpoint`, `Operation -TAGGED-> tag:java:…GetMapping {attributes:{value:…}}`.
7. WebFlux functional (`RouterFunctions.route(GET("/x"), handler::m)`): như trên, handler là `m`.
8. Server sinh từ OpenAPI (interface `*Api` trong generated-sources): lấy path/method từ file OpenAPI, Endpoint gắn vào method của class implement interface đó.

Ví dụ: `@RequestMapping("/items")` + `@GetMapping("/{id}")` → `path=/items/{id}`, `pathRegex=^/items/[^/]+$`, uid `uat:b-service:endpoint:http:GET /items/{id}` (dù context-path là `/b`).

### 4.2 ClientCall
Quy tắc chung ở `../cross-service.md` §1. Theo từng loại client:

| Client | Operation gắn ClientCall | httpMethod, urlTemplate | Base URL |
|---|---|---|---|
| `@FeignClient(name, url, path)` | method của interface Feign | từ mapping của method; `urlTemplate` = `path` của `@FeignClient` + mapping method | `url="${key}"` → `baseUrlConfigKey=key`; không có `url` thì `spring.cloud.openfeign.client.config.<name>.url` (bản cũ `feign.client.config.<name>.url`); không có cả hai thì gọi qua discovery: `discoveryName=name`, base URL null (không cần Gap) |
| `RestTemplate.getForObject/getForEntity/postForObject/exchange…` | method chứa lời gọi | method từ tên hàm/`HttpMethod`; URL đối số đầu: phần ghép từ biến base → bỏ, phần còn lại thành template (`"/items/" + id` → `/items/{id}`) | biến base lấy từ `@Value("${key}")`/`@ConfigurationProperties` → key đó; `UriComponentsBuilder.fromHttpUrl(base)` tương tự |
| `WebClient` / `RestClient` | method chứa `.get()/.post()…uri(...)` | `.uri("/items/{id}", id)` → `/items/{id}` | `baseUrl(...)` trong `@Bean` tạo client → lần theo bean được inject để lấy key |
| `@HttpExchange` interface | method của interface | `@GetExchange("/x")` … | `HttpServiceProxyFactory` + client có `baseUrl` |
| Client sinh từ OpenAPI | method gọi `*Api` | từ file OpenAPI, `confidence=medium` | `ApiClient.setBasePath(...)` / property |

- `discoveryName`: Feign `name`/`value`; URL dạng `lb://x` hoặc `http://x` với `x` là tên k8s service/Eureka → `x`.
- Có base URL từ config → `USES_CONFIG {role:'base-url'}` từ ClientCall tới ConfigKey, và điền `resolvedBaseUrl/Host/Port/Path` theo giá trị ở env (`../config-and-env.md`). Key không có giá trị → Gap `missing-config-value` gắn vào ClientCall.
- URL ghép chuỗi trong code: ghi `urlTemplate` tốt nhất có thể, `confidence=medium`. Không tìm ra URL → `urlTemplate=null` + Gap `unresolved-call` (askWho=`Dev`).
- Caller nội bộ gọi method Feign: `CALLS {dispatch:'interface'}` tới Operation của interface Feign.

Ví dụ (fixture a-service): `@FeignClient(name = "b-service", url = "${b-service.url}")` + `@GetMapping("/items/{id}") ItemDto getItem(...)`, `application-uat.yml` có `b-service.url: http://10.1.2.3:8081/b` →
```json
{ "type": "ClientCall", "uid": "uat:a-service:clientcall:com.example.a.client.BClient#getItem->feign:GET /items/{id}",
  "props": { "clientKind": "feign", "httpMethod": "GET", "urlTemplate": "/items/{id}", "baseUrlConfigKey": "b-service.url",
             "resolvedBaseUrl": "http://10.1.2.3:8081/b", "resolvedHost": "10.1.2.3", "resolvedPort": 8081,
             "resolvedPath": "/b/items/{id}", "discoveryName": "b-service", "signature": null, "topic": null, "confidence": "high", "…": "…" } }
```

### 4.3 DataStore + mode
| Công nghệ | uid | location |
|---|---|---|
| MongoDB (Spring Data Mongo, `MongoTemplate`) | `ds:<env>:mongodb:<database>.<collection>` | database từ `spring.data.mongodb.database` hoặc path của `spring.data.mongodb.uri`; collection từ `@Document(collection=…)`/`@Document("…")`, mặc định tên class viết thường chữ đầu |
| JPA/JDBC (`@Entity`, `JpaRepository`, `JdbcTemplate`) | `ds:<env>:<postgresql|oracle|mysql|sqlserver|h2>:<schema>.<table>` | tech từ `spring.datasource.url` (`jdbc:postgresql:` → `postgresql`); table từ `@Table(name, schema)`, mặc định tên entity đổi sang snake_case (`confidence=medium`) |
| Vector store (langchain4j `EmbeddingStore`, Qdrant) | `ds:<env>:qdrant:<collection>` | collection từ config/builder |
| File system | `ds:<env>:filesystem:<path>` | path từ config |

- Node DataStore: `props.tech`, `location`, `kind` (`collection`, `table`, `vector-collection`, `directory`), `name`.
- `ACCESSES {mode}` đặt trên **Operation** thực hiện truy cập; với repository dùng Operation kế thừa của chính repository (`../schema.md` §6). Mode theo tên: `find*|get*|read*|query*|count*|exists*|stream*` → `read`; `save*|insert*|update*|delete*|remove*` → `write`; `@Modifying @Query` → `write`; method tự viết dùng cả hai → `rw`.
- Entity: `Component(entity) -ACCESSES {mode:'maps'}-> DataStore`.
- Không xác định được database/schema: location chỉ là `<collection|table>`, thêm Gap `unknown-datastore` (askWho=`DevOps`).

### 4.4 Channel
- Consumer: `@KafkaListener(topics="x")` → `Operation -SUBSCRIBES-> ch:<env>:kafka:x`; `@JmsListener(destination)` → `jms`; `@RabbitListener(queues)` → `rabbitmq`. Topic là `${key}` thì giải từ config; không giải được → Gap `missing-config-value`.
- Producer: xem bảng mapping; ClientCall có `topic`, thêm `PUBLISHES`.
- Node Channel: `props.tech`, `name`.

### 4.5 CALLS
- Với mỗi lời gọi method trong thân Operation, xác định kiểu receiver (field/param/biến cục bộ/`this`) rồi trỏ `CALLS` tới Operation của kiểu đó: `{dispatch:'static'|'interface', lines:[…], resolved:true}`. Nhiều lời gọi cùng đích trong một method: một cạnh, gộp `lines`.
- Receiver là interface của project: `CALLS` tới Operation của interface (`dispatch:'interface'`); Operation của mỗi class implement có `OVERRIDES` tới Operation của interface.
- Method kế thừa từ supertype ngoài (repository): quy tắc `../schema.md` §6.
- Không giải được đích: `CALLS` tới `ext:<FQN đoán được>#<method>` với `resolved:false`.
- Không ghi CALLS tới JDK/tiện ích tầm thường (`String`, collection, `Optional`, logging, Lombok builder). Ghi CALLS tới `ext:` khi lời gọi có ý nghĩa với hành vi (SDK AI, client lưu trữ, crypto…).

### 4.6 TRIGGERS
`@Scheduled` → `Component -TRIGGERS {event:'@Scheduled', cron|fixedRate|fixedDelay}-> Operation`; `@EventListener`/`@TransactionalEventListener` → `event:'@EventListener'`; `ApplicationRunner`/`CommandLineRunner.run` → `event:'startup'`. Method `main` của class `@SpringBootApplication`: `props.entry=true`.

### 4.7 Bean/DI
- Class có stereotype → `Bean` (uid `<env>:<pk>:bean:<tên>`, tên = tên class viết thường chữ đầu hoặc tên tường minh trong annotation), `Component -PROVIDES {via:'stereotype'}-> Bean`, `Bean -BEAN_TYPE-> Component`.
- Method `@Bean` → Bean tên = tên method (hoặc `@Bean(name)`), `PROVIDES {via:'bean-method'}` từ class `@Configuration`, `BEAN_TYPE` tới kiểu trả về (Component của project hoặc `ext:`).
- Repository Spring Data → `via:'spring-data-repository'`; interface `@FeignClient` → `via:'feign-client'`.
- Inject qua constructor (kể cả `@RequiredArgsConstructor` của Lombok với field `final`), field `@Autowired`/`@Inject`, tham số method `@Bean` → `Component -INJECTS {via:'constructor'|'field'|'param', qualifier?}-> Bean` của kiểu đó (interface có đúng 1 implementation → bean của implementation).
- `@Value("${key}")` → `Component -READS_CONFIG {via:'@Value'}-> ConfigKey`; `@ConfigurationProperties(prefix)` → `READS_CONFIG {via:'@ConfigurationProperties'}` tới từng key được bind.

### 4.8 Member
Field của entity, dto, `@ConfigurationProperties` → `Member` (`Component -CONTAINS-> Member`), `nativeType` = kiểu; field có annotation quan trọng (`@Id`, `@Field`, `@Column`) → `TAGGED`. Field inject phụ thuộc và hằng số `static final` không tạo Member.

## 5. Config theo env

- File: `application.{yml,yaml,properties}` (profile `default`) + `application-<profile>.*` cho từng profile active. Profile active ở env = `catalog.services.<pk>.profiles.<env>` nếu có, không thì `[<env>]`, cộng `spring.profiles.active`/`spring.profiles.include`/`spring.profiles.group` khai báo trong file. Thứ tự ưu tiên và giải placeholder: `../config-and-env.md` §2. Tài liệu YAML nhiều phần (`---` + `spring.config.activate.on-profile`) tính như file profile tương ứng.
- `Deployment.port` = `server.port` (mặc định `8080`); `Deployment.contextPath` = `server.servlet.context-path` (WebFlux: `spring.webflux.base-path`), mặc định `null`; cạnh `USES_CONFIG {role:'port'|'context-path'}` từ Deployment. `management.server.port` không phải port của Deployment.
- `Deployment.hosts`: từ manifest deploy nếu có (`k8s` Service/Ingress host, `eureka.instance.hostname`), không thì `[]`.
- Base URL: §4.2.
- Placeholder của key credential: `spring.datasource.password: ${DB_PASS:s3cr3tPwd}` → `value: "***"`, `masked: true`, `placeholderExpr: "${DB_PASS:***}"`, `defaultValue` bỏ hoặc `"***"` (rule `R7-config-default`, `../config-and-env.md` §2). ConfigKey `value` luôn là chuỗi (`"8081"`), `Deployment.port` là số nguyên (`8081`).
- Secret đặc thù Spring (che bằng `***` hoặc cắt URL): `spring.datasource.password`, `spring.datasource.url` (cắt userinfo), `spring.data.mongodb.uri` (cắt userinfo/query), `spring.data.mongodb.password`, `spring.rabbitmq.password`, `spring.kafka.properties.sasl.jaas.config`, `spring.security.oauth2.client.registration.*.client-secret`, `*.jwt.secret`, `*.api-key`, `server.ssl.key-store-password`.

Ví dụ (fixture a-service, env uat): `spring.datasource.password: secret` → ConfigKey `uat:a-service:config:spring.datasource.password` với `value: "***"`, `masked: true`.

## 6. Gợi ý mô tả

- Trách nhiệm diễn đạt theo **tài nguyên nghiệp vụ + hành động** mà controller/listener phục vụ ("Tra cứu item theo id", "Nhận sự kiện thanh toán từ topic payment.created"), không theo tên class.
- Capability: gom Endpoint cùng tài nguyên/mục đích (thường cùng prefix `@RequestMapping` của class, hoặc cùng service nghiệp vụ được gọi), cộng listener/job phục vụ cùng việc. Tên dạng động từ + đối tượng.
- `notResponsibleFor`: ghi rõ khi service chỉ là proxy/BFF (không sở hữu dữ liệu), khi dữ liệu thuộc service khác, khi service chỉ đọc.
- Ghi vào mô tả Endpoint/Operation: DataStore đọc/ghi (collection/bảng), service đích của ClientCall, điều kiện lỗi rõ ràng (`throw`, `ResponseEntity.notFound()`, `@Valid`).
- `techStack`: `java`, `spring-boot`, các starter chính (`spring-web`, `spring-webflux`, `spring-data-mongodb`, `spring-data-jpa`, `spring-cloud-openfeign`, `spring-kafka`, `langchain4j`…), DB.
- Thuật ngữ hay gặp: tra cứu (lookup), tạo mới (create), cập nhật (update), đồng bộ (sync), thông báo (notification), xác thực (authentication), phân quyền (authorization), tài liệu (document), giao dịch (transaction).

## 7. Bẫy thường gặp

| Bẫy | Xử lý đúng |
|---|---|
| Lombok (`@Data`, `@Getter`, `@Builder`, `@RequiredArgsConstructor`) sinh method/constructor không thấy trong source | Không tạo Operation cho getter/setter/builder; `@RequiredArgsConstructor` + field `final` = constructor injection (`INJECTS {via:'constructor'}`) |
| Gọi qua interface (service interface + `*Impl`) | `CALLS` tới Operation của interface; Operation của `*Impl` có `OVERRIDES` tới đó |
| Gọi method kế thừa của repository (`repo.findById`) | Operation `kind=inherited` trên chính repository + `OVERRIDES` tới `ext:…#findById`; `ACCESSES` đặt trên Operation đó (`../schema.md` §6). Trỏ thẳng `CALLS` tới `ext:` làm đứt chuỗi Endpoint → DataStore |
| Cộng context-path vào `Endpoint.path` | Sai (**ruling R16**). `path` chỉ gồm `@RequestMapping` class + method; context-path ở `Deployment.contextPath` |
| Base URL của bên gọi thiếu context-path của đích | Ghi đúng giá trị config, không tự thêm context-path. Khi đó `link` thấy lời gọi trúng host/port của đích mà không khớp endpoint nào và sinh Gap `unresolved-call` (askWho=`Dev`, câu hỏi nêu context-path của đích; ruling R20), không biến lời gọi thành ExternalSystem (`../cross-service.md` §2.1 bước 7) |
| URL ghép chuỗi trong code | `urlTemplate` tốt nhất có thể + `confidence=medium` |
| Service discovery (`lb://name`, Feign chỉ có `name`) | `discoveryName=name`, khớp theo tên service, không theo host; không cần Gap thiếu base URL |
| `@FeignClient(path="/v1")` | Cộng `path` vào `urlTemplate` của mọi method |
| `@RequestMapping` không có `method` | `httpMethod=ANY` |
| Bean có `@Profile` không active ở env | Vẫn ghi node; thêm `props.profileCondition` (ví dụ `"!uat"`); ClientCall của nó `confidence=low` |
| Config trong `bootstrap.yml` hoặc Config Server (`spring.config.import: configserver:`) | Đọc `bootstrap*`; giá trị nằm ở Config Server ngoài repo → `isPlaceholder=true` + Gap `missing-config-value` |
| Code sinh từ OpenAPI nằm trong `target/generated-sources` | Không đọc output build; đọc file OpenAPI nguồn, `confidence=medium` |
| ext: uid ghi sai loại vertex giữa các project | Type luôn `Component`, `#op` luôn `Operation` (`../schema.md` §2.1) |

## 8. Conformance

**Fixture:** `templates/fixtures/spring-boot/`
- `a-service`: `ItemProxyController` (`GET /api/items/{id}`) → `ItemService#getItem` → Feign `BClient#getItem` (`@FeignClient(name="b-service", url="${b-service.url}")`, `GET /items/{id}`); `application-uat.yml` có `b-service.url: http://10.1.2.3:8081/b` (đã gồm context-path `/b` của đích, ruling R16) và `spring.datasource.password: secret`.
- `b-service`: `server.port: 8081`, `server.servlet.context-path: /b`; `ItemController` (`GET /items/{id}`) → `ItemRepository#findById` (kế thừa `MongoRepository`) → `@Document(collection="items")`, database `b_db` ở uat.
- Bundle kỳ vọng: `expected/a-service.uat.bundle.json`, `expected/b-service.uat.bundle.json`.

Trích đoạn kỳ vọng:
```json
{ "type": "Endpoint", "uid": "uat:b-service:endpoint:http:GET /items/{id}",
  "props": { "protocol": "http", "httpMethod": "GET", "path": "/items/{id}", "pathRegex": "^/items/[^/]+$", "signature": "GET /items/{id}", "…": "…" } }
{ "type": "Deployment", "uid": "uat:b-service:deployment", "props": { "port": 8081, "contextPath": "/b", "hosts": [], "…": "…" } }
{ "type": "ConfigKey", "uid": "uat:a-service:config:spring.datasource.password", "props": { "key": "spring.datasource.password", "value": "***", "masked": true, "…": "…" } }
{ "type": "CALLS", "from": "uat:b-service:operation:com.example.b.controller.ItemController#getItem",
  "to": "uat:b-service:operation:com.example.b.repository.ItemRepository#findById", "props": { "dispatch": "interface", "lines": [22], "resolved": true } }
{ "type": "OVERRIDES", "from": "uat:b-service:operation:com.example.b.repository.ItemRepository#findById",
  "to": "ext:org.springframework.data.mongodb.repository.MongoRepository#findById", "props": {} }
{ "type": "ACCESSES", "from": "uat:b-service:operation:com.example.b.repository.ItemRepository#findById", "to": "ds:uat:mongodb:b_db.items", "props": { "mode": "read" } }
{ "type": "USES_CONFIG", "from": "uat:a-service:clientcall:com.example.a.client.BClient#getItem->feign:GET /items/{id}",
  "to": "uat:a-service:config:b-service.url", "props": { "role": "base-url" } }
```
Link hai fixture cho `TARGETS {matchedBy:'host+path', confidence:'high'}` từ ClientCall của a-service tới `uat:b-service:endpoint:http:GET /items/{id}` và `SERVICE_DEPENDS_ON` a-service → b-service.

**Rule riêng** (`<skill>/scripts/core/profile-rules/index.mjs`, chạy bằng `node <skill>/scripts/validate-bundle.mjs <bundle> --profile spring-boot`):
| Rule id | Điều kiện | Sửa khi fail |
|---|---|---|
| `spring-boot-controller-endpoint` | mọi Component `stereotype=controller` (không external) có ≥1 Operation (qua `CONTAINS`) có `EXPOSES` tới Endpoint | thiếu Endpoint cho `@*Mapping` của controller (§4.1), hoặc thiếu cạnh `CONTAINS` Component → Operation |
| `spring-boot-clientcall-base-url` | mọi ClientCall `clientKind` ∈ {`feign`, `rest-template`, `web-client`, `rest-client`} có `USES_CONFIG {role:'base-url'}` hoặc `HAS_GAP`; được miễn khi `urlTemplate` là URL tuyệt đối (`scheme://host…`, kể cả `lb://name`), hoặc khi lời gọi chỉ qua discovery (`discoveryName` có giá trị và `baseUrlConfigKey` null, ví dụ Feign chỉ có `name`) | thêm cạnh tới ConfigKey base URL (§4.2), hoặc Gap `missing-config-value`/`unresolved-call` |
| `spring-boot-server-port` | ConfigKey `server.port` có giá trị số thì `Deployment.port` bằng giá trị đó | sửa `Deployment.port` |

**Test:** `<skill>/scripts/test/profile-spring.test.mjs` (`npm test` từ thư mục skill): hai bundle kỳ vọng validate sạch với profile `spring-boot`; password bị che `***`; link hai fixture ra `TARGETS host+path`; mỗi rule riêng bắt được lỗi cố ý.
