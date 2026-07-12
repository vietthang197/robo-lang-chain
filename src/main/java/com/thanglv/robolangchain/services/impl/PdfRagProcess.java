package com.thanglv.robolangchain.services.impl;

import com.thanglv.robolangchain.entity.FileManagementDocument;
import com.thanglv.robolangchain.repository.FileManagementRepository;
import com.thanglv.robolangchain.services.DocumentRagProcessor;
import com.thanglv.robolangchain.util.Constant;
import dev.langchain4j.data.document.DefaultDocument;
import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.Metadata;
import dev.langchain4j.data.image.Image;
import dev.langchain4j.data.message.ImageContent;
import dev.langchain4j.data.message.TextContent;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.response.ChatResponse;
import dev.langchain4j.store.embedding.EmbeddingStoreIngestor;
import lombok.RequiredArgsConstructor;
import org.apache.pdfbox.Loader;
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
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

@Service
@RequiredArgsConstructor
public class PdfRagProcess implements DocumentRagProcessor {

    @Value("${nas.path}")
    private String rootDir;

    @Autowired
    private EmbeddingStoreIngestor embeddingStoreIngestor;

    @Autowired
    @Qualifier("visionModel")
    private ChatModel visionModel;

    @Override
    public void process(FileManagementDocument fileManagementDocument) throws IOException {
        File fileProcessing = null;
        if (Constant.FILE_SOURCE.LOCAL.equalsIgnoreCase(fileManagementDocument.getSource())) {
            fileProcessing = Paths.get(fileManagementDocument.getPath()).toFile();
        }

        try (PDDocument document = Loader.loadPDF(fileProcessing)) {
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
                media.add(" page number: " + page);
                // Extract text from the current page
                StringBuilder textContent = new StringBuilder(pdfTextStripper.getText(document));

                // Iterate over XObjects to extract images
                String date = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
                Path rootPath = Paths.get(rootDir).resolve(date).resolve(fileManagementDocument.getId() + "_embeddings");
                if (Files.notExists(rootPath) || !Files.isDirectory(rootPath)) {
                    Files.createDirectories(rootPath);
                }
                for (var c : resources.getXObjectNames()) {
                    PDXObject pdxObject = resources.getXObject(c);
                    if (pdxObject instanceof PDImageXObject image) {
                        ++index;
                        BufferedImage bufferedImage = image.getImage();

                        // Save image to disk
                        Path rootImagePath = rootPath.resolve("images");
                        if (Files.notExists(rootImagePath) || !Files.isDirectory(rootImagePath)) {
                            Files.createDirectories(rootImagePath);
                        }
                        String imagePath = rootImagePath.resolve("page_" + page + "_im_" + index + ".png").toAbsolutePath().toString();
                        try (FileOutputStream fileOutputStream = new FileOutputStream(imagePath)) {
                            ImageIO.write(bufferedImage, "png", fileOutputStream);
                        }

                        // Convert image to Base64 for transmission
                        try (ByteArrayOutputStream byteArrayOutputStream = new ByteArrayOutputStream()) {
                            ImageIO.write(bufferedImage, "png", byteArrayOutputStream);
                            byte[] data = byteArrayOutputStream.toByteArray();
                            String imageBase64 = Base64.getEncoder().encodeToString(data);

                            // Create an Image object with the Base64 encoded data
                            Image img = Image.builder()
                                    .base64Data(imageBase64)
                                    .mimeType("image/png")
                                    .build();

                            ImageContent imageContent = ImageContent.from(img);
                            media.add(" image path: " + imagePath + " in page: " + page);

                            UserMessage userMessage = UserMessage.from(
                                    TextContent.from("""
                                            Analyze the image thoroughly and return every piece of information that may be useful for another language model.
                                            
                                            Include:
                                            - A detailed description of the image.
                                            - All visible objects, people, actions, and relationships.
                                            - Layout, UI elements, tables, charts, diagrams, and forms.
                                            - All visible numbers, dates, addresses, IDs, labels, logos, and symbols.
                                            
                                            If the image contains text:
                                            - Perform OCR and transcribe ALL visible text exactly as it appears.
                                            - Preserve the reading order, paragraphs, and line breaks.
                                            - Do not summarize, paraphrase, or correct the text.
                                            
                                            If any information is uncertain or partially visible, explicitly indicate the uncertainty instead of guessing.
                                            Do not infer information that is not directly visible in the image.
                                            """),
                                    imageContent
                            );

                            // Send the message to the Gemini LLM and receive a description
                            ChatResponse response = visionModel.chat(userMessage);
                            String imageDescription = response.aiMessage().text();

                            // Append the image description to the page text
                            textContent.append("\n").append("IMAGE : ").append(imagePath).append(" Description of the image :\n").append(imageDescription);
                        }
                    }
                }

                // Build metadata for the document segment
                Metadata metadata = new Metadata();
                metadata.put("number of page", page);
                metadata.put("file name", fileManagementDocument.getOriginalFileName());
                metadata.put("media", String.join("#", media));

                // Create a document with text and metadata, then ingest it into the embedding store
                Document doc = new DefaultDocument(textContent.toString(), metadata);
                embeddingStoreIngestor.ingest(doc);
            }
        }
    }
}
