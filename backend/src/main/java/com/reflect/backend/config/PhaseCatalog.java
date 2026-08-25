package com.reflect.backend.config;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

/**
 * フェーズ（工程区分）マスタ。定義元は shared/phases.json で、フロントエンドの
 * {@code frontend/src/lib/constants.ts} も同じファイルを読む。
 * ビルド時に classpath へ取り込まれる（backend/build.gradle の processResources を参照）。
 *
 * <p>バックエンドはフェーズコードを解釈せず、target（Requirement / Development）
 * だけで対象タスク種別を判断する。これによりフェーズを増減・改名しても Java 側の
 * 変更は不要になる。
 */
@Slf4j
@Component
public class PhaseCatalog {

    private static final String RESOURCE = "phases.json";

    public static final String TARGET_REQUIREMENT = "Requirement";
    public static final String TARGET_DEVELOPMENT = "Development";

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Phase(String code, String name, String description, String target) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Catalog(List<Phase> phases) {}

    private final List<Phase> phases;

    public PhaseCatalog(ObjectMapper objectMapper) {
        this.phases = load(objectMapper);
        validate();
        log.info("フェーズマスタを読み込みました: {} フェーズ（{}）",
                phases.size(), phases.stream().map(Phase::code).toList());
    }

    private List<Phase> load(ObjectMapper objectMapper) {
        ClassPathResource resource = new ClassPathResource(RESOURCE);
        try (InputStream in = resource.getInputStream()) {
            Catalog catalog = objectMapper.readValue(in, Catalog.class);
            if (catalog == null || catalog.phases() == null || catalog.phases().isEmpty()) {
                throw new IllegalStateException(RESOURCE + " に phases が定義されていません");
            }
            return List.copyOf(catalog.phases());
        } catch (IOException e) {
            throw new IllegalStateException(
                    "フェーズマスタ (" + RESOURCE + ") を読み込めません。"
                            + "shared/phases.json がビルドに取り込まれているか確認してください", e);
        }
    }

    /**
     * 対象種別の個数が満たされていないと工程別進捗が黙って誤った値を返すため、
     * 起動時に停止させる。条件はフロントエンド側の検証と揃えてある。
     */
    private void validate() {
        long requirement = phases.stream().filter(p -> TARGET_REQUIREMENT.equals(p.target())).count();
        if (requirement != 1) {
            throw new IllegalStateException(
                    "shared/phases.json の定義エラー: target=\"Requirement\" のフェーズはちょうど1件必要です"
                            + "（現在 " + requirement + " 件）");
        }
        if (phases.stream().noneMatch(p -> TARGET_DEVELOPMENT.equals(p.target()))) {
            throw new IllegalStateException(
                    "shared/phases.json の定義エラー: target=\"Development\" のフェーズが1件以上必要です");
        }
    }

    /** マスタ定義順のフェーズ一覧 */
    public List<Phase> phases() {
        return phases;
    }

    /** マスタ定義順のフェーズコード一覧 */
    public List<String> codes() {
        return phases.stream().map(Phase::code).toList();
    }

    /** そのフェーズを実施するタスク種別（マスタに無いコードは null） */
    public String targetOf(String code) {
        return phases.stream()
                .filter(p -> p.code().equals(code))
                .map(Phase::target)
                .findFirst().orElse(null);
    }

    /** 当該フェーズがそのタスク種別の対象か */
    public boolean isTargetOf(String phaseCode, String taskType) {
        String target = targetOf(phaseCode);
        return target != null && target.equals(taskType);
    }
}
