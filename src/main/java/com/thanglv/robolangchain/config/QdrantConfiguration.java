package com.thanglv.robolangchain.config;

import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.ollama.OllamaEmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.qdrant.QdrantEmbeddingStore;
import io.qdrant.client.QdrantClient;
import io.qdrant.client.QdrantGrpcClient;
import io.qdrant.client.grpc.Collections;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.ExecutionException;

@Configuration
@RequiredArgsConstructor
public class QdrantConfiguration {

    private final EmbeddingModel embeddingModel;

    @Value("${qdrant.host}")
    private String qdrantHost;

    @Value("${qdrant.port}")
    private Integer qdrantPort;

    @Bean
    public QdrantClient qdrantClient() throws ExecutionException, InterruptedException {
        QdrantGrpcClient.Builder grpcClientBuilder =
                QdrantGrpcClient.newBuilder(
                        qdrantHost, qdrantPort, false);
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
}
