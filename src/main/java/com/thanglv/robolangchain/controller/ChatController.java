package com.thanglv.robolangchain.controller;

import com.thanglv.robolangchain.dto.request.InputChat;
import com.thanglv.robolangchain.dto.request.Assistant;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class ChatController {

    private final Assistant assistant;

    @PostMapping("/chat")
    public String model(@RequestBody InputChat request) {
        return assistant.chat(request.getMessage());
    }
}
