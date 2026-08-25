package com.reflect.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * アクションアイテムのステータスマスタ（shared/action-item-statuses.json）を検証する。
 * タスクのステータスとは別体系で、新規アイテムの初期値をここから取る。
 */
class ActionItemStatusCatalogTest {

    private final ActionItemStatusCatalog catalog = new ActionItemStatusCatalog(new ObjectMapper());

    @Test
    void loads_shared_master_from_classpath() {
        assertThat(catalog.names()).isNotEmpty().doesNotHaveDuplicates();
    }

    @Test
    void resolves_the_initial_status_from_the_master() {
        assertThat(catalog.names()).contains(catalog.notStartedName());
        assertThat(catalog.isCompleted(catalog.notStartedName())).isFalse();
    }

    @Test
    void treats_unknown_status_as_not_completed() {
        assertThat(catalog.isCompleted("確認待ち")).isFalse();
        assertThat(catalog.isCompleted(null)).isFalse();
    }
}
