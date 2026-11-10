---
name: code-graph-ingest
description: >-
  Dựng và cập nhật code graph GraphRAG-ready của cả hệ sinh thái microservice (Spring Boot, Java, T24; sau này BPM, micro-frontend, mobile)
  trong ArcadeDB (database CodeGraph), theo từng env (dev, uat). Dùng khi người dùng muốn: "scan/ingest project vào graph",
  "mô hình hoá source lên ArcadeDB", "đưa repo X (env uat) lên code graph", "link service", "nối lời gọi giữa các service",
  "topology report", "báo cáo topology", "GraphRAG ecosystem"; hoặc in English: ingest/scan a repo into the code graph,
  model source code in ArcadeDB, link services / resolve cross-service calls, build a topology report. Ba lệnh:
  ingest <repoPath> --project <key> --env <dev|uat>, link --env <env>, report --env <env>.
---

# code-graph-ingest

Skill này dạy agent đọc source của **một project ở một env**, map vào **mô hình graph chuẩn** dùng chung cho mọi công nghệ, ghi ra một **bundle** JSON, validate, rồi nạp vào ArcadeDB qua MCP. Sau đó `link` nối lời gọi giữa các service, `report` xuất topology để người review. Graph này là nền cho agent Solution Architect (GraphRAG) trả lời "service nào làm gì, gọi ai, dữ liệu nằm đâu".

SKILL.md chỉ mô tả **quy trình** (pha, việc làm, đọc tài liệu nào, lệnh nào, điều kiện qua pha). Chi tiết nằm trong `references/`; đọc đúng file khi bước yêu cầu, đừng làm theo trí nhớ.

## Khi nào dùng

| Người dùng muốn | Lệnh |
|---|---|
| Đưa một repo (một project, một env) lên graph, hoặc cập nhật sau khi code đổi | `ingest <repoPath> --project <key> --env <dev\|uat>` |
| Nối ClientCall với Endpoint/Channel của service khác, tính phụ thuộc service, áp câu trả lời Gap | `link --env <env>` (luôn chạy sau mỗi `ingest`) |
| Xem topology, ma trận phụ thuộc, Gap đang mở, câu query cho ArcadeDB Studio | `report --env <env>` |
| Dọn node dùng chung không còn cạnh | `## Bảo trì` (chỉ khi người dùng yêu cầu) |

Không dùng skill này để sửa code của repo được scan, hay để trả lời câu hỏi kiến trúc (đó là việc của agent đọc graph).

## Quy ước chung

- `<skill>` = thư mục skill `.claude/skills/code-graph-ingest`. **Mọi lệnh `node scripts/...` chạy với thư mục hiện tại là `<skill>`** (`cd <skill>`); đối số file dùng **đường dẫn tuyệt đối** trong workspace. Tài liệu trong `references/` viết `node <skill>/scripts/...`: cùng lệnh.
- `<workspace>` = thư mục làm việc, mặc định `code-graph-workspace/` trong thư mục hiện tại của phiên. Workspace **phải nằm ngoài mọi repo được scan**; nếu thư mục mặc định nằm trong `<repoPath>`, hỏi người dùng chọn chỗ khác. `<ws>` = `<workspace>/<env>/<projectKey>`.
- Env hợp lệ: `dev`, `uat`. Database: `CodeGraph`. Node ≥ 20. Chạy `npm install` trong `<skill>` một lần nếu thiếu `node_modules` (phụ thuộc duy nhất: `yaml`).
- Ghi DB **chỉ** qua MCP ArcadeDB: `mcp__arcadedb__execute_command` (ghi) và `mcp__arcadedb__query` (đọc), luôn `database: "CodeGraph"`. Không dùng HTTP/CLI khác.
- Mô tả, câu hỏi Gap, báo cáo cho người dùng: tiếng Việt, giữ thuật ngữ kỹ thuật tiếng Anh.

### Bố cục workspace

