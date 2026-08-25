package com.reflect.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * フェーズマスタ（shared/phases.json）の読み込みと対象種別の判定を検証する。
 * このファイルはフロントエンドと共有する単一の定義元であり、
 * classpath に取り込まれていないと集計が起動時に失敗する。
 */
class PhaseCatalogTest {

    private final PhaseCatalog catalog = new PhaseCatalog(new ObjectMapper());

    @Test
    void loads_shared_master_from_classpath() {
        assertThat(catalog.phases()).isNotEmpty();
        assertThat(catalog.codes()).doesNotHaveDuplicates();
    }

    @Test
    void resolves_target_task_type_from_the_shared_master() {
        String requirementPhase = catalog.phases().stream()
                .filter(p -> PhaseCatalog.TARGET_REQUIREMENT.equals(p.target()))
                .map(PhaseCatalog.Phase::code)
                .findFirst().orElseThrow();

        assertThat(catalog.isTargetOf(requirementPhase, "Requirement")).isTrue();
        assertThat(catalog.isTargetOf(requirementPhase, "Development")).isFalse();
    }

    @Test
    void treats_unknown_phase_code_as_no_target() {
        assertThat(catalog.targetOf("NOPE")).isNull();
        assertThat(catalog.isTargetOf("NOPE", "Development")).isFalse();
        assertThat(catalog.isTargetOf(null, "Development")).isFalse();
    }

    @Test
    void keeps_the_order_defined_in_the_shared_master() {
        // 画面のフェーズ並び順はこの順序に従うため、読み込みで並べ替えないこと
        assertThat(catalog.codes()).containsExactlyElementsOf(
                catalog.phases().stream().map(PhaseCatalog.Phase::code).toList());
    }
}
