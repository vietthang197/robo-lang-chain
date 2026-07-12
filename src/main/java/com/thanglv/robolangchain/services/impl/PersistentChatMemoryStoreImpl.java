package com.thanglv.robolangchain.services.impl;

import com.thanglv.robolangchain.entity.ChatMessageDocument;
import com.thanglv.robolangchain.repository.ChatMessageRepository;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.store.memory.chat.ChatMemoryStore;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import static dev.langchain4j.data.message.ChatMessageDeserializer.messagesFromJson;
import static dev.langchain4j.data.message.ChatMessageSerializer.messagesToJson;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class PersistentChatMemoryStoreImpl implements ChatMemoryStore {

    private final ChatMessageRepository chatMessageRepository;

    @Override
    public List<ChatMessage> getMessages(Object memoryId) {
        Optional<ChatMessageDocument> chatMessageDocumentOptional = chatMessageRepository.findFirstBySessionId((String) memoryId);
        if (chatMessageDocumentOptional.isEmpty()) {
            return List.of();
        }
        ChatMessageDocument chatMessageDocument = chatMessageDocumentOptional.get();
        return messagesFromJson(chatMessageDocument.getChatContent());
    }

    @Override
    public void updateMessages(Object memoryId, List<ChatMessage> messages) {
        String content = messagesToJson(messages);
        Optional<ChatMessageDocument> chatMessageDocumentOptional = chatMessageRepository.findFirstBySessionId((String) memoryId);
        if (chatMessageDocumentOptional.isEmpty()) {
            ChatMessageDocument chatMessageDocument = new ChatMessageDocument();
            chatMessageDocument.setSessionId((String) memoryId);
            chatMessageDocument.setChatContent(content);
            chatMessageDocument.setCreatedDate(Instant.now());
            chatMessageDocument.setUserId(UUID.randomUUID().toString());
            chatMessageRepository.save(chatMessageDocument);
        } else {
            ChatMessageDocument existsChat = chatMessageDocumentOptional.get();
            existsChat.setChatContent(content);
            existsChat.setUpdatedDate(Instant.now());
            chatMessageRepository.save(existsChat);
        }
    }

    @Override
    public void deleteMessages(Object memoryId) {
        Optional<ChatMessageDocument> chatMessageDocumentOptional = chatMessageRepository.findFirstBySessionId((String) memoryId);
        chatMessageDocumentOptional.ifPresent(chatMessageRepository::delete);
    }
}
