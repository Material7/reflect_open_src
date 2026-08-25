package com.reflect.backend.service;

import com.reflect.backend.entity.ProjectSettings;
import com.reflect.backend.entity.Task;
import com.reflect.backend.repository.ProjectSettingsRepository;
import com.reflect.backend.repository.TaskRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class TaskService {

    private final TaskRepository taskRepository;
    private final TaskChangeLogService changeLogService;
    private final ProjectSettingsRepository settingsRepository;

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public List<Task> findAll(Long projectId) {
        return projectId != null
                ? taskRepository.findByProjectIdOrderByTaskId(projectId)
                : taskRepository.findAll();
    }

    @Transactional(readOnly = true)
    public List<Task> findByType(Long projectId, String type) {
        return projectId != null
                ? taskRepository.findByProjectIdAndTypeOrderByTaskId(projectId, type)
                : taskRepository.findByTypeOrderByTaskId(type);
    }

    /** タスク名（完全一致・大小文字無視）でタスクを検索。projectId 指定時はそのプロジェクト内に限定 */
    @Transactional(readOnly = true)
    public List<Task> findByName(Long projectId, String name) {
        if (name == null || name.isBlank()) return List.of();
        return taskRepository.findByNameIgnoreCase(name.trim(), projectId);
    }

    /** 表示用タスクID（例: TASK-R0001）でタスクを検索。projectId 指定時はそのプロジェクト内に限定 */
    @Transactional(readOnly = true)
    public List<Task> findByDisplayTaskId(Long projectId, String taskId) {
        if (taskId == null || taskId.isBlank()) return List.of();
        return taskRepository.findAllByTaskId(taskId.trim(), projectId);
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public Task save(Task task) {
        if (task.getProjectId() == null) {
            throw new IllegalArgumentException("projectId は必須です");
        }
        if (task.getId() == null || task.getId().isBlank()) {
            task.setId(UUID.randomUUID().toString());
        }
        validateTicketKeyUnique(task.getProjectId(), task.getTicketKey(), task.getId());
        if (task.getTaskId() == null || task.getTaskId().isBlank()) {
            task.setTaskId(allocateTaskId(task.getProjectId(), task.getType()));
        }
        normalizePriority(task);
        Task saved = taskRepository.save(task);
        changeLogService.logTaskCreate(saved, currentUser());
        return saved;
    }

    private static final java.util.Set<String> VALID_PRIORITIES = java.util.Set.of("HIGH", "MEDIUM", "LOW");

    /** 優先度を正規化: HIGH/MEDIUM/LOW 以外（空文字含む）は null にする */
    private void normalizePriority(Task task) {
        if (task.getPriority() != null && !VALID_PRIORITIES.contains(task.getPriority())) {
            task.setPriority(null);
        }
    }

    /** 同一プロジェクト内でのチケットIDの重複を禁止する */
    private void validateTicketKeyUnique(Long projectId, String ticketKey, String taskId) {
        if (ticketKey == null || ticketKey.isBlank()) return;
        if (taskRepository.existsByProjectIdAndTicketKeyAndIdNot(projectId, ticketKey, taskId)) {
            throw new IllegalArgumentException(
                    "チケットID「" + ticketKey + "」は同一プロジェクト内の別タスクに既に紐づけられています");
        }
    }

    /**
     * プロジェクト別カウンタから表示用タスクIDを採番する（行ロックで排他制御）。
     * 採番はこのメソッドが唯一の実装で、外部 API 向けの払い出しもここを経由する。
     * 呼び出し側のトランザクション内で実行すること。
     */
    public String allocateTaskId(Long projectId, String type) {
        ProjectSettings s = settingsRepository.findByProjectIdForUpdate(projectId)
                .orElseThrow(() -> new IllegalStateException("プロジェクト設定が存在しません: " + projectId));
        String letter;
        int counter;
        if ("Requirement".equals(type)) {
            letter = "R"; counter = s.getTaskIdCounterR();
            s.setTaskIdCounterR(counter + 1);
        } else if ("Indirect".equals(type)) {
            letter = "X"; counter = s.getTaskIdCounterX() == null ? 1 : s.getTaskIdCounterX();
            s.setTaskIdCounterX(counter + 1);
        } else {
            letter = "D"; counter = s.getTaskIdCounterD();
            s.setTaskIdCounterD(counter + 1);
        }
        String taskId = String.format("%s-%s%04d", s.getTaskIdPrefix(), letter, counter);
        settingsRepository.save(s);
        return taskId;
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public Task update(Task task) {
        Task existing = taskRepository.findById(task.getId())
                .orElseThrow(() -> new IllegalArgumentException("タスクが見つかりません: " + task.getId()));
        // projectId / taskId は不変。リクエストボディの値で上書きされないよう既存値を保持
        task.setProjectId(existing.getProjectId());
        task.setTaskId(existing.getTaskId());
        normalizePriority(task);
        validateTicketKeyUnique(task.getProjectId(), task.getTicketKey(), task.getId());
        // detach しないと save(merge) が existing の状態を上書きし diff が取れなくなる
        entityManager.detach(existing);
        Task saved = taskRepository.save(task);
        changeLogService.diffAndLog(existing, saved, currentUser());
        return saved;
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public void delete(String id) {
        Task task = taskRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("タスクが見つかりません: " + id));
        changeLogService.logTaskDelete(task, currentUser());
        taskRepository.deleteById(id);
    }

    /** 削除対象タスクの projectId を解決（@PreAuthorize 用） */
    @Transactional(readOnly = true)
    public Long projectIdOf(String taskId) {
        return taskRepository.findById(taskId).map(Task::getProjectId).orElse(null);
    }

    private static String currentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null ? String.valueOf(auth.getName()) : "system";
    }
}
