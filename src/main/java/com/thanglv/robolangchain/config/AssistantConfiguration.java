package com.thanglv.robolangchain.config;

import com.thanglv.robolangchain.mcp.InternalTool;
import dev.langchain4j.mcp.McpToolProvider;
import dev.langchain4j.memory.chat.ChatMemoryProvider;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.rag.RetrievalAugmentor;
import dev.langchain4j.service.AiServices;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class AssistantConfiguration {

    @Autowired
    private McpToolProvider mcpToolProvider;

    @Autowired
    @Qualifier("chatModel")
    private ChatModel chatModel;

    @Autowired
    private ChatMemoryProvider chatMemoryProvider;

    @Autowired
    private RetrievalAugmentor retrievalAugmentor;

    @Autowired
    private InternalTool internalTool;

    @Bean
    public RoboAssistant assistant() {
        return AiServices.builder(RoboAssistant.class)
                .chatModel(chatModel)
                .tools(List.of(internalTool))
                .toolProvider(mcpToolProvider)
                .chatMemoryProvider(chatMemoryProvider)
                .retrievalAugmentor(retrievalAugmentor)
                .build();
    }
}
