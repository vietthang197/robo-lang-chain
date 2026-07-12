package com.thanglv.robolangchain.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.thanglv.robolangchain.config.RoboAssistant;
import com.thanglv.robolangchain.dto.request.AttachmentRequest;
import com.thanglv.robolangchain.dto.request.RoboChatMessageRequest;
import com.thanglv.robolangchain.entity.FileManagementDocument;
import com.thanglv.robolangchain.repository.FileManagementRepository;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.apache.commons.collections4.CollectionUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.stream.Collectors;


@RestController
@RequiredArgsConstructor
public class ChatController {

    private final RoboAssistant roboAssistant;
    private final FileManagementRepository fileManagementRepository;
    private final ObjectMapper objectMapper;

    @PostMapping("/chat")
    public String chat(@RequestHeader String sessionId,
                       @RequestBody RoboChatMessageRequest request,
                       HttpServletRequest servletRequest) throws JsonProcessingException {
//        String sessionId = servletRequest.getRequestedSessionId();
        if (request.getMeta() != null && CollectionUtils.isNotEmpty(request.getMeta().getAttachments())) {
            List<FileManagementDocument> files = fileManagementRepository.findAllByIdIn(
                    request.getMeta()
                            .getAttachments()
                            .stream()
                            .map(AttachmentRequest::getFileId)
                            .collect(Collectors.toList())
            );
            List<AttachmentRequest> attachmentRequestList = files.stream().map(item -> {
                AttachmentRequest attmReq = new AttachmentRequest();
                attmReq.setFileId(item.getId());
                attmReq.setMimeType(item.getMimeType());
                attmReq.setName(item.getOriginalFileName());
                attmReq.setSize(item.getFileSize());
                return attmReq;
            }).collect(Collectors.toList());
            String json = objectMapper.writeValueAsString(attachmentRequestList);
            request.setMessage(request.getMessage() + "\n" + "Attachments: " + "\n" + json);
        }
        return roboAssistant.chat(sessionId, request.getMessage());
    }
}
