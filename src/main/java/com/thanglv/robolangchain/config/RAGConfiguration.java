package com.thanglv.robolangchain.config;

import dev.langchain4j.data.document.splitter.DocumentSplitters;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.input.PromptTemplate;
import dev.langchain4j.model.scoring.ScoringModel;
import dev.langchain4j.rag.DefaultRetrievalAugmentor;
import dev.langchain4j.rag.RetrievalAugmentor;
import dev.langchain4j.rag.content.aggregator.ReRankingContentAggregator;
import dev.langchain4j.rag.content.injector.DefaultContentInjector;
import dev.langchain4j.rag.content.retriever.EmbeddingStoreContentRetriever;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.EmbeddingStoreIngestor;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;


@Configuration
@RequiredArgsConstructor
public class RAGConfiguration {

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

    @Bean
    public ReRankingContentAggregator reRankingContentAggregator(ScoringModel scoringModel) {
        return ReRankingContentAggregator.builder()
                .scoringModel(scoringModel)
                .minScore(0.5)
                .maxResults(20)
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
                                {{userMessage}}
                                
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

}