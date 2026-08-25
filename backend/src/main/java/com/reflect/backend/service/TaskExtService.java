package com.reflect.backend.service;

import com.reflect.backend.entity.Task;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
public class TaskExtService {

    private final TaskRepository taskRepository;
    private final MemberRepository memberRepository;
    private final TaskChangeLogService changeLogService;
    private final TaskService taskService;

    /** 採番できるタスク種別。TaskService.allocateTaskId が扱う種別と揃える */
    private static final Set<String> VALID_TASK_TYPES =
            Set.of("Requirement", "Development", "Indirect");

    @Transactional(readOnly = true)
    public Task getById(String id) {
        return taskRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("タスクが見つかりません: " + id));
    }

    @Transactional(readOnly = true)
    public Task getByTaskId(String taskId) {
        return taskRepository.findByTaskId(taskId)
                .orElseThrow(() -> new NoSuchElementException("タスクが見つかりません: " + taskId));
    }

    /** @PreAuthorize 用: UUID からプロジェクトIDを解決（存在しなければ null） */
    @Transactional(readOnly = true)
    public Long projectIdOf(String id) {
        return taskRepository.findById(id).map(Task::getProjectId).orElse(null);
    }

    /** @PreAuthorize 用: 表示用タスクID からプロジェクトIDを解決（存在しなければ null） */
    @Transactional(readOnly = true)
    public Long projectIdOfDisplayId(String taskId) {
        return taskRepository.findByTaskId(taskId).map(Task::getProjectId).orElse(null);
    }

    @Transactional(readOnly = true)
    public List<Task> search(Long projectId, String type, String status, String assignee, String domainId, String name) {
        return taskRepository.search(
                projectId,
                blankToNull(type), blankToNull(status),
                blankToNull(assignee), blankToNull(domainId),
                blankToNull(name));
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public Task updateStatus(String id, String status) {
        if (status == null || status.isBlank()) throw new IllegalArgumentException("status は必須です");
        Task task = getById(id);
        String oldStatus = task.getStatus();
        task.setStatus(status);
        Task saved = taskRepository.save(task);
        changeLogService.logChange(saved, "STATUS_CHANGED", currentUser(), null, null, null, oldStatus, status);
        return saved;
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public Task updateAssignee(String id, String assignee) {
        if (assignee == null || assignee.isBlank()) throw new IllegalArgumentException("assignee は必須です");
        if (!memberRepository.existsByEmployeeNumber(assignee))
            throw new IllegalArgumentException("担当者が見つかりません: " + assignee);
        Task task = getById(id);
        String oldAssignee = task.getAssignee();
        task.setAssignee(assignee);
        Task saved = taskRepository.save(task);
        changeLogService.logChange(saved, "ASSIGNEE_CHANGED", currentUser(), null, null, null, oldAssignee, assignee);
        return saved;
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public Task updateWorkStep(String id, String phaseCode, String workStepCode) {
        if (workStepCode == null || workStepCode.isBlank()) throw new IllegalArgumentException("workStepCode は必須です");
        Task task = getById(id);
        Map<String, Object> phases = deepCopyPhases(task.getPhases());
        String oldWs = (String) getPhaseMap(phases, phaseCode).get("currentWorkStepCode");
        getPhaseMap(phases, phaseCode).put("currentWorkStepCode", workStepCode);
        task.setPhases(phases);
        Task saved = taskRepository.save(task);
        changeLogService.logChange(saved, "WORK_STEP_CHANGED", currentUser(), phaseCode, null, null, oldWs, workStepCode);
        return saved;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getPhase(String id, String phaseCode) {
        return getPhaseMap(getById(id).getPhases(), phaseCode);
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    @SuppressWarnings("unchecked")
    public Task updateSchedule(String id, String phaseCode, String workStepCode,
                               Map<String, Object> scheduleData) {
        Task task = getById(id);
        Map<String, Object> phases = deepCopyPhases(task.getPhases());
        Map<String, Object> phaseData = getPhaseMap(phases, phaseCode);
        Map<String, Object> schedule = getOrMakeSchedule(phaseData);

        Map<String, Object> oldWsData = schedule.get(workStepCode) instanceof Map
                ? (Map<String, Object>) schedule.get(workStepCode) : Map.of();

        scheduleData.put("workStepCode", workStepCode);
        schedule.put(workStepCode, scheduleData);
        task.setPhases(phases);
        Task saved = taskRepository.save(task);

        String cu = currentUser();
        logIfDateChanged(saved, "PLANNED_START_DATE_CHANGED", cu, phaseCode, workStepCode, oldWsData, scheduleData, "plannedStartDate");
        logIfDateChanged(saved, "PLANNED_END_DATE_CHANGED",   cu, phaseCode, workStepCode, oldWsData, scheduleData, "plannedEndDate");
        logIfDateChanged(saved, "ACTUAL_START_DATE_CHANGED",  cu, phaseCode, workStepCode, oldWsData, scheduleData, "actualStartDate");
        logIfDateChanged(saved, "ACTUAL_END_DATE_CHANGED",    cu, phaseCode, workStepCode, oldWsData, scheduleData, "actualEndDate");
        return saved;
    }

    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public Map<String, Object> getManHours(String id) {
        Task task = getById(id);
        Map<String, Object> result = new LinkedHashMap<>();
        Map<String, Object> phases = task.getPhases();
        if (phases == null) return result;

        phases.forEach((phaseCode, phaseObj) -> {
            Map<String, Object> phaseData = (Map<String, Object>) phaseObj;
            Object schedObj = phaseData.get("schedule");
            if (!(schedObj instanceof Map)) return;
            Map<String, Object> schedule = (Map<String, Object>) schedObj;

            double totalPlanned = 0, totalActual = 0;
            Map<String, Object> byStep = new LinkedHashMap<>();
            for (Map.Entry<String, Object> e : schedule.entrySet()) {
                if (!(e.getValue() instanceof Map)) continue;
                Map<String, Object> ws = (Map<String, Object>) e.getValue();
                double p = toDouble(ws.get("plannedManHours"));
                double a = toDouble(ws.get("actualManHours"));
                totalPlanned += p;
                totalActual  += a;
                byStep.put(e.getKey(), Map.of("plannedManHours", p, "actualManHours", a));
            }
            Map<String, Object> phaseSummary = new LinkedHashMap<>();
            phaseSummary.put("totalPlannedManHours", totalPlanned);
            phaseSummary.put("totalActualManHours",  totalActual);
            phaseSummary.put("byWorkStep", byStep);
            result.put(phaseCode, phaseSummary);
        });
        return result;
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public Task updateManHours(String id, String phaseCode, String workStepCode,
                               Double plannedManHours, Double actualManHours) {
        Task task = getById(id);
        Map<String, Object> phases = deepCopyPhases(task.getPhases());
        Map<String, Object> schedule = getOrMakeSchedule(getPhaseMap(phases, phaseCode));
        Map<String, Object> ws = getOrMakeWorkStep(schedule, workStepCode);

        Double oldPlanned = toDouble(ws.get("plannedManHours"));
        Double oldActual  = toDouble(ws.get("actualManHours"));

        if (plannedManHours != null) ws.put("plannedManHours", plannedManHours);
        if (actualManHours  != null) ws.put("actualManHours",  actualManHours);
        task.setPhases(phases);
        Task saved = taskRepository.save(task);

        String cu = currentUser();
        if (plannedManHours != null && !Objects.equals(oldPlanned, plannedManHours)) {
            changeLogService.logChange(saved, "PLANNED_MAN_HOURS_CHANGED", cu, phaseCode, workStepCode, null,
                    oldPlanned != null ? String.valueOf(oldPlanned) : null,
                    String.valueOf(plannedManHours));
        }
        if (actualManHours != null && !Objects.equals(oldActual, actualManHours)) {
            changeLogService.logChange(saved, "ACTUAL_MAN_HOURS_CHANGED", cu, phaseCode, workStepCode, null,
                    oldActual != null ? String.valueOf(oldActual) : null,
                    String.valueOf(actualManHours));
        }
        return saved;
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    @SuppressWarnings("unchecked")
    public Task addActualManHoursLog(String id, String phaseCode, String workStepCode,
                                     String employeeNumber, String date, double hours, String content) {
        if (employeeNumber == null || employeeNumber.isBlank()) throw new IllegalArgumentException("employeeNumber は必須です");
        if (date == null || date.isBlank()) throw new IllegalArgumentException("date は必須です");

        Task task = getById(id);
        Map<String, Object> phases = deepCopyPhases(task.getPhases());
        Map<String, Object> schedule = getOrMakeSchedule(getPhaseMap(phases, phaseCode));
        Map<String, Object> ws = getOrMakeWorkStep(schedule, workStepCode);

        // actualManHoursPerMember: empNo -> date -> hours
        Object perMObj = ws.get("actualManHoursPerMember");
        Map<String, Object> perM = perMObj instanceof Map
                ? new LinkedHashMap<>((Map<String, Object>) perMObj)
                : new LinkedHashMap<>();

        Object logObj = perM.get(employeeNumber);
        Map<String, Object> log = logObj instanceof Map
                ? new LinkedHashMap<>((Map<String, Object>) logObj)
                : new LinkedHashMap<>();
        log.put(date, hours);
        perM.put(employeeNumber, log);
        ws.put("actualManHoursPerMember", perM);

        // actualWorkContentPerMember: empNo -> date -> 作業内容（任意）
        if (content != null && !content.isBlank()) {
            Object cObj = ws.get("actualWorkContentPerMember");
            Map<String, Object> cPerM = cObj instanceof Map
                    ? new LinkedHashMap<>((Map<String, Object>) cObj)
                    : new LinkedHashMap<>();
            Object cLogObj = cPerM.get(employeeNumber);
            Map<String, Object> cLog = cLogObj instanceof Map
                    ? new LinkedHashMap<>((Map<String, Object>) cLogObj)
                    : new LinkedHashMap<>();
            cLog.put(date, content);
            cPerM.put(employeeNumber, cLog);
            ws.put("actualWorkContentPerMember", cPerM);
        }

        // actualManHours を自動再集計
        double total = perM.values().stream()
                .filter(v -> v instanceof Map)
                .flatMap(v -> ((Map<String, Object>) v).values().stream())
                .mapToDouble(this::toDouble)
                .sum();
        double newTotal = Math.round(total * 10.0) / 10.0;
        ws.put("actualManHours", newTotal);

        task.setPhases(phases);
        Task saved = taskRepository.save(task);

        changeLogService.logChange(saved, "ACTUAL_MAN_HOURS_LOGGED", currentUser(),
                phaseCode, workStepCode, null,
                null, employeeNumber + " / " + date + " / " + hours + "h");
        return saved;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getDeliverables(String id) {
        Map<String, Object> dbp = getById(id).getDeliverablesByPhase();
        return dbp != null ? dbp : Map.of();
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    @SuppressWarnings("unchecked")
    public Task addDeliverable(String id, String phaseCode, Map<String, Object> deliverable) {
        Task task = getById(id);
        Map<String, Object> dbp = task.getDeliverablesByPhase() != null
                ? new LinkedHashMap<>(task.getDeliverablesByPhase()) : new LinkedHashMap<>();
        Object listObj = dbp.get(phaseCode);
        List<Object> list = listObj instanceof List
                ? new ArrayList<>((List<Object>) listObj) : new ArrayList<>();
        list.add(deliverable);
        dbp.put(phaseCode, list);
        task.setDeliverablesByPhase(dbp);
        Task saved = taskRepository.save(task);
        String dName = (String) deliverable.get("name");
        String dWorkflow = (String) deliverable.get("workflow");
        changeLogService.logChange(saved, "DELIVERABLE_ADDED", currentUser(), phaseCode, null, dName, null, dWorkflow);
        return saved;
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    @SuppressWarnings("unchecked")
    public Task updateDeliverable(String id, String phaseCode, int index, Map<String, Object> deliverable) {
        Task task = getById(id);
        Map<String, Object> dbp = new LinkedHashMap<>(
                task.getDeliverablesByPhase() != null ? task.getDeliverablesByPhase() : Map.of());
        Object listObj = dbp.get(phaseCode);
        if (!(listObj instanceof List)) throw new IllegalArgumentException("フェーズに成果物が存在しません: " + phaseCode);
        List<Object> list = new ArrayList<>((List<Object>) listObj);
        if (index < 0 || index >= list.size()) throw new IllegalArgumentException("インデックスが範囲外です: " + index);

        Map<String, Object> oldDeliverable = (Map<String, Object>) list.get(index);
        list.set(index, deliverable);
        dbp.put(phaseCode, list);
        task.setDeliverablesByPhase(dbp);
        Task saved = taskRepository.save(task);

        String dName = (String) deliverable.getOrDefault("name", oldDeliverable.get("name"));
        String oldWf = (String) oldDeliverable.get("workflow");
        String newWf = (String) deliverable.get("workflow");
        if (!Objects.equals(oldWf, newWf)) {
            changeLogService.logChange(saved, "DELIVERABLE_WORKFLOW_CHANGED", currentUser(),
                    phaseCode, null, dName, oldWf, newWf);
        } else {
            changeLogService.logChange(saved, "DELIVERABLE_UPDATED", currentUser(),
                    phaseCode, null, dName, null, null);
        }
        return saved;
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    @SuppressWarnings("unchecked")
    public void deleteDeliverable(String id, String phaseCode, int index) {
        Task task = getById(id);
        Map<String, Object> dbp = new LinkedHashMap<>(
                task.getDeliverablesByPhase() != null ? task.getDeliverablesByPhase() : Map.of());
        Object listObj = dbp.get(phaseCode);
        if (!(listObj instanceof List)) throw new IllegalArgumentException("フェーズに成果物が存在しません: " + phaseCode);
        List<Object> list = new ArrayList<>((List<Object>) listObj);
        if (index < 0 || index >= list.size()) throw new IllegalArgumentException("インデックスが範囲外です: " + index);

        Map<String, Object> oldDeliverable = (Map<String, Object>) list.get(index);
        list.remove(index);
        dbp.put(phaseCode, list);
        task.setDeliverablesByPhase(dbp);
        Task saved = taskRepository.save(task);

        String dName = (String) oldDeliverable.get("name");
        String dWorkflow = (String) oldDeliverable.get("workflow");
        changeLogService.logChange(saved, "DELIVERABLE_DELETED", currentUser(),
                phaseCode, null, dName, dWorkflow, null);
    }

    /** タスク作成前の表示用タスクID払い出し。採番は TaskService の実装を共用する */
    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public Map<String, Object> allocateTaskId(Long projectId, String type) {
        if (!VALID_TASK_TYPES.contains(type)) {
            throw new IllegalArgumentException(
                    "type は " + String.join(" / ", VALID_TASK_TYPES) + " のいずれかを指定してください");
        }
        if (projectId == null) {
            throw new IllegalArgumentException("projectId は必須です");
        }
        String taskId = taskService.allocateTaskId(projectId, type);
        return Map.of("taskId", taskId, "type", type, "projectId", projectId);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> deepCopyPhases(Map<String, Object> phases) {
        if (phases == null) return new LinkedHashMap<>();
        Map<String, Object> copy = new LinkedHashMap<>();
        phases.forEach((k, v) -> {
            if (v instanceof Map) {
                Map<String, Object> pd = new LinkedHashMap<>((Map<String, Object>) v);
                Object sched = pd.get("schedule");
                if (sched instanceof Map<?, ?> rawSched) {
                    Map<String, Object> schedCopy = new LinkedHashMap<>();
                    ((Map<String, Object>) rawSched).forEach((wsKey, wsVal) -> {
                        if (wsVal instanceof Map) {
                            schedCopy.put(wsKey, new LinkedHashMap<>((Map<String, Object>) wsVal));
                        } else {
                            schedCopy.put(wsKey, wsVal);
                        }
                    });
                    pd.put("schedule", schedCopy);
                }
                copy.put(k, pd);
            } else {
                copy.put(k, v);
            }
        });
        return copy;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> getPhaseMap(Map<String, Object> phases, String phaseCode) {
        if (phases == null || !phases.containsKey(phaseCode)) {
            throw new NoSuchElementException("フェーズが見つかりません: " + phaseCode);
        }
        return (Map<String, Object>) phases.get(phaseCode);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> getOrMakeSchedule(Map<String, Object> phaseData) {
        Object o = phaseData.get("schedule");
        if (o instanceof Map) return (Map<String, Object>) o;
        Map<String, Object> m = new LinkedHashMap<>();
        phaseData.put("schedule", m);
        return m;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> getOrMakeWorkStep(Map<String, Object> schedule, String wsCode) {
        Object o = schedule.get(wsCode);
        if (o instanceof Map) return (Map<String, Object>) o;
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("workStepCode", wsCode);
        schedule.put(wsCode, m);
        return m;
    }

    private double toDouble(Object v) {
        return v instanceof Number n ? n.doubleValue() : 0.0;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }

    private static String currentUser() {
        var auth = org.springframework.security.core.context.SecurityContextHolder
                .getContext().getAuthentication();
        return auth != null ? String.valueOf(auth.getName()) : "system";
    }

    private void logIfDateChanged(Task task, String operation, String changedBy,
                                   String phaseCode, String wsCode,
                                   Map<String, Object> oldMap, Map<String, Object> newMap,
                                   String field) {
        String oldV = oldMap.get(field) != null ? String.valueOf(oldMap.get(field)) : null;
        String newV = newMap.get(field) != null ? String.valueOf(newMap.get(field)) : null;
        if (!Objects.equals(oldV, newV)) {
            changeLogService.logChange(task, operation, changedBy, phaseCode, wsCode, null, oldV, newV);
        }
    }
}
