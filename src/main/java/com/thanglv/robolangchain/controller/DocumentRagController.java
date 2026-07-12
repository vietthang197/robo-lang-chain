package com.thanglv.robolangchain.controller;

import com.thanglv.robolangchain.dto.response.DocumentProcessingResponse;
import com.thanglv.robolangchain.services.DocumentRagProcessingService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/document")
@RequiredArgsConstructor
public class DocumentRagController {

    private final DocumentRagProcessingService documentRagProcessingService;

    @GetMapping("/rag/process/{documentId}")
    public ResponseEntity<DocumentProcessingResponse> process(@PathVariable String documentId) throws Exception {
        return ResponseEntity.ok(documentRagProcessingService.process(documentId));
    }
}
