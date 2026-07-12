package com.thanglv.robolangchain.dto.request;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class RoboChatRequest {
    private String message;
    private List<String> documentId;
}