```
<workspace>/
  system-catalog.yaml                 # dùng chung mọi project (mẫu: templates/system-catalog.example.yaml)
  <env>/
    <projectKey>/                     # = <ws>
      src/                            # git worktree của branch ứng với env (pha 0); chỉ đọc
      inventory.json                  # pha 1
      bundle.part-<module>.json       # pha 2-5 (mỗi module/subagent một part; phần chung: bundle.part-_root.json)
      bundle.json                     # bản đã gộp và validate (pha 6)
      bundle.prev.json                # bundle của lần nạp thành công trước, để diff
      diff.md
      catalog-proposal.yaml           # đề xuất domain/layer/ownerTeam (pha 5)
      load-batches/NNN-*.cypher, load-batches/plan.json
      load-state.json                 # tiến độ nạp (pha 7)
    link/                             # link-input.json, link-bundle.json, link-batches/, load-state.json
    report-data.json, report-data.prev.json, topology-report.md, studio-queries.md
```

### Tài liệu tham chiếu

| File | Đọc khi |
|---|---|
| `references/schema.md` | luôn, trước pha 2: vertex, edge, thuộc tính, **công thức uid** (§2), quy tắc method kế thừa (§6) |
| `references/bundle-format.md` | trước khi ghi part/bundle; ghi Gap; gộp; các rule validate; điểm dễ sai khi nạp |
| `references/readers/_contract.md` | để hiểu cấu trúc 8 mục của mọi reader profile |
| `references/readers/spring-boot.md` | project Spring Boot |
| `references/readers/java-generic.md` | Java không có Spring (thư viện, standalone, TAFJ extension trong repo T24) |
| `references/readers/t24.md` | repo Temenos T24 (routine jBC, record VERSION/ENQUIRY/OFS.SOURCE…, IRIS) |
| `references/config-and-env.md` | catalog, đọc config theo env, placeholder, secret, Deployment (pha 0, 4) |
| `references/cross-service.md` | ClientCall (pha 3-4), lệnh `link` |
| `references/describe-guide.md` | pha 5: cách viết mô tả, evidence, confidence, thẻ Service, Capability |
| `references/review-outputs.md` | lệnh `report`, cách đọc report |

Mẫu: `templates/bundle.schema.json` (schema máy đọc của bundle), `templates/system-catalog.example.yaml`, fixture kèm bundle kỳ vọng `templates/fixtures/spring-boot/expected/a-service.uat.bundle.json`, `templates/fixtures/spring-boot/expected/b-service.uat.bundle.json`, `templates/fixtures/t24/expected/t24.uat.bundle.json`. Khi phân vân cách ghi một phần tử, mở bundle kỳ vọng của profile tương ứng và làm theo.

## Quy tắc bắt buộc

1. **Không đọc secret file:** `.env`, `.env.*`, keystore (`*.jks`, `*.p12`, `*.keystore`, `*.pem`), file bị `.gitignore` chứa secret. Ghi chúng vào `coverage.skipped` với lý do `secret file`.
2. **Không ghi secret** vào bundle, mô tả, evidence, diagnostics, câu hỏi Gap, báo cáo hay câu trả lời cho người dùng. Key credential: `value: "***"`, `masked: true`; placeholder có default giữ tên biến, che default: `${VAR:***}` (rule `R7-config-default`). URL giữ scheme/host/port/path, bỏ userinfo/query. Phân vân thì dùng `maskConfigValue` (`references/config-and-env.md` §4).
3. **Không bịa** URL, host, tên hệ thống, bảng, nghiệp vụ hay hành vi không thấy trong code/config. Không biết thì để `null` và sinh Gap đúng kind.
4. **Mọi `description` có `evidence[]` (không rỗng) và `confidence`.** `confidence=low` thì sinh Gap `low-confidence-description`.
5. **Không ghi đè mô tả `descriptionSource=human`** (writer giữ nguyên; đừng viết lại các node đó).
6. **Không sửa repo được scan**: chỉ đọc trong worktree `src/`; không commit, checkout, stash, pull, sửa file trong đó. Chỉ thao tác git được phép là `git worktree add` và lệnh đọc (`rev-parse`, `status`, `branch`).
7. **Ghi DB chỉ qua MCP**, chỉ bằng các file trong `plan.json` (theo đúng thứ tự) hoặc lệnh bảo trì khi người dùng yêu cầu. Không bao giờ chạy `900-cleanup` (hay `900-cleanup-derived`) sau một lô lỗi.
8. **Ruling R16:** `Endpoint.path` **không** gồm context-path; context-path chỉ nằm ở `Deployment.contextPath`; base URL mà bên gọi cấu hình đã gồm context-path của đích (ghi đúng giá trị config, không tự thêm).
9. **Ruling R17:** `gapAnswers` trong `system-catalog.yaml` là nguồn **bền vững duy nhất** cho câu trả lời thủ công; **không bao giờ sửa/tạo `TARGETS` trực tiếp trong DB**.
10. **Ruling R12:** Gap trong bundle ingest luôn là `gap:<env>:<projectKey>:…`; `gap:<env>:system:…` chỉ do `link` sinh.
11. **Ruling R23 (OFS):** ClientCall `clientKind=ofs` có `signature` đã chuẩn hoá (`APP,VERSION` hoặc `ENQ <NAME>`, viết hoa, bỏ khoảng trắng), `urlTemplate` = `signature`; **không bao giờ chép message OFS** (chứa user/password).
12. **uid:** Service = `<env>:<projectKey>:service:<projectKey>`; projectKey không được là `system`, `__system__`, không chứa `:`. Uid dùng chung `ext:` giữ **một loại vertex** ở mọi project (type → `Component`, `#op` → `Operation`). Không dùng số dòng trong uid. Công thức đầy đủ: `references/schema.md` §2.
13. Ingest không ghi `TARGETS`, `SERVICE_DEPENDS_ON`, `OWNS_DATA`, `READS_DATA` (chỉ `link` sinh).
14. Không có reader profile cho loại project đã phát hiện (BPM, micro-frontend, mobile, …): **dừng và báo người dùng**; không tự chế profile.

