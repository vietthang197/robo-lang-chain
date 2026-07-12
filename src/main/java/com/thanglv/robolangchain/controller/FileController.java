package com.thanglv.robolangchain.controller;

import com.thanglv.robolangchain.dto.request.FileUploadRequest;
import com.thanglv.robolangchain.dto.response.FileUploadResponse;
import com.thanglv.robolangchain.services.FileStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/file")
@RequiredArgsConstructor
public class FileController {

    private final FileStorageService fileStorageService;

    @PostMapping("/upload")
    public ResponseEntity<?> upload(@ModelAttribute FileUploadRequest request) throws Exception {
        FileUploadResponse response = fileStorageService.upload(request);
        return ResponseEntity.ok(response);
    }
}
