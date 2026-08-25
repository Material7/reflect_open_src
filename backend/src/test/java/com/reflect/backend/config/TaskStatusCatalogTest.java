package com.reflect.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * タスクステータスマスタ（shared/task-statuses.json）の読み込みと役割判定を検証する。
 * このファイルはフロントエンドと共有する単一の定義元であり、
 * classpath に取り込まれていないと集計が起動時に失敗する。
 */
class TaskStatusCatalogTest {

    private final TaskStatusCatalog catalog = new TaskStatusCatalog(new ObjectMapper());

    @Test
    void loads_shared_master_from_classpath() {
        assertThat(catalog.names()).isNotEmpty().doesNotHaveDuplicates();
    }

    @Test
    void classifies_each_status_by_the_role_defined_in_the_master() {
        String completed = catalog.names().stream().filter(catalog::isCompleted).findFirst().orElseThrow();
        String notStarted = catalog.names().stream().filter(catalog::isNotStarted).findFirst().orElseThrow();

        assertThat(completed).isNotEqualTo(notStarted);
        assertThat(catalog.isCompleted(notStarted)).isFalse();
        assertThat(catalog.isNotStarted(completed)).isFalse();
    }

    @Test
    void treats_statuses_added_by_administrators_as_having_no_role() {
        // 設定画面で追加されたステータスはマスタに無く、どの分類にも属さない
        assertThat(catalog.isCompleted("確認待ち")).isFalse();
        assertThat(catalog.isNotStarted("確認待ち")).isFalse();
        assertThat(catalog.isInProgress("確認待ち")).isFalse();
        assertThat(catalog.isOnHold("確認待ち")).isFalse();
        assertThat(catalog.isStopped("確認待ち")).isFalse();
    }

    @Test
    void treats_unset_status_as_having_no_role() {
        assertThat(catalog.isCompleted(null)).isFalse();
        assertThat(catalog.isNotStarted(null)).isFalse();
    }
}