---

## ingest

Cú pháp: `ingest <repoPath> --project <projectKey> --env <dev|uat>`. Đi lần lượt Pha 0 → Pha 7; không qua pha khi chưa đạt điều kiện qua pha. Báo người dùng ngắn gọn khi xong mỗi pha (số file, số node, Gap mới).

### Pha 0. Chuẩn bị

**Đầu vào:** `repoPath`, `projectKey`, `env`; `<workspace>/system-catalog.yaml`. **Đọc:** `references/config-and-env.md` §1.

1. Kiểm tra tham số: env ∈ {`dev`, `uat`}; projectKey đúng quy tắc 12. Sai thì dừng.
2. Đọc `<workspace>/system-catalog.yaml`. Chưa có file, hoặc chưa có `services.<projectKey>` hay `services.<projectKey>.branches.<env>`: **dừng**, đưa người dùng đoạn YAML đề xuất theo `templates/system-catalog.example.yaml` (`repo`, `readerProfiles`, `branches`) và chỉ ghi vào catalog khi người dùng đồng ý và cho biết branch. Không tự đoán branch.
3. Tạo worktree cho branch của env (`<branch>` = `services.<projectKey>.branches.<env>`):
   ```bash
   git -C <repoPath> rev-parse --verify <branch>          # không tồn tại: dừng, báo người dùng
   git -C <repoPath> worktree add <workspace>/<env>/<projectKey>/src <branch>
   ```
   - Git báo branch đang được checkout ở worktree khác (thường là chính `<repoPath>`): dùng `git -C <repoPath> worktree add --detach <workspace>/<env>/<projectKey>/src <branch>` (cùng commit, không khoá branch).
   - `src/` đã có từ lần trước: không tạo lại; kiểm tra `git -C <ws>/src status --porcelain` rỗng và HEAD đúng branch/commit của branch (`git -C <ws>/src rev-parse HEAD` = `git -C <repoPath> rev-parse <branch>`). Lệch thì hỏi người dùng (không tự reset/pull).
   - Không fetch/pull. Scan đúng những gì branch local đang có; người dùng muốn code mới hơn thì tự cập nhật branch.
4. Ghi `commitSha` = `git -C <ws>/src rev-parse HEAD`. Đặt `scanId` = `<env>-<projectKey>-<UTC yyyyMMddTHHmmssZ>` (dùng cho mọi part của lần scan này).
5. Lần chạy trước:
   - `<ws>/load-state.json` có `status` khác `done` (nạp dở hoặc lỗi): hỏi người dùng **nạp tiếp bundle cũ** (nhảy tới Pha 7, tiếp từ file ghi trong `load-state.json`) hay **scan lại** (tiếp tục pha 0; khi đó không đổi `bundle.prev.json`).
   - `<ws>/bundle.json` có nhưng không có `load-state.json`: bundle đó chưa từng được nạp; không dùng làm `bundle.prev.json` (giữ `bundle.prev.json` cũ nếu có).
   - `<ws>/bundle.json` có và lần nạp trước `done`: sao chép thành `<ws>/bundle.prev.json` (để diff ở pha 6). Xoá các `bundle.part-*.json` cũ.
