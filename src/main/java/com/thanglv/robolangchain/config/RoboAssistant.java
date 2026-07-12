package com.thanglv.robolangchain.config;

import dev.langchain4j.service.MemoryId;
import dev.langchain4j.service.UserMessage;

public interface RoboAssistant {
    String chat(@MemoryId String memoryId, @UserMessage String userMessage);
}