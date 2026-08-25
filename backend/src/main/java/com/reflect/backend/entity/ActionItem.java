package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * アクションアイテム / 開発工程外タスク
 * タスク発行前段階の作業項目や、要件・開発の正式タスクに乗らない管理項目を扱う。
 * category で種別を区別し、正式タスクへ「発行」した場合は issuedTaskId に紐づく。
 */
@Entity
@Table(name = "action_items")
@Getter @Setter @NoArgsConstructor
public class ActionItem {

    @Id
    @Column(length = 50)
    private String id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /** 表示用ID（例: TASK-A0001）。プロジェクト別カウンタから採番、不変 */
    @Column(name = "item_id", length = 30)
    private String itemId;

    /** 種別: プロジェクト設定で定義したアクションアイテムカテゴリ名 */
    @Column(nullable = false, length = 100)
    private String category;

    @Column(nullable = false, length = 255)
    private String title;

    @Column(length = 50)
    private String assignee;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "due_date", length = 20)
    private String dueDate;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", columnDefinition = "jsonb")
    private List<String> tags = new ArrayList<>();

    /** 優先度: "HIGH" | "MEDIUM" | "LOW"（未設定なら null） */
    @Column(length = 20)
    private String priority;

    @Column(length = 1000)
    private String memo;

    @Column(name = "ticket_url", length = 500)
    private String ticketUrl;

    @Column(name = "ticket_key", length = 50)
    private String ticketKey;

    /** 発行先の正式タスク内部ID（未発行なら null） */
    @Column(name = "issued_task_id", length = 50)
    private String issuedTaskId;

    @Column(name = "created_by", length = 50)
    private String createdBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt;
}
