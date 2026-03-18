package com.thanglv.robolangchain.dto.request;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RoboChatRequest {
    private String message;
    private String conversationId;
}
