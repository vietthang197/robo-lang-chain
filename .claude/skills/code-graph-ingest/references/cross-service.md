# Lời gọi liên service: ClientCall, link, Gap

Mục tiêu: từ một chỗ gọi ra ngoài trong code, dựng được chuỗi **ClientCall → (base URL qua config) → host:port → Deployment → Endpoint** của service đích, để agent SA trả lời "service A gọi service nào, API nào". Ingest chỉ ghi phía **bên gọi** (ClientCall + config); `link` mới ghép hai phía.

## 1. Trích xuất ClientCall (pha 3–4 của ingest)

### 1.1 Gắn vào đâu
- Mỗi chỗ gọi ra ngoài là một `ClientCall`, gắn vào `Operation` phát ra lời gọi bằng `MAKES_CALL {line}`:
  - Feign / declarative client (`@FeignClient`, `@HttpExchange`): Operation là **method của interface client** (`com.example.a.client.BClient#getItem`); caller nội bộ có `CALLS {dispatch:'interface'}` tới method đó.
  - RestTemplate / WebClient / RestClient / HttpClient / OFS / producer: Operation là method chứa câu lệnh gọi.
- uid: `<env>:<projectKey>:clientcall:<qualifiedName Operation>-><clientKind>:<httpMethod> <urlTemplate>` (không có method thì bỏ phần method; trùng thì `~2`, `~3`). Ví dụ `uat:a-service:clientcall:com.example.a.client.BClient#getItem->feign:GET /items/{id}`. Không biết URL: phần URL là `?`, method không biết là `ANY`: `uat:a-service:clientcall:com.x.DynClient#call->rest-template:ANY ?` (trùng: `…ANY ?~2`); props `urlTemplate` vẫn `null`.

### 1.2 Điền thuộc tính (ruling R15: `null` = không biết / không áp dụng)
| Trường | Quy tắc |
|---|---|
| `clientKind` | `feign`, `rest-template`, `web-client`, `rest-client`, `http-client`, `ofs`, `tif`, `callj`, `kafka-producer`, `jms-producer`, `fetch`, … |
| `httpMethod` | từ annotation (`@GetMapping`) hoặc tên method client (`getForObject` → GET, `postForEntity` → POST, `.get()`/`.post()` của WebClient/RestClient, `exchange(…, HttpMethod.PUT, …)`) |
| `urlTemplate` | phần URL viết trong code, **không gồm base URL từ config**: Feign = `@FeignClient(path)` + mapping của method (`/items/{id}`); RestTemplate với `baseUrl + "/items/" + id` = `/items/{id}` (biến ghép chuỗi thành `{tên biến}`). URL tuyệt đối viết cứng thì ghi nguyên (`http://api.partner.com/v1/x`) |
| `baseUrlConfigKey` | key config chứa base URL (`${b-service.url}` → `b-service.url`; `@ConfigurationProperties(prefix="clients.b")` + field `baseUrl` → `clients.b.base-url`) |
| `resolvedBaseUrl` | giá trị key đó ở env đang scan, đã che theo `config-and-env.md` (bỏ userinfo/query) |
| `resolvedHost`, `resolvedPort` | tách từ `resolvedBaseUrl` (hoặc từ URL tuyệt đối); port mặc định 80/443 theo scheme |
| `resolvedPath` | path của base URL nối với `urlTemplate`: `http://10.1.2.3:8081/b` + `/items/{id}` → `/b/items/{id}` |
| `discoveryName` | Feign `name`/`value` (`@FeignClient(name="b-service")`), `lb://b-service/...`, tên k8s service (`http://b-service:8080`) |
| `signature` | OFS `APP,VERSION` (chỉ khi `clientKind=ofs`), ví dụ `FUNDS.TRANSFER,ACTR` |
| `topic` | topic/queue của producer (`kafkaTemplate.send("payment.created", …)`) |
| `confidence` | `high` khi URL lấy thẳng từ annotation/config; `medium` khi URL ghép chuỗi trong code hoặc qua nhiều lớp biến; `low` khi phải đoán |

- Base URL lấy từ config: thêm cạnh `ClientCall -USES_CONFIG {role:'base-url'}-> ConfigKey`. Header xác thực lấy từ config: `USES_CONFIG {role:'credential'}` (value đã `***`).
- Producer (`*-producer`): ngoài ClientCall có `topic`, ghi thêm `Operation -PUBLISHES-> Channel` (`ch:<env>:<tech>:<topic>`). Consumer (`@KafkaListener`…): `Operation -SUBSCRIBES-> Channel`. `link` cần Channel + `SUBSCRIBES`/`PUBLISHES` để tính phụ thuộc bất đồng bộ.

