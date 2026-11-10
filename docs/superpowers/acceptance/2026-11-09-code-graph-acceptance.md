# Nghiệm thu skill `code-graph-ingest` trên robo-lang-chain (env dev)

- Ngày chạy: 2026-11-10 (UTC). Người chạy: agent theo `.claude/skills/code-graph-ingest/SKILL.md`.
- Project: `robo-lang-chain`, repo `D:/IdeaProjects/robo-lang-chain`, env `dev` → branch `master` @ `f2b3b3016d9ede300932c7c55b9632c8c3d29816` (git worktree riêng, ngoài checkout của người dùng).
- Workspace: thư mục scratchpad của phiên (`.../scratchpad/code-graph-workspace`), nằm ngoài repo được scan. `system-catalog.yaml`: `branches {dev: master}`, `readerProfiles [spring-boot]`, `domain document-ai`, `layer core-service`.
- Database: ArcadeDB `CodeGraph` qua MCP (`mcp__arcadedb__execute_command` / `mcp__arcadedb__query`). Không đụng `OpenBeer`.
- Topology report sinh ra: [`2026-11-09-topology-dev.md`](2026-11-09-topology-dev.md).

## 1. Xoá dữ liệu demo (spec §14)

| Bước | Kết quả |
|---|---|
| Trước khi xoá | 193 node `CodeNode`, 347 cạnh; 138 node "legacy" (không có `env`) theo câu query Pha 0 bước 6 |
| `MATCH (n:CodeNode) DETACH DELETE n` (người dùng đồng ý: "Xoá demo, chạy thật") | OK |
| `MATCH (n:CodeNode) RETURN count(n)` | **0**; `MATCH (n) RETURN count(n)` cũng 0 |

## 2. Ingest `robo-lang-chain --env dev`

| Pha | Kết quả |
|---|---|
| 0 | Worktree `master` sạch, `commitSha` f2b3b30, `scanId = dev-robo-lang-chain-20261110T000332Z` |
| 1 | Detection: `spring-boot` (pom có `spring-boot-starter-parent` 3.5.14, `@SpringBootApplication` ở `RoboLangChainApplication`), khớp catalog. Inventory 33 file (pom.xml, application.properties, 31 file Java), skipped: `src/test/**`, `.mvn/**`, `mvnw*`, `.git*`, `README.md`, `--compose.yaml--` (đều có lý do). Không đọc file secret |
| 2-5 | Một part `bundle.part-_root.json` (repo ≤ 150 file). 258 node, 439 cạnh, 8 Gap |
| 6 | `validate-bundle --profile spring-boot`: **0 error**, 3 warning (`W-unreachable-operation` cho `DocumentRagProcessor#process`, `W-single-endpoint-capability` ×2). `diff.md` lần đầu: +258 node, +439 cạnh |
| 7 | 47 lô. Lô `103-nodes-Service` lỗi lần đầu (defect D1, đã sửa, nạp lại lô đó). `990-count` = **195** = `expectNodes` 195. Cạnh có `scanId` của lần scan: 439 = số cạnh bundle |

Thành phần bundle: Service 1, Deployment 1 (port 8080 mặc định, contextPath null, profilesActive [dev]), Environment/Domain/Layer 1/1/1, Module 12, Component 47 (13 `ext:`), Operation 47 (11 `ext:`), Member 45, Bean 30, Endpoint 6 (3 http + 3 `langchain4j-tool`), Capability 3, ClientCall 8 (5 Ollama, 3 MCP stdio), ConfigKey 11, DataStore 4, Library 16, Tag 16, Gap 8 (`unresolved-call`, askWho Dev).

Secret: `spring.data.mongodb.uri` lưu thành `mongodb://<mongo-host>:27017/app_db` (`masked: true`, bỏ userinfo và query); grep bundle không còn userinfo/`authSource`. `RoboLangChainApplication.java` trên `master` không in credential (bản sửa in credential chỉ nằm trong working copy chưa commit của người dùng, không được scan).

## 3. Câu hỏi BA (spec §13.3): từ path `/document/rag/process/{documentId}`

Query 1 (Endpoint → Service + thẻ service):
```cypher
MATCH (ep:Endpoint) WHERE ep.env = 'dev' AND ep.path = '/document/rag/process/{documentId}'
MATCH (d:Deployment)-[:SERVES]->(ep) MATCH (s:Service)-[:DEPLOYED_AS]->(d)
RETURN ep.signature, s.uid, s.summary, size(s.responsibilities), ep.description
```
Kết quả: `GET /document/rag/process/{documentId}` → `dev:robo-lang-chain:service:robo-lang-chain`; summary "robo-lang-chain là API chat AI xây trên Spring Boot và langchain4j …", 6 responsibilities, 4 notResponsibleFor, mô tả Endpoint đầy đủ (input, PDF-only, Qdrant, lỗi).

