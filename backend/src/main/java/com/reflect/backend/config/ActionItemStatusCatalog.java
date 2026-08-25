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
 * アクションアイテムのステータスマスタ。定義元は shared/action-item-statuses.json で、
 * フロントエンドの {@code frontend/src/lib/constants.ts} も同じファイルを読む。
 * タスクのステータスとは別体系で、こちらは設定画面から編集できない固定マスタ。
 */
@Slf4j
@Component
public class ActionItemStatusCatalog {

    private static final String RESOURCE = "action-item-statuses.json";

    public static final String ROLE_NOT_STARTED = "notStarted";
    public static final String ROLE_COMPLETED   = "completed";

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ActionItemStatus(String name, String role) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Catalog(List<ActionItemStatus> actionItemStatuses) {}

    private final List<ActionItemStatus> statuses;
    private final String notStartedName;
    private final String completedName;

    public ActionItemStatusCatalog(ObjectMapper objectMapper) {
        this.statuses = load(objectMapper);
        this.notStartedName = requireSingle(ROLE_NOT_STARTED);
        this.completedName  = requireSingle(ROLE_COMPLETED);
        log.info("アクションアイテムのステータスマスタを読み込みました: {} 件（未着手={}, 完了={}）",
                statuses.size(), notStartedName, completedName);
    }

    private List<ActionItemStatus> load(ObjectMapper objectMapper) {
        ClassPathResource resource = new ClassPathResource(RESOURCE);
        try (InputStream in = resource.getInputStream()) {
            Catalog catalog = objectMapper.readValue(in, Catalog.class);
            if (catalog == null || catalog.actionItemStatuses() == null || catalog.actionItemStatuses().isEmpty()) {
                throw new IllegalStateException(RESOURCE + " に actionItemStatuses が定義されていません");
            }
            return List.copyOf(catalog.actionItemStatuses());
        } catch (IOException e) {
            throw new IllegalStateException(
                    "アクションアイテムのステータスマスタ (" + RESOURCE + ") を読み込めません。"
                            + "shared/action-item-statuses.json がビルドに取り込まれているか確認してください", e);
        }
    }

    private String requireSingle(String role) {
        List<String> names = statuses.stream()
                .filter(s -> role.equals(s.role()))
                .map(ActionItemStatus::name)
                .toList();
        if (names.size() != 1) {
            throw new IllegalStateException(
                    "shared/action-item-statuses.json の定義エラー: role=\"" + role
                            + "\" のステータスはちょうど1件必要です（現在 " + names.size() + " 件）");
        }
        return names.get(0);
    }

    /** マスタ定義順のステータス名一覧 */
    public List<String> names() {
        return statuses.stream().map(ActionItemStatus::name).toList();
    }

    /** 新規アイテムの初期ステータス */
    public String notStartedName() {
        return notStartedName;
    }

    public boolean isCompleted(String status) {
        return completedName.equals(status);
    }
}
