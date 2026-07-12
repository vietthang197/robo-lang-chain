package com.thanglv.robolangchain.repository;

import com.thanglv.robolangchain.entity.ChatMessageDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface ChatMessageRepository extends MongoRepository<ChatMessageDocument, String> {
    Optional<ChatMessageDocument> findFirstBySessionId(String sessionId);
}
