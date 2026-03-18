package com.thanglv.robolangchain.services.impl;


import com.thanglv.robolangchain.dto.request.DocumentUploadRequest;
import com.thanglv.robolangchain.dto.response.DocumentUploadResponse;
import com.thanglv.robolangchain.entity.DocumentManagement;
import com.thanglv.robolangchain.repository.DocumentManagementRepository;
import com.thanglv.robolangchain.services.DocumentStorageService;
import com.thanglv.robolangchain.util.Constant;
import lombok.RequiredArgsConstructor;
import org.apache.commons.io.FilenameUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class DocumentStorageServiceImpl implements DocumentStorageService {

    private final DocumentManagementRepository documentManagementRepository;

    @Value("${nas.path}")
    private String rootDir;

    @Override
    public DocumentUploadResponse upload(DocumentUploadRequest request) throws IOException {
        Path rootPath = Paths.get(rootDir);
        String subDir = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        rootPath = rootPath.resolve(subDir);
        if (Files.notExists(rootPath) || !Files.isDirectory(rootPath)) {
            Files.createDirectories(rootPath);
        }

        String newFileName = UUID.randomUUID()+ "." + FilenameUtils.getExtension(request.getFile().getOriginalFilename());
        Path newFilePath = rootPath.resolve(newFileName);
        try (InputStream is = request.getFile().getInputStream()) {
            Files.copy(is, newFilePath, StandardCopyOption.REPLACE_EXISTING);
        }

        DocumentManagement documentManagement = new DocumentManagement();
        documentManagement.setId(UUID.randomUUID().toString());
        documentManagement.setOriginalFileName(request.getFile().getOriginalFilename());
        documentManagement.setSize(request.getFile().getSize());
        documentManagement.setPath(newFilePath.toAbsolutePath().toString());
        documentManagement.setCreatedDate(LocalDateTime.now());
        documentManagement.setStatus(Constant.DOCUMENT_STATUS.NOT_PROCESS);

        documentManagement = documentManagementRepository.save(documentManagement);
        DocumentUploadResponse response = new DocumentUploadResponse();
        response.setDocumentId(documentManagement.getId());
        response.setPath(documentManagement.getPath());
        return response;
    }
}
