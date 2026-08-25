package com.reflect.backend.service;

import com.reflect.backend.config.PhaseCatalog;
import com.reflect.backend.config.TaskStatusCatalog;
import com.reflect.backend.config.WorkStepCatalog;
import com.reflect.backend.entity.Task;
import com.reflect.backend.entity.ProjectSettings;
import com.reflect.backend.repository.DomainRepository;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.repository.ProjectSettingsRepository;
import com.reflect.backend.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.*;

@Slf4j
@Service
@RequiredArgsConstructor
public class StatsService {

    private final TaskRepository            taskRepository;
    private final DomainRepository          domainRepository;
    private final MemberRepository          memberRepository;
    private final ProjectSettingsRepository settingsRepository;
    private final WorkStepCatalog           workSteps;
    private final PhaseCatalog              phaseCatalog;
    private final TaskStatusCatalog         taskStatuses;

    /**
     * プロジェクトごとのスキップ工程。画面側は全機能でスキップ工程を除外しているため、
     * 集計 API も同じ扱いに揃えないと週報と画面の数値が食い違う。
     */
    private Map<Long, Set<String>> skippedPhasesByProject() {
        Map<Long, Set<String>> result = new HashMap<>();
        for (ProjectSettings s : settingsRepository.findAll()) {
            List<String> skipped = s.getSkippedPhases();
            result.put(s.getProjectId(), skipped == null ? Set.of() : new HashSet<>(skipped));
        }
        return result;
    }

    /** そのタスクのプロジェクトで当該フェーズがスキップ設定されているか */
    private boolean isSkipped(Map<Long, Set<String>> skipped, Task task, String phase) {
        return skipped.getOrDefault(task.getProjectId(), Set.of()).contains(phase);
    }

    /** 集計範囲内のタスク。横断集計でも参照権のないプロジェクトは除外する */
    private List<Task> tasks(StatsScope scope) {
        List<Task> list = scope.projectId() != null
                ? taskRepository.findByProjectIdOrderByTaskId(scope.projectId())
                : taskRepository.findAll();
        return list.stream().filter(t -> scope.includes(t.getProjectId())).toList();
    }

    @Cacheable(value = "stats", key = "'summary:' + #scope.cacheKey()")
    @Transactional(readOnly = true)
    public Map<String, Object> getSummary(StatsScope scope) {
        List<Task> all = tasks(scope);
        long total     = all.size();
        long req       = all.stream().filter(t -> "Requirement".equals(t.getType())).count();
        long dev       = all.stream().filter(t -> "Development".equals(t.getType())).count();
        // ステータス名ではなくマスタの role で分類する（設定画面での改名に追従するため）
        long completed = all.stream().filter(t -> taskStatuses.isCompleted(t.getStatus())).count();
        long inProgress = all.stream().filter(t -> taskStatuses.isInProgress(t.getStatus())).count();
        long onHold    = all.stream().filter(t -> taskStatuses.isOnHold(t.getStatus())).count();
        long stopped   = all.stream().filter(t -> taskStatuses.isStopped(t.getStatus())).count();
        long newTasks  = all.stream().filter(t -> taskStatuses.isNotStarted(t.getStatus())).count();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("total",       total);
        result.put("requirement", req);
        result.put("development", dev);
        result.put("completed",   completed);
        result.put("inProgress",  inProgress);
        result.put("onHold",      onHold);
        result.put("stopped",     stopped);
        result.put("newTasks",    newTasks);
        result.put("completionRate", total > 0 ? Math.round((double) completed / total * 1000) / 10.0 : 0.0);
        return result;
    }

