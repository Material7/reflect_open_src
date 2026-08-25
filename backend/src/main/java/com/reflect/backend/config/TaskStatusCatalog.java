package com.reflect.backend.config;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * タスクステータスマスタ。定義元は shared/task-statuses.json で、フロントエンドの
 * {@code frontend/src/lib/constants.ts} も同じファイルを読む。
 * ビルド時に classpath へ取り込まれる（backend/build.gradle の processResources を参照）。
 *
 * <p>バックエンドはステータス名を解釈せず、各ステータスに付いた role
 * （notStarted / inProgress / onHold / stopped / completed）だけで集計上の意味を判断する。
 * これによりステータス名を変えても Java 側の変更は不要になる。
 *
 * <p>管理者が設定画面で追加したステータスは role を持たないため、集計上は
 * どの分類にも属さない「その他」として扱われる。
 */
@Slf4j
@Component
public class TaskStatusCatalog {

    private static final String RESOURCE = "task-statuses.json";

    public static final String ROLE_NOT_STARTED = "notStarted";
    public static final String ROLE_IN_PROGRESS = "inProgress";
    public static final String ROLE_COMPLETED   = "completed";
    public static final String ROLE_ON_HOLD     = "onHold";
    public static final String ROLE_STOPPED     = "stopped";

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record TaskStatus(String name, String role) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Catalog(List<TaskStatus> taskStatuses) {}

    private final List<TaskStatus> statuses;
    private final Set<String> notStartedNames;
    private final Set<String> inProgressNames;
    private final Set<String> completedNames;
    private final Set<String> onHoldNames;
    private final Set<String> stoppedNames;

    public TaskStatusCatalog(ObjectMapper objectMapper) {
        this.statuses = load(objectMapper);
        this.notStartedNames = namesWithRole(ROLE_NOT_STARTED);
        this.inProgressNames = namesWithRole(ROLE_IN_PROGRESS);
        this.completedNames  = namesWithRole(ROLE_COMPLETED);
        this.onHoldNames     = namesWithRole(ROLE_ON_HOLD);
        this.stoppedNames    = namesWithRole(ROLE_STOPPED);
        validate();
        log.info("タスクステータスマスタを読み込みました: {} 件（未着手={}, 進行中={}, 完了={}）",
                statuses.size(), notStartedNames, inProgressNames, completedNames);
    }

    private List<TaskStatus> load(ObjectMapper objectMapper) {
        ClassPathResource resource = new ClassPathResource(RESOURCE);
        try (InputStream in = resource.getInputStream()) {
            Catalog catalog = objectMapper.readValue(in, Catalog.class);
            if (catalog == null || catalog.taskStatuses() == null || catalog.taskStatuses().isEmpty()) {
                throw new IllegalStateException(RESOURCE + " に taskStatuses が定義されていません");
            }
            return List.copyOf(catalog.taskStatuses());
        } catch (IOException e) {
            throw new IllegalStateException(
                    "タスクステータスマスタ (" + RESOURCE + ") を読み込めません。"
                            + "shared/task-statuses.json がビルドに取り込まれているか確認してください", e);
        }
    }

    private Set<String> namesWithRole(String role) {
        Set<String> names = new LinkedHashSet<>();
        for (TaskStatus s : statuses) {
            if (role.equals(s.role())) names.add(s.name());
        }
        return names;
    }

    /**
     * 役割の個数が満たされていないと完了率・アラートが黙って誤った値を返すため、
     * 起動時に停止させる。条件はフロントエンド側の検証と揃えてある。
     */
    private void validate() {
        requireSingle(ROLE_NOT_STARTED, notStartedNames);
        requireSingle(ROLE_IN_PROGRESS, inProgressNames);
        requireSingle(ROLE_COMPLETED, completedNames);
    }

    private void requireSingle(String role, Set<String> names) {
        if (names.size() != 1) {
            throw new IllegalStateException(
                    "shared/task-statuses.json の定義エラー: role=\"" + role
                            + "\" のステータスはちょうど1件必要です（現在 " + names.size() + " 件）");
        }
    }

    /** マスタ定義順のステータス名一覧。新規プロジェクト・初期化時の既定値になる */
    public List<String> names() {
        return statuses.stream().map(TaskStatus::name).toList();
    }

    public boolean isNotStarted(String status) {
        return status != null && notStartedNames.contains(status);
    }

    public boolean isInProgress(String status) {
        return status != null && inProgressNames.contains(status);
    }

    public boolean isCompleted(String status) {
        return status != null && completedNames.contains(status);
    }

    public boolean isOnHold(String status) {
        return status != null && onHoldNames.contains(status);
    }

    public boolean isStopped(String status) {
        return status != null && stoppedNames.contains(status);
    }
}
