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
 * アンケート本体。設問・対象ユーザー・権限設定を保持する。
 * 回答は SurveyResponse（1人1レコード、記名）に分離して保持する。
 */
@Entity
@Table(name = "surveys")
@Getter @Setter @NoArgsConstructor
public class Survey {

    @Id
    @Column(length = 50)
    private String id;

    /** 所属プロジェクトID。null = 全プロジェクト（特定プロジェクトに紐づかない全社アンケート） */
    @Column(name = "project_id")
    private Long projectId;

    @Column(nullable = false, length = 255)
    private String title;

    @Column(length = 2000)
    private String description;

    /** draft | open | closed */
    @Column(nullable = false, length = 20)
    private String status = "draft";

    /** 対象指定の方式: "members"（個別） | "all"（公開時点のプロジェクト全メンバー） */
    @Column(name = "target_type", nullable = false, length = 20)
    private String targetType = "members";

    /** 対象メンバーの employeeNumber 一覧（targetType="members" のとき有効） */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "target_member_ids", columnDefinition = "jsonb")
    private List<String> targetMemberIds = new ArrayList<>();

    /** 回答期限 YYYY-MM-DD（任意。null=期限なし） */
    @Column(name = "due_date", length = 20)
    private String dueDate;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<SurveyQuestion> questions = new ArrayList<>();

    /**
     * 集計結果を見られる追加対象（作成者・PM・システムAdmin は常時可のため含めない）。
     * subset of {"pl", "respondents", "all"} (JSONB)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "result_visible_to", columnDefinition = "jsonb")
    private List<String> resultVisibleTo = new ArrayList<>();

    /**
     * 個別回答（記名）を特定できる追加対象（作成者・PM・システムAdmin は常時可のため含めない）。
     * subset of {"pl", "viewers"} (JSONB)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "identity_visible_to", columnDefinition = "jsonb")
    private List<String> identityVisibleTo = new ArrayList<>();

    /** 対象者への結果公開タイミング: after_close | after_answer | always（resultVisibleTo に respondents 含む時のみ有効） */
    @Column(name = "result_timing", nullable = false, length = 20)
    private String resultTiming = "after_close";

    @Column(name = "created_by", length = 50)
    private String createdBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt;
}
