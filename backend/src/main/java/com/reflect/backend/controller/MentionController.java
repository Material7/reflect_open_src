package com.reflect.backend.controller;

import com.reflect.backend.service.MentionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/me/mentions")
@RequiredArgsConstructor
public class MentionController {

    private final MentionService mentionService;

    @GetMapping
    public List<MentionService.MentionView> list(@AuthenticationPrincipal String employeeNumber) {
        return mentionService.listForUser(employeeNumber);
    }

    @GetMapping("/unread-count")
    public Map<String, Long> unreadCount(@AuthenticationPrincipal String employeeNumber) {
        return Map.of("count", mentionService.unreadCount(employeeNumber));
    }

    @PostMapping("/read")
    public ResponseEntity<Void> markRead(@AuthenticationPrincipal String employeeNumber,
                                         @RequestBody Map<String, String> body) {
        String taskId = body.get("taskId");
        if (taskId != null && !taskId.isBlank()) {
            mentionService.markReadByTask(employeeNumber, taskId);
        }
        return ResponseEntity.noContent().build();
    }
}
