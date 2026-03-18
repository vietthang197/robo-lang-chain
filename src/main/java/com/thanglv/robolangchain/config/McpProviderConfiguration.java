package com.thanglv.robolangchain.config;

import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.mcp.McpToolProvider;
import dev.langchain4j.mcp.client.DefaultMcpClient;
import dev.langchain4j.mcp.client.McpClient;
import dev.langchain4j.mcp.client.transport.McpTransport;
import dev.langchain4j.mcp.client.transport.docker.DockerMcpTransport;
import dev.langchain4j.mcp.client.transport.stdio.StdioMcpTransport;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class McpProviderConfiguration {

    @Bean
    public McpToolProvider mcpToolProvider() {
        McpTransport mcpTimeTransport = StdioMcpTransport.builder()
                .command(List.of("docker", "run", "-i", "--rm", "mcp/time"))
                .logEvents(true)
                .build();
         McpClient mcpClientTime = DefaultMcpClient.builder().transport(mcpTimeTransport).clientName("time").build();

        McpTransport mcpFetchTransport = StdioMcpTransport.builder()
                .command(List.of("docker", "run", "-i", "--rm", "mcp/fetch"))
                .logEvents(true)
                .build();
        McpClient mcpClientFetch = DefaultMcpClient.builder().transport(mcpFetchTransport).clientName("fetch").build();

        McpTransport fileSystemTransport = StdioMcpTransport.builder()
                .command(List.of("C:\\\\Program Files\\\\nodejs\\\\npx.cmd",  "-y",
                        "@modelcontextprotocol/server-filesystem", "D:/"))
                .logEvents(true)
                .build();
        McpClient mcpClientFile = DefaultMcpClient.builder().transport(fileSystemTransport).clientName("filesystem").build();

        McpTransport playwrightTransport = StdioMcpTransport.builder()
                .command(List.of("C:\\\\Program Files\\\\nodejs\\\\npx.cmd",  "-y",
                        "@playwright/mcp@latest"))
                .logEvents(true)
                .build();
        McpClient mcpPlaywright = DefaultMcpClient.builder().transport(playwrightTransport).clientName("playwright").build();

//        McpTransport websearchTransport = StdioMcpTransport.builder()
//                .command(List.of("docker", "run", "-i", "--rm", "mcp/duckduckgo"))
//                .logEvents(true)
//                .build();
//        McpClient mcpClientSearch = DefaultMcpClient.builder().transport(websearchTransport).clientName("search").build();

        return McpToolProvider.builder()
                .mcpClients(mcpClientTime, mcpClientFetch, mcpClientFile, mcpPlaywright)
                .build();
    }
}
