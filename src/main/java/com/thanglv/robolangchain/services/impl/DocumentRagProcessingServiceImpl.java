package com.thanglv.robolangchain.services.impl;

import com.thanglv.robolangchain.dto.response.DocumentProcessingResponse;
import com.thanglv.robolangchain.entity.FileManagementDocument;
import com.thanglv.robolangchain.repository.FileManagementRepository;
import com.thanglv.robolangchain.services.DocumentRagProcessingService;
import com.thanglv.robolangchain.util.Constant;
import org.apache.commons.io.FilenameUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import java.util.Optional;

@Service
public class DocumentRagProcessingServiceImpl implements DocumentRagProcessingService {
    @Autowired
    private  FileManagementRepository fileManagementRepository;

    @Autowired
    @Qualifier("pdfRagProcess")
    private PdfRagProcess pdfRagProcess;

    @Override
    public DocumentProcessingResponse process(String fileId) throws Exception {
        long start = System.currentTimeMillis();
        Optional<FileManagementDocument> documentManagementOptional = fileManagementRepository.findById(fileId);
        if (documentManagementOptional.isEmpty()) {
            throw new RuntimeException("Document Management Not Found");
        }
        FileManagementDocument fileManagementDocument = documentManagementOptional.get();
        if (FilenameUtils.getExtension(fileManagementDocument.getOriginalFileName()).toLowerCase().contains("pdf")) {
            pdfRagProcess.process(fileManagementDocument);
        } else {
            throw new RuntimeException("Error document type not support rag");
        }

        fileManagementDocument.setRagStatus(Constant.RAG_STATUS.PROCESSED);
        fileManagementRepository.save(fileManagementDocument);
        long end = System.currentTimeMillis();
        DocumentProcessingResponse documentProcessingResponse = new DocumentProcessingResponse();
        documentProcessingResponse.setTime((end - start) + " ms");
        return documentProcessingResponse;
    }
}