    @Cacheable(value = "stats", key = "'phaseProgress:' + #scope.cacheKey()")
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getPhaseProgress(StatsScope scope) {
        List<Task> all = tasks(scope);
        Map<Long, Set<String>> skipped = skippedPhasesByProject();
        List<Map<String, Object>> result = new ArrayList<>();

        for (String phase : phaseCatalog.codes()) {
            // 対象タスク種別はフェーズマスタの target で決まる。スキップ工程は集計しない
            List<Task> targets = all.stream()
                    .filter(t -> phaseCatalog.isTargetOf(phase, t.getType()))
                    .filter(t -> !isSkipped(skipped, t, phase))
                    .toList();

            long notStarted = 0, inProgress = 0, completed = 0, excluded = 0;
            for (Task t : targets) {
                String ws = currentWorkStep(t, phase);
                if (workSteps.isNotStarted(ws))      notStarted++;
                else if (workSteps.isExcluded(ws))   excluded++;
                else if (workSteps.isCompleted(ws))  completed++;
                else                                 inProgress++;
            }

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("phase",      phase);
            row.put("total",      targets.size());
            row.put("notStarted", notStarted);
            row.put("inProgress", inProgress);
            row.put("completed",  completed);
            row.put("excluded",   excluded);
            result.add(row);
        }
        return result;
    }

    @Cacheable(value = "stats", key = "'byDomain:' + #scope.cacheKey()")
    @Transactional(readOnly = true)
    public List<Map<String, Object>> getByDomain(StatsScope scope) {
        List<Task> all = tasks(scope);
        List<Map<String, Object>> result = new ArrayList<>();

        List<com.reflect.backend.entity.Domain> domains = scope.projectId() != null
                ? domainRepository.findByProjectId(scope.projectId())
                : domainRepository.findAll().stream()
                        .filter(d -> scope.includes(d.getProjectId()))
                        .toList();
        domains.forEach(domain -> {
            List<Task> dt = all.stream().filter(t -> domain.getId().equals(t.getDomainId())).toList();
            if (dt.isEmpty()) return;
            long comp = dt.stream().filter(t -> taskStatuses.isCompleted(t.getStatus())).count();
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("domainId",      domain.getId());
            row.put("domainName",    domain.getName());
            row.put("total",         dt.size());
            row.put("completed",     comp);
            row.put("completionRate", Math.round((double) comp / dt.size() * 1000) / 10.0);
            result.add(row);
        });
        return result;
    }

    @Cacheable(value = "stats", key = "'byMember:' + #scope.cacheKey()")
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getByMember(StatsScope scope) {
        List<Task> all = tasks(scope);
        List<Map<String, Object>> result = new ArrayList<>();

        memberRepository.findAll().forEach(member -> {
            List<Task> mt = all.stream().filter(t -> member.getEmployeeNumber().equals(t.getAssignee())).toList();
            long comp = mt.stream().filter(t -> taskStatuses.isCompleted(t.getStatus())).count();

            double totalActual = 0;
            for (Task t : mt) {
                Map<String, Object> phases = t.getPhases();
                if (phases == null) continue;
                for (Object phaseObj : phases.values()) {
                    if (!(phaseObj instanceof Map)) continue;
                    Object schedObj = ((Map<String, Object>) phaseObj).get("schedule");
                    if (!(schedObj instanceof Map)) continue;
                    for (Object wsObj : ((Map<String, Object>) schedObj).values()) {
                        if (!(wsObj instanceof Map)) continue;
                        Object ah = ((Map<String, Object>) wsObj).get("actualManHours");
                        if (ah instanceof Number n) totalActual += n.doubleValue();
                    }
                }
            }

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("employeeNumber",  member.getEmployeeNumber());
            row.put("name",            member.getName());
            row.put("role",            member.getRole());
            row.put("totalTasks",      mt.size());
            row.put("completedTasks",  comp);
            row.put("actualManHours",  Math.round(totalActual * 10) / 10.0);
            result.add(row);
        });
        return result;
    }

