package com.thanglv.robolangchain.dto.request;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RoboDocumentChatRequest extends RoboChatRequest {
    private String documentId;
}
