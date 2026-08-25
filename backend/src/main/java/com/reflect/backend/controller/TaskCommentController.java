package com.reflect.backend.controller;

import com.reflect.backend.entity.TaskComment;
import com.reflect.backend.service.ProjectAuthService;
import com.reflect.backend.service.TaskCommentService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * タスクコメント API。対象タスクの所属プロジェクトのメンバーであることを要求する
 * （システム Admin は全プロジェクト可）。
 */
@RestController
@RequestMapping("/api/tasks")
@RequiredArgsConstructor
public class TaskCommentController {

    /** 対象タスクの所属プロジェクトのメンバーであること */
    private static final String MEMBER_OF_TASK =
            "@projectAuth.isMember(authentication, @taskService.projectIdOf(#taskId))";

    private final TaskCommentService service;
    private final ProjectAuthService projectAuth;

    @GetMapping("/comments")
    @PreAuthorize("#projectId == null or @projectAuth.isMember(authentication, #projectId)")
    public List<TaskComment> listAll(@RequestParam(required = false) Long projectId,
                                     Authentication auth) {
        List<TaskComment> comments = service.findAll(projectId);
        // projectId 未指定の横断取得では、所属していないプロジェクトのコメントを除外する
        Set<Long> visible = projectAuth.visibleProjectIds(auth);
        if (visible != null) {
            comments = comments.stream().filter(c -> visible.contains(c.getProjectId())).toList();
        }
        return comments;
    }

    @GetMapping("/{taskId}/comments")
    @PreAuthorize(MEMBER_OF_TASK)
    public List<TaskComment> list(@PathVariable String taskId) {
        return service.findByTaskId(taskId);
    }

    @PostMapping("/{taskId}/comments")
    @PreAuthorize(MEMBER_OF_TASK)
    public TaskComment create(@PathVariable String taskId,
                              @RequestBody Map<String, String> body,
                              Authentication auth) {
        String content = body.get("content");
        if (content == null || content.isBlank()) {
            throw new IllegalArgumentException("コメント内容は必須です");
        }
        return service.create(taskId, content, auth.getName());
    }

    @DeleteMapping("/{taskId}/comments/{commentId}")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Void> delete(@PathVariable String taskId,
                                       @PathVariable String commentId,
                                       Authentication auth) {
        String role = auth.getAuthorities().stream()
            .findFirst()
            .map(GrantedAuthority::getAuthority)
            .map(a -> a.replace("ROLE_", ""))
            .orElse("");
        service.delete(commentId, auth.getName(), role);
        return ResponseEntity.noContent().build();
    }
}
