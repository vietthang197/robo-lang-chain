# Topology dev

_Tạo lúc 2026-11-10T00:33:32.722Z_

## Services theo Domain/Layer

| Service | Domain | Layer | Summary | Capabilities | Độ phủ |
|---|---|---|---|---|---|
| robo-lang-chain | Document AI | core-service | robo-lang-chain là API chat AI xây trên Spring Boot và langchain4j (không dùng Spring AI): người dùng chat với trợ lý RoboAssistant chạy mô hình trên Ollama, có RAG trên tài liệu đã nạp (Qdrant collection documents, rerank ONNX), bộ nhớ hội thoại trong MongoDB và các tool (tool nội bộ, MCP fetch/filesystem/playwright). Service cũng nhận upload tệp vào thư mục cục bộ và xử lý PDF thành embedding để phục vụ RAG. | Trò chuyện với trợ lý AI, Tải lên tệp, Xử lý tài liệu cho RAG | 33/33 |

### robo-lang-chain (robo-lang-chain)

robo-lang-chain là API chat AI xây trên Spring Boot và langchain4j (không dùng Spring AI): người dùng chat với trợ lý RoboAssistant chạy mô hình trên Ollama, có RAG trên tài liệu đã nạp (Qdrant collection documents, rerank ONNX), bộ nhớ hội thoại trong MongoDB và các tool (tool nội bộ, MCP fetch/filesystem/playwright). Service cũng nhận upload tệp vào thư mục cục bộ và xử lý PDF thành embedding để phục vụ RAG.

- **Domain**: Document AI
- **Layer**: core-service
- **Tech stack**: apache-pdfbox, apache-tika, java, langchain4j, langchain4j-mcp, langchain4j-ollama, langchain4j-onnx-scoring, langchain4j-qdrant, mongodb, ollama, qdrant, spring-boot, spring-data-mongodb, spring-web
- **Độ phủ**: 33/33

**Trách nhiệm**
- Cung cấp API POST /chat để chat với trợ lý AI theo sessionId, có thể kèm tệp đính kèm (fileId)
- Cung cấp tool cho trợ lý: ngày giờ hiện tại, chuyển ảnh thành Markdown; kết nối MCP server fetch, filesystem (ổ D:/) và playwright qua stdio
- Lưu và nạp lịch sử hội thoại (cửa sổ 20 tin nhắn) trong MongoDB collection chatMessageDocument
- Nhận upload tệp qua POST /file/upload, lưu vào thư mục nas.path và ghi metadata vào MongoDB collection fileManagementDocument
- Truy hồi ngữ cảnh từ Qdrant (tối đa 100 đoạn, điểm ≥ 0.5) và rerank bằng mô hình ONNX (điểm ≥ 0.75) trước khi trả lời
- Xử lý RAG cho tài liệu PDF qua GET /document/rag/process/{documentId}: tách text, mô tả ảnh bằng vision model, embed và ghi vào Qdrant collection documents

**Không phụ trách**
- Chưa hỗ trợ RAG cho tài liệu không phải PDF; tool document_to_html chưa được cài đặt
- Không lưu tệp lên kho lưu trữ ngoài (chỉ nguồn LOCAL trên ổ đĩa của máy chạy service)
- Không tự chạy mô hình AI: chat, vision và embedding đều gọi Ollama qua HTTP (ollama.base.url)
- Không xác thực hay phân quyền người dùng (createdBy/userId được sinh UUID ngẫu nhiên)

**Capabilities**
- Trò chuyện với trợ lý AI
- Tải lên tệp
- Xử lý tài liệu cho RAG

## Phụ thuộc

| Caller | localhost |
|---|---|
| robo-lang-chain | http×5 · 1 ep |

## Dữ liệu

| DataStore | Location | Owner | Readers |
|---|---|---|---|
| ds:dev:filesystem:D:/upload (filesystem) | D:/upload | robo-lang-chain |  |
| ds:dev:mongodb:app_db.chatMessageDocument (mongodb) | app_db.chatMessageDocument | robo-lang-chain |  |
| ds:dev:mongodb:app_db.fileManagementDocument (mongodb) | app_db.fileManagementDocument | robo-lang-chain |  |
| ds:dev:qdrant:documents (qdrant) | documents | robo-lang-chain |  |

## Gap đang mở

### Dev

