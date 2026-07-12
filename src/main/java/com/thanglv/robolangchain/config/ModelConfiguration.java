package com.thanglv.robolangchain.config;

import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.ollama.OllamaChatModel;
import dev.langchain4j.model.ollama.OllamaEmbeddingModel;
import dev.langchain4j.model.scoring.ScoringModel;
import dev.langchain4j.model.scoring.onnx.OnnxScoringModel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

@Configuration
public class ModelConfiguration {

    private static final Logger log = LoggerFactory.getLogger(ModelConfiguration.class);

    @Value("${ollama.base.url}")
    private String ollamaBaseUrl;

    @Value("${ollama.chat.model.name}")
    private String ollamaChatModelName;

    @Value("${scoring.model.onnx.path}")
    private String onnxPath;

    @Value("${scoring.model.tokenizer.path}")
    private String tokenizerPath;

    @Value("${ollama.embedding.model.name}")
    private String ollamaEmbeddingModelName;

    @Bean(name = "scoringModel")
    public ScoringModel scoringModel() {
        return new OnnxScoringModel(onnxPath, tokenizerPath);
    }

    @Bean(name = "chatModel")
    public ChatModel chatModel() {
        return OllamaChatModel.builder()
                .baseUrl(ollamaBaseUrl)
                .modelName(ollamaChatModelName)
                .think(true)
                .returnThinking(true)
                .maxRetries(5)
                .logger(log)
                .logRequests(true)
                .logResponses(true)
                .temperature(0.6d)
                .topK(20)
                .minP(0d)
                .topP(0.95d)
                .timeout(Duration.ofMinutes(30L))
                .build();
    }

    @Bean(name = "embeddingModel")
    public EmbeddingModel embeddingModel() {
        return OllamaEmbeddingModel.builder()
                .baseUrl(ollamaBaseUrl)
                .modelName(ollamaEmbeddingModelName)
                .maxRetries(5)
                .logRequests(true)
                .logResponses(true)
                .timeout(Duration.ofMinutes(30L))
                .build();
    }
}
