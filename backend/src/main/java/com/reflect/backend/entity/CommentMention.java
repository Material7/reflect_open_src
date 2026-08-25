package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * コメント内のメンション。1コメントで複数メンションされた場合は複数行。
 * mentionedEmp（メンションされた人）単位でダッシュボードに集約・既読管理する。
 */
@Entity
@Table(name = "comment_mentions",
        indexes = {
                @Index(name = "idx_mention_emp", columnList = "mentioned_emp"),
                @Index(name = "idx_mention_comment", columnList = "comment_id")
        })
@Getter @Setter @NoArgsConstructor
public class CommentMention {

    @Id
    @Column(length = 50)
    private String id;

    @Column(name = "comment_id", nullable = false, length = 50)
    private String commentId;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "task_id", nullable = false, length = 50)
    private String taskId;

    @Column(name = "mentioned_emp", nullable = false, length = 50)
    private String mentionedEmp;

    @Column(name = "created_by", nullable = false, length = 50)
    private String createdBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    /** 既読日時。null = 未読 */
    @Column(name = "read_at")
    private LocalDateTime readAt;
}
