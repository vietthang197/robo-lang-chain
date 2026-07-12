package com.thanglv.robolangchain.services;

import com.thanglv.robolangchain.dto.response.DocumentProcessingResponse;

public interface DocumentRagProcessingService {
    DocumentProcessingResponse process(String fileId) throws Exception;
}
