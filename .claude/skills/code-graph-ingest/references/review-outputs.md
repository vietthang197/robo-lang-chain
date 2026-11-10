# Đầu ra để review: topology report và studio queries

Lệnh `report --env <env>` tạo `code-graph-workspace/<env>/topology-report.md` và `studio-queries.md` để người review topology và để kiểm tra nhanh graph trước khi agent SA dùng. Chỉ đọc DB (không ghi).

## 1. Chạy

Chạy sau `link --env <env>` (rollup `SERVICE_DEPENDS_ON`, `OWNS_DATA`, `READS_DATA` do link sinh; chưa link thì ma trận phụ thuộc rỗng).

`<skill>` = thư mục skill `.claude/skills/code-graph-ingest`.

```bash
cd code-graph-workspace/uat
# 1. TRƯỚC KHI ghi kết quả query mới: giữ bản của lần trước để so (bỏ qua ở lần đầu)
[ -f report-data.json ] && cp report-data.json report-data.prev.json
# 2. lấy câu query
node <skill>/scripts/print-queries.mjs report --env uat        # JSON [{name, cypher}]: services, dependencies, dataOwnership, gaps
# 3. chạy từng câu qua MCP ArcadeDB `query` (language cypher, database CodeGraph);
#    lưu {"services": [...], "dependencies": [...], "dataOwnership": [...], "gaps": [...]} vào report-data.json (ghi đè)
# 4. dựng report
node <skill>/scripts/make-report.mjs report-data.json topology-report.md --env uat --prev report-data.prev.json
```

- Lần đầu (chưa có `report-data.prev.json`): bỏ `--prev`; mục "Thay đổi" ghi "Lần đầu tạo report".
- `make-report` ghi luôn `studio-queries.md` cạnh `topology-report.md`.
- `node <skill>/scripts/print-queries.mjs studio --env uat` in riêng các câu studio nếu chỉ cần chúng.
- Lưu `records` đúng như MCP trả về (mảng object, tên cột theo `AS` trong câu query); không sửa tay.

## 2. Đọc `topology-report.md`

| Mục | Nội dung | Kiểm tra gì |
|---|---|---|
| **Services theo Domain/Layer** | bảng service (Domain, Layer, Summary, Capabilities, Độ phủ) + thẻ từng service (summary, trách nhiệm, không phụ trách, capabilities, tech stack, owner team) | Service nằm ở `(chưa phân loại)` → catalog thiếu `domain`/`layer`, xem `catalog-proposal.yaml`. Độ phủ `filesRead/filesTotal` < 95% → xem `coverage.skipped` và Gap `unread-files`. Summary mơ hồ → sửa theo `describe-guide.md` |
| **Phụ thuộc** | ma trận Caller × đích; ô dạng `<protocol>×<callCount> · <N> ep`, `(async)` cho phụ thuộc qua Channel, `?` cho confidence thấp | Ô thiếu so với kiến trúc đã biết → ClientCall chưa khớp (xem Gap); đích là IP/host lạ → ExternalSystem, có thể là service chưa ingest |
| **Dữ liệu** | DataStore → Owner (ghi) / Readers (đọc) | DataStore có nhiều owner → chia sẻ DB giữa service, cần xác nhận; DataStore không owner/reader → `ACCESSES` thiếu |
| **Gap đang mở** | gom theo askWho (`BA`, `DevOps`, `Dev`); mỗi dòng: câu hỏi, kind, uid node gắn Gap | Gửi câu hỏi cho đúng người. Câu trả lời cho `ambiguous-target`/`unknown-external` ghi vào `gapAnswers` của catalog (**ruling R17**), rồi chạy lại `link`. Gap `unresolved-call` do link sinh (câu hỏi "…trỏ tới host/port của X nhưng không khớp endpoint nào (context-path …)") là **dấu hiệu lệch context-path** (ruling R20): base URL của bên gọi thiếu context-path của X, hoặc path/method sai; một phụ thuộc lẽ ra phải có đang bị thiếu trong ma trận. Dev sửa config/code rồi ingest lại bên gọi; `gapAnswers` không đóng được loại này |
| **Thay đổi so với lần trước** | service, phụ thuộc, capability mới/mất | Mất bất ngờ → kiểm tra ingest gần nhất (branch sai, file bị bỏ qua) |

## 3. `studio-queries.md`

Các câu Cypher dán vào ArcadeDB Studio (graph view):
1. Toàn cảnh L1: service và `SERVICE_DEPENDS_ON`.
2. Theo domain: thay `<domain>` bằng slug (`domain:<slug>`).
3. Một service từ L1 xuống L2: thay `<projectKey>`; Service → Capability, Deployment → Endpoint.
4. Chuỗi Endpoint → DataStore: `EXPOSES` ← Operation; điểm xuất phát là **cả** Operation đó **và** Component `CONTAINS` nó (ruling R22), rồi `CALLS|TRIGGERS*0..4` (ruling R21), lùi tối đa một cạnh `OVERRIDES` (gọi qua interface: `CALLS` dừng ở Operation của interface, Operation của `*Impl` `OVERRIDES` nó), tiếp `CALLS|TRIGGERS*0..4` → `ACCESSES` → DataStore. Nhờ vậy hook gắn ở Component (T24 VERSION `-TRIGGERS->` routine) cũng hiện trong chuỗi. Chuỗi đứt thường do vi phạm quy tắc gọi method kế thừa (`schema.md` §6).
5. Gap đang mở và node gắn Gap.

## 4. Sau khi review

- Sửa mô tả sai: sửa trong DB với `descriptionSource='human'` (không bị ghi đè ở lần scan sau) hoặc sửa nguồn rồi ingest lại.
- Domain/Layer: duyệt `catalog-proposal.yaml` vào `system-catalog.yaml`, ingest lại project để ghi `IN_DOMAIN`/`IN_LAYER`.
- Gap đã trả lời: chỉ qua `gapAnswers` (TARGETS) hoặc sửa config/code rồi ingest lại (missing-config-value, unresolved-call).