### 1.3 Khi không xác định được
| Tình huống | Ghi gì |
|---|---|
| Không tìm ra URL (đọc từ DB, tham số runtime…) | `urlTemplate=null`, uid dùng `?` (§1.1), Gap `unresolved-call` (askWho=`Dev`, hash trên uid ClientCall): *"Lời gọi `<clientKind>` trong `<Operation>` dùng URL nào? URL được tạo lúc chạy từ `<biến/nguồn>`."* |
| Key base URL không có giá trị ở env | `resolved*=null`; **một** Gap `missing-config-value` (askWho=`DevOps`) cho ConfigKey đó (hash trên uid ConfigKey), `HAS_GAP` từ ConfigKey và từ mọi ClientCall dùng key: *"Ở env `<env>`, `<key>` (base URL của `<Client>`) có giá trị gì?"* (`config-and-env.md` §2) |
| Gọi tới host không thuộc project nào đã biết | ingest không cần làm gì; `link` sẽ tạo `ExternalSystem` hoặc Gap `unknown-external` |

Rule chung `R5-clientcall-url`: mọi ClientCall có `urlTemplate` hoặc `HAS_GAP`. Rule `spring-boot-clientcall-base-url`: ClientCall HTTP (`feign|rest-template|web-client|rest-client`) có `USES_CONFIG {role:'base-url'}` hoặc `HAS_GAP` (được miễn: URL tuyệt đối viết cứng trong code, và lời gọi chỉ qua discovery: `discoveryName` có giá trị, `baseUrlConfigKey` null).

## 2. Lệnh `link --env <env>`

Chạy sau **mỗi** lần ingest (ingest lại một project xoá các cạnh đi ra từ node của nó, kể cả `TARGETS`). Workspace: `code-graph-workspace/<env>/link/`.

`<skill>` = thư mục skill `.claude/skills/code-graph-ingest`.

```bash
node <skill>/scripts/print-queries.mjs link --env uat          # in JSON [{name, cypher}]
# chạy từng câu qua MCP ArcadeDB `query` (language cypher), lưu {<name>: records} vào link-input.json
node <skill>/scripts/link-plan.mjs link-input.json ../../system-catalog.yaml uat link-bundle.json
node <skill>/scripts/bundle-to-cypher.mjs link-bundle.json link-batches --mode link
# gửi từng file theo thứ tự trong link-batches/plan.json; 990-count phải bằng expectNodes
```

`link-input.json` có các khoá `clientCalls`, `endpoints`, `deployments`, `services`, `accesses`, `externals`, `channels`, `subscriptions`. Dữ liệu link cần từ ingest (thiếu là không khớp được):
- ClientCall: `resolvedHost`/`resolvedPort`/`resolvedPath` (hoặc `urlTemplate`), `httpMethod`, `discoveryName`, `signature`, `topic`.
- Endpoint: `path`/`pathRegex`/`httpMethod`/`signature`, `protocol`.
- Deployment: `port`/`contextPath`/`hosts`.
- Channel + `SUBSCRIBES`/`PUBLISHES` cho phụ thuộc bất đồng bộ; `ACCESSES {mode}` tới DataStore cho `OWNS_DATA`/`READS_DATA`.

### 2.1 Thứ tự ưu tiên khi khớp (đúng như `<skill>/scripts/core/link.mjs`)
Path của lời gọi = `resolvedPath`, không có thì path của `urlTemplate`. Trước khi so với `Endpoint.pathRegex` của project P, cắt `Deployment.contextPath` của P khỏi path (**ruling R16**); path không nằm dưới context-path đó thì P không phải ứng viên. Method phải khớp (Endpoint `ANY`/`*` khớp mọi method). Endpoint được so path là Endpoint `protocol=http` **hoặc** `iris` (IRIS REST của T24, ruling R21); `SERVICE_DEPENDS_ON.protocol` lấy protocol của Endpoint khớp.

