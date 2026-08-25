package com.reflect.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.reflect.backend.config.PhaseCatalog;
import com.reflect.backend.config.TaskStatusCatalog;
import com.reflect.backend.config.WorkStepCatalog;
import com.reflect.backend.entity.ProjectSettings;
import com.reflect.backend.entity.Task;
import com.reflect.backend.repository.DomainRepository;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.repository.ProjectSettingsRepository;
import com.reflect.backend.repository.TaskRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 統計 API がプロジェクト設定のスキップ工程を尊重することを検証する。
 * 画面は全機能でスキップ工程を除外するため、集計側が除外しないと
 * 週報の工程別進捗・遅延アラートが画面表示と食い違う。
 */
class StatsSkippedPhaseTest {

    private final TaskRepository taskRepository = mock(TaskRepository.class);
    private final DomainRepository domainRepository = mock(DomainRepository.class);
    private final MemberRepository memberRepository = mock(MemberRepository.class);
    private final ProjectSettingsRepository settingsRepository = mock(ProjectSettingsRepository.class);
    private final PhaseCatalog phaseCatalog = new PhaseCatalog(new ObjectMapper());
    private final StatsService statsService = new StatsService(
            taskRepository, domainRepository, memberRepository, settingsRepository,
            new WorkStepCatalog(new ObjectMapper()), phaseCatalog,
            new TaskStatusCatalog(new ObjectMapper()));

    /** 開発タスクのフェーズ。マスタ（shared/phases.json）を差し替えても壊れないよう定義から取る */
    private List<String> developmentPhases() {
        return phaseCatalog.phases().stream()
                .filter(p -> PhaseCatalog.TARGET_DEVELOPMENT.equals(p.target()))
                .map(PhaseCatalog.Phase::code)
                .toList();
    }

    private String activePhase() {
        return developmentPhases().get(0);
    }

    private String skippedPhase() {
        return developmentPhases().get(1);
    }

    private Task developmentTask() {
        Task t = new Task();
        t.setId("task-1");
        t.setProjectId(1L);
        t.setTaskId("TASK-D0001");
        t.setType("Development");
        t.setStatus("進行中");
        t.setPhases(Map.of(
                activePhase(), Map.of("currentWorkStepCode", "MKD",
                        "schedule", Map.of("MKD", Map.of("plannedEndDate", "2000-01-01",
                                "plannedManHours", 3.0, "actualManHours", 2.0))),
                skippedPhase(), Map.of("currentWorkStepCode", "MKD",
                        "schedule", Map.of("MKD", Map.of("plannedEndDate", "2000-01-01",
                                "plannedManHours", 5.0, "actualManHours", 4.0)))));
        return t;
    }

    private Map<String, Object> row(List<Map<String, Object>> rows, String phase) {
        return rows.stream().filter(r -> phase.equals(r.get("phase"))).findFirst().orElseThrow();
    }

    private void skipPhase(String phase) {
        ProjectSettings s = new ProjectSettings();
        s.setProjectId(1L);
        s.setSkippedPhases(List.of(phase));
        when(settingsRepository.findAll()).thenReturn(List.of(s));
    }

    @Test
    void phase_progress_excludes_skipped_phases() {
        when(taskRepository.findByProjectIdOrderByTaskId(1L)).thenReturn(List.of(developmentTask()));
        skipPhase(skippedPhase());

        List<Map<String, Object>> rows = statsService.getPhaseProgress(StatsScope.ofProject(1L));

        Map<String, Object> active = row(rows, activePhase());
        Map<String, Object> skipped = row(rows, skippedPhase());
        assertThat(active.get("total")).isEqualTo(1);
        assertThat(skipped.get("total")).isEqualTo(0);
    }

    @Test
    void man_hours_excludes_skipped_phases() {
        when(taskRepository.findByProjectIdOrderByTaskId(1L)).thenReturn(List.of(developmentTask()));
        skipPhase(skippedPhase());

        List<Map<String, Object>> rows = statsService.getManHours(StatsScope.ofProject(1L));

        Map<String, Object> skipped = row(rows, skippedPhase());
        assertThat(skipped.get("plannedManHours")).isEqualTo(0.0);
        assertThat(skipped.get("actualManHours")).isEqualTo(0.0);
    }

    @Test
    void alerts_are_not_raised_for_skipped_phases() {
        Task task = developmentTask();
        task.setPhases(Map.of(skippedPhase(), Map.of("currentWorkStepCode", "MKD",
                "schedule", Map.of("MKD", Map.of("plannedEndDate", "2000-01-01")))));
        when(taskRepository.findByProjectIdOrderByTaskId(1L)).thenReturn(List.of(task));
        skipPhase(skippedPhase());

        assertThat(statsService.getAlerts(StatsScope.ofProject(1L))).isEmpty();
    }

    @Test
    void alerts_are_still_raised_for_active_phases() {
        Task task = developmentTask();
        task.setPhases(Map.of(skippedPhase(), Map.of("currentWorkStepCode", "MKD",
                "schedule", Map.of("MKD", Map.of("plannedEndDate", "2000-01-01")))));
        when(taskRepository.findByProjectIdOrderByTaskId(1L)).thenReturn(List.of(task));
        skipPhase(activePhase());

        assertThat(statsService.getAlerts(StatsScope.ofProject(1L))).hasSize(1);
    }
}
