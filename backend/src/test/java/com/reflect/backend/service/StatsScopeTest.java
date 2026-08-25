package com.reflect.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.reflect.backend.config.PhaseCatalog;
import com.reflect.backend.config.TaskStatusCatalog;
import com.reflect.backend.config.WorkStepCatalog;
import com.reflect.backend.entity.Task;
import com.reflect.backend.entity.ProjectSettings;
import com.reflect.backend.repository.DomainRepository;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.repository.ProjectSettingsRepository;
import com.reflect.backend.repository.TaskRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 統計の集計範囲を DB なしで検証する。
 * この絞り込みが無いと、所属していないプロジェクトのタスクが横断集計に混入する。
 */
class StatsScopeTest {

    private final TaskRepository taskRepository = mock(TaskRepository.class);
    private final DomainRepository domainRepository = mock(DomainRepository.class);
    private final MemberRepository memberRepository = mock(MemberRepository.class);
    private final ProjectSettingsRepository settingsRepository = mock(ProjectSettingsRepository.class);
    private final TaskStatusCatalog taskStatuses = new TaskStatusCatalog(new ObjectMapper());
    private final StatsService statsService = new StatsService(
            taskRepository, domainRepository, memberRepository, settingsRepository,
            new WorkStepCatalog(new ObjectMapper()), new PhaseCatalog(new ObjectMapper()),
            taskStatuses);

    /** 完了ステータス名。マスタ（shared/task-statuses.json）を差し替えても壊れないよう定義から取る */
    private String completedStatus() {
        return taskStatuses.names().stream().filter(taskStatuses::isCompleted).findFirst().orElseThrow();
    }

    private String inProgressStatus() {
        return taskStatuses.names().stream().filter(taskStatuses::isInProgress).findFirst().orElseThrow();
    }

    private Task task(Long projectId, String status) {
        Task t = new Task();
        t.setId("task-" + projectId + "-" + status);
        t.setProjectId(projectId);
        t.setType("Development");
        t.setStatus(status);
        return t;
    }

    @Test
    void includes_only_the_single_project_when_scoped_to_one() {
        StatsScope scope = StatsScope.ofProject(1L);
        assertThat(scope.includes(1L)).isTrue();
        assertThat(scope.includes(2L)).isFalse();
    }

    @Test
    void includes_only_visible_projects_when_scoped_across_projects() {
        StatsScope scope = StatsScope.ofVisible(Set.of(1L, 3L));
        assertThat(scope.includes(1L)).isTrue();
        assertThat(scope.includes(2L)).isFalse();
        assertThat(scope.includes(3L)).isTrue();
    }

    @Test
    void includes_every_project_for_system_admin() {
        StatsScope scope = StatsScope.ofVisible(null);
        assertThat(scope.includes(1L)).isTrue();
        assertThat(scope.includes(99L)).isTrue();
    }

    @Test
    void cache_key_separates_users_with_different_visible_projects() {
        // 可視範囲が違えば別のキーになること（キャッシュ経由で他プロジェクトの数値が漏れない）
        assertThat(StatsScope.ofVisible(Set.of(1L, 3L)).cacheKey())
                .isNotEqualTo(StatsScope.ofVisible(Set.of(1L, 2L)).cacheKey());
        assertThat(StatsScope.ofVisible(Set.of(1L)).cacheKey())
                .isNotEqualTo(StatsScope.ofVisible(null).cacheKey());
    }

    @Test
    void cache_key_is_stable_regardless_of_set_iteration_order() {
        assertThat(StatsScope.ofVisible(Set.of(3L, 1L, 2L)).cacheKey())
                .isEqualTo(StatsScope.ofVisible(Set.of(1L, 2L, 3L)).cacheKey());
    }

    @Test
    void summary_excludes_tasks_of_projects_the_user_cannot_see() {
        when(taskRepository.findAll()).thenReturn(List.of(
                task(1L, completedStatus()),
                task(2L, completedStatus()),   // 所属外のプロジェクト
                task(3L, inProgressStatus())));

        var summary = statsService.getSummary(StatsScope.ofVisible(Set.of(1L, 3L)));

        assertThat(summary.get("total")).isEqualTo(2L);
        assertThat(summary.get("completed")).isEqualTo(1L);
    }

    @Test
    void summary_counts_every_project_for_system_admin() {
        when(taskRepository.findAll()).thenReturn(List.of(
                task(1L, completedStatus()),
                task(2L, completedStatus()),
                task(3L, inProgressStatus())));

        var summary = statsService.getSummary(StatsScope.ofVisible(null));

        assertThat(summary.get("total")).isEqualTo(3L);
    }
}
