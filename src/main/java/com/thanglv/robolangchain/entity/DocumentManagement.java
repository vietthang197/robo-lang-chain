package com.thanglv.robolangchain.entity;

import com.thanglv.robolangchain.util.Constant;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table
@Getter
@Setter
public class DocumentManagement {

    @Id
    private String id;

    private String originalFileName;
    private Long size;
    private String path;
    private LocalDateTime createdDate;
    private Constant.DOCUMENT_STATUS status;
}
