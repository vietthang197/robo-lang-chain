package com.thanglv.robolangchain.config;

import com.thanglv.robolangchain.dto.request.Assistant;
import com.thanglv.robolangchain.repository.ConversationStoreRepository;
import dev.langchain4j.community.model.xinference.XinferenceScoringModel;
import dev.langchain4j.data.document.splitter.DocumentSplitters;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.mcp.McpToolProvider;
import dev.langchain4j.memory.ChatMemory;
import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.input.PromptTemplate;
import dev.langchain4j.model.ollama.OllamaEmbeddingModel;
import dev.langchain4j.model.scoring.ScoringModel;
import dev.langchain4j.rag.DefaultRetrievalAugmentor;
import dev.langchain4j.rag.RetrievalAugmentor;
import dev.langchain4j.rag.content.aggregator.ReRankingContentAggregator;
import dev.langchain4j.rag.content.injector.DefaultContentInjector;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.EmbeddingStoreIngestor;
import dev.langchain4j.store.embedding.qdrant.QdrantEmbeddingStore;
import dev.langchain4j.store.memory.chat.InMemoryChatMemoryStore;
import io.qdrant.client.QdrantClient;
import io.qdrant.client.QdrantGrpcClient;
import io.qdrant.client.grpc.Collections;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;
import java.util.concurrent.ExecutionException;

@Configuration
@RequiredArgsConstructor
public class EmbeddingConfiguration {

    private final OllamaEmbeddingModel embeddingModel;

    @Bean
    public QdrantClient qdrantClient() throws ExecutionException, InterruptedException {
        QdrantGrpcClient.Builder grpcClientBuilder =
                QdrantGrpcClient.newBuilder(
                        "localhost", 6334, false);
        QdrantClient client = new QdrantClient(grpcClientBuilder.build());
        boolean existsDocument = client.collectionExistsAsync("documents").get();
        if (!existsDocument) {
            client
                    .createCollectionAsync(
                            "documents",
                            Collections.VectorParams.newBuilder().setDistance(Collections.Distance.Cosine).setSize(embeddingModel.dimension()).build())
                    .get();
        }
        return client;
    }

    @Bean
    public EmbeddingStore<TextSegment> qdrantEmbeddingStore() throws ExecutionException, InterruptedException {
        return new QdrantEmbeddingStore(
                qdrantClient(), "documents", "text_segment"
        );
    }

    @Bean
    public EmbeddingStoreIngestor embeddingStoreIngestor(EmbeddingModel embeddingModel,
                                                         EmbeddingStore<TextSegment> embeddingStore) {
        return EmbeddingStoreIngestor.builder()
                .documentSplitter(DocumentSplitters.recursive(1000, 100))
                .embeddingModel(embeddingModel)
                .embeddingStore(embeddingStore)
                .build();
    }

    @Bean
    public EmbeddingStoreContentRetriever embeddingStoreContentRetriever(EmbeddingStore<TextSegment> embeddingStore,
                                                                         EmbeddingModel embeddingModel) {
        return EmbeddingStoreContentRetriever.builder()
                .embeddingStore(embeddingStore)
                .embeddingModel(embeddingModel)
                .maxResults(50)
                .minScore(0.6)
                .build();
    }

    @Bean(name = "scoringModel")
    public ScoringModel scoringModel() {
        return XinferenceScoringModel.builder()
                .baseUrl("http://localhost:9997")
                .apiKey(null)
                .modelName("Qwen3-Reranker-0.6B")
                .timeout(Duration.ofSeconds(300))
                .maxRetries(10)
                .topN(30)
                .logRequests(true)
                .logResponses(true)
                .build();
    }

    @Bean
    public ReRankingContentAggregator reRankingContentAggregator(ScoringModel scoringModel) {
        return ReRankingContentAggregator.builder()
                .scoringModel(scoringModel)
                .minScore(0.8)
                .maxResults(30)
                .build();
    }

    @Bean
    public RetrievalAugmentor retrievalAugmentor(
            EmbeddingStoreContentRetriever retriever,
            ReRankingContentAggregator aggregator) {

        return DefaultRetrievalAugmentor.builder()
                .contentRetriever(retriever)
                .contentAggregator(aggregator)
                .contentInjector(DefaultContentInjector.builder().promptTemplate(
                        PromptTemplate.from("""
                                Context information is below.
                                
                                ---------------------
                                {{contents}}
                                ---------------------
                                
                                Given the context information and no prior knowledge, answer the query.
                                
                                Follow these rules:
                                
                                1. If the context is empty or irrelevant, answer using your own knowledge.
                                2. Avoid statements like "Based on the context..." or "The provided information...".
                                """)
                ).build())
                .build();
    }

    @Bean
    public Assistant assistant(ChatModel chatModel,
                               RetrievalAugmentor retrievalAugmentor, McpToolProvider toolProvider, ConversationStoreRepository conversationStoreRepository) {

        ChatMemory chatMemory = MessageWindowChatMemory.builder()
                .maxMessages(100)
                .chatMemoryStore(new InMemoryChatMemoryStore())
                .build();

        return AiServices.builder(Assistant.class)
                .chatModel(chatModel)
                .retrievalAugmentor(retrievalAugmentor)
                .toolProvider(toolProvider)
                .chatMemory(chatMemory)
                .build();
    }
}