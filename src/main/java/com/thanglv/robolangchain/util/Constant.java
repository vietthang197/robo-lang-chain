package com.thanglv.robolangchain.util;

public interface Constant {

    enum RAG_STATUS {
        NOT_PROCESS,
        PROCESSED
    }

    enum UPLOAD_STATUS {
        NOT_UPLOAD,
        PENDING,
        SUCCESS,
        FAILED
    }

    String NO = "N";
    String YES = "Y";

    interface FILE_SOURCE {
        String LOCAL = "LOCAL";
    }
}