6. Kiểm tra DB (chỉ đọc, `mcp__arcadedb__list_databases` rồi `mcp__arcadedb__query`): có database `CodeGraph`; đếm node cũ không có `env` (dữ liệu demo):
   `MATCH (n:CodeNode) WHERE n.env IS NULL AND NOT (n.uid STARTS WITH 'ext:' OR n.uid STARTS WITH 'lib:' OR n.uid STARTS WITH 'tag:' OR n.uid STARTS WITH 'env:' OR n.uid STARTS WITH 'domain:' OR n.uid STARTS WITH 'layer:' OR n.uid STARTS WITH 'system:') RETURN count(n) AS legacy`
   (nếu type `CodeNode` chưa tồn tại, thay `(n:CodeNode)` bằng `(n)`). `legacy > 0`: báo người dùng và **hỏi** trước khi ingest; không tự xoá. MCP không kết nối được: báo, vẫn làm pha 1-6 (bundle nạp sau).

**Qua pha khi:** worktree đúng branch, sạch; có `commitSha`, `scanId`; catalog có mục của project.

### Pha 1. Detection + Inventory

**Đọc:** mục 1-2 của `references/readers/spring-boot.md`, `references/readers/java-generic.md`, `references/readers/t24.md` (chỉ mục Detection, Inventory).

1. Chạy **Detection của mọi profile** trên `<ws>/src` (Glob/Grep đúng dấu hiệu trong mục 1 của profile). Ghi các profile khớp vào `scan.readerProfiles` (ví dụ `["spring-boot"]`, `["t24", "java-generic"]`). So với `readerProfiles` trong catalog; lệch thì báo người dùng.
2. Không profile nào khớp, hoặc thấy dấu hiệu BPM/micro-frontend/mobile (BPMN `.bpmn`, `angular.json`/module federation, Android/iOS…): **dừng**, báo người dùng là chưa có profile (quy tắc 14).
3. Profile yêu cầu dừng và hỏi (nhiều `@SpringBootApplication` ở module khác nhau; nhiều instance T24): dừng, hỏi projectKey cho từng ứng dụng.
4. Lập inventory theo mục 2 của các profile khớp và ghi `<ws>/inventory.json`:
   ```json
   { "scanId": "…", "env": "uat", "projectKey": "…", "readerProfiles": ["…"],
     "files": [{ "path": "src/main/java/…", "module": "<module>", "profile": "spring-boot" }],
     "skipped": [{ "path": "target/**", "reason": "build output" }],
     "modules": { "<module>": ["<path>", "…"] } }
   ```
   `path` tương đối từ gốc repo. Module chia theo mục 2 của profile (Spring: package con cấp 1 hoặc Maven module; T24: product/thư mục BP; ≤ ~40 file mỗi phần). `filesTotal` = số phần tử `files`.
5. **T24, lần ingest đầu của project này** (chưa có `bundle.prev.json`): mở vài file record thật, so với giả định định dạng export và đưa người dùng danh sách **"Quy ước cần xác minh trên repo thật"** của `references/readers/t24.md`, kèm điều quan sát được. Ghi lại câu trả lời; định dạng khác giả định thì làm theo đoạn "Nếu repo thật khác định dạng này" của t24.md (Gap `unread-files`, không đoán field).

**Qua pha khi:** có số liệu độ phủ (`files`, `skipped`); mọi file bị bỏ qua đều có lý do; không file secret nào bị đọc.

### Pha 2. Cấu trúc (L3)

**Đọc:** `references/schema.md` (đủ, nhất là §2 uid, §6 method kế thừa), `references/bundle-format.md` §1, §3, §4, mục 3-4 của profile (bảng mapping, công thức CALLS/TRIGGERS/Member).

