package com.thanglv.robolangchain.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(indexes = {
        @Index(name = "conversation_store_index", columnList = "conversation_id")
}
)
@Getter
@Setter
public class ConversationStore {
    @Id
    private String conversationId;

    @Lob
    private String content;

    private Instant createdAt;
    private Instant updatedAt;
}
