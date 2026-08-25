package com.reflect.backend.service;

import com.reflect.backend.config.ActionItemStatusCatalog;
import com.reflect.backend.entity.ActionItem;
import com.reflect.backend.entity.ProjectSettings;
import com.reflect.backend.repository.ActionItemRepository;
import com.reflect.backend.repository.ProjectSettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ActionItemService {

    private static final Set<String> VALID_PRIORITIES = Set.of("HIGH", "MEDIUM", "LOW");

    private final ActionItemRepository repository;
    private final ProjectSettingsRepository settingsRepository;
    private final ActionItemStatusCatalog statusCatalog;

    @Transactional(readOnly = true)
    public List<ActionItem> findAll(Long projectId) {
        return projectId != null
                ? repository.findByProjectIdOrderByCreatedAtDesc(projectId)
                : repository.findAllByOrderByCreatedAtDesc();
    }

    @Transactional
    public ActionItem create(ActionItem item, String createdBy) {
        validate(item);
        if (item.getProjectId() == null)
            throw new IllegalArgumentException("projectId は必須です");
        if (item.getId() == null || item.getId().isBlank())
            item.setId(UUID.randomUUID().toString());
        validateTicketKeyUnique(item.getProjectId(), item.getTicketKey(), item.getId());
        if (item.getItemId() == null || item.getItemId().isBlank())
            item.setItemId(allocateItemId(item.getProjectId()));
        if (item.getStatus() == null || item.getStatus().isBlank())
            item.setStatus(statusCatalog.notStartedName());
        normalizeTags(item);
        normalizePriority(item);
        item.setCreatedBy(createdBy);
        item.setCreatedAt(LocalDateTime.now());
        return repository.save(item);
    }

    /** プロジェクト別カウンタから表示用IDを採番（行ロックで排他制御）。形式: {prefix}-A0001 */
    private String allocateItemId(Long projectId) {
        ProjectSettings s = settingsRepository.findByProjectIdForUpdate(projectId)
                .orElseThrow(() -> new IllegalStateException("プロジェクト設定が存在しません: " + projectId));
        int counter = s.getTaskIdCounterA() == null ? 1 : s.getTaskIdCounterA();
        String itemId = String.format("%s-A%04d", s.getTaskIdPrefix(), counter);
        s.setTaskIdCounterA(counter + 1);
        settingsRepository.save(s);
        return itemId;
    }

    @Transactional
    public ActionItem update(String id, ActionItem patch) {
        ActionItem existing = repository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("アクションアイテムが見つかりません: " + id));
        validate(patch);
        validateTicketKeyUnique(existing.getProjectId(), patch.getTicketKey(), id);
        existing.setCategory(patch.getCategory());
        existing.setTitle(patch.getTitle());
        existing.setAssignee(patch.getAssignee());
        existing.setStatus(patch.getStatus() == null || patch.getStatus().isBlank()
                ? statusCatalog.notStartedName() : patch.getStatus());
        existing.setDueDate(patch.getDueDate());
        existing.setTags(patch.getTags());
        existing.setPriority(patch.getPriority());
        existing.setMemo(patch.getMemo());
        existing.setTicketUrl(patch.getTicketUrl());
        existing.setTicketKey(patch.getTicketKey());
        existing.setIssuedTaskId(patch.getIssuedTaskId());
        normalizeTags(existing);
        normalizePriority(existing);
        return repository.save(existing);
    }

    @Transactional
    public void delete(String id) {
        if (!repository.existsById(id))
            throw new NoSuchElementException("アクションアイテムが見つかりません: " + id);
        repository.deleteById(id);
    }

    @Transactional(readOnly = true)
    public Long projectIdOf(String id) {
        return repository.findById(id).map(ActionItem::getProjectId).orElse(null);
    }

    private void validate(ActionItem item) {
        if (item.getTitle() == null || item.getTitle().isBlank())
            throw new IllegalArgumentException("title は必須です");
        if (item.getCategory() == null || item.getCategory().isBlank())
            throw new IllegalArgumentException("category は必須です");
    }

    /** 同一プロジェクト内でのチケットIDの重複を禁止する */
    private void validateTicketKeyUnique(Long projectId, String ticketKey, String itemId) {
        if (ticketKey == null || ticketKey.isBlank()) return;
        if (repository.existsByProjectIdAndTicketKeyAndIdNot(projectId, ticketKey, itemId)) {
            throw new IllegalArgumentException(
                    "チケットID「" + ticketKey + "」は同一プロジェクト内の別のアクションアイテムに既に紐づけられています");
        }
    }

    /** タグを正規化: null は空リストに、空白/重複を除去 */
    private void normalizeTags(ActionItem item) {
        if (item.getTags() == null) {
            item.setTags(new ArrayList<>());
            return;
        }
        List<String> cleaned = new ArrayList<>();
        for (String t : item.getTags()) {
            if (t == null) continue;
            String v = t.trim();
            if (!v.isEmpty() && !cleaned.contains(v)) cleaned.add(v);
        }
        item.setTags(cleaned);
    }

    /** 優先度を正規化: HIGH/MEDIUM/LOW 以外（空文字含む）は null にする */
    private void normalizePriority(ActionItem item) {
        if (item.getPriority() != null && !VALID_PRIORITIES.contains(item.getPriority())) {
            item.setPriority(null);
        }
    }
}
