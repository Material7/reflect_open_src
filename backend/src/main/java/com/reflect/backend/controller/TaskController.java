package com.reflect.backend.controller;

import com.reflect.backend.dto.response.TaskRefResponse;
import com.reflect.backend.entity.Task;
import com.reflect.backend.service.ProjectAuthService;
import com.reflect.backend.service.TaskService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/tasks")
@RequiredArgsConstructor
public class TaskController {

    private final TaskService taskService;
    private final ProjectAuthService projectAuth;

    @GetMapping
    public ResponseEntity<List<Task>> getTasks(
            @RequestParam(required = false) Long projectId,
            @RequestParam(required = false) String type,
            Authentication auth) {
        List<Task> tasks = (type != null)
                ? taskService.findByType(projectId, type)
                : taskService.findAll(projectId);
        Set<Long> visible = projectAuth.visibleProjectIds(auth);
        if (visible != null) {
            tasks = tasks.stream().filter(t -> visible.contains(t.getProjectId())).toList();
        }
        return ResponseEntity.ok(tasks);
    }

    /**
     * タスク名または表示用タスクIDからタスク（UUID含む）を引く軽量ルックアップ。
     * `name`（完全一致・大小文字無視）または `taskId`（例: TASK-R0001）のいずれかを指定する。
     * projectId で絞り込み可。名前/タスクIDは横断で重複しうるため配列で返す。
     * 所属プロジェクトのタスクのみ（システムAdminは全件）。
     */
    @GetMapping("/lookup")
    public ResponseEntity<List<TaskRefResponse>> lookup(
            @RequestParam(required = false) String name,
            @RequestParam(required = false) String taskId,
            @RequestParam(required = false) Long projectId,
            Authentication auth) {
        boolean hasTaskId = taskId != null && !taskId.isBlank();
        boolean hasName = name != null && !name.isBlank();
        if (!hasTaskId && !hasName) {
            throw new IllegalArgumentException("name または taskId のいずれかを指定してください");
        }
        List<Task> matched = hasTaskId
                ? taskService.findByDisplayTaskId(projectId, taskId)
                : taskService.findByName(projectId, name);
        Set<Long> visible = projectAuth.visibleProjectIds(auth);
        List<TaskRefResponse> result = matched.stream()
                .filter(t -> visible == null || visible.contains(t.getProjectId()))
                .map(TaskRefResponse::from)
                .toList();
        return ResponseEntity.ok(result);
    }

    @PostMapping
    @PreAuthorize("@projectAuth.isMember(authentication, #task.projectId)")
    public ResponseEntity<Task> createTask(@RequestBody Task task) {
        return ResponseEntity.ok(taskService.save(task));
    }

    @PutMapping("/{id}")
    @PreAuthorize("@projectAuth.isMember(authentication, @taskService.projectIdOf(#id))")
    public ResponseEntity<Task> updateTask(@PathVariable String id, @RequestBody Task task) {
        task.setId(id);
        return ResponseEntity.ok(taskService.update(task));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@projectAuth.canDeleteTask(authentication, @taskService.projectIdOf(#id))")
    public ResponseEntity<Void> deleteTask(@PathVariable String id) {
        taskService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
