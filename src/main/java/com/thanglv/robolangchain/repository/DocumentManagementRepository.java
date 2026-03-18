package com.thanglv.robolangchain.repository;

import com.thanglv.robolangchain.entity.DocumentManagement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface DocumentManagementRepository extends JpaRepository<DocumentManagement, String> {
}
