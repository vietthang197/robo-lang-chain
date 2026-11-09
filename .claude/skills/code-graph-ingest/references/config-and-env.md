# Config, môi trường và secret

Config và môi trường là **dữ liệu hạng nhất**: mỗi env có code (branch) và config riêng; lời gọi liên service được dựng qua config (base URL → host:port → Deployment → Endpoint). Không bao giờ ghi secret lên graph.

## 1. `system-catalog.yaml`

File dùng chung: `code-graph-workspace/system-catalog.yaml`. Mẫu đầy đủ: `templates/system-catalog.example.yaml`.

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
    clientCall: "uat:a-service:clientcall:com.example.a.client.BClient#getItem->feign:GET /items/{id}"
    answer: { targetService: b-service, host: 10.1.2.3 }
    answeredBy: BA
```

| Mục | Dùng để |
|---|---|
| `environments` | env hợp lệ (`dev`, `uat`) và database (`CodeGraph`) |
| `services.<projectKey>.branches` | env → branch. Pha 0 tạo `git worktree` cho branch đó và ghi `commitSha`. Branch không tồn tại: dừng, báo người dùng |
| `services.<projectKey>.profiles` | (tuỳ chọn) env → danh sách Spring profile; mặc định profile = tên env |
| `domain`, `layer`, `ownerTeam` | giá trị đã duyệt. Có thì ghi `IN_DOMAIN`/`IN_LAYER {source:'catalog'}` và `Service.ownerTeam`; chưa có thì chỉ đề xuất vào `catalog-proposal.yaml` |
| `gapAnswers` | **ruling R17**: `[{env, clientCall: <uid ClientCall>, answer: {targetService: <projectKey>, host?: <host/IP>}, answeredBy}]` là **nguồn bền vững duy nhất** cho `TARGETS` thủ công. Người trả lời Gap ghi vào đây, **không bao giờ sửa `TARGETS` trực tiếp trong DB** (ingest lại sẽ xoá cạnh đó). `link` dựng `TARGETS {matchedBy:manual}` từ mục này và đánh dấu Gap `status=answered` |

## 2. File config theo env

- Nguồn config là file trong repo, trên **branch của env**: Spring `application.yml|yaml|properties` + `application-<profile>.yml|yaml|properties` (cả `bootstrap*.yml` nếu có); T24 là record OFS.SOURCE, `tafj.properties`, …
- Thứ tự giải giá trị (Spring): `application-<env>` > `application` > default trong `${KEY:default}`. Nhiều profile active thì profile đứng sau thắng.
- Mỗi key **cuối cùng** (sau khi gộp file) thành một `ConfigKey`, uid `<env>:<projectKey>:config:<key>`; key YAML lồng nhau được làm phẳng bằng dấu chấm (`spring.datasource.password`). Key kiểu list dùng chỉ số: `app.hosts[0]`.
- `Service` → `CONTAINS` → mỗi ConfigKey.

### Thuộc tính `ConfigKey`
| Thuộc tính | Cách điền |
|---|---|
| `key` | tên key đầy đủ |
| `value` | giá trị đã giải ở env này, **sau khi che secret** (mục 4); `null` nếu không giải được |
| `masked` | `true` nếu value đã bị thay/cắt |
| `isPlaceholder` | `true` nếu giá trị gốc là `${…}` lấy từ biến môi trường không có trong repo |
| `placeholderExpr` | biểu thức gốc, ví dụ `${B_URL}` hoặc `${B_URL:http://localhost:8081}` |
| `defaultValue` | phần default trong `${KEY:default}` (cũng phải che secret) |
| `sourceFile`, `profile` | file chứa giá trị thắng, profile của file đó (`default` cho `application.yml`) |

### Giải placeholder
1. `${other.key}` tham chiếu key khác trong config: thay bằng giá trị đã giải của key đó.
2. `${ENV_VAR:default}` không có trong repo: dùng `default`, `isPlaceholder=true`, `placeholderExpr` giữ nguyên biểu thức.
3. `${ENV_VAR}` không có default và không có trong repo: `value=null`, `isPlaceholder=true`, và sinh Gap `missing-config-value` (askWho=`DevOps`) gắn vào ConfigKey (và vào ClientCall dùng key đó), câu hỏi dạng: *"Ở env uat, `b-service.url` (base URL của BClient) có giá trị gì? Key lấy từ biến môi trường `B_URL` không có trong repo."*

## 3. Deployment

Một `Deployment` cho mỗi `(env, projectKey)`, uid `<env>:<projectKey>:deployment`; `Service -DEPLOYED_AS-> Deployment`, `Deployment -SERVES-> Endpoint` (mọi Endpoint), `Deployment -IN_ENV-> env:<env>`.

| Thuộc tính | Nguồn |
|---|---|
| `port` | `server.port` đã giải (số nguyên); Spring mặc định `8080` khi không khai báo. Rule `spring-boot-server-port`: ConfigKey `server.port` có giá trị số thì `Deployment.port` phải bằng nó. Cạnh `USES_CONFIG {role:'port'}` |
| `contextPath` | `server.servlet.context-path` (Spring Boot 2+; bản cũ `server.context-path`, WebFlux `spring.webflux.base-path`); `null` nếu không có. Cạnh `USES_CONFIG {role:'context-path'}` |
| `hosts[]` | host/IP của chính service ở env này nếu config/repo ghi rõ (ví dụ manifest k8s, `eureka.instance.hostname`); thường để `[]`. `link` điền thêm từ `resolvedHost` của các lời gọi đã khớp chắc chắn và từ `gapAnswers.answer.host` |
| `branch`, `commitSha` | từ pha 0 |
| `profilesActive[]` | profile đã dùng để giải config |

**Ruling R16:** `Endpoint.path` **không** gồm context-path; context-path chỉ nằm ở `Deployment.contextPath`. `link` cắt context-path của service đích khỏi URL của bên gọi trước khi so path. Hệ quả: base URL mà bên gọi cấu hình **đã gồm** context-path của đích. Fixture: b-service có `server.servlet.context-path: /b`, Endpoint `GET /items/{id}`; a-service cấu hình `b-service.url: http://10.1.2.3:8081/b`.

## 4. Secret

- Mẫu key secret: `(?i)(password|passwd|secret|token|apikey|api-key|credential|private|key-store|uri|url)`.
- Key credential thật (`password|passwd|secret|token|apikey|api-key|credential|private|key-store`): **value luôn thay bằng `***`**, `masked=true`, kể cả khi giá trị trông vô hại. Ví dụ `spring.datasource.password: secret` → `value: "***"`, `masked: true`.
- Key `uri|url`: là URL thì **giữ scheme/host/port/path, bỏ userinfo, query và fragment**; `masked=true` nếu có cắt. Ví dụ `mongodb://app:pw@db1:27017/app_db?authSource=admin` → `mongodb://db1:27017/app_db`. URL không tách được host khỏi credential thì `***`.
- Key bất kỳ mà value khớp mẫu secret (URL có `user:pass@`, JWT, PEM private key, `password=…`, AWS key) cũng che như trên.
- `${ENV_VAR}` trần không phải secret (giữ nguyên); `${VAR:default}` thì xét phần default.
- Hàm chuẩn (dùng khi phân vân): `maskConfigValue(key, value)` trong `scripts/core/secrets.mjs`:
  ```bash
  node -e "import('./scripts/core/secrets.mjs').then(m=>console.log(m.maskConfigValue(process.argv[1],process.argv[2])))" "spring.data.mongodb.uri" "mongodb://u:p@h:27017/db"
  ```
- Không đọc `.env`, `.env.*`, keystore (`*.jks`, `*.p12`), hay file bị `.gitignore` chứa secret; ghi chúng vào `coverage.skipped` với lý do `secret file`.
- Không chép secret vào `description`, `evidence`, `diagnostics`, `question`. `validate-bundle` quét lại toàn bộ bundle (rule `R7-secret`); gặp là fail.
