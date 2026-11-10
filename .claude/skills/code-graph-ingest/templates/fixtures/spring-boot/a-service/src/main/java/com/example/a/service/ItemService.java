package com.example.a.service;

import com.example.a.client.BClient;
import com.example.a.dto.ItemDto;
import org.springframework.stereotype.Service;

@Service
public class ItemService {
    private final BClient bClient;

    public ItemService(BClient bClient) {
        this.bClient = bClient;
    }

    public ItemDto getItem(String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("id is required");
        }
        return bClient.getItem(id);
    }
}
