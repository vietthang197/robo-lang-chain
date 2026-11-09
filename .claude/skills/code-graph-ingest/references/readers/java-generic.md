# Reader profile: `java-generic`

Đọc Java thuần **không có ngữ nghĩa Spring**: TAFJ Java extension trong repo T24, thư viện Java dùng chung, ứng dụng Java standalone (batch/CLI). Profile này chỉ dựng tầng L3 (Module, Component, Operation, Member, Tag, Library, CALLS, OVERRIDES, EXTENDS/IMPLEMENTS, USES_TYPE) cộng các điểm vào/ra rõ ràng. **Không** tạo Bean/DI, không suy Endpoint từ annotation framework. Repo Spring Boot dùng `spring-boot.md` (đã bao gồm các quy tắc L3 ở đây).

## 1. Detection

Khớp khi có `src/**/*.java` (hoặc thư mục nguồn Java khác như `java/`, `ext/`) và **không** khớp `spring-boot`. Các dạng thường gặp:
- **TAFJ extension**: trong repo T24 (đi kèm profile `t24`), có file `.java` import `com.temenos.*` hoặc được gọi từ jBC bằng `CALLJ "<FQN>", "<method>", …`.
- **Thư viện**: có `pom.xml`/`build.gradle*` với packaging `jar`, không có method `public static void main`.
- **Ứng dụng standalone**: có `public static void main(String[])`.

Trong repo T24, `java-generic` chạy **cùng projectKey** với `t24` (một Service T24); ghi cả hai vào `scan.readerProfiles`.

## 2. Inventory

Đọc: `**/*.java` dưới thư mục nguồn; `pom.xml`/`build.gradle*` (Library); `*.properties` cấu hình của ứng dụng/extension (`tafj.properties` do profile `t24` xử lý).

Bỏ qua (ghi `coverage.skipped` kèm lý do): `target/**`, `build/**`, `out/**`, `bin/**`, `*.class`, `*.jar` (build output / binary; jar trong `lib/` chỉ dùng để suy `Library`), `**/generated*/**` (sinh tự động), `src/test/**` (test), `.idea/**` (IDE), `.env*`, keystore (secret).

Thứ tự: build file → class có `main` hoặc class được `CALLJ` gọi (điểm vào) → các class chúng dùng → còn lại. Chia subagent theo package cấp 1 hoặc theo module build, ≤ ~40 file mỗi phần. `filesTotal`/`filesRead` đếm như `_contract.md` §2.

## 3. Bảng mapping

| Native | Vertex chuẩn | kind / stereotype | qualifiedName |
|---|---|---|---|
| repo/ứng dụng (khi chạy một mình) | `Service` + `Deployment` | `kind=service`; `techStack=[java]` (+ `tafj`, `library`) | projectKey |
| package | `Module` | `kind=java-package` | tên package |
| class / interface / enum / record | `Component` | `kind=java-class|java-interface|java-enum|java-record`; `stereotype`: `t24-java-extension` (TAFJ, được CALLJ gọi), `main` (có `main`), `dto` (chỉ chứa dữ liệu), còn lại bỏ trống | FQN (nested: `Outer$Inner`) |
| method, constructor có logic | `Operation` | `kind=java-method` | `<FQN>#<method>` (`~n` cho overload; constructor: `<FQN>#<init>`) |
| field | `Member` | `kind=java-field` | `<FQN>#<field>` |
| `extends` / `implements` | `EXTENDS` / `IMPLEMENTS {typeArgs}` | | supertype ngoài project → `Component` `ext:<FQN>` (`external:true`) |
| annotation | `Tag` + `TAGGED {attributes}` | `kind=java-annotation` | `tag:java:<FQN>` |
| dependency (pom/gradle/`lib/*.jar`) | `Library` + `DEPENDS_ON` | `kind=maven|gradle|jar` | `lib:maven:<groupId>:<artifactId>`; jar rời: `lib:jar:<tên file không version>` |

Không tạo Operation cho getter/setter/`equals`/`hashCode`/`toString` tầm thường và constructor chỉ gán field.

## 4. Công thức trích xuất

- **Endpoint:**
  - Ứng dụng standalone: method `main` → `Endpoint` `protocol=batch`, `signature=<FQN class main>`, uid `<env>:<pk>:endpoint:batch:<FQN>`; `Operation#main -EXPOSES-> Endpoint`.
  - TAFJ extension: không tạo Endpoint (điểm vào là jBC `CALLJ`); Operation được gọi có `props.entry=true` và `CALLS {dispatch:'call'}` từ routine jBC do profile `t24` ghi, trỏ tới uid `<env>:<projectKey>:operation:<FQN>#<method>` (vì vậy uid phải đúng công thức để cạnh từ phía jBC khớp).
  - Thư viện: không có Endpoint; xem §7 về Service surface.
