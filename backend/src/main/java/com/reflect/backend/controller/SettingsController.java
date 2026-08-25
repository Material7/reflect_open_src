package com.reflect.backend.controller;

import com.reflect.backend.service.SettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/projects/{projectId}/settings")
@RequiredArgsConstructor
public class SettingsController {

    private final SettingsService settingsService;

    @GetMapping
    @PreAuthorize("@projectAuth.isMember(authentication, #projectId)")
    public ResponseEntity<Map<String, Object>> getSettings(@PathVariable Long projectId) {
        return ResponseEntity.ok(settingsService.getAll(projectId));
    }

    @PutMapping
    @PreAuthorize("@projectAuth.hasProjectRole(authentication, #projectId, 'Admin', 'PM', 'PL')")
    public ResponseEntity<Map<String, Object>> updateSettings(
            @PathVariable Long projectId,
            @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(settingsService.saveAll(projectId, body));
    }
}