0. **`gapAnswers` trong catalog (ruling R17)**: có mục cho ClientCall này thì dựng `TARGETS {matchedBy:'manual', confidence:'high'}` tới Endpoint khớp path của `targetService`, bỏ qua tự động; `answer.host` được thêm vào `Deployment.hosts` của đích. Nếu tự động lẽ ra sinh Gap thì Gap đó được ghi `status=answered`. Câu trả lời không khớp Endpoint nào → Gap `ambiguous-target` báo câu trả lời sai.
1. **OFS** (`clientKind=ofs`): `signature` = `Endpoint.signature` (protocol ofs) → `matchedBy=ofs-version`, high. Nhiều project → Gap `ambiguous-target`.
2. **Producer có `topic`**: Channel cùng tên (ưu tiên cùng tech) → `matchedBy=topic`, high.
3. **Host + path**: `resolvedHost` ∈ `Deployment.hosts` của P (và port khớp khi cả hai biết) và path khớp → `matchedBy=host+path`, high. Nhiều P → Gap `ambiguous-target`.
4. **Discovery name**: `discoveryName` (hoặc host) = `Service.name`/projectKey của P và path khớp đúng 1 P → `matchedBy=host+path`, high.
5. **Port-only**: P chưa có `hosts` nhưng `Deployment.port = resolvedPort` và path khớp đúng 1 P → `matchedBy=host+path`, medium.
6. **Chỉ path**: path khớp đúng 1 project → `matchedBy=path`, medium; nhiều project → Gap `ambiguous-target`.
7. **Trúng host/port nhưng trượt endpoint (ruling R20)**: không bước nào ở trên khớp, nhưng lời gọi tới đúng chỗ của một project đã scan, tức:
   - `resolvedHost` ∈ `Deployment.hosts` của project khác, và port tương thích (một bên chưa biết port, hoặc hai port bằng nhau); hoặc
   - host không nằm trong `hosts` của project nào, và `resolvedPort` bằng `Deployment.port` của **đúng một** project khác mà **hoặc host của lời gọi chưa biết, hoặc project đó chưa có `hosts` nào** (giống điều kiện port-only của bước 3/5). Project đã có `hosts` mà không chứa host của lời gọi thì là máy khác dùng cùng port, **không** phải trượt endpoint. Ví dụ `http://api.partner.com:8081/x` khi b-service có `hosts=['10.9.9.9']`, port 8081: thành `ExternalSystem`. Nếu b-service chưa có `hosts` thì lời gọi đó vẫn sinh Gap này; khi `Deployment.hosts` của b-service đã được điền (từ một lời gọi khớp high, hoặc `answer.host` của một mục `gapAnswers` tới b-service), lần `link` sau sẽ phân biệt được và lời gọi tới host lạ thành `ExternalSystem`.

   Khi đó sinh Gap `unresolved-call` (askWho=`Dev`, `candidates[]` = `{projectKey, hosts, port, contextPath}`) và **không** tạo TARGETS tới ExternalSystem. Nguyên nhân thường gặp: base URL của bên gọi thiếu context-path của đích (ví dụ `http://10.1.2.3:8081` thay vì `http://10.1.2.3:8081/b`), hoặc path/method sai.
8. **Không ứng viên**: có host → `TARGETS {matchedBy:'host', confidence:'medium'}` tới `ExternalSystem` `sys:<env>:<host>`; không có host → Gap `unknown-external`.

Sau khi khớp: điền `Deployment.hosts[]` từ `resolvedHost` của lời gọi khớp high (trừ khi host là tên service); xoá các cạnh `derived:true` cũ của env và sinh lại `SERVICE_DEPENDS_ON` (protocol, sync, endpointsUsed, callCount, confidence thấp nhất), `OWNS_DATA` (có `write`/`rw`), `READS_DATA`.

Fixture: a-service gọi `BClient#getItem` (`discoveryName=b-service`, `resolvedHost=10.1.2.3`, `resolvedPort=8081`, `resolvedPath=/b/items/{id}`); b-service có `contextPath=/b`, `port=8081`, `hosts=[]`, Endpoint `GET /items/{id}`. Kết quả: `TARGETS {matchedBy:'host+path', confidence:'high'}` (bước 4), `SERVICE_DEPENDS_ON` a → b, và `10.1.2.3` được ghi vào `hosts` của b-service.

### 2.2 Gap do link sinh
- uid `gap:<env>:system:<kind>:<sha1(uid ClientCall)[0:12]>` (**ruling R12**: chỉ link sinh `gap:<env>:system:…`; bị dọn và sinh lại ở mỗi lần link). Gắn bằng `HAS_GAP` từ ClientCall.
- `ambiguous-target`: askWho=`BA`, `candidates[]` = `{projectKey, hosts, port}` của từng ứng viên. Câu hỏi: *"Lời gọi `GET /items/{id}` từ a-service trỏ tới host/IP nào?"*
- `unknown-external`: askWho=`DevOps`. Câu hỏi: *"Lời gọi `GET /x` từ a-service trỏ tới hệ thống nào (host/IP hoặc service)?"*
- `unresolved-call` (bước 7, ruling R20): askWho=`Dev`, `candidates[]` = `{projectKey, hosts, port, contextPath}`. Câu hỏi: *"Lời gọi `GET /items/{id}` từ a-service trỏ tới host/port của b-service nhưng không khớp endpoint nào (context-path /b). Base URL có thiếu context-path không?"* Cách đóng: Dev xác nhận rồi sửa config/code (thêm context-path vào base URL, sửa path), ingest lại bên gọi và chạy lại `link`; nếu bundle đã ghi sai `resolvedPath` so với config thật thì sửa bundle. `gapAnswers` **không** đóng được Gap này, vì khớp thủ công vẫn so path sau khi cắt context-path.
- Trả lời `ambiguous-target`/`unknown-external`: ghi vào `gapAnswers` của catalog (`config-and-env.md` §1), rồi chạy lại `link`. **Không sửa `TARGETS` trong DB.**

### 2.3 Câu hỏi Gap: cách viết
- Tiếng Việt, một câu hỏi, nêu đủ: lời gọi nào (method + URL), từ service nào, cần biết gì (host/IP, giá trị config, tên service đích).
- Đưa ứng viên vào `candidates[]`, không liệt kê dài trong câu hỏi.
- Không chứa secret.