Dựng Module, Component, Operation, Member, Tag, Library và cạnh `CONTAINS`, `CALLS`, `OVERRIDES`, `EXTENDS`/`IMPLEMENTS`, `USES_TYPE`, `TAGGED`, `DEPENDS_ON`, `FROM_LIBRARY`, `TRIGGERS`. Đọc file theo **thứ tự đọc** trong mục 2 của profile. Mọi node dùng chung (`ext:`, `lib:`, `tag:`, …) mà part có cạnh tới phải có mặt trong `nodes[]` của part đó, ghi giống hệt nhau ở mọi part.

**Qua pha khi:** có bundle một phần cho từng module (`<ws>/bundle.part-<module>.json`, cùng khối `scan`, `coverage` chỉ đếm file của module).

### Pha 3. Giao tiếp (L2)

**Đọc:** mục 4 của profile (Endpoint, ClientCall, DataStore, Channel, Bean/DI), `references/cross-service.md` §1.

Dựng Endpoint (+ `EXPOSES`), ClientCall (+ `MAKES_CALL`, `USES_CONFIG {role:'base-url'}`), Channel (+ `PUBLISHES`/`SUBSCRIBES`), DataStore (+ `ACCESSES {mode}`), Bean (+ `PROVIDES`, `INJECTS`, `BEAN_TYPE`). Endpoint path theo quy tắc 8; ClientCall OFS theo quy tắc 11. Không biết URL: uid dùng `?`/`ANY`, `urlTemplate=null`, Gap `unresolved-call`.

**Qua pha khi:** mọi ClientCall có `urlTemplate` hoặc Gap `unresolved-call` (rule `R5-clientcall-url`).

### Pha 4. Config + Deployment

**Đọc:** `references/config-and-env.md` (đủ), mục 5 của profile.

1. Đọc config của **env đang scan** (Spring: `application*.yml|yaml|properties` theo profile active = `catalog.services.<pk>.profiles.<env>` hoặc `[<env>]`; T24: record OFS.SOURCE, `tafj.properties`). Mỗi key cuối cùng → `ConfigKey` (`Service -CONTAINS->`), che secret (quy tắc 2), giải placeholder.
2. Placeholder không có giá trị trong repo: `value=null`, `isPlaceholder=true`, **một** Gap `missing-config-value` (askWho=`DevOps`) cho mỗi ConfigKey, `HAS_GAP` từ ConfigKey và từ mọi ClientCall dùng key.
3. Tạo `Service` (uid quy tắc 12), `Deployment` (`port`, `contextPath`, `hosts` thường `[]`, `branch`, `commitSha`, `profilesActive`), `Environment` `env:<env>`, cạnh `IN_ENV`, `DEPLOYED_AS`, `SERVES` (Deployment → mọi Endpoint), `USES_CONFIG {role:'port'|'context-path'}`.
4. Điền `resolvedBaseUrl`, `resolvedHost`, `resolvedPort`, `resolvedPath`, `discoveryName` cho ClientCall (`references/cross-service.md` §1.2).
5. Catalog đã có `domain`/`layer` cho project: thêm node `Domain`/`Layer` và cạnh `IN_DOMAIN`/`IN_LAYER {source:'catalog'}`, `Service.ownerTeam`.

Các node này (Service, Deployment, Environment, ConfigKey, Library, L0, Gap config) ghi vào `<ws>/bundle.part-_root.json`.

**Qua pha khi:** mọi placeholder thiếu giá trị đã có Gap `missing-config-value` (askWho=DevOps); không còn chuỗi secret nào trong part.

### Repo lớn: subagent cho Pha 2-4

