package com.reflect.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 作業工程マスタ（shared/work-steps.json）の読み込みと役割判定を検証する。
 * このファイルはフロントエンドと共有する単一の定義元であり、
 * classpath に取り込まれていないと集計が起動時に失敗する。
 *
 * <p>工程コードは直書きせずマスタから解決する。マスタを差し替えても
 * このテストが壊れないことが、コード名に依存していないことの担保になる。
 */
class WorkStepCatalogTest {

    private final WorkStepCatalog catalog = new WorkStepCatalog(new ObjectMapper());

    private List<String> codesWithRole(String role) {
        return catalog.workSteps().stream()
                .filter(ws -> role.equals(ws.role()))
                .map(WorkStepCatalog.WorkStep::code)
                .toList();
    }

    /** role を持たない工程（＝進行中扱い）の代表 */
    private String inProgressCode() {
        return catalog.workSteps().stream()
                .filter(ws -> ws.role() == null)
                .map(WorkStepCatalog.WorkStep::code)
                .findFirst().orElseThrow();
    }

    @Test
    void loads_shared_master_from_classpath() {
        assertThat(catalog.workSteps()).isNotEmpty();
        assertThat(catalog.workSteps().stream().map(WorkStepCatalog.WorkStep::code).toList())
                .doesNotHaveDuplicates();
    }

    @Test
    void classifies_codes_by_role_defined_in_the_shared_master() {
        String notStarted = codesWithRole("notStarted").get(0);
        String excluded = codesWithRole("excluded").get(0);
        List<String> completed = codesWithRole("completed");

        assertThat(catalog.isNotStarted(notStarted)).isTrue();
        assertThat(catalog.isExcluded(excluded)).isTrue();
        assertThat(completed).allSatisfy(code -> assertThat(catalog.isCompleted(code)).isTrue());

        assertThat(catalog.isTerminal(completed.get(0))).isTrue();
        assertThat(catalog.isTerminal(excluded)).isTrue();
        assertThat(catalog.isTerminal(inProgressCode())).isFalse();
    }

    @Test
    void treats_unset_code_as_not_started() {
        assertThat(catalog.isNotStarted(null)).isTrue();
        assertThat(catalog.isInProgress(null)).isFalse();
        assertThat(catalog.isTerminal(null)).isFalse();
    }

    @Test
    void treats_blank_code_as_not_started() {
        // フロントエンドの isNotStartedStep が空文字を未着手として扱うため揃えている
        assertThat(catalog.isNotStarted("")).isTrue();
        assertThat(catalog.isNotStarted("   ")).isTrue();
        assertThat(catalog.isInProgress("")).isFalse();
    }

    @Test
    void treats_code_without_role_as_in_progress() {
        String code = inProgressCode();
        assertThat(catalog.isInProgress(code)).isTrue();
        assertThat(catalog.isNotStarted(code)).isFalse();
        assertThat(catalog.isCompleted(code)).isFalse();
    }

    @Test
    void treats_unknown_code_as_in_progress() {
        // 工程マスタから消えたコードが古いタスクに残っている場合。
        // 未着手にも完了にも寄せず「進行中」に落とす（フロントエンドの判定と揃えてある）
        assertThat(catalog.isNotStarted("NO_SUCH_STEP")).isFalse();
        assertThat(catalog.isTerminal("NO_SUCH_STEP")).isFalse();
        assertThat(catalog.isInProgress("NO_SUCH_STEP")).isTrue();
    }
}
