package com.thanglv.robolangchain.dto.request;

import lombok.Getter;
import lombok.Setter;
import org.springframework.web.multipart.MultipartFile;

import java.io.Serializable;

@Getter
@Setter
public class FileUploadRequest implements Serializable {
    private MultipartFile file;
}