Query 2 (chuỗi tới DataStore). Câu "Chuỗi Endpoint → DataStore" của `studio-queries.md` **trước khi sửa** trả **0 dòng** (defect D2: `CALLS` dừng ở `DocumentRagProcessingService#process` của interface). Sau khi sửa (lùi qua `OVERRIDES`):
```cypher
MATCH (ep:Endpoint)<-[:EXPOSES]-(op:Operation) WHERE ep.env = 'dev' AND ep.path = '/document/rag/process/{documentId}'
MATCH (op)-[:CALLS*0..4]->(m:Operation) OPTIONAL MATCH (impl:Operation)-[:OVERRIDES]->(m)
WITH DISTINCT [x IN [m, impl] WHERE x IS NOT NULL] AS hops UNWIND hops AS h
MATCH (h)-[:CALLS*0..4]->(n:Operation)-[a:ACCESSES]->(ds:DataStore)
RETURN DISTINCT n.qualifiedName, a.mode, ds.uid
```
| accessor | mode | DataStore |
|---|---|---|
| `PdfRagProcess#process` | rw | `ds:dev:filesystem:D:/upload` |
| `FileManagementRepository#findById` | read | `ds:dev:mongodb:app_db.fileManagementDocument` |
| `FileManagementRepository#save` | write | `ds:dev:mongodb:app_db.fileManagementDocument` |
| `PdfRagProcess#process` | write | `ds:dev:qdrant:documents` |

Chuỗi: `DocumentRagController#process` -CALLS-> `DocumentRagProcessingService#process` <-OVERRIDES- `DocumentRagProcessingServiceImpl#process` -CALLS-> `FileManagementRepository#findById|save` (kế thừa, `OVERRIDES ext:MongoRepository#…`) và -CALLS-> `PdfRagProcess#process` -ACCESSES-> Qdrant `documents`. **Đạt** (cả `ds:dev:mongodb:app_db.fileManagementDocument` và `ds:dev:qdrant:documents`).

Câu studio đã sửa chạy trên toàn env dev: 13 dòng; cặp Endpoint → DataStore: `/document/rag/process` → filesystem, fileManagementDocument, qdrant; `POST /chat` → fileManagementDocument, qdrant; `POST /file/upload` → filesystem, fileManagementDocument; tool `image_to_markdown` → filesystem, fileManagementDocument.

## 4. Idempotency

| Kịch bản | Kết quả |
|---|---|
| Ingest lại, code không đổi (scanId mới) | `validate` 0 error; `diff-bundle bundle.prev.json → bundle.json`: **+0 −0 ~0 node, +0 −0 cạnh**; `expectNodes` 195 (không đổi) |
| Xoá `DocumentRagController.java` trên **bản copy scratch** của worktree (không đụng checkout của người dùng, không commit) rồi ingest | `validate` 0 error; diff: **−5 node** (Component `DocumentRagController`, Operation `#process`, Endpoint `GET /document/rag/process/{documentId}`, Bean `documentRagController`, Capability `document-rag-processing`), −14 cạnh, ~1 (evidence của Service); **0 node `ext:`/`lib:`/`tag:` bị xoá** (24/16/16 trước và sau); `expectNodes` 190 |
| Khôi phục file, ingest lại | diff so với bundle gốc: +0 −0 ~0 |
| Phía DB | Các lần ingest lại **chưa nạp vào DB** (xem D5: mỗi lần nạp phải chuyển ~250 KB Cypher qua lời gọi MCP của agent). Kiểm tra thay thế trên DB: mọi node `ext:`/`lib:`/`tag:`/`ds:`/`sys:`/L0 có `projectKey = null` (0/24, 0/16, 0/16, 0/4, 0/1), nên `900-cleanup` (lọc `{env, projectKey}`) không thể xoá chúng; 990-count của lần nạp thật = 195 khớp |

## 5. Link và report

| Bước | Kết quả |
|---|---|
| `print-queries link` → 8 câu qua MCP → `link-input.json` | clientCalls 8, endpoints 6, deployments 1, services 1, accesses 12, externals/channels/subscriptions 0 |
| `link-plan` | 5 `TARGETS` (5 lời gọi Ollama → `sys:dev:localhost`, matchedBy host, medium), 1 `SERVICE_DEPENDS_ON` (robo-lang-chain → `sys:dev:localhost`, http ×5), 4 `OWNS_DATA`, 3 Gap `unknown-external` (3 MCP stdio) |
| `validate-bundle link-bundle.json` | 0 error, 0 warning |
| Nạp 10 lô link | `990-count` = **4** = `expectNodes` |
| `report` | `topology-report.md`: robo-lang-chain dưới Domain **Document AI**, Layer core-service, độ phủ 33/33, 3 capability; ma trận phụ thuộc robo-lang-chain → localhost `http×5`; 4 DataStore owner robo-lang-chain; 11 Gap mở (Dev 8, DevOps 3) |
| Ollama là ExternalSystem | Có: `sys:dev:localhost` (port 11434) — tên theo host vì `ollama.base.url = http://localhost:11434` |
| MCP server là ExternalSystem | **Không**: MCP chạy qua stdio (không có host) nên link sinh Gap `unknown-external`; skill chưa có cách mô hình hoá (D6) |

