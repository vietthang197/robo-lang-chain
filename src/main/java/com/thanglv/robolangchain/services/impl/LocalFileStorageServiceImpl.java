package com.thanglv.robolangchain.services.impl;


import com.thanglv.robolangchain.dto.request.FileUploadRequest;
import com.thanglv.robolangchain.dto.response.FileUploadResponse;
import com.thanglv.robolangchain.entity.FileManagementDocument;
import com.thanglv.robolangchain.repository.FileManagementRepository;
import com.thanglv.robolangchain.services.FileStorageService;
import com.thanglv.robolangchain.util.Constant;
import lombok.RequiredArgsConstructor;
import org.apache.commons.io.FilenameUtils;
import org.apache.tika.Tika;
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
public class LocalFileStorageServiceImpl implements FileStorageService {

    private final FileManagementRepository fileManagementRepository;
    private final Tika tika = new Tika();

    @Value("${nas.path}")
    private String rootDir;

    @Override
    public FileUploadResponse upload(FileUploadRequest request) throws IOException {
        Path rootPath = Paths.get(rootDir);
        String subDir = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        rootPath = rootPath.resolve(subDir);
        if (Files.notExists(rootPath) || !Files.isDirectory(rootPath)) {
            Files.createDirectories(rootPath);
        }

        String newFileName = UUID.randomUUID() + "." + FilenameUtils.getExtension(request.getFile().getOriginalFilename());
        Path newFilePath = rootPath.resolve(newFileName);
        String mimeType = null;

        try (InputStream is = request.getFile().getInputStream()) {
            Files.copy(is, newFilePath, StandardCopyOption.REPLACE_EXISTING);
            mimeType = tika.detect(is, request.getFile().getOriginalFilename());
        }

        FileManagementDocument localFile = new FileManagementDocument();
        localFile.setId(UUID.randomUUID().toString());
        localFile.setOriginalFileName(request.getFile().getOriginalFilename());
        localFile.setFileSize(request.getFile().getSize());
        localFile.setPath(newFilePath.toAbsolutePath().toString());
        localFile.setCreatedDate(Instant.now());
        localFile.setUploadStatus(Constant.UPLOAD_STATUS.SUCCESS);
        localFile.setSource(Constant.FILE_SOURCE.LOCAL);
        localFile.setRagStatus(Constant.RAG_STATUS.NOT_PROCESS);
        localFile.setMimeType(mimeType);

        // String createdBy = SecurityContextHolder.getContext().getUserId()
        localFile.setCreatedBy(UUID.randomUUID().toString());

        localFile = fileManagementRepository.save(localFile);
        FileUploadResponse response = new FileUploadResponse();
        response.setFileId(localFile.getId());
        response.setPath(localFile.getPath());
        response.setMimeType(mimeType);
        response.setOriginalFileName(localFile.getOriginalFileName());
        return response;
    }
}
