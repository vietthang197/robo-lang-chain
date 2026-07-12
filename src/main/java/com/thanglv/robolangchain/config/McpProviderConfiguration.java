package com.thanglv.robolangchain.config;

import dev.langchain4j.mcp.McpToolProvider;
import dev.langchain4j.mcp.client.DefaultMcpClient;
import dev.langchain4j.mcp.client.McpClient;
import dev.langchain4j.mcp.client.transport.McpTransport;
import dev.langchain4j.mcp.client.transport.stdio.StdioMcpTransport;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;
import java.util.List;

@Configuration
public class McpProviderConfiguration {

    @Bean
    public McpToolProvider mcpToolProvider() {
        McpTransport mcpFetchTransport = StdioMcpTransport.builder()
                .command(List.of("C:/Program Files/nodejs/npx.cmd", "mcp-fetch-server"))
                .logEvents(true)
                .build();
        McpClient mcpClientFetch = DefaultMcpClient.builder()
                .transport(mcpFetchTransport)
                .clientName("fetch")
                .toolExecutionTimeout(Duration.ofMinutes(30))
                .build();
        McpTransport fileSystemTransport = StdioMcpTransport.builder()
                .command(List.of("C:/Program Files/nodejs/npx.cmd", "-y",
                        "@modelcontextprotocol/server-filesystem", "D:/"))
                .logEvents(true)
                .build();
        McpClient mcpClientFile = DefaultMcpClient.builder()
                .transport(fileSystemTransport)
                .toolExecutionTimeout(Duration.ofMinutes(30))
                .clientName("filesystem")
                .build();

        McpTransport playwrightTransport = StdioMcpTransport.builder()
                .command(List.of("C:/Program Files/nodejs/npx.cmd", "-y",
                        "@playwright/mcp@latest"))
                .logEvents(true)
                .build();
        McpClient mcpPlaywright = DefaultMcpClient.builder()
                .transport(playwrightTransport)
                .clientName("playwright")
                .toolExecutionTimeout(Duration.ofMinutes(30))
                .build();
        return McpToolProvider.builder()
                .mcpClients(mcpClientFetch, mcpClientFile, mcpPlaywright)
                .build();
    }
}
