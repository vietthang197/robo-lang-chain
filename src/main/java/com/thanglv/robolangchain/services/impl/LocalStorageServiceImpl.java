package com.thanglv.robolangchain.services.impl;


import com.thanglv.robolangchain.dto.request.DocumentUploadRequest;
import com.thanglv.robolangchain.dto.response.DocumentUploadResponse;
import com.thanglv.robolangchain.entity.FileManagementDocument;
import com.thanglv.robolangchain.repository.FileManagementRepository;
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
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class LocalStorageServiceImpl implements DocumentStorageService {

    private final FileManagementRepository fileManagementRepository;

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

        FileManagementDocument localFile = new FileManagementDocument();
        localFile.setId(UUID.randomUUID().toString());
        localFile.setOriginalFileName(request.getFile().getOriginalFilename());
        localFile.setSize(request.getFile().getSize());
        localFile.setPath(newFilePath.toAbsolutePath().toString());
        localFile.setCreatedDate(Instant.now());
        localFile.setUploadStatus(Constant.UPLOAD_STATUS.SUCCESS);
        localFile.setIsLocalStorage(Constant.NO);
        localFile.setRagStatus(Constant.RAG_STATUS.NOT_PROCESS);

        localFile = fileManagementRepository.save(localFile);
        DocumentUploadResponse response = new DocumentUploadResponse();
        response.setDocumentId(localFile.getId());
        response.setPath(localFile.getPath());
        return response;
    }
}
