package com.example.a.controller;

import com.example.a.dto.ItemDto;
import com.example.a.service.ItemService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/items")
public class ItemProxyController {
    private final ItemService itemService;

    public ItemProxyController(ItemService itemService) {
        this.itemService = itemService;
    }

    @GetMapping("/{id}")
    public ItemDto getItem(@PathVariable String id) {
        return itemService.getItem(id);
    }
}
