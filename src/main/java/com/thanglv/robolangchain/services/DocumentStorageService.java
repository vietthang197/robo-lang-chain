package com.thanglv.robolangchain.services;


import com.thanglv.robolangchain.dto.request.DocumentUploadRequest;
import com.thanglv.robolangchain.dto.response.DocumentUploadResponse;

import java.io.IOException;

public interface DocumentStorageService {
    DocumentUploadResponse upload(DocumentUploadRequest request) throws IOException;
}
