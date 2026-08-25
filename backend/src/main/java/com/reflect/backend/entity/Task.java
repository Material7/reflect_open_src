package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.List;
import java.util.Map;

/**
 * タスク
 * phases / deliverablesByPhase は深いネスト構造のためJSONBで保持
 */
@Entity
@Table(name = "tasks",
        uniqueConstraints = @UniqueConstraint(columnNames = {"project_id", "task_id"}))
@Getter @Setter @NoArgsConstructor
public class Task {

    @Id
    @Column(length = 50)
    private String id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /** 表示用タスクID。プロジェクト内で一意（プロジェクト間では重複可） */
    @Column(name = "task_id", nullable = false, length = 30)
    private String taskId;

    @Column(nullable = false, length = 20)
    private String type;

    @Column(nullable = false, length = 20)
    private String status;

    /** 優先度: "HIGH" | "MEDIUM" | "LOW"（未設定なら null） */
    @Column(length = 20)
    private String priority;

    @Column(name = "domain_id", nullable = false, length = 50)
    private String domainId;

    @Column(nullable = false, length = 255)
    private String name;

    @Column(nullable = false, length = 100)
    private String assignee;

    /** 紐づくチケットID（例: PROJ-123）。URLから自動抽出。未連携なら null */
    @Column(name = "ticket_key", length = 50)
    private String ticketKey;

    @Column(name = "ticket_url", length = 500)
    private String ticketUrl;

    /**
     * フェーズデータ全体 (JSONB)
     * 構造: { "AD": { "currentWorkStepCode": "MKD", "schedule": { "MKD": { ... } } }, ... }
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> phases;

    /**
     * 成果物データ (JSONB)
     * 構造: { "AD": [ { "type": "...", "name": "...", ... } ], ... }
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "deliverables_by_phase", columnDefinition = "jsonb")
    private Map<String, Object> deliverablesByPhase;

    /**
     * 参照リソース (JSONB, タスク単位)
     * サイトURL / ファイルパス / SVN・Git リポジトリを表す TaskReference の配列
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "reference_list", columnDefinition = "jsonb")
    private List<Object> references;

    /**
     * タグ (JSONB, タスク単位)
     * プロジェクト設定で定義したタグ名の配列
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tags;
}