    @Cacheable(value = "stats", key = "'manHours:' + #scope.cacheKey()")
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getManHours(StatsScope scope) {
        List<Task> all = tasks(scope);
        Map<Long, Set<String>> skipped = skippedPhasesByProject();
        List<Map<String, Object>> result = new ArrayList<>();

        for (String phase : phaseCatalog.codes()) {
            double planned = 0, actual = 0;
            for (Task t : all) {
                if (isSkipped(skipped, t, phase)) continue;
                Map<String, Object> phases = t.getPhases();
                if (phases == null) continue;
                Object phaseObj = phases.get(phase);
                if (!(phaseObj instanceof Map)) continue;
                Object schedObj = ((Map<String, Object>) phaseObj).get("schedule");
                if (!(schedObj instanceof Map)) continue;
                for (Object wsObj : ((Map<String, Object>) schedObj).values()) {
                    if (!(wsObj instanceof Map)) continue;
                    Map<String, Object> ws = (Map<String, Object>) wsObj;
                    if (ws.get("plannedManHours") instanceof Number p) planned += p.doubleValue();
                    if (ws.get("actualManHours")  instanceof Number a) actual  += a.doubleValue();
                }
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("phase",            phase);
            row.put("plannedManHours",  Math.round(planned * 10) / 10.0);
            row.put("actualManHours",   Math.round(actual  * 10) / 10.0);
            result.add(row);
        }
        return result;
    }

    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getAlerts(StatsScope scope) {
        List<Task> all = tasks(scope);
        Map<Long, Set<String>> skipped = skippedPhasesByProject();
        List<Map<String, Object>> alerts = new ArrayList<>();
        LocalDate today = LocalDate.now();

        for (Task t : all) {
            if (taskStatuses.isOnHold(t.getStatus()) || taskStatuses.isStopped(t.getStatus())) {
                alerts.add(alertEntry(t, taskStatuses.isOnHold(t.getStatus()) ? "HOLD" : "STOPPED",
                        t.getStatus() + " 状態のタスクです"));
                continue;
            }
            if (taskStatuses.isCompleted(t.getStatus())) continue;

            Map<String, Object> phases = t.getPhases();
            if (phases == null) continue;
            for (Map.Entry<String, Object> e : phases.entrySet()) {
                if (isSkipped(skipped, t, e.getKey())) continue;
                if (!(e.getValue() instanceof Map)) continue;
                Map<String, Object> pd = (Map<String, Object>) e.getValue();
                String ws = (String) pd.get("currentWorkStepCode");
                if (!workSteps.isInProgress(ws)) continue;

                Object schedObj = pd.get("schedule");
                if (!(schedObj instanceof Map)) continue;
                Object wsObj = ((Map<String, Object>) schedObj).get(ws);
                if (!(wsObj instanceof Map)) continue;
                Object endDateObj = ((Map<String, Object>) wsObj).get("plannedEndDate");
                if (!(endDateObj instanceof String endDateStr)) continue;
                try {
                    LocalDate endDate = LocalDate.parse(endDateStr);
                    if (endDate.isBefore(today)) {
                        alerts.add(alertEntry(t, "DELAYED",
                                "フェーズ " + e.getKey() + " / 工程 " + ws + " の計画終了日を過ぎています（" + endDateStr + "）"));
                        break; // タスクにつき1件
                    }
                } catch (Exception ex) {
                        log.debug("タスク {} のアラートチェックをスキップ（日付フォーマット不正: {}）",
                                t.getTaskId(), endDateStr);
                    }
            }
        }
        return alerts;
    }

    @SuppressWarnings("unchecked")
    private String currentWorkStep(Task task, String phaseCode) {
        Map<String, Object> phases = task.getPhases();
        if (phases == null) return null;
        Object phaseObj = phases.get(phaseCode);
        if (!(phaseObj instanceof Map)) return null;
        return (String) ((Map<String, Object>) phaseObj).get("currentWorkStepCode");
    }

    private Map<String, Object> alertEntry(Task t, String type, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("taskId",   t.getTaskId());
        m.put("taskUuid", t.getId());
        m.put("name",     t.getName());
        m.put("type",     type);
        m.put("message",  message);
        m.put("status",   t.getStatus());
        m.put("assignee", t.getAssignee());
        return m;
    }
}
