package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "task_change_logs")
@Getter @Setter @NoArgsConstructor
public class TaskChangeLog {

    @Id
    @Column(length = 50)
    private String id;

    /** 所属プロジェクト（書き込み時にタスクから非正規化。APIキー操作など非タスク操作では null） */
    @Column(name = "project_id")
    private Long projectId;

    /** 対象タスクの内部UUID（tasks.id）。APIキー操作など非タスク操作では null */
    @Column(name = "task_id", length = 50)
    private String taskId;

    /** 表示用タスクID（例: TASK-R0001）スナップショット */
    @Column(name = "task_display_id", length = 30)
    private String taskDisplayId;

    @Column(name = "task_name", length = 255)
    private String taskName;

    /** タスク種別スナップショット（Requirement / Development） */
    @Column(name = "task_type", length = 20)
    private String taskType;

    /**
     * 操作種別コード
     * TASK_CREATED / TASK_DELETED / STATUS_CHANGED / ASSIGNEE_CHANGED /
     * NAME_CHANGED / DOMAIN_CHANGED /
     * WORK_STEP_CHANGED / PLANNED_START_DATE_CHANGED / PLANNED_END_DATE_CHANGED /
     * ACTUAL_START_DATE_CHANGED / ACTUAL_END_DATE_CHANGED /
     * PLANNED_MAN_HOURS_CHANGED / ACTUAL_MAN_HOURS_CHANGED / ACTUAL_MAN_HOURS_LOGGED /
     * DELIVERABLE_ADDED / DELIVERABLE_WORKFLOW_CHANGED / DELIVERABLE_UPDATED / DELIVERABLE_DELETED /
     * API_KEY_GENERATED / API_KEY_REVOKED
     */
    @Column(nullable = false, length = 50)
    private String operation;

    @Column(name = "changed_by", nullable = false, length = 50)
    private String changedBy;

    @Column(name = "changed_at", nullable = false)
    private LocalDateTime changedAt;

    /** フェーズコード（B/C カテゴリのみ。例: RA, AD） */
    @Column(name = "phase_code", length = 10)
    private String phaseCode;

    /** 作業工程コード（B/C カテゴリのみ。例: MKD, RV） */
    @Column(name = "work_step_code", length = 20)
    private String workStepCode;

    /** 成果物名（D カテゴリのみ） */
    @Column(name = "deliverable_name", length = 255)
    private String deliverableName;

    @Column(name = "old_value", columnDefinition = "TEXT")
    private String oldValue;

    @Column(name = "new_value", columnDefinition = "TEXT")
    private String newValue;
}