Tổng DB sau link: 262 node (`dev:` 187, `gap:` 11, `ext:` 24, `lib:` 16, `tag:` 16, `ds:` 4, `sys:` 1, L0 3), 452 cạnh.

## 6. Defect của skill

| # | Mức | Mô tả | Xử lý |
|---|---|---|---|
| D1 | Chặn | `bundle-to-cypher` ghi `Service.coverage` (map) và mọi prop map / list-of-map (TAGGED `attributes`, Gap `candidates` có phần tử) trực tiếp; ArcadeDB từ chối: `InvalidPropertyType - Property values can only be of primitive types or arrays thereof`. Lô `103-nodes-Service` lỗi | **Đã sửa** commit `26ce980`: map/list-of-map lưu thành chuỗi JSON (`storable`), `make-report` parse lại `coverage`; test mới trong `batches.test.mjs`, `report.test.mjs` |
| D2 | Chặn (cho §13.3) | Câu studio "Chuỗi Endpoint → DataStore" chỉ đi `CALLS|TRIGGERS`; với mẫu Spring phổ biến (controller → service interface → `*Impl`), `CALLS` dừng ở Operation của interface (đúng theo spring-boot.md §4.5) nên chuỗi luôn đứt (0 dòng) | **Đã sửa** commit `3b4a0db`: lùi tối đa một cạnh `OVERRIDES` rồi đi tiếp; cập nhật `review-outputs.md`, test `queries.test.mjs` |
| D3 | Nhỏ | Mẫu key credential khớp `token` trong `scoring.model.tokenizer.path` → giá trị (đường dẫn file) bị che `***` | Ghi nhận, không sửa (an toàn); có diagnostic trong bundle |
| D4 | Nhỏ | Không có hướng dẫn cho client SDK (langchain4j Ollama, Qdrant gRPC, MCP stdio): path HTTP do thư viện dựng nên theo quy tắc phải dùng `?`/`ANY` + Gap `unresolved-call` cho mỗi chỗ gọi → 5 Gap Dev ít giá trị. Chỗ gắn ClientCall cho AI service declarative (`AiServices`) và bean cấu hình MCP cũng không được nêu | Ghi nhận; đã chọn: ClientCall gắn vào `RoboAssistant#chat` (giống Feign interface), MCP gắn vào `McpProviderConfiguration#mcpToolProvider` |
| D5 | Lớn (vận hành) | Pha 7 bắt agent đọc rồi gửi lại nguyên nội dung từng lô qua MCP: repo 33 file đã là 47 lô ~250 KB Cypher (~150k token mỗi lần nạp). Repo > 150 file hoặc ingest lại nhiều lần sẽ vượt ngân sách context; nghiệm thu không nạp lại được 3 lần ingest idempotency | Ghi nhận; cần cách nạp không đi qua context (ví dụ MCP tool đọc file, hoặc lô nhỏ hơn bằng cách bỏ prop dư thừa) |
| D6 | Trung bình | Link chỉ tạo `ExternalSystem` từ host; tích hợp không có host (MCP stdio, file model ONNX cục bộ) chỉ thành Gap `unknown-external`, và `gapAnswers` chỉ nhận `targetService` (projectKey) nên không đóng được Gap này. Câu hỏi Gap của link với lời gọi không có method/URL in nguyên uid ClientCall (khó đọc) | Ghi nhận |
| D7 | Nhỏ | Profile spring-boot không nói gì về file docker-compose (repo có `--compose.yaml--`), README, hay khi không có `application-<env>.*` (profilesActive ghi gì) | Ghi nhận; đã bỏ qua compose có lý do, ghi `profilesActive: [dev]` + diagnostic |
| D8 | Nhỏ | `990-count` trong `link` đếm theo `scanId` nên chỉ xác nhận node do link ghi, không phát hiện được cạnh `TARGETS` thiếu | Ghi nhận |
| D9 | Nhỏ | SKILL.md Pha 7: khi writer được sửa giữa chừng, không nói có được sinh lại lô với cùng `scanId` không (bước 1 nói "bỏ qua khi đang nạp tiếp và cùng scanId") | Đã sinh lại lô với cùng scanId (MERGE nên an toàn), chỉ gửi lại lô thay đổi chưa nạp |

Ngoài ra (quy trình): lô `104-nodes-Deployment` được gửi trong cùng lượt với lô `103` bị lỗi nên đã chạy sau lỗi; vô hại (MERGE) nhưng trái quy tắc "dừng ngay". Ghi nhận để lần sau gửi tuần tự.
