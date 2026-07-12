package com.thanglv.robolangchain.entity;

import lombok.Getter;
import lombok.Setter;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

import java.time.Instant;

@Document
@Getter
@Setter
public class ChatMessageDocument {

    @Id
    @Field(name = "SESSION_ID")
    private String sessionId;

    @Field(name = "CHAT_CONTENT")
    private String chatContent;

    @Field(name = "USER_ID")
    private String userId;

    @Field(name = "CREATED_DATE")
    private Instant createdDate;

    @Field("UPDATED_DATE")
    private Instant updatedDate;
}
