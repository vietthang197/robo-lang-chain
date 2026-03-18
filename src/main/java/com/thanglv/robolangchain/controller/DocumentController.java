package com.thanglv.robolangchain.controller;

import com.thanglv.robolangchain.dto.request.DocumentUploadRequest;
import com.thanglv.robolangchain.dto.response.DocumentProcessingResponse;
import com.thanglv.robolangchain.dto.response.DocumentUploadResponse;
import com.thanglv.robolangchain.services.DocumentProcessingService;
import com.thanglv.robolangchain.services.DocumentStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/document")
@RequiredArgsConstructor
public class DocumentController {

    private final DocumentStorageService documentStorageService;
    private final DocumentProcessingService documentProcessingService;

    @PostMapping("/upload")
    public ResponseEntity<?> upload(@ModelAttribute DocumentUploadRequest request) throws Exception {
        DocumentUploadResponse response = documentStorageService.upload(request);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/process/{documentId}")
    public ResponseEntity<DocumentProcessingResponse> process(@PathVariable String documentId) throws Exception {
        return ResponseEntity.ok(documentProcessingService.process(documentId));
    }
}
