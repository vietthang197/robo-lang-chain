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
| `value` | giá trị đã giải ở env này, **sau khi che secret** (mục 4); **luôn là chuỗi** (kể cả số: `"8080"`, boolean: `"true"`), `null` nếu không giải được. (Ngược lại `Deployment.port` là **số nguyên**: `8080`.) |
| `masked` | `true` nếu value đã bị thay/cắt |
| `isPlaceholder` | `true` nếu giá trị gốc là `${…}` lấy từ biến môi trường không có trong repo |
| `placeholderExpr` | biểu thức gốc, ví dụ `${B_URL}` hoặc `${B_URL:http://localhost:8081}`. **Key credential** (mục 4): giữ tên biến, phần default thay bằng `***`: `${DB_PASS:s3cr3tPwd}` → `${DB_PASS:***}` (default rỗng hoặc là placeholder khác thì giữ nguyên, nhưng default lồng bên trong cũng phải che: `${A:${B:***}}`) |
| `defaultValue` | phần default trong `${KEY:default}`, đã che như `value`. **Key credential:** không ghi, hoặc ghi đúng `***` |
| `sourceFile`, `profile` | file chứa giá trị thắng, profile của file đó (`default` cho `application.yml`) |

Rule `R7-config-default` (validator): với ConfigKey có `key` khớp mẫu key credential, mỗi default trong `placeholderExpr` (kể cả default lồng bên trong) phải là `***`, rỗng, hoặc **đúng một** placeholder cân bằng `${…}` (`${A:${B}}` được; `${A:${B}s3cret${C}}` hay `${A:x${B}}` thì fail); `defaultValue` phải bỏ trống hoặc là `***`. Lý do: mẫu quét secret chung (`R7-secret`) không nhận ra mật khẩu nằm trong `${DB_PASS:s3cr3tPwd}`.

### Giải placeholder
1. `${other.key}` tham chiếu key khác trong config: thay bằng giá trị đã giải của key đó.
2. `${ENV_VAR:default}` không có trong repo: dùng `default` (đã che secret), `isPlaceholder=true`, `placeholderExpr` giữ biểu thức gốc; **riêng key credential** ghi `placeholderExpr` với default đã che (`${DB_PASS:***}`), `value: "***"`, `defaultValue: "***"` (hoặc bỏ), `masked: true`.
3. `${ENV_VAR}` không có default và không có trong repo: `value=null`, `isPlaceholder=true`, và sinh **một** Gap `missing-config-value` (askWho=`DevOps`) **cho mỗi ConfigKey**: uid `gap:<env>:<projectKey>:missing-config-value:<sha1(uid ConfigKey)[0:12]>`; cạnh `HAS_GAP` từ chính ConfigKey **và** từ mọi ClientCall dùng key đó (`USES_CONFIG`). Câu hỏi dạng: *"Ở env uat, `b-service.url` (base URL của BClient) có giá trị gì? Key lấy từ biến môi trường `B_URL` không có trong repo."*
   Key được tham chiếu trong code (`${b-service.url}` trong `@FeignClient`, `@Value`) mà không có trong file config nào: vẫn tạo ConfigKey với `value=null`, `sourceFile=null`, và Gap như trên.

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

- Mẫu key secret: `(?i)(password|passwd|pwd|secret|token|api[_-]?key|credential|private|key-store|jaas|signing[_-]?key|encryption|.pass|uri|url)` (`.pass` = `pass` đứng riêng thành một đoạn key như `ldap.bind-pass`, không bắt `passthrough`) (`SECRET_KEY` trong `<skill>/scripts/core/secrets.mjs`; `jaas` bắt `spring.kafka.properties.sasl.jaas.config`).
- Key credential thật (`password|passwd|pwd|secret|token|api[_-]?key|credential|private|key-store|jaas|signing[_-]?key|encryption|.pass`, `CREDENTIAL_KEY`; vd `payment.api_key`, `ldap.pwd`, `jwt.signing-key`, `app.encryption.key`): **value luôn thay bằng `***`**, `masked=true`, kể cả khi giá trị trông vô hại; default trong placeholder cũng che (`${DB_PASS:***}`, mục 2). Ví dụ `spring.datasource.password: secret` → `value: "***"`, `masked: true`.
- Key `uri|url`: là URL thì **giữ scheme/host/port/path, bỏ userinfo, query và fragment**; `masked=true` nếu có cắt. Ví dụ `mongodb://app:pw@db1:27017/app_db?authSource=admin` → `mongodb://db1:27017/app_db`. JDBC cũng vậy: `jdbc:mysql://root:pw@db:3306/app` → `jdbc:mysql://db:3306/app`; `jdbc:sqlserver://db:1433;user=sa;password=…` → `jdbc:sqlserver://db:1433` (bỏ `;params`); Oracle thin `jdbc:oracle:thin:USER/PASS@//db:1521/ORCL` → `jdbc:oracle:thin:@//db:1521/ORCL`. URL không tách được host khỏi credential thì `***`.
- Key bất kỳ mà value khớp mẫu secret (URL có `user:pass@`, Oracle thin `USER/PASS@`, JWT, PEM private key, `password=…`, AWS key, `Bearer <token>`, token dạng `sk-…`/`ghp_…`/`xoxb-…`) cũng che như trên.
- `${ENV_VAR}` trần không phải secret (giữ nguyên); `${VAR:default}` thì xét phần default.
- Hàm chuẩn (dùng khi phân vân): `maskConfigValue(key, value)` trong `<skill>/scripts/core/secrets.mjs`:
  ```bash
  cd <skill> && node -e "import('./scripts/core/secrets.mjs').then(m=>console.log(m.maskConfigValue(process.argv[1],process.argv[2])))" "spring.data.mongodb.uri" "mongodb://u:p@h:27017/db"
  ```
- Không đọc `.env`, `.env.*`, keystore (`*.jks`, `*.p12`), hay file bị `.gitignore` chứa secret; ghi chúng vào `coverage.skipped` với lý do `secret file`.
- Không chép secret vào `description`, `evidence`, `diagnostics`, `question`. `validate-bundle` quét lại toàn bộ bundle (rule `R7-secret`) và kiểm default của key credential (rule `R7-config-default`); gặp là fail.

`<skill>` trong các lệnh = thư mục skill `.claude/skills/code-graph-ingest`.
