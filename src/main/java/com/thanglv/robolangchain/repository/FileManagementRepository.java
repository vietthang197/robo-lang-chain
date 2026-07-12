package com.thanglv.robolangchain.repository;

import com.thanglv.robolangchain.entity.FileManagementDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface FileManagementRepository extends MongoRepository<FileManagementDocument, String> {
}
