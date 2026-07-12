package com.thanglv.robolangchain.mcp;

import com.thanglv.robolangchain.entity.FileManagementDocument;
import com.thanglv.robolangchain.mcp.toolResponse.CurrentDateTime;
import com.thanglv.robolangchain.repository.FileManagementRepository;
import com.thanglv.robolangchain.util.Constant;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.ReturnBehavior;
import dev.langchain4j.agent.tool.SearchBehavior;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.data.image.Image;
import dev.langchain4j.data.message.ImageContent;
import dev.langchain4j.data.message.TextContent;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.response.ChatResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.ZonedDateTime;
import java.util.Base64;
import java.util.Optional;

@Service
public class InternalTool {

    @Autowired
    @Qualifier("visionModel")
    private ChatModel visionModel;

    @Autowired
    private FileManagementRepository fileManagementRepository;

    @Tool(name = "get_current_datetime", value = """
            Returns the current date and time from the MCP server.
            Use this tool whenever accurate current date or time information is required. This includes answering questions about today's date, the current time, the current year, month, day, weekday, or performing calculations relative to the current moment (for example, "3 days from now", "next Monday", or "how many days until a specific date").
            Do not estimate or assume the current date or time. Always call this tool when an accurate current timestamp is needed.
            The response contains:
            Year, month, and day of month
            Hour, minute, and second
            Day of week
            Day of year
            ISO week of year
            Leap year indicator
            Unix epoch timestamp in milliseconds
            IANA time zone identifier (for example, Asia/Ho_Chi_Minh)
            UTC offset (for example, +07:00)
            ISO 8601 date-time string with time zone offset
            """,
            returnBehavior = ReturnBehavior.TO_LLM,
            searchBehavior = SearchBehavior.SEARCHABLE)
    public CurrentDateTime mcpTime() {
        ZonedDateTime now = ZonedDateTime.now();
        return new CurrentDateTime(
                now.getYear(),
                now.getMonthValue(),
                now.getDayOfMonth(),
                now.getHour(),
                now.getMinute(),
                now.getSecond(),
                now.toInstant().toEpochMilli(),
                now.getZone().getId(),
                now.getOffset().getId(),
                now.toOffsetDateTime().toString(),
                now.getDayOfWeek().getValue(),
                now.getDayOfWeek().name(),
                now.getDayOfYear(),
                now.get(java.time.temporal.IsoFields.WEEK_OF_WEEK_BASED_YEAR),
                now.toLocalDate().isLeapYear()
        );
    }

    @Tool(name = "image_to_markdown", value = """
            Reads an image identified by the provided fileId and converts all visible content into clean Markdown.
            
            Use this tool whenever the user asks to:
            - read, analyze, inspect, or understand an image
            - extract text (OCR) from an image
            - convert an image into Markdown
            - describe tables, forms, receipts, invoices, screenshots, documents, books, slides, whiteboards, diagrams, charts, or UI screenshots
            - summarize or preserve the structure of a document shown in an image
            
            The tool performs OCR and vision analysis, preserving the original document structure whenever possible.
            
            Output rules:
            - Return valid Markdown only.
            - Preserve headings, paragraphs, bullet lists, numbered lists, blockquotes and tables.
            - Reconstruct tables using Markdown table syntax whenever possible.
            - Preserve reading order.
            - Include code blocks if source code appears in the image.
            - Preserve hyperlinks as plain text.
            - Use Markdown images only when the image itself is meaningful to the document.
            - Describe diagrams, charts and figures using concise Markdown if they cannot be faithfully represented.
            - If some text is unreadable, indicate it as [unreadable].
            - Do not invent or hallucinate missing content.
            - Do not translate unless explicitly requested by the user.
            - Do not add explanations outside the generated Markdown.
            
            Input:
            - fileId: identifier of an uploaded image.
            
            Returns:
            - Markdown representation of the image contents.
            """,
            returnBehavior = ReturnBehavior.TO_LLM,
            searchBehavior = SearchBehavior.SEARCHABLE)
    public String imageToMarkdown(@P(name = "fileId", description = "identifier of an uploaded image.") String fileId) throws IOException {
        Optional<FileManagementDocument> fileOptional = fileManagementRepository.findById(fileId);
        if (fileOptional.isEmpty()) {
            throw new IllegalArgumentException("Error fileId not exists");
        }
        FileManagementDocument fileImage = fileOptional.get();
        if (!Constant.FILE_SOURCE.LOCAL.equalsIgnoreCase(fileImage.getSource())) {
            throw new IllegalArgumentException("file source not support");
        }
        Path filePath = Paths.get(fileImage.getPath());
        if (Files.notExists(filePath) || Files.isDirectory(filePath)) {
            throw new IllegalArgumentException("Error fileId not exists");
        }
        String imageBase64 = Base64.getEncoder().encodeToString(Files.readAllBytes(filePath));
        Image img = Image.builder()
                .base64Data(imageBase64)
                .mimeType(fileImage.getMimeType())
                .build();
        ImageContent imageContent = ImageContent.from(img);
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
                        Return Markdown representation of the image contents.
                        """),
                imageContent
        );

        ChatResponse response = visionModel.chat(userMessage);
        return response.aiMessage().text();
    }


    @Tool(name = "document_to_html", value = """
            Converts a document identified by the provided fileId into clean, well-structured HTML.
            
            Use this tool whenever the user asks to:
            - convert a document into HTML
            - extract document contents as HTML
            - display or render a document in a web page
            - preserve document structure for further processing
            - transform PDF, DOCX or other supported documents into HTML
            
            Supported document types include:
            - PDF
            - DOCX
            - DOC
            - ODT
            - RTF
            - TXT
            - Other supported office document formats
            
            Conversion requirements:
            - Preserve the original document structure whenever possible.
            - Preserve headings, paragraphs, sections, lists, tables, hyperlinks and images.
            - Preserve text formatting such as bold, italic, underline and inline code where applicable.
            - Generate semantic HTML using appropriate elements such as h1-h6, p, ul, ol, li, table, thead, tbody, tr, th, td, blockquote and pre/code.
            - Preserve reading order.
            - Preserve page content without omitting information.
            - Do not summarize, translate or rewrite the document.
            - Do not invent missing content.
            - If some content cannot be converted faithfully, preserve as much information as possible.
            
            Input:
            - fileId: identifier of the uploaded document.
            
            Returns:
            - Complete HTML representation of the document.
            """,
            returnBehavior = ReturnBehavior.TO_LLM,
            searchBehavior = SearchBehavior.SEARCHABLE)
    public String documentToHtml() {
        return null;
    }
}
