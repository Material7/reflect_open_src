package com.reflect.backend.service;

import com.reflect.backend.entity.Task;
import com.reflect.backend.entity.TaskChangeLog;
import com.reflect.backend.repository.TaskChangeLogRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/**
 * 参照リソースの変更ログ差分（diffReferences）を DB なしで検証する。
 * TaskChangeLogService は @RequiredArgsConstructor でリポジトリを注入するため直接生成できる。
 */
class ReferenceChangeLogTest {

    private Task taskWithReferences(List<Map<String, Object>> refs) {
        Task t = new Task();
        t.setId("task-1");
        t.setProjectId(1L);
        t.setTaskId("VERIFY-1");
        t.setType("Development");
        t.setName("検証タスク");
        t.setReferences(new ArrayList<>(refs));
        return t;
    }

    private Map<String, Object> ref(String id, String kind, String label, String value) {
        return Map.of("id", id, "kind", kind, "label", label, "value", value);
    }

    @Test
    void diffReferences_records_added_updated_deleted() {
        TaskChangeLogRepository repo = mock(TaskChangeLogRepository.class);
        TaskChangeLogService service = new TaskChangeLogService(repo);

        Task oldTask = taskWithReferences(List.of(
                ref("r1", "web", "Wiki", "https://a.example"),
                ref("r2", "file", "Spec", "\\\\srv\\share\\spec.xlsx")
        ));
        Task newTask = taskWithReferences(List.of(
                ref("r1", "web", "Wiki", "https://a.example/changed"),
                ref("r3", "svn", "SVNリポジトリ", "https://svn.example/repo")
        ));

        service.diffAndLog(oldTask, newTask, "tester");

        ArgumentCaptor<TaskChangeLog> cap = ArgumentCaptor.forClass(TaskChangeLog.class);
        verify(repo, org.mockito.Mockito.times(3)).save(cap.capture());

        Map<String, String> opToName = cap.getAllValues().stream()
                .collect(Collectors.toMap(TaskChangeLog::getOperation, TaskChangeLog::getDeliverableName));

        assertThat(opToName).containsKeys("REFERENCE_UPDATED", "REFERENCE_ADDED", "REFERENCE_DELETED");
        assertThat(opToName.get("REFERENCE_UPDATED")).isEqualTo("Wiki");
        assertThat(opToName.get("REFERENCE_ADDED")).isEqualTo("SVNリポジトリ");
        assertThat(opToName.get("REFERENCE_DELETED")).isEqualTo("Spec");
    }

    @Test
    void diffReferences_no_change_records_nothing() {
        TaskChangeLogRepository repo = mock(TaskChangeLogRepository.class);
        TaskChangeLogService service = new TaskChangeLogService(repo);

        List<Map<String, Object>> same = List.of(ref("r1", "web", "Wiki", "https://a.example"));
        service.diffAndLog(taskWithReferences(same), taskWithReferences(same), "tester");

        verify(repo, org.mockito.Mockito.never()).save(org.mockito.Mockito.any());
    }
}
