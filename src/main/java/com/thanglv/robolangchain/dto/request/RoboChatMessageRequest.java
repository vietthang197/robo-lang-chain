package com.thanglv.robolangchain.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RoboChatMessageRequest {

    @NotBlank(message = "message can not be blank")
    private String message;
    private MetaChatMessageRequest meta;
}