- **ClientCall:** `java.net.http.HttpClient`, `HttpURLConnection`, Apache/OkHttp client → `clientKind=http-client`; JDBC (`DriverManager.getConnection`) → không phải ClientCall mà là DataStore. Quy tắc trường như `../cross-service.md` §1.2; base URL từ `*.properties`/hằng số; không thấy → Gap `unresolved-call`.
- **DataStore + mode:** JDBC `PreparedStatement` với SQL literal → `ds:<env>:<db tech>:<schema>.<table>`, mode theo câu lệnh (`SELECT` → `read`, `INSERT|UPDATE|DELETE|MERGE` → `write`); file I/O với đường dẫn từ config → `ds:<env>:filesystem:<path>`. Không rõ → Gap `unknown-datastore`.
- **Channel:** client JMS/Kafka/MQ thuần (`MessageProducer.send`, `KafkaProducer.send`) → ClientCall producer + `PUBLISHES`; consumer loop → `SUBSCRIBES`.
- **CALLS:** như `spring-boot.md` §4.5 (receiver type, `dispatch:'static'|'interface'`, `lines`, `resolved`; gọi qua interface → `OVERRIDES`; không giải được → `ext:` với `resolved:false`; bỏ JDK/tiện ích tầm thường). Gọi method kế thừa từ supertype ngoài: `../schema.md` §6.
- **TRIGGERS:** `Thread`/`Runnable`/`ExecutorService.submit` → `TRIGGERS {event:'thread'}`; `Timer`/`ScheduledExecutorService` → `event:'schedule'`; listener đăng ký thủ công → `event:'listener'`.
- **Bean/DI:** không áp dụng (không có container DI). Nếu phát hiện framework DI (Guice, CDI, Dagger) thì ghi diagnostics và dùng `Bean`/`INJECTS` như `spring-boot.md` §4.7 với `framework` tương ứng.
- **Member:** field của dto/model/config; bỏ hằng số `static final` trừ khi là URL/key config (khi đó dùng làm nguồn cho ClientCall).
- **USES_TYPE:** tham số/kiểu trả về/field là Component của project → `USES_TYPE {role:'param'|'return'|'field'}`.

## 5. Config theo env

- File: `*.properties`/`*.yml` của ứng dụng trên branch của env; nếu có biến thể theo env (`config-uat.properties`, thư mục `uat/`), chọn theo tên env. Với TAFJ: `tafj.properties` và environment do profile `t24` đọc.
- Thứ tự giải và placeholder: `../config-and-env.md` §2 (tương tự Spring: file theo env > file chung > default trong code).
- `Deployment`: ứng dụng standalone/thư viện thường không có port → `port=null`, `contextPath=null`, `hosts=[]`. TAFJ extension dùng Deployment của Service T24.
- Secret: theo `../config-and-env.md` §4; thêm các key JDBC (`*.jdbc.password`, `*.jdbc.url` cắt userinfo).

## 6. Gợi ý mô tả

- TAFJ extension: mô tả theo nghiệp vụ mà routine jBC gọi nó cần ("Tính phí chuyển khoản theo biểu phí ngoài", "Ký số dữ liệu trước khi gửi đối tác"), nêu routine/VERSION gọi tới (evidence là uid Operation phía jBC khi đã có).
- Thư viện: `summary` nói thư viện cung cấp gì và ai dùng (nếu biết); `responsibilities` theo nhóm API public; `notResponsibleFor` các việc thư viện để cho bên dùng.
- Ứng dụng batch: Capability theo job ("Đối soát giao dịch cuối ngày").
- Thuật ngữ: biểu phí (fee schedule), đối soát (reconciliation), ký số (digital signature), mã hoá (encryption), hạch toán (posting).

## 7. Bẫy thường gặp

| Bẫy | Xử lý đúng |
|---|---|
| Áp ngữ nghĩa Spring cho Java thuần (tạo Bean, Endpoint từ annotation lạ) | Không; chỉ L3 + điểm vào/ra rõ ràng |
| Thư viện thuần không có Endpoint/Channel làm fail `R5-service-surface` | Ingest thư viện riêng chỉ khi catalog yêu cầu; khi đó ghi Gap `low-confidence-description` (askWho=`BA`) gắn vào Service, câu hỏi: "Thư viện `<tên>` được những service nào dùng, cho chức năng gì?". Thông thường thư viện chỉ xuất hiện qua `lib:` + `FROM_LIBRARY` từ project dùng nó |
| uid Operation của TAFJ extension không khớp với `CALLJ` phía jBC | Dùng đúng `<FQN>#<method>` như chuỗi trong `CALLJ`; overload thì `~n` và ghi `signature` |
| Reflection / `Class.forName(...)` | `CALLS` tới `ext:`/đích đoán được với `resolved:false`, diagnostics `warn` |
| Code trong jar không có source | Không đọc binary; chỉ ghi `Library`, kiểu dùng tới thành `ext:` Component |
| ext: uid ghi sai loại vertex giữa các project | Type luôn `Component`, `#op` luôn `Operation` (`../schema.md` §2.1) |

## 8. Conformance

- **Fixture:** chưa có fixture riêng. Mapping L3 (Module/Component/Operation/Member, CALLS, OVERRIDES, EXTENDS, USES_TYPE, TAGGED, Library) được kiểm qua `templates/fixtures/spring-boot/expected/*.bundle.json`; phần TAFJ extension sẽ được kiểm cùng fixture `templates/fixtures/t24/` (một routine `CALLJ` sang một class Java).
- **Rule riêng:** chưa có (`profileRules['java-generic']` trả về `[]`); bundle chỉ cần qua các rule chung (`../bundle-format.md` §5): `node <skill>/scripts/validate-bundle.mjs <bundle> --profile java-generic`.
- **Trích đoạn kỳ vọng** (phần L3, lấy từ fixture b-service):
```json
{ "type": "EXTENDS", "from": "uat:b-service:component:com.example.b.repository.ItemRepository",
  "to": "ext:org.springframework.data.mongodb.repository.MongoRepository", "props": { "typeArgs": ["com.example.b.model.Item", "String"] } }
{ "type": "USES_TYPE", "from": "uat:b-service:operation:com.example.b.controller.ItemController#getItem",
  "to": "uat:b-service:component:com.example.b.model.Item", "props": { "role": "return" } }
```
