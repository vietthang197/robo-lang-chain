package com.thanglv.robolangchain.entity;

import com.thanglv.robolangchain.util.Constant;
import lombok.Getter;
import lombok.Setter;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

import java.time.Instant;

@Getter
@Setter
@Document
public class FileManagementDocument {

    @Id
    private String id;

    @Field(name = "ORIGINAL_FILE_NAME")
    private String originalFileName;

    @Field(name = "FILE_SIZE")
    private Long fileSize;

    @Field(name = "PATH")
    private String path;

    @Field(name = "EXTERNAL_STORAGE_TYPE")
    private String externalStorageType;

    @Field(name = "EXTERNAL_STORAGE_ID")
    private String externalStorageId;

    @Field(name = "SOURCE")
    private String source;

    @Field(name = "CREATED_DATE")
    private Instant createdDate;

    @Field(name = "RAG_STATUS")
    private Constant.RAG_STATUS ragStatus;

    @Field(name = "UPLOAD_STATUS")
    private Constant.UPLOAD_STATUS uploadStatus;

    @Field(name = "MIME_TYPE")
    private String mimeType;

    @Indexed
    @Field(name = "CREATED_BY")
    private String createdBy;
}
