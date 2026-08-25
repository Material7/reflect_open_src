package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * メンバーごとの VCS（SVN/Git）認証情報。サーバー（ホスト）単位で複数登録できる。
 * host が空文字 "" のエントリは、ホスト未一致時のフォールバック（既定）として扱う。
 */
@Entity
@Table(name = "vcs_credentials",
        uniqueConstraints = @UniqueConstraint(columnNames = {"member_id", "type", "host"}))
@Getter @Setter @NoArgsConstructor
public class VcsCredential {

    @Id
    @Column(length = 50)
    private String id;

    @Column(name = "member_id", nullable = false)
    private Long memberId;

    /** "SVN" | "GIT" */
    @Column(nullable = false, length = 10)
    private String type;

    /** サーバーのホスト名（例: svn.example.com / github.com）。"" = 既定フォールバック */
    @Column(nullable = false, length = 255)
    private String host = "";

    @Column(length = 200)
    private String username;

    @Column(name = "password_enc", length = 500)
    private String passwordEnc;
}
