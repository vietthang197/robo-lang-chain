package com.thanglv.robolangchain.services.impl;

import com.thanglv.robolangchain.dto.response.DocumentProcessingResponse;
import com.thanglv.robolangchain.entity.DocumentManagement;
import com.thanglv.robolangchain.repository.DocumentManagementRepository;
import com.thanglv.robolangchain.services.DocumentProcessingService;
import com.thanglv.robolangchain.util.Constant;
import dev.langchain4j.data.document.DefaultDocument;
import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.Metadata;
import dev.langchain4j.data.document.splitter.DocumentSplitters;
import dev.langchain4j.data.image.Image;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ImageContent;
import dev.langchain4j.data.message.TextContent;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.response.ChatResponse;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.EmbeddingStoreIngestor;
import lombok.RequiredArgsConstructor;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageTree;
import org.apache.pdfbox.pdmodel.PDResources;
import org.apache.pdfbox.pdmodel.graphics.PDXObject;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class DocumentProcessingServiceImpl implements DocumentProcessingService {
    private final DocumentManagementRepository documentManagementRepository;
    private final EmbeddingStoreIngestor embeddingStoreIngestor;

    // Document Splitter với cấu hình tối ưu: 
    // - maxSegmentSize: 500 ký tự (đủ nhỏ để tìm kiếm chính xác)
    // - overlapSize: 100 ký tự (đủ lớn để giữ ngữ cảnh giữa các segment)
    private static final int MAX_SEGMENT_SIZE = 500;
    private static final int OVERLAP_SIZE = 100;

    @Autowired
    private ChatModel chatModel;

    @Value("${nas.path}")
    private String nasPath;

    @Override
    public DocumentProcessingResponse process(String fileId) throws Exception {
        long start = System.currentTimeMillis();
        Optional<DocumentManagement> documentManagementOptional = documentManagementRepository.findById(fileId);
        if (documentManagementOptional.isEmpty()) {
            throw new RuntimeException("Document Management Not Found");
        }
        DocumentManagement documentManagement = documentManagementOptional.get();
        try (PDDocument document = PDDocument.load(Files.newInputStream(Paths.get(documentManagement.getPath())))) {
            PDPageTree pdPages = document.getPages();
            PDFTextStripper pdfTextStripper = new PDFTextStripper();
            int index = 0;
            int page = 0;
            for (PDPage pdPage : pdPages) {
                ++page;
                // Set the page range to extract text from the current page only
                pdfTextStripper.setStartPage(page);
                pdfTextStripper.setEndPage(page);

                PDResources resources = pdPage.getResources();
                List<String> media = new ArrayList<>();
                // Extract text from the current page
                StringBuilder textContent = new StringBuilder(pdfTextStripper.getText(document));

                // Iterate over XObjects to extract images
                String date = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
                Path rootPath = Paths.get(nasPath).resolve(date).resolve(fileId + "_embeddings");
                if (Files.notExists(rootPath) || !Files.isDirectory(rootPath)) {
                    Files.createDirectories(rootPath);
                }
                for (var c : resources.getXObjectNames()) {
                    PDXObject pdxObject = resources.getXObject(c);
                    if (pdxObject instanceof PDImageXObject image) {
                        ++index;
                        BufferedImage imageImage = image.getImage();

                        // Save image to disk
                        Path rootImagePath = rootPath.resolve("images");
                        if (Files.notExists(rootImagePath) || !Files.isDirectory(rootImagePath)) {
                            Files.createDirectories(rootImagePath);
                        }
                        String imagePath = rootImagePath.resolve("page_" + page + "_im_" + index + ".png").toAbsolutePath().toString();
                        try (FileOutputStream fileOutputStream = new FileOutputStream(imagePath)) {
                            ImageIO.write(imageImage, "png", fileOutputStream);
                        }

                        // Convert image to Base64 for transmission
                        ByteArrayOutputStream byteArrayOutputStream = new ByteArrayOutputStream();
                        ImageIO.write(imageImage, "png", byteArrayOutputStream);
                        byte[] data = byteArrayOutputStream.toByteArray();
                        String imageBase64 = Base64.getEncoder().encodeToString(data);

                        // Create an Image object with the Base64 encoded data
                        Image img = Image.builder()
                                .base64Data(imageBase64)
                                .mimeType("image/png")
                                .build();

                        ImageContent imageContent = ImageContent.from(img);
                        media.add(imagePath);

                        UserMessage userMessage = UserMessage.from(
                                TextContent.from("Extract all necessary information from the image"),
                                imageContent
                        );

                        // Send the message to the Gemini LLM and receive a description
                        ChatResponse response = chatModel.chat(userMessage);
                        String imageDescription = response.aiMessage().text();

                        // Append the image description to the page text
                        textContent.append("\n").append("IMAGE : ").append(imagePath).append(" Description of the image :\n").append(imageDescription);
                    }
                }

                // Build metadata for the document segment
                Metadata metadata = new Metadata();
                metadata.put("Page", page);
                metadata.put("media", String.join("#", media));

                // Tạo document với text và metadata
                Document doc = new DefaultDocument(textContent.toString(), metadata);
                
                // Sử dụng Document Splitter để chia nhỏ nội dung trước khi ingest
                // Việc này giúp cải thiện chất lượng tìm kiếm bằng cách tạo các segment nhỏ hơn,
                // dễ dàng khớp với truy vấn cụ thể thay vì toàn bộ trang
                var splitter = DocumentSplitters.recursive(MAX_SEGMENT_SIZE, OVERLAP_SIZE);
                List<TextSegment> segments = splitter.split(doc);
                
                // Ingest từng segment vào embedding store
                for (TextSegment segment : segments) {
                    embeddingStoreIngestor.ingest(segment);
                }
            }
        }
        documentManagement.setStatus(Constant.DOCUMENT_STATUS.PROCESSED);
        documentManagementRepository.save(documentManagement);
        long end = System.currentTimeMillis();
        DocumentProcessingResponse documentProcessingResponse = new DocumentProcessingResponse();
        documentProcessingResponse.setTime((end - start) + " ms");
        return documentProcessingResponse;
    }
}
