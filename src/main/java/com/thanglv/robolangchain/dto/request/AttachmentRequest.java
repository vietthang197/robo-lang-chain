package com.thanglv.robolangchain.dto.request;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class AttachmentRequest {
    private String id;
    private String mimeType;
    private Long size;
    private String name;
}
