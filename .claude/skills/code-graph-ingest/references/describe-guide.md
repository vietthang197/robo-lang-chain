# Hướng dẫn viết mô tả

Mô tả là thứ agent Solution Architect đọc để hiểu **mỗi service làm gì, chịu trách nhiệm gì, gọi đi đâu**. Viết cho người (và agent) chưa từng mở code. Pha 5 (Mô tả) chạy **từ dưới lên**: Operation → Component → Endpoint → Capability → thẻ Service; tầng trên chỉ tổng hợp từ tầng dưới + bằng chứng trong code.

## 1. Quy tắc chung

- **Ngôn ngữ:** `description`, `summary`, `responsibilities[]`, `notResponsibleFor[]`, `question` của Gap viết **tiếng Việt**; giữ nguyên thuật ngữ kỹ thuật tiếng Anh (`controller`, `Feign client`, `MongoDB collection`, `endpoint`, `context-path`, tên class/method/path/key config). `businessTerms[]` ghi cả tiếng Việt lẫn tiếng Anh nếu có, ví dụ `"tra cứu item (item lookup)"`.
- **Bằng chứng:** node nào có `description` thì **bắt buộc** có `evidence[]` (không rỗng) và `confidence` (rule `R6-description-evidence`). Mỗi phần tử evidence là `file:line` (đường dẫn tương đối từ gốc repo) hoặc uid của node khác đã có trong bundle. Tầng thấp (Operation, Component) dẫn `file:line`; tầng cao (Endpoint, Capability, Service) dẫn uid của tầng dưới, có thể thêm `file:line`.
- **Bắt buộc có mô tả** (rule `R6-required-description`): Component `stereotype=controller|service`, mọi `Endpoint`, mọi `Capability` (trừ node `external`). Nên có: Service (thẻ service), Operation là entry/handler/method public có logic, repository, entity, ClientCall, DataStore.
- **`confidence`:**
  - `high`: thấy trực tiếp trong code/config (annotation, lời gọi, giá trị config).
  - `medium`: suy ra từ nhiều dấu hiệu rõ ràng nhưng có bước ghép (URL ghép chuỗi, tên bảng theo quy ước đặt tên).
  - `low`: phải đoán ý nghĩa nghiệp vụ. Khi đó **bắt buộc** sinh Gap `low-confidence-description` (askWho=`BA`, câu hỏi nêu điều chưa chắc) gắn vào node bằng `HAS_GAP`.
- **`descriptionSource`:** AI viết thì `ai`; lấy từ tài liệu (README, Javadoc, spec BA) thì `doc` và evidence dẫn tới tài liệu đó. `human` chỉ do người sửa; mô tả `human` đã lưu trong DB **không bao giờ bị ghi đè** (writer giữ nguyên), nên đừng tốn công viết lại.
- **Cấm:**
  - Bịa tên hệ thống, URL, nghiệp vụ, tên bảng không thấy trong code/config.
  - Chép secret, password, token, connection string có userinfo, hay dữ liệu cá nhân vào mô tả (validator rule `R7-secret` sẽ fail).
  - Mô tả getter/setter, constructor chỉ gán field, hàm tiện ích tầm thường.
  - Mô tả lại tên method bằng chữ ("Hàm getItem lấy item") mà không thêm thông tin.

## 2. Theo từng tầng (một ví dụ tốt, một ví dụ xấu)

### 2.1 Operation: 1–2 câu: làm gì, đọc/ghi gì, gọi đi đâu
- Tốt: `"Kiểm tra id (rỗng thì ném IllegalArgumentException), sau đó gọi BClient.getItem để lấy item từ b-service."` evidence `["src/main/java/com/example/a/service/ItemService.java:17", "…:19"]`, confidence `high`.
- Xấu: `"Phương thức getItem của ItemService dùng để get item."` (lặp tên, không nói đọc/ghi/gọi gì, không có evidence).

### 2.2 Component: 1–3 câu: vai trò trong service, nhận gì, giao việc cho ai
- Tốt: `"REST controller của b-service cho tài nguyên /items; đọc item qua ItemRepository và trả 200 hoặc 404."`
- Xấu: `"Controller quan trọng xử lý mọi nghiệp vụ item của hệ thống ngân hàng."` (phóng đại, bịa "ngân hàng", không nói giao việc cho ai).

### 2.3 Endpoint: input chính, kết quả, tác dụng phụ (ghi DB, gọi hệ thống khác), điều kiện lỗi chính
- Tốt: `"Tra cứu một item theo id. Input: id trên path. Kết quả: ItemDto (id, name) lấy từ b-service qua GET /items/{id}. Lỗi: id rỗng gây IllegalArgumentException; lỗi từ b-service được Feign ném lại."` evidence gồm uid Operation handler/ClientCall và `file:line` của mapping.
- Xấu: `"API GET /api/items/{id}."` (chỉ lặp signature; agent SA không biết nó làm gì, có gọi đi đâu không).

### 2.4 Capability: gom Endpoint/Channel/Job cùng mục đích nghiệp vụ; `name` dạng động từ + đối tượng
- Tốt: `name: "Tra cứu item"`, `description: "Cung cấp thông tin item theo id từ kho dữ liệu item (MongoDB collection items) do b-service sở hữu."`, `businessTerms: ["item", "tra cứu item (item lookup)"]`, evidence là uid các Endpoint/DataStore, có `REALIZED_BY` tới từng Endpoint. Slug uid: kebab-case tiếng Anh ngắn, ví dụ `item-lookup`.
- Xấu: `name: "ItemController"` (tên kỹ thuật, không phải nghiệp vụ) hoặc một Capability cho mỗi Endpoint khi chúng cùng phục vụ một việc.

### 2.5 Thẻ Service (`Service.props`)
- `summary`: 2–3 câu; `responsibilities`: 3–7 ý; `notResponsibleFor`: những việc dễ bị gán nhầm cho service này; `businessTerms`; `techStack`; `description` có thể trùng ý summary nhưng cụ thể hơn; evidence là uid của Endpoint/Operation/ClientCall chính.
- Tốt:
  ```json
  "summary": "a-service là lớp proxy tra cứu item: nhận request REST từ client và lấy dữ liệu item từ b-service qua Feign client. Service không lưu dữ liệu item.",
  "responsibilities": ["Cung cấp API REST GET /api/items/{id} để tra cứu item theo id",
                       "Kiểm tra tham số id trước khi gọi tiếp (id rỗng thì báo lỗi)",
                       "Gọi b-service qua Feign client BClient với base URL cấu hình b-service.url"],
  "notResponsibleFor": ["Không lưu trữ hay sở hữu dữ liệu item (dữ liệu nằm ở b-service)", "Không tạo hoặc sửa item"]
  ```
- Xấu: `"summary": "Microservice Spring Boot."`, `"responsibilities": ["Xử lý request"]`, `notResponsibleFor` rỗng (không giúp agent SA phân biệt service này với service khác).

## 3. Đề xuất Domain/Layer

AI **chỉ đề xuất** domain/layer vào `catalog-proposal.yaml` (không ghi `IN_DOMAIN`/`IN_LAYER` khi catalog chưa có). Khi `system-catalog.yaml` đã có `domain`/`layer` cho service thì mới ghi node `Domain`/`Layer` và cạnh `IN_DOMAIN`/`IN_LAYER` với `props.source = "catalog"`.
