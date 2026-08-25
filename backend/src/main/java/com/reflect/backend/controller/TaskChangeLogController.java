package com.reflect.backend.controller;

import com.reflect.backend.entity.TaskChangeLog;
import com.reflect.backend.service.ProjectAuthService;
import com.reflect.backend.service.TaskChangeLogService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/change-logs")
@RequiredArgsConstructor
public class TaskChangeLogController {

    private final TaskChangeLogService service;
    private final ProjectAuthService projectAuth;

    @GetMapping
    public ResponseEntity<Page<TaskChangeLog>> list(
            @RequestParam(required = false) Long projectId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String operation,
            @RequestParam(required = false) String taskDisplayId,
            @RequestParam(required = false) String changedBy,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate) {

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (projectId != null) {
            requireViewable(auth, projectId);
        } else if (!projectAuth.isSystemAdmin(auth)) {
            throw new AccessDeniedException("プロジェクトを指定してください");
        }
        return ResponseEntity.ok(
                service.search(projectId, operation, taskDisplayId, changedBy, fromDate, toDate, page, size));
    }

    @GetMapping("/task/{taskId}")
    public ResponseEntity<List<TaskChangeLog>> byTask(@PathVariable String taskId) {
        List<TaskChangeLog> logs = service.findByTaskId(taskId);
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (!logs.isEmpty()) requireViewable(auth, logs.get(0).getProjectId());
        return ResponseEntity.ok(logs);
    }

    @GetMapping("/{id}")
    public ResponseEntity<TaskChangeLog> getById(@PathVariable String id) {
        return service.findById(id)
                .map(log -> {
                    requireViewable(SecurityContextHolder.getContext().getAuthentication(), log.getProjectId());
                    return ResponseEntity.ok(log);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    private void requireViewable(Authentication auth, Long projectId) {
        if (projectId != null && !projectAuth.canViewChangeLogs(auth, projectId)) {
            throw new AccessDeniedException("変更ログの閲覧権限がありません");
        }
    }
}
