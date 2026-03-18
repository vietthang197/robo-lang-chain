package com.thanglv.robolangchain.repository;

import com.thanglv.robolangchain.entity.ConversationStore;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ConversationStoreRepository extends JpaRepository<ConversationStore, String> {
    Optional<ConversationStore> findByConversationIdOrderByCreatedAtAsc(String conversationId);

    @Modifying
    int deleteByConversationId(String conversationId);
}
