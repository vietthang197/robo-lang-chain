package com.thanglv.robolangchain.dto.response;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class FileUploadResponse {
    private String fileId;
    private String path;
    private String mimeType;
    private String originalFileName;
}
