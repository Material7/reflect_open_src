package com.reflect.backend.controller;

import com.reflect.backend.entity.Task;
import com.reflect.backend.entity.TaskChangeLog;
import com.reflect.backend.service.ProjectAuthService;
import com.reflect.backend.service.TaskChangeLogService;
import com.reflect.backend.service.TaskExtService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Set;

import java.util.List;
import java.util.Map;

/**
 * 既存 TaskController を補完する拡張エンドポイント群。
 * 外部 REST API 向けに個別取得・検索・部分更新・フェーズ/工数/成果物操作を提供する。
 *
 * <p>いずれのエンドポイントも対象タスクの所属プロジェクトのメンバーであることを要求する
 * （システム Admin は全プロジェクト可）。変更ログの取得だけは changeLogViewRoles に従う。
 * タスクが存在しない場合は projectIdOf が null を返し、@PreAuthorize が 403 で落とす。
 */
@RestController
@RequestMapping("/api/tasks")
@RequiredArgsConstructor
public class TaskExtController {

    /** 対象タスクの所属プロジェクトのメンバーであること */
    private static final String MEMBER_OF_TASK =
            "@projectAuth.isMember(authentication, @taskExtService.projectIdOf(#id))";

    private final TaskExtService service;
    private final TaskChangeLogService changeLogService;
    private final ProjectAuthService projectAuth;

    @GetMapping("/by-task-id/{taskId}")
    @PreAuthorize("@projectAuth.isMember(authentication, @taskExtService.projectIdOfDisplayId(#taskId))")
    public ResponseEntity<Task> getByTaskId(@PathVariable String taskId) {
        return ResponseEntity.ok(service.getByTaskId(taskId));
    }

    @GetMapping("/{id}")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Task> getById(@PathVariable String id) {
        return ResponseEntity.ok(service.getById(id));
    }

    @GetMapping("/search")
    @PreAuthorize("#projectId == null or @projectAuth.isMember(authentication, #projectId)")
    public ResponseEntity<List<Task>> search(
            @RequestParam(required = false) Long projectId,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String assignee,
            @RequestParam(required = false) String domainId,
            @RequestParam(required = false) String name,
            Authentication auth) {
        List<Task> tasks = service.search(projectId, type, status, assignee, domainId, name);
        // projectId 未指定の横断検索では、所属していないプロジェクトのタスクを除外する
        Set<Long> visible = projectAuth.visibleProjectIds(auth);
        if (visible != null) {
            tasks = tasks.stream().filter(t -> visible.contains(t.getProjectId())).toList();
        }
        return ResponseEntity.ok(tasks);
    }

    @PostMapping("/allocate-id")
    public ResponseEntity<Map<String, Object>> allocateId(@RequestBody Map<String, String> body,
                                                          Authentication auth) {
        Long projectId = body.get("projectId") != null ? Long.valueOf(body.get("projectId")) : null;
        if (!projectAuth.isMember(auth, projectId)) {
            throw new AccessDeniedException("このプロジェクトでタスクIDを採番する権限がありません");
        }
        return ResponseEntity.ok(service.allocateTaskId(projectId, body.get("type")));
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Task> updateStatus(
            @PathVariable String id,
            @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(service.updateStatus(id, body.get("status")));
    }

    @PatchMapping("/{id}/assignee")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Task> updateAssignee(
            @PathVariable String id,
            @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(service.updateAssignee(id, body.get("assignee")));
    }

    @GetMapping("/{id}/phases/{phaseCode}")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Map<String, Object>> getPhase(
            @PathVariable String id,
            @PathVariable String phaseCode) {
        return ResponseEntity.ok(service.getPhase(id, phaseCode));
    }

    @PatchMapping("/{id}/phases/{phaseCode}/work-step")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Task> updateWorkStep(
            @PathVariable String id,
            @PathVariable String phaseCode,
            @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(service.updateWorkStep(id, phaseCode, body.get("workStepCode")));
    }

    @PutMapping("/{id}/phases/{phaseCode}/schedule/{workStepCode}")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Task> updateSchedule(
            @PathVariable String id,
            @PathVariable String phaseCode,
            @PathVariable String workStepCode,
            @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(service.updateSchedule(id, phaseCode, workStepCode, body));
    }

    @GetMapping("/{id}/man-hours")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Map<String, Object>> getManHours(@PathVariable String id) {
        return ResponseEntity.ok(service.getManHours(id));
    }

    @PatchMapping("/{id}/phases/{phaseCode}/schedule/{workStepCode}/man-hours")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Task> updateManHours(
            @PathVariable String id,
            @PathVariable String phaseCode,
            @PathVariable String workStepCode,
            @RequestBody Map<String, Object> body) {
        Double planned = body.get("plannedManHours") instanceof Number n ? n.doubleValue() : null;
        Double actual  = body.get("actualManHours")  instanceof Number n ? n.doubleValue() : null;
        return ResponseEntity.ok(service.updateManHours(id, phaseCode, workStepCode, planned, actual));
    }

    @PostMapping("/{id}/phases/{phaseCode}/schedule/{workStepCode}/actual-man-hours-log")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Task> addActualManHoursLog(
            @PathVariable String id,
            @PathVariable String phaseCode,
            @PathVariable String workStepCode,
            @RequestBody Map<String, Object> body) {
        String empNo = (String) body.get("employeeNumber");
        String date  = (String) body.get("date");
        double hours = body.get("hours") instanceof Number n ? n.doubleValue() : 0.0;
        String content = (String) body.get("content");
        return ResponseEntity.ok(service.addActualManHoursLog(id, phaseCode, workStepCode, empNo, date, hours, content));
    }

    @GetMapping("/{id}/deliverables")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Map<String, Object>> getDeliverables(@PathVariable String id) {
        return ResponseEntity.ok(service.getDeliverables(id));
    }

    @PostMapping("/{id}/deliverables/{phaseCode}")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Task> addDeliverable(
            @PathVariable String id,
            @PathVariable String phaseCode,
            @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(service.addDeliverable(id, phaseCode, body));
    }

    @PutMapping("/{id}/deliverables/{phaseCode}/{index}")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Task> updateDeliverable(
            @PathVariable String id,
            @PathVariable String phaseCode,
            @PathVariable int index,
            @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(service.updateDeliverable(id, phaseCode, index, body));
    }

    @DeleteMapping("/{id}/deliverables/{phaseCode}/{index}")
    @PreAuthorize(MEMBER_OF_TASK)
    public ResponseEntity<Void> deleteDeliverable(
            @PathVariable String id,
            @PathVariable String phaseCode,
            @PathVariable int index) {
        service.deleteDeliverable(id, phaseCode, index);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/change-logs")
    @PreAuthorize("@projectAuth.canViewChangeLogs(authentication, @taskExtService.projectIdOf(#id))")
    public ResponseEntity<List<TaskChangeLog>> getChangeLogsByUuid(@PathVariable String id) {
        return ResponseEntity.ok(changeLogService.findByTaskId(id));
    }

    @GetMapping("/by-task-id/{taskId}/change-logs")
    @PreAuthorize("@projectAuth.canViewChangeLogs(authentication, @taskExtService.projectIdOfDisplayId(#taskId))")
    public ResponseEntity<List<TaskChangeLog>> getChangeLogsByTaskId(@PathVariable String taskId) {
        return ResponseEntity.ok(changeLogService.findByTaskDisplayId(taskId));
    }
}
