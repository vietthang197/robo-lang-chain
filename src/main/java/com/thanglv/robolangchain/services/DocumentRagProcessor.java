package com.thanglv.robolangchain.services;

import com.thanglv.robolangchain.entity.FileManagementDocument;

import java.io.IOException;

public interface DocumentRagProcessor {
    void process(FileManagementDocument file) throws IOException;
}
