package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * プロジェクト所属（メンバー × プロジェクト）。
 * メンバーアカウント（Member）は全社共通だが、ロールと所属ドメイングループは
 * プロジェクトごとに持つ。
 */
@Entity
@Table(name = "project_members",
        uniqueConstraints = @UniqueConstraint(columnNames = {"project_id", "member_id"}))
@Getter @Setter @NoArgsConstructor
public class ProjectMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "member_id", nullable = false)
    private Long memberId;

    /** プロジェクト内のロール（Admin/PM/PL/DL/SL/Member） */
    @Column(nullable = false, length = 20)
    private String role;

    /** プロジェクト内で所属するドメイングループID一覧（Member から移設） */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "project_member_domain_group_ids",
            joinColumns = @JoinColumn(name = "project_member_id"))
    @Column(name = "domain_group_id")
    private List<String> domainGroupIds = new ArrayList<>();
}
