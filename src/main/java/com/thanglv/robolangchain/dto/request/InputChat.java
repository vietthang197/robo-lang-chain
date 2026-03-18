package com.thanglv.robolangchain.dto.request;

import lombok.Data;

import javax.validation.constraints.NotNull;

@Data
public class InputChat {
    @NotNull
    private String message;

    @NotNull
    private String memoryId;
}
