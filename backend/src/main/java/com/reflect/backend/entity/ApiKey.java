package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * REST API 用 API キー
 * 実際のキー値はハッシュ化して保持する。平文は発行時の一度だけ返す。
 */
@Entity
@Table(name = "api_keys")
@Getter @Setter @NoArgsConstructor
public class ApiKey {

    @Id
    @Column(length = 50)
    private String id;

    @Column(name = "member_id", nullable = false)
    private Long memberId;

    /** SHA-256 ハッシュ（hex 文字列） */
    @Column(name = "key_hash", unique = true, nullable = false, length = 100)
    private String keyHash;

    /**
     * 表示用プレフィックス（先頭 12 文字）
     * 例: "rfl_a3f2b1c4"
     */
    @Column(name = "key_prefix", nullable = false, length = 20)
    private String keyPrefix;

    @Column(length = 100)
    private String name;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "last_used_at")
    private LocalDateTime lastUsedAt;
}
