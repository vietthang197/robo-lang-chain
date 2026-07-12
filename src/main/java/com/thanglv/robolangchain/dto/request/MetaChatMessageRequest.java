package com.thanglv.robolangchain.dto.request;

import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class MetaChatMessageRequest {

    @Size(max = 5, message = "max attachments size is 5")
    private List<AttachmentRequest> attachments;
}
