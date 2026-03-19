package com.thanglv.robolangchain.controller;

import com.thanglv.robolangchain.agent.AgentOrchestrator;
import com.thanglv.robolangchain.dto.request.InputChat;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ChatController {

    private final AgentOrchestrator agentOrchestrator;

    @PostMapping("/chat")
    public String chat(@RequestBody InputChat request) {
        return agentOrchestrator.process(request.getMessage());
    }
}
