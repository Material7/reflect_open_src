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
 * 作業工程マスタ。定義元は shared/work-steps.json で、フロントエンドの
 * {@code frontend/src/lib/constants.ts} も同じファイルを読む。
 * ビルド時に classpath へ取り込まれる（backend/build.gradle の processResources を参照）。
 *
 * <p>バックエンドは工程コードを解釈せず、各工程に付いた role
 * （notStarted / completed / excluded）だけで集計上の意味を判断する。
 * これにより工程コードを変えても Java 側の変更は不要になる。
 */
@Slf4j
@Component
public class WorkStepCatalog {

    private static final String RESOURCE = "work-steps.json";

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record WorkStep(String code, String name, Integer progress, String role) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Catalog(List<WorkStep> workSteps) {}

    private final List<WorkStep> workSteps;
    private final Set<String> notStartedCodes;
    private final Set<String> completedCodes;
    private final Set<String> excludedCodes;

    public WorkStepCatalog(ObjectMapper objectMapper) {
        this.workSteps = load(objectMapper);
        this.notStartedCodes = codesWithRole("notStarted");
        this.completedCodes  = codesWithRole("completed");
        this.excludedCodes   = codesWithRole("excluded");
        validate();
        log.info("作業工程マスタを読み込みました: {} 工程（未着手={}, 完了={}, 除外={}）",
                workSteps.size(), notStartedCodes, completedCodes, excludedCodes);
    }

    private List<WorkStep> load(ObjectMapper objectMapper) {
        ClassPathResource resource = new ClassPathResource(RESOURCE);
        try (InputStream in = resource.getInputStream()) {
            Catalog catalog = objectMapper.readValue(in, Catalog.class);
            if (catalog == null || catalog.workSteps() == null || catalog.workSteps().isEmpty()) {
                throw new IllegalStateException(RESOURCE + " に workSteps が定義されていません");
            }
            return List.copyOf(catalog.workSteps());
        } catch (IOException e) {
            throw new IllegalStateException(
                    "作業工程マスタ (" + RESOURCE + ") を読み込めません。"
                            + "shared/work-steps.json がビルドに取り込まれているか確認してください", e);
        }
    }

    private Set<String> codesWithRole(String role) {
        Set<String> codes = new LinkedHashSet<>();
        for (WorkStep ws : workSteps) {
            if (role.equals(ws.role())) codes.add(ws.code());
        }
        return codes;
    }

    /**
     * 役割の個数が満たされていないと工程別進捗・アラートが黙って誤った値を返すため、
     * 起動時に停止させる。条件はフロントエンド側の検証と揃えてある。
     */
    private void validate() {
        if (notStartedCodes.size() != 1) {
            throw new IllegalStateException(fmt("notStarted", 1, notStartedCodes.size()));
        }
        if (excludedCodes.size() != 1) {
            throw new IllegalStateException(fmt("excluded", 1, excludedCodes.size()));
        }
        if (completedCodes.isEmpty()) {
            throw new IllegalStateException(
                    "shared/work-steps.json の定義エラー: role=\"completed\" の工程が1件以上必要です");
        }
    }

    private String fmt(String role, int expected, int actual) {
        return "shared/work-steps.json の定義エラー: role=\"" + role + "\" の工程はちょうど"
                + expected + "件必要です（現在 " + actual + " 件）";
    }

    public List<WorkStep> workSteps() {
        return workSteps;
    }

    /**
     * 未設定（null・空文字）は工程未記録とみなし、着手前として扱う。
     * マスタに無いコード（旧マスタの残骸など）は着手前ではなく進行中になる。
     * 判定はフロントエンドの isNotStartedStep と揃えてある。
     */
    public boolean isNotStarted(String code) {
        return code == null || code.isBlank() || notStartedCodes.contains(code);
    }

    public boolean isCompleted(String code) {
        return code != null && completedCodes.contains(code);
    }

    public boolean isExcluded(String code) {
        return code != null && excludedCodes.contains(code);
    }

    /** 完了または除外。これ以上作業が発生しない状態 */
    public boolean isTerminal(String code) {
        return isCompleted(code) || isExcluded(code);
    }

    /** 着手済みかつ未完了。遅延判定の対象 */
    public boolean isInProgress(String code) {
        return !isNotStarted(code) && !isTerminal(code);
    }
}