Khi `inventory.json` có **hơn 150 file**: agent chính làm Pha 1 và đọc config (Pha 4 bước 1-2) **trước**, rồi giao Pha 2-4 cho **một subagent mỗi module** (chạy song song). Mỗi subagent nhận trong prompt:
- danh sách file của module (đường dẫn tuyệt đối trong `<ws>/src`) và khối `scan` (scanId, env, projectKey, repoPath, branch, commitSha, readerProfiles);
- đường dẫn profile (`references/readers/<profile>.md`), `references/schema.md` (công thức uid §2 và quy tắc §2.1), `references/bundle-format.md`, `references/cross-service.md` §1, `references/describe-guide.md` (để mô tả Operation/Component/Endpoint của module);
- bảng ConfigKey đã giải và che secret (Spring) hoặc bảng hook + bảng tên EB.API (T24, theo mục 2 của t24.md);
- đường dẫn đầu ra `<ws>/bundle.part-<module>.json` và yêu cầu: `CALLS` sang module khác dùng **uid dự kiến** theo công thức; không tạo Service/Deployment/ConfigKey (đã ở `_root`); tuân thủ mục "Quy tắc bắt buộc" (chép nguyên văn quy tắc 1-6, 8, 10-13 vào prompt: không secret, không bịa, evidence/confidence, không ghi đè mô tả human, không sửa repo, ruling R16 context-path, ruling R12 uid Gap, OFS, uid, không `TARGETS`/rollup trong ingest); **không nạp DB, không ghi file nào khác**.

Agent chính chỉ gộp (Pha 6) và làm Pha 5 ở tầng Capability/Service. Repo ≤ 150 file: agent chính tự làm, có thể ghi tất cả vào một part `bundle.part-_root.json`.

### Pha 5. Mô tả

**Đọc:** `references/describe-guide.md` (đủ), mục 6 của profile.

1. Từ dưới lên: Operation (entry, handler, method public có logic) → Component (bắt buộc với stereotype `controller`/`service`) → Endpoint (bắt buộc) → Capability (gom Endpoint/Channel/Job, `REALIZED_BY`, `Service -PROVIDES_CAPABILITY->`) → thẻ Service (`summary`, `responsibilities`, `notResponsibleFor`, `businessTerms`, `techStack`).
2. Mỗi mô tả có `evidence` + `confidence` + `descriptionSource` (quy tắc 4). `confidence=low` → Gap `low-confidence-description` (askWho=BA).
3. Ghi `<ws>/catalog-proposal.yaml`: đề xuất `domain`, `layer`, `ownerTeam` (nếu thấy) cho `services.<projectKey>`, mỗi giá trị kèm lý do và evidence. Không sửa `system-catalog.yaml`; không ghi `IN_DOMAIN`/`IN_LAYER` khi catalog chưa có.

**Qua pha khi:** mọi mô tả có `evidence` + `confidence`; mọi mô tả confidence thấp có Gap.

### Pha 6. Ghép + validate

```bash
cd <skill>
node scripts/merge-bundles.mjs <ws>/bundle.json <ws>/bundle.part-_root.json <ws>/bundle.part-<module>.json …
node scripts/validate-bundle.mjs <ws>/bundle.json --profile <profile[,profile]>     # ví dụ --profile t24,java-generic
node scripts/diff-bundle.mjs <ws>/bundle.prev.json <ws>/bundle.json <ws>/diff.md    # lần đầu: thay bundle.prev.json bằng -
```
- Validate có `ERROR`: sửa part/bundle (theo cột "Sửa khi fail" ở mục 8 của profile và bảng rule ở `references/bundle-format.md` §5), gộp và validate lại; lặp đến khi `0 error(s)`. **Không nạp bundle chưa pass.** `WARN` không chặn nhưng phải báo người dùng (độ phủ < 95%, …).
- Báo người dùng tóm tắt `diff.md` (thêm/mất/đổi) và Gap mới. Ingest lại khi code không đổi phải cho diff rỗng.

**Qua pha khi:** validate pass; có `diff.md`.

### Pha 7. Nạp

**Đọc:** `references/bundle-format.md` §6.

**Trước khi nạp:** validate đã pass; MCP kết nối được và có `CodeGraph` (không thì dừng, bundle giữ nguyên để nạp sau); người dùng đã trả lời câu hỏi dữ liệu cũ ở Pha 0 (nếu có); **T24 lần đầu**: người dùng đã xác nhận các "Quy ước cần xác minh trên repo thật" (Pha 1 bước 5). Chưa xác nhận thì hỏi lại và dừng ở đây.

1. Sinh lô (bỏ qua khi đang nạp tiếp và `load-state.json` có cùng `scanId` với `bundle.json`):
   ```bash
   cd <skill>
   node scripts/bundle-to-cypher.mjs <ws>/bundle.json <ws>/load-batches
   ```
   Lệnh ghi `load-batches/NNN-*.cypher` và `load-batches/plan.json` (`[{file, language, expectNodes?, expectEdges?}]`); nó từ chối bundle không hợp lệ.
