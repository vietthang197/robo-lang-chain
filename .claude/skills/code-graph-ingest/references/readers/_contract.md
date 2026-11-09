# Hợp đồng reader profile

Reader profile dạy AI đọc **một loại project** (spring-boot, java-generic, t24, …) và map native artifact vào **mô hình chuẩn** ở `../schema.md`. Profile không được thêm loại vertex/edge mới; đặc thù công nghệ đi vào `kind`, `nativeType`, `stereotype`. Một project có thể khớp nhiều profile (ví dụ `spring-boot` + `java-generic`); mọi profile khớp đều được áp dụng và ghi vào `scan.readerProfiles`.

Mỗi profile là một file `readers/<profile>.md` có **đúng 8 mục sau, theo thứ tự, với tiêu đề `## 1. Detection` … `## 8. Conformance`**.

## 1. Detection
Phải ghi: dấu hiệu nhận diện cụ thể, kiểm tra được bằng Glob/Grep (tên file, thư mục, chuỗi nội dung), và profile này có đi kèm profile nào khác không. Ví dụ: "có `pom.xml` hoặc `build.gradle*` chứa `spring-boot` **và** có class mang `@SpringBootApplication`".

## 2. Inventory
Phải ghi:
- Glob các file cần đọc và file bỏ qua, **mỗi nhóm bỏ qua có lý do** (output build, file sinh tự động, vendor, secret, test). Mọi file bỏ qua vào `scan.coverage.skipped[]` dạng `{path, reason}`.
- Thứ tự đọc (ví dụ build file → config → entry point → controller → service → client → repository/entity).
- Cách chia module để giao subagent khi repo lớn (đơn vị chia, ngưỡng số file) và cách đếm `filesTotal`/`filesRead`.

## 3. Bảng mapping
Phải ghi: bảng `native artifact → vertex chuẩn + kind/stereotype + công thức qualifiedName`, phủ mọi artifact mà profile đọc. Ví dụ dòng: `method → Operation, kind=java-method, qualifiedName=<FQN class>#<method>[~n]`.

## 4. Công thức trích xuất
Phải ghi công thức (dấu hiệu trong code → node/edge/thuộc tính) cho từng mục sau; mục nào không áp dụng thì ghi rõ "không áp dụng" và lý do:
- **Endpoint** (protocol, httpMethod, path, pathRegex, signature);
- **ClientCall** (mọi trường ở `../cross-service.md` §1.2, kèm `USES_CONFIG {role:'base-url'}`);
- **DataStore + mode** (`ds:` uid, `ACCESSES {mode}`);
- **Channel** (`PUBLISHES`/`SUBSCRIBES`);
- **CALLS** (dispatch, lines, resolved; quy tắc method kế thừa ở `../schema.md` §6);
- **TRIGGERS** (event);
- **Bean/DI** (`PROVIDES`, `INJECTS`, `BEAN_TYPE`);
- **Member**.

## 5. Config theo env
Phải ghi: file config nào ứng với env nào, thứ tự ưu tiên khi gộp, cách giải placeholder, nguồn của `Deployment.port`/`contextPath`/`hosts`, nguồn base URL của ClientCall, các key là secret đặc thù của công nghệ (bổ sung cho mẫu chung ở `../config-and-env.md`).

## 6. Gợi ý mô tả
Phải ghi: cách diễn đạt "trách nhiệm" và "capability" cho loại project này (theo `../describe-guide.md`), cách gom Endpoint thành Capability, và các thuật ngữ nghiệp vụ hay gặp (Việt + Anh).

## 7. Bẫy thường gặp
Phải ghi: danh sách lỗi dễ mắc khi đọc loại project này, mỗi bẫy kèm **cách xử lý đúng** (không chỉ nêu bẫy).

## 8. Conformance
Phải ghi:
- Đường dẫn fixture `templates/fixtures/<profile>/` và bundle kỳ vọng `templates/fixtures/<profile>/expected/*.bundle.json`, cùng trích đoạn bundle kỳ vọng cho các phần tử quan trọng nhất.
- Rule validate riêng của profile: id rule (bắt đầu bằng tên profile), điều kiện, cách sửa khi fail. Rule được cài trong `scripts/core/profile-rules/index.mjs` và chạy bằng `node scripts/validate-bundle.mjs <bundle> --profile <profile>`.
- Test chứng minh fixture pass (`scripts/test/profile-<profile>.test.mjs`).
