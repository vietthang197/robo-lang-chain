package com.thanglv.robolangchain.controller;

import com.thanglv.robolangchain.config.RoboAssistant;
import com.thanglv.robolangchain.dto.request.RoboChatRequest;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;


@RestController
@RequiredArgsConstructor
public class ChatController {

    private final RoboAssistant roboAssistant;

    @PostMapping("/chat")
    public String chat(@RequestBody RoboChatRequest userMessageRequest, HttpServletRequest servletRequest) {
        String sessionId = servletRequest.getRequestedSessionId();
        return roboAssistant.chat(sessionId, userMessageRequest.getMessage());
    }
}
