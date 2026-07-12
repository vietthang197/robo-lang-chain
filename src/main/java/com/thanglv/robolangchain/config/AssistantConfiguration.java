package com.thanglv.robolangchain.config;

import com.thanglv.robolangchain.mcp.InternalTool;
import dev.langchain4j.mcp.McpToolProvider;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.service.AiServices;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
@RequiredArgsConstructor
public class AssistantConfiguration {

    private final McpToolProvider mcpToolProvider;
    private final ChatModel chatModel;

    @Bean
    public RoboAssistant assistant(ChatModel chatModel) {
        return AiServices.builder(RoboAssistant.class)
                .chatModel(chatModel)
                .tools(List.of(new InternalTool()))
                .toolProvider(mcpToolProvider)
                .build();
    }
}
