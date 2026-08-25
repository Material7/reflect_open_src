package com.reflect.backend.service;

import com.reflect.backend.entity.Task;
import com.reflect.backend.entity.TaskChangeLog;
import com.reflect.backend.repository.TaskChangeLogRepository;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.*;

@Service
@RequiredArgsConstructor
public class TaskChangeLogService {

    private final TaskChangeLogRepository repository;

    @Transactional(readOnly = true)
    public Page<TaskChangeLog> search(Long projectId, String operation, String taskDisplayId, String changedBy,
                                      String fromDate, String toDate, int page, int size) {
        LocalDateTime from = parseDate(fromDate, "T00:00:00");
        LocalDateTime to   = parseDate(toDate,   "T23:59:59");

        String opFilter  = blankToNull(operation);
        String tidFilter = taskDisplayId != null && !taskDisplayId.isBlank()
                ? taskDisplayId.toLowerCase() : null;
        String cbFilter  = changedBy != null && !changedBy.isBlank()
                ? changedBy.toLowerCase() : null;

        Specification<TaskChangeLog> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (projectId != null)
                predicates.add(cb.equal(root.get("projectId"), projectId));
            if (opFilter != null)
                predicates.add(cb.equal(root.get("operation"), opFilter));
            if (tidFilter != null)
                predicates.add(cb.like(cb.lower(root.get("taskDisplayId")), "%" + tidFilter + "%"));
            if (cbFilter != null)
                predicates.add(cb.like(cb.lower(root.get("changedBy")), "%" + cbFilter + "%"));
            if (from != null)
                predicates.add(cb.greaterThanOrEqualTo(root.get("changedAt"), from));
            if (to != null)
                predicates.add(cb.lessThanOrEqualTo(root.get("changedAt"), to));
            if (query != null) query.orderBy(cb.desc(root.get("changedAt")));
            return cb.and(predicates.toArray(new Predicate[0]));
        };
        return repository.findAll(spec, PageRequest.of(page, size));
    }

    @Transactional(readOnly = true)
    public List<TaskChangeLog> findByTaskId(String taskId) {
        return repository.findByTaskIdOrderByChangedAtDesc(taskId);
    }

    @Transactional(readOnly = true)
    public List<TaskChangeLog> findByTaskDisplayId(String taskDisplayId) {
        return repository.findByTaskDisplayIdOrderByChangedAtDesc(taskDisplayId);
    }

    @Transactional(readOnly = true)
    public Optional<TaskChangeLog> findById(String id) {
        return repository.findById(id);
    }

    @Transactional
    public void logTaskCreate(Task task, String changedBy) {
        save(task, "TASK_CREATED", changedBy, null, null, null, null, null);
    }

    @Transactional
    public void logTaskDelete(Task task, String changedBy) {
        save(task, "TASK_DELETED", changedBy, null, null, null, null, null);
    }

    @Transactional
    public void logChange(Task task, String operation, String changedBy,
                          String phaseCode, String workStepCode, String deliverableName,
                          String oldValue, String newValue) {
        save(task, operation, changedBy, phaseCode, workStepCode, deliverableName, oldValue, newValue);
    }

    @Transactional
    public void logApiKeyOperation(String operation, String changedBy, String keyPrefix) {
        TaskChangeLog log = new TaskChangeLog();
        log.setId(UUID.randomUUID().toString());
        log.setOperation(operation);
        log.setChangedBy(changedBy);
        log.setChangedAt(LocalDateTime.now());
        log.setOldValue(operation.equals("API_KEY_REVOKED") ? keyPrefix : null);
        log.setNewValue(operation.equals("API_KEY_GENERATED") ? keyPrefix : null);
        repository.save(log);
    }

    @Transactional
    public void diffAndLog(Task oldTask, Task newTask, String changedBy) {
        if (!Objects.equals(oldTask.getStatus(), newTask.getStatus())) {
            save(newTask, "STATUS_CHANGED", changedBy, null, null, null,
                    oldTask.getStatus(), newTask.getStatus());
        }
        if (!Objects.equals(oldTask.getPriority(), newTask.getPriority())) {
            save(newTask, "PRIORITY_CHANGED", changedBy, null, null, null,
                    priorityLabel(oldTask.getPriority()), priorityLabel(newTask.getPriority()));
        }
        if (!Objects.equals(oldTask.getAssignee(), newTask.getAssignee())) {
            save(newTask, "ASSIGNEE_CHANGED", changedBy, null, null, null,
                    oldTask.getAssignee(), newTask.getAssignee());
        }
        if (!Objects.equals(oldTask.getName(), newTask.getName())) {
            save(newTask, "NAME_CHANGED", changedBy, null, null, null,
                    oldTask.getName(), newTask.getName());
        }
        if (!Objects.equals(oldTask.getDomainId(), newTask.getDomainId())) {
            save(newTask, "DOMAIN_CHANGED", changedBy, null, null, null,
                    oldTask.getDomainId(), newTask.getDomainId());
        }

        diffPhases(oldTask, newTask, changedBy);

        diffDeliverables(oldTask, newTask, changedBy);

        diffReferences(oldTask, newTask, changedBy);
    }

    private void diffPhases(Task oldTask, Task newTask, String changedBy) {
        Map<String, Object> oldPhases = oldTask.getPhases();
        Map<String, Object> newPhases = newTask.getPhases();
        if (oldPhases == null || newPhases == null) return;

        for (String phaseCode : newPhases.keySet()) {
            if (!oldPhases.containsKey(phaseCode)) continue;
            Map<String, Object> oldPhase = castMap(oldPhases.get(phaseCode));
            Map<String, Object> newPhase = castMap(newPhases.get(phaseCode));
            if (oldPhase == null || newPhase == null) continue;

            String oldWs = str(oldPhase.get("currentWorkStepCode"));
            String newWs = str(newPhase.get("currentWorkStepCode"));
            if (!Objects.equals(oldWs, newWs)) {
                save(newTask, "WORK_STEP_CHANGED", changedBy, phaseCode, null, null, oldWs, newWs);
            }

            Map<String, Object> oldSched = castMap(oldPhase.get("schedule"));
            Map<String, Object> newSched = castMap(newPhase.get("schedule"));
            if (oldSched == null || newSched == null) continue;

            for (String wsCode : newSched.keySet()) {
                if (!oldSched.containsKey(wsCode)) continue;
                Map<String, Object> oldWs2 = castMap(oldSched.get(wsCode));
                Map<String, Object> newWs2 = castMap(newSched.get(wsCode));
                if (oldWs2 == null || newWs2 == null) continue;

                compareStr(newTask, "PLANNED_START_DATE_CHANGED", changedBy, phaseCode, wsCode, oldWs2, newWs2, "plannedStartDate");
                compareStr(newTask, "PLANNED_END_DATE_CHANGED",   changedBy, phaseCode, wsCode, oldWs2, newWs2, "plannedEndDate");
                compareStr(newTask, "ACTUAL_START_DATE_CHANGED",  changedBy, phaseCode, wsCode, oldWs2, newWs2, "actualStartDate");
                compareStr(newTask, "ACTUAL_END_DATE_CHANGED",    changedBy, phaseCode, wsCode, oldWs2, newWs2, "actualEndDate");
                compareNum(newTask, "PLANNED_MAN_HOURS_CHANGED",  changedBy, phaseCode, wsCode, oldWs2, newWs2, "plannedManHours");
                compareNum(newTask, "ACTUAL_MAN_HOURS_CHANGED",   changedBy, phaseCode, wsCode, oldWs2, newWs2, "actualManHours");
            }
        }
    }

    private void diffDeliverables(Task oldTask, Task newTask, String changedBy) {
        Map<String, Object> oldDbp = oldTask.getDeliverablesByPhase();
        Map<String, Object> newDbp = newTask.getDeliverablesByPhase();
        if (oldDbp == null && newDbp == null) return;

        Map<String, Object> safeOld = oldDbp != null ? oldDbp : Map.of();
        Map<String, Object> safeNew = newDbp != null ? newDbp : Map.of();

        Set<String> phaseCodes = new HashSet<>();
        phaseCodes.addAll(safeOld.keySet());
        phaseCodes.addAll(safeNew.keySet());

        for (String phaseCode : phaseCodes) {
            List<Map<String, Object>> oldList = toDeliverableList(safeOld.get(phaseCode));
            List<Map<String, Object>> newList = toDeliverableList(safeNew.get(phaseCode));

            int commonSize = Math.min(oldList.size(), newList.size());

            for (int i = 0; i < commonSize; i++) {
                Map<String, Object> oldD = oldList.get(i);
                Map<String, Object> newD = newList.get(i);
                String dName = nvl(str(newD.get("name")), str(oldD.get("name")));

                String oldWf = str(oldD.get("workflow"));
                String newWf = str(newD.get("workflow"));
                if (!Objects.equals(oldWf, newWf)) {
                    save(newTask, "DELIVERABLE_WORKFLOW_CHANGED", changedBy, phaseCode, null, dName, oldWf, newWf);
                } else if (hasFieldChange(oldD, newD)) {
                    save(newTask, "DELIVERABLE_UPDATED", changedBy, phaseCode, null, dName, null, null);
                }
            }
            for (int i = commonSize; i < newList.size(); i++) {
                Map<String, Object> newD = newList.get(i);
                save(newTask, "DELIVERABLE_ADDED", changedBy, phaseCode, null,
                        str(newD.get("name")), null, str(newD.get("workflow")));
            }
            for (int i = commonSize; i < oldList.size(); i++) {
                Map<String, Object> oldD = oldList.get(i);
                save(newTask, "DELIVERABLE_DELETED", changedBy, phaseCode, null,
                        str(oldD.get("name")), str(oldD.get("workflow")), null);
            }
        }
    }

    private void diffReferences(Task oldTask, Task newTask, String changedBy) {
        List<Map<String, Object>> oldList = toDeliverableList(oldTask.getReferences());
        List<Map<String, Object>> newList = toDeliverableList(newTask.getReferences());
        if (oldList.isEmpty() && newList.isEmpty()) return;

        Map<String, Map<String, Object>> oldById = new LinkedHashMap<>();
        for (Map<String, Object> r : oldList) {
            String id = str(r.get("id"));
            if (id != null) oldById.put(id, r);
        }
        Set<String> newIds = new HashSet<>();

        for (Map<String, Object> newR : newList) {
            String id = str(newR.get("id"));
            String label = str(newR.get("label"));
            if (id != null) newIds.add(id);
            Map<String, Object> oldR = id != null ? oldById.get(id) : null;
            if (oldR == null) {
                save(newTask, "REFERENCE_ADDED", changedBy, null, null, label, null, label);
            } else if (hasReferenceChange(oldR, newR)) {
                save(newTask, "REFERENCE_UPDATED", changedBy, null, null, label, null, null);
            }
        }
        for (Map<String, Object> oldR : oldList) {
            String id = str(oldR.get("id"));
            if (id == null || !newIds.contains(id)) {
                String label = str(oldR.get("label"));
                save(newTask, "REFERENCE_DELETED", changedBy, null, null, label, label, null);
            }
        }
    }

    private boolean hasReferenceChange(Map<String, Object> oldR, Map<String, Object> newR) {
        for (String field : List.of("label", "kind", "value", "revision", "branch", "note")) {
            if (!Objects.equals(str(oldR.get(field)), str(newR.get(field)))) return true;
        }
        return false;
    }

    private void save(Task task, String operation, String changedBy,
                      String phaseCode, String workStepCode, String deliverableName,
                      String oldValue, String newValue) {
        TaskChangeLog log = new TaskChangeLog();
        log.setId(UUID.randomUUID().toString());
        log.setProjectId(task.getProjectId());
        log.setTaskId(task.getId());
        log.setTaskDisplayId(task.getTaskId());
        log.setTaskName(task.getName());
        log.setTaskType(task.getType());
        log.setOperation(operation);
        log.setChangedBy(changedBy);
        log.setChangedAt(LocalDateTime.now());
        log.setPhaseCode(phaseCode);
        log.setWorkStepCode(workStepCode);
        log.setDeliverableName(deliverableName);
        log.setOldValue(oldValue);
        log.setNewValue(newValue);
        repository.save(log);
    }

    private void compareStr(Task task, String operation, String changedBy,
                             String phaseCode, String wsCode,
                             Map<String, Object> oldMap, Map<String, Object> newMap, String field) {
        String oldV = str(oldMap.get(field));
        String newV = str(newMap.get(field));
        if (!Objects.equals(oldV, newV)) {
            save(task, operation, changedBy, phaseCode, wsCode, null, oldV, newV);
        }
    }

    private void compareNum(Task task, String operation, String changedBy,
                             String phaseCode, String wsCode,
                             Map<String, Object> oldMap, Map<String, Object> newMap, String field) {
        Double oldV = toDouble(oldMap.get(field));
        Double newV = toDouble(newMap.get(field));
        if (!Objects.equals(oldV, newV)) {
            save(task, operation, changedBy, phaseCode, wsCode, null,
                    oldV != null ? String.valueOf(oldV) : null,
                    newV != null ? String.valueOf(newV) : null);
        }
    }

    private boolean hasFieldChange(Map<String, Object> oldD, Map<String, Object> newD) {
        for (String field : List.of("name", "type", "revision", "url")) {
            if (!Objects.equals(str(oldD.get(field)), str(newD.get(field)))) return true;
        }
        return false;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> toDeliverableList(Object obj) {
        if (!(obj instanceof List)) return List.of();
        List<?> raw = (List<?>) obj;
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : raw) {
            if (item instanceof Map) result.add((Map<String, Object>) item);
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> castMap(Object obj) {
        return obj instanceof Map ? (Map<String, Object>) obj : null;
    }

    private String str(Object v) {
        return v != null ? String.valueOf(v) : null;
    }

    private Double toDouble(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(String.valueOf(v)); } catch (NumberFormatException e) { return null; }
    }

    private String nvl(String a, String b) {
        return a != null ? a : b;
    }

    /** 優先度コード → 表示ラベル（未設定は null のまま） */
    private String priorityLabel(String code) {
        if (code == null) return null;
        return switch (code) {
            case "HIGH" -> "高";
            case "MEDIUM" -> "中";
            case "LOW" -> "低";
            default -> code;
        };
    }

    private static LocalDateTime parseDate(String date, String timeSuffix) {
        if (date == null || date.isBlank()) return null;
        try {
            return LocalDateTime.parse(date + timeSuffix);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("日付の形式が不正です（yyyy-MM-dd）: " + date);
        }
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}
