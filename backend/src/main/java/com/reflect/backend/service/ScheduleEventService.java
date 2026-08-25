package com.reflect.backend.service;

import com.reflect.backend.entity.ScheduleEvent;
import com.reflect.backend.repository.ScheduleEventRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ScheduleEventService {

    private static final Set<String> VALID_TYPES = Set.of("milestone", "event");
    private static final Set<String> VALID_COLORS = Set.of("indigo", "red", "orange", "green", "purple", "gray");

    private final ScheduleEventRepository repository;

    @Transactional(readOnly = true)
    public List<ScheduleEvent> findAll(Long projectId) {
        return projectId != null
                ? repository.findByProjectIdOrderByDateAsc(projectId)
                : repository.findAllByOrderByDateAsc();
    }

    @Transactional
    public ScheduleEvent create(ScheduleEvent event, String createdBy) {
        validate(event);
        if (event.getProjectId() == null)
            throw new IllegalArgumentException("projectId は必須です");
        if (event.getId() == null || event.getId().isBlank())
            event.setId(UUID.randomUUID().toString());
        event.setCreatedBy(createdBy);
        event.setCreatedAt(LocalDateTime.now());
        normalizeColor(event);
        return repository.save(event);
    }

    @Transactional
    public ScheduleEvent update(String id, ScheduleEvent patch) {
        ScheduleEvent existing = repository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("スケジュールが見つかりません: " + id));
        validate(patch);
        existing.setType(patch.getType());
        existing.setTitle(patch.getTitle());
        existing.setDate(patch.getDate());
        existing.setEndDate(patch.getEndDate());
        existing.setDescription(patch.getDescription());
        existing.setColor(patch.getColor());
        normalizeColor(existing);
        return repository.save(existing);
    }

    @Transactional
    public void delete(String id) {
        if (!repository.existsById(id))
            throw new NoSuchElementException("スケジュールが見つかりません: " + id);
        repository.deleteById(id);
    }

    @Transactional(readOnly = true)
    public Long projectIdOf(String id) {
        return repository.findById(id).map(ScheduleEvent::getProjectId).orElse(null);
    }

    private void validate(ScheduleEvent event) {
        if (event.getTitle() == null || event.getTitle().isBlank())
            throw new IllegalArgumentException("title は必須です");
        if (event.getDate() == null || event.getDate().isBlank())
            throw new IllegalArgumentException("date は必須です（YYYY-MM-DD）");
        if (!VALID_TYPES.contains(event.getType()))
            throw new IllegalArgumentException("type は milestone または event です");
    }

    private void normalizeColor(ScheduleEvent event) {
        if (event.getColor() == null || !VALID_COLORS.contains(event.getColor())) {
            event.setColor("indigo");
        }
    }
}