- Lời gọi Ollama (embedding câu hỏi để truy hồi RAG) trong RoboAssistant#chat dùng method/path HTTP nào trên http://localhost:11434? Path do thư viện langchain4j-ollama (OllamaEmbeddingModel) tự dựng, không thấy trong code của robo-lang-chain. _(unresolved-call)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.RoboAssistant#chat->langchain4j-ollama:ANY ?~2`
- MCP client "fetch" trong McpProviderConfiguration#mcpToolProvider gọi MCP server qua stdio (tiến trình con chạy "npx mcp-fetch-server"), không có URL/host. Server này chạy ở đâu ở env dev (cùng máy với service?) và nên ghi nhận là hệ thống ngoài nào? _(unresolved-call)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.McpProviderConfiguration#mcpToolProvider->mcp-stdio:?`
- Lời gọi Ollama (vision model chuyển ảnh thành Markdown) trong InternalTool#imageToMarkdown dùng method/path HTTP nào trên http://localhost:11434? Path do thư viện langchain4j-ollama (OllamaChatModel) tự dựng, không thấy trong code của robo-lang-chain. _(unresolved-call)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.mcp.InternalTool#imageToMarkdown->langchain4j-ollama:ANY ?`
- MCP client "filesystem" trong McpProviderConfiguration#mcpToolProvider gọi MCP server qua stdio (tiến trình con chạy "npx -y @modelcontextprotocol/server-filesystem D:/"), không có URL/host. Server này chạy ở đâu ở env dev (cùng máy với service?) và nên ghi nhận là hệ thống ngoài nào? _(unresolved-call)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.McpProviderConfiguration#mcpToolProvider->mcp-stdio:?~2`
- MCP client "playwright" trong McpProviderConfiguration#mcpToolProvider gọi MCP server qua stdio (tiến trình con chạy "npx -y @playwright/mcp@latest"), không có URL/host. Server này chạy ở đâu ở env dev (cùng máy với service?) và nên ghi nhận là hệ thống ngoài nào? _(unresolved-call)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.McpProviderConfiguration#mcpToolProvider->mcp-stdio:?~3`
- Lời gọi Ollama (chat model) trong RoboAssistant#chat dùng method/path HTTP nào trên http://localhost:11434? Path do thư viện langchain4j-ollama (OllamaChatModel) tự dựng, không thấy trong code của robo-lang-chain. _(unresolved-call)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.RoboAssistant#chat->langchain4j-ollama:ANY ?`
- Lời gọi Ollama (vision model mô tả ảnh trong PDF) trong PdfRagProcess#process dùng method/path HTTP nào trên http://localhost:11434? Path do thư viện langchain4j-ollama (OllamaChatModel) tự dựng, không thấy trong code của robo-lang-chain. _(unresolved-call)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.services.impl.PdfRagProcess#process->langchain4j-ollama:ANY ?`
- Lời gọi Ollama (embedding đoạn văn bản khi ingest) trong PdfRagProcess#process dùng method/path HTTP nào trên http://localhost:11434? Path do thư viện langchain4j-ollama (OllamaEmbeddingModel) tự dựng, không thấy trong code của robo-lang-chain. _(unresolved-call)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.services.impl.PdfRagProcess#process->langchain4j-ollama:ANY ?~2`

### DevOps

- Lời gọi dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.McpProviderConfiguration#mcpToolProvider->mcp-stdio:? từ robo-lang-chain trỏ tới hệ thống nào (host/IP hoặc service)? _(unknown-external)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.McpProviderConfiguration#mcpToolProvider->mcp-stdio:?`
- Lời gọi dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.McpProviderConfiguration#mcpToolProvider->mcp-stdio:?~2 từ robo-lang-chain trỏ tới hệ thống nào (host/IP hoặc service)? _(unknown-external)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.McpProviderConfiguration#mcpToolProvider->mcp-stdio:?~2`
- Lời gọi dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.McpProviderConfiguration#mcpToolProvider->mcp-stdio:?~3 từ robo-lang-chain trỏ tới hệ thống nào (host/IP hoặc service)? _(unknown-external)_ — `dev:robo-lang-chain:clientcall:com.thanglv.robolangchain.config.McpProviderConfiguration#mcpToolProvider->mcp-stdio:?~3`

## Thay đổi so với lần trước

Lần đầu tạo report
