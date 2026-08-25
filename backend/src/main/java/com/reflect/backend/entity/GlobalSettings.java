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
 * 全社共通設定（システム全体で1レコード）。
 * プロジェクトをまたいで共通の設定を保持する。
 */
@Entity
@Table(name = "global_settings")
@Getter @Setter @NoArgsConstructor
public class GlobalSettings {

    @Id
    @Column(name = "id")
    private Long id = 1L;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "change_log_view_roles", columnDefinition = "jsonb")
    private List<String> changeLogViewRoles = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "task_statuses", columnDefinition = "jsonb")
    private List<String> taskStatuses = new ArrayList<>();
}
