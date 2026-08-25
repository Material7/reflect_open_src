package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.ArrayList;
import java.util.List;

/**
 * プロジェクト設定（プロジェクトごとに1レコード。PK = projects.id）
 */
@Entity
@Table(name = "project_settings")
@Getter @Setter @NoArgsConstructor
public class ProjectSettings {

    /** 所属プロジェクトのID（= projects.id）。1プロジェクト1行 */
    @Id
    @Column(name = "project_id")
    private Long projectId;

    @Column(name = "task_id_prefix", nullable = false, length = 20)
    private String taskIdPrefix = "TASK";

    @Column(name = "task_id_counter_r", nullable = false)
    private int taskIdCounterR = 1;

    @Column(name = "task_id_counter_d", nullable = false)
    private int taskIdCounterD = 1;

    /** アクションアイテム表示ID採番カウンタ。既存行向けに nullable（読み込み時は null を 1 とみなす） */
    @Column(name = "task_id_counter_a")
    private Integer taskIdCounterA = 1;

    /** 工程外タスク表示ID採番カウンタ。既存行向けに nullable（読み込み時は null を 1 とみなす） */
    @Column(name = "task_id_counter_x")
    private Integer taskIdCounterX = 1;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "skipped_phases", columnDefinition = "jsonb")
    private List<String> skippedPhases = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "workflows", columnDefinition = "jsonb")
    private List<String> workflows = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "action_item_categories", columnDefinition = "jsonb")
    private List<String> actionItemCategories = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", columnDefinition = "jsonb")
    private List<String> tags = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "action_item_delete_roles", columnDefinition = "jsonb")
    private List<String> actionItemDeleteRoles = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "task_delete_roles", columnDefinition = "jsonb")
    private List<String> taskDeleteRoles = new ArrayList<>();

    /** 除外扱いの作業工程（constants.ts の role: "excluded"）を選択可能なロール一覧 (JSONB) */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "exclude_step_select_roles", columnDefinition = "jsonb")
    private List<String> excludeStepSelectRoles = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "change_log_view_roles", columnDefinition = "jsonb")
    private List<String> changeLogViewRoles = new ArrayList<>();
}