2. Ghi `<ws>/load-state.json`: `{ "scanId": "<scanId>", "batchesDir": "<ws>/load-batches", "status": "loading", "nextFile": "000-schema.cypher", "failedFile": null, "error": null }`.
3. Gửi từng mục của `plan.json` **theo đúng thứ tự**, bắt đầu từ `nextFile`: đọc nội dung file, gọi `mcp__arcadedb__execute_command` với `database: "CodeGraph"`, `language` = `language` của mục (`sqlscript` cho `000-schema.cypher`, `cypher` cho phần còn lại), `command` = nội dung file. Thành công thì cập nhật `nextFile` sang mục kế tiếp.
4. **Lô lỗi:** dừng ngay; ghi `status: "failed"`, `failedFile: "<file>"`, `error` (thông báo lỗi, không có secret) vào `load-state.json`; báo người dùng. **Không** gửi các file sau, đặc biệt **không chạy `900-cleanup`**. Lần chạy sau tiếp tục từ `failedFile` (gửi lại các file node/edge trước đó cũng vô hại vì đều `MERGE`).
5. `990-count`: lấy `nodes` và `edges` trả về, so `nodes` với `expectNodes` và `edges` với `expectEdges` của mục đó trong `plan.json` (**không** so với tổng node/cạnh của bundle, vì bundle còn node dùng chung và cạnh đi ra từ node dùng chung). `edges` < `expectEdges` nghĩa là lô cạnh đã bỏ qua cạnh có đầu mút không tồn tại (thường là node dùng chung báo `W-shared-endpoint-missing` lúc validate). Lệch bất kỳ con số nào: ghi `status: "count-mismatch"`; **không chạy lại cleanup** (`900-cleanup`) hay lô nào khác; chạy lại `990-count` một lần; vẫn lệch thì báo người dùng cả bốn con số (`nodes`/`expectNodes`, `edges`/`expectEdges`) kèm các cảnh báo `W-shared-endpoint-missing`, rồi **dừng**, không coi là thành công.
6. Khớp cả hai: `status: "done"`. Báo người dùng số node và cạnh đã nạp, số Gap mở, đường dẫn `diff.md` và `catalog-proposal.yaml`.
7. **Luôn nhắc:** "Ingest lại xoá các cạnh đi ra từ node của project (kể cả `TARGETS`). Hãy chạy `link --env <env>` ngay bây giờ."

**Qua pha khi:** `990-count` cho `nodes` = `expectNodes` và `edges` = `expectEdges`; `load-state.json` `status: "done"`.

---

## link

Cú pháp: `link --env <env>`. Chạy sau **mỗi** ingest, và sau khi người dùng ghi câu trả lời vào `gapAnswers`. **Đọc:** `references/cross-service.md` §2. Thư mục làm việc: `<workspace>/<env>/link/`.

1. In câu query (chỉ đọc):
   ```bash
   cd <skill>
   node scripts/print-queries.mjs link --env <env>
   ```
   Kết quả là JSON `[{name, cypher}]` (`clientCalls`, `endpoints`, `deployments`, `services`, `accesses`, `externals`, `channels`, `subscriptions`).
2. Chạy từng câu bằng `mcp__arcadedb__query` (`database: "CodeGraph"`, `language: "cypher"`, `limit: 100000`). Ghi `<workspace>/<env>/link/link-input.json` = `{ "<name>": <records đúng như MCP trả về> }` cho đủ 8 khoá. Số record bằng đúng `limit` nghĩa là bị cắt: dừng, báo người dùng.
3. Lập kế hoạch link:
   ```bash
   node scripts/link-plan.mjs <workspace>/<env>/link/link-input.json <workspace>/system-catalog.yaml <env> <workspace>/<env>/link/link-bundle.json
   node scripts/validate-bundle.mjs <workspace>/<env>/link/link-bundle.json
   node scripts/bundle-to-cypher.mjs <workspace>/<env>/link/link-bundle.json <workspace>/<env>/link/link-batches --mode link
   ```
