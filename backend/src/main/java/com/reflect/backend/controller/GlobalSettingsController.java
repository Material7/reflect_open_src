package com.reflect.backend.controller;

import com.reflect.backend.entity.GlobalSettings;
import com.reflect.backend.service.GlobalSettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/global-settings")
@RequiredArgsConstructor
public class GlobalSettingsController {

    private final GlobalSettingsService globalSettingsService;

    @GetMapping
    public ResponseEntity<GlobalSettings> get() {
        return ResponseEntity.ok(globalSettingsService.get());
    }

    @PutMapping
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<GlobalSettings> update(@RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(globalSettingsService.update(body));
    }
}
