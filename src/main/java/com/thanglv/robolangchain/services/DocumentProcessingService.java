package com.thanglv.robolangchain.services;

import com.thanglv.robolangchain.dto.response.DocumentProcessingResponse;

public interface DocumentProcessingService {
    DocumentProcessingResponse process(String fileId) throws Exception;
}
