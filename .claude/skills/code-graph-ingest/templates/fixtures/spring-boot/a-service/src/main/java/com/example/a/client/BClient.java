package com.example.a.client;

import com.example.a.dto.ItemDto;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

@FeignClient(name = "b-service", url = "${b-service.url}")
public interface BClient {
    @GetMapping("/items/{id}")
    ItemDto getItem(@PathVariable("id") String id);
}
