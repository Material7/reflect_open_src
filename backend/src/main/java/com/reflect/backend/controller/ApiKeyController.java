package com.reflect.backend.controller;

import com.reflect.backend.service.ApiKeyService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/auth/api-keys")
@RequiredArgsConstructor
public class ApiKeyController {

    private final ApiKeyService apiKeyService;

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> list(
            @AuthenticationPrincipal String employeeNumber) {
        return ResponseEntity.ok(apiKeyService.list(employeeNumber));
    }

    /** 新しい API キーを発行（平文は一度だけ返る） */
    @PostMapping
    public ResponseEntity<Map<String, Object>> generate(
            @AuthenticationPrincipal String employeeNumber) {
        return ResponseEntity.ok(apiKeyService.generate(employeeNumber));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> revoke(
            @AuthenticationPrincipal String employeeNumber,
            @PathVariable String id) {
        apiKeyService.revoke(id, employeeNumber);
        return ResponseEntity.noContent().build();
    }
}