4. Nạp `link-batches/plan.json` đúng như Pha 7 bước 2-6 (dùng `<workspace>/<env>/link/load-state.json`; lô lỗi thì dừng, **không** chạy `900-cleanup-derived`/`901-cleanup-derived-gaps`; `990-count` so với `expectNodes`).
5. Báo người dùng: số `TARGETS`, `SERVICE_DEPENDS_ON`, Gap `ambiguous-target`/`unknown-external`/`unresolved-call` (in ra bởi `link-plan`), và cách trả lời: ghi vào `gapAnswers` của `system-catalog.yaml` (quy tắc 9) rồi chạy lại `link`; Gap `unresolved-call` (lệch context-path) thì Dev sửa config/code và ingest lại bên gọi.

**Xong khi:** `990-count` = `expectNodes`, `status: "done"`. Gợi ý chạy `report --env <env>`.

---

## report

Cú pháp: `report --env <env>`. Chỉ đọc DB. Chạy sau `link`. **Đọc:** `references/review-outputs.md`.

1. Trong `<workspace>/<env>/`: nếu có `report-data.json` thì **trước tiên** sao chép thành `report-data.prev.json` (trước khi ghi kết quả mới).
2. In câu query:
   ```bash
   cd <skill>
   node scripts/print-queries.mjs report --env <env>
   ```
   (`services`, `dependencies`, `dataOwnership`, `gaps`, `endpoints`). Chạy từng câu bằng `mcp__arcadedb__query` (`database: "CodeGraph"`, `language: "cypher"`, `limit: 100000`); ghi `<workspace>/<env>/report-data.json` = `{ "<name>": <records> }` (ghi đè, không sửa tay).
3. Dựng report (bỏ `--prev` nếu chưa có `report-data.prev.json`):
   ```bash
   node scripts/make-report.mjs <workspace>/<env>/report-data.json <workspace>/<env>/topology-report.md --env <env> --prev <workspace>/<env>/report-data.prev.json
   ```
   Lệnh ghi cả `studio-queries.md` cạnh report. Chỉ cần câu query Studio: `node scripts/print-queries.mjs studio --env <env>`.
4. Báo người dùng: đường dẫn hai file, số service, ô phụ thuộc, Gap mở theo askWho, service `(chưa phân loại)` và thay đổi so với lần trước; gợi ý những điểm cần kiểm theo bảng "Đọc topology-report.md" của `references/review-outputs.md`.

---

## Bảo trì

Ingest không bao giờ xoá node dùng chung (`ext:`, `lib:`, `tag:`, `ds:`, `ch:`, `sys:`). Theo thời gian sẽ còn node dùng chung không còn cạnh nào. **Chỉ khi người dùng yêu cầu**:

1. In câu lệnh: `node scripts/print-queries.mjs maintenance --env <env>` (in `sharedCleanupStatement()`; câu lệnh không phụ thuộc env).
2. Cho người dùng xem câu lệnh, nói rõ nó **xoá** mọi node dùng chung không có cạnh (ở mọi env), và chờ đồng ý.
3. Gửi bằng `mcp__arcadedb__execute_command` (`database: "CodeGraph"`, `language: "cypher"`). Không chạy khi có lần ingest/link đang nạp dở (`load-state.json` khác `done`).

## Xử lý lỗi (tóm tắt)

| Tình huống | Làm gì |
|---|---|
| Branch của env không tồn tại | Dừng ở Pha 0, báo người dùng |
| Không có profile cho loại project | Dừng ở Pha 1, báo người dùng (quy tắc 14) |
| File không đọc/hiểu được | `diagnostics` + Gap `unread-files` gom theo module; scan tiếp |
| Không giải được tên routine/method được gọi | `CALLS` tới `ext:`/placeholder, `resolved=false` |
| Validate fail | Sửa bundle, validate lại; không nạp |
| Lô nạp lỗi | Dừng, ghi `load-state.json`, không cleanup; lần sau tiếp từ `failedFile` |
| MCP ArcadeDB không kết nối được | Dừng ở Pha 7 (hoặc ở `link`/`report`); bundle còn nguyên |
| `990-count` lệch `expectNodes`/`expectEdges` | `status: "count-mismatch"`; không chạy lại cleanup; chạy lại `990-count` một lần; vẫn lệch thì báo người dùng các con số và dừng |
