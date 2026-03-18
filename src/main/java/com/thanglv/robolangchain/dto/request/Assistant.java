package com.thanglv.robolangchain.dto.request;

import dev.langchain4j.service.MemoryId;
import dev.langchain4j.service.UserMessage;

public interface Assistant {
    String chat(@UserMessage String userMessage);
}