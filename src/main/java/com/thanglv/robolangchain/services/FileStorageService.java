package com.thanglv.robolangchain.services;


import com.thanglv.robolangchain.dto.request.FileUploadRequest;
import com.thanglv.robolangchain.dto.response.FileUploadResponse;

import java.io.IOException;

public interface FileStorageService {
    FileUploadResponse upload(FileUploadRequest request) throws IOException;
}
