package com.thanglv.robolangchain.services.impl;

import com.thanglv.robolangchain.entity.ConversationStore;
import com.thanglv.robolangchain.repository.ConversationStoreRepository;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.store.memory.chat.ChatMemoryStore;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import static dev.langchain4j.data.message.ChatMessageDeserializer.messagesFromJson;
import static dev.langchain4j.data.message.ChatMessageSerializer.messagesToJson;

import java.time.Instant;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class PersistentChatMemoryStore implements ChatMemoryStore {

    private final ConversationStoreRepository conversationStoreRepository;

    @Override
    public List<ChatMessage> getMessages(Object o) {
        String conversationId = (String) o;
        Optional<ConversationStore> conversationStoreOptional = conversationStoreRepository.findByConversationIdOrderByCreatedAtAsc(conversationId);
        if (conversationStoreOptional.isEmpty()) {
            return Collections.emptyList();
        }
        ConversationStore conversationStore = conversationStoreOptional.get();
        return messagesFromJson(conversationStore.getContent());
    }

    @Override
    public void updateMessages(Object o, List<ChatMessage> list) {
        String conversationId = (String) o;
        Optional<ConversationStore> conversationStoreOptional = conversationStoreRepository.findByConversationIdOrderByCreatedAtAsc(conversationId);
        if (conversationStoreOptional.isEmpty()) {
            ConversationStore conversationStore = new ConversationStore();
            conversationStore.setConversationId(conversationId);
            conversationStore.setContent(messagesToJson(list));
            conversationStore.setCreatedAt(Instant.now());
            conversationStoreRepository.save(conversationStore);
        } else {
            ConversationStore conversationStore = conversationStoreOptional.get();
            conversationStore.setContent(messagesToJson(list));
            conversationStore.setUpdatedAt(Instant.now());
            conversationStoreRepository.save(conversationStore);
        }
    }

    @Override
    public void deleteMessages(Object o) {
        conversationStoreRepository.deleteByConversationId((String) o);
    }
}
