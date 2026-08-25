package com.reflect.backend.config;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * 起動時にシークレット設定を検証する。
 *
 * <p>本アプリはソースコードが公開されているため、サンプル値やプレースホルダのまま
 * 起動すると署名キー・暗号化キーが第三者に既知の値となり、認証のなりすましや
 * 保存済み VCS 認証情報の復号が可能になる。設定漏れを起動時に確実に止める。
 */
@Configuration
public class SecretsValidator {

    /** 過去のサンプル値・テンプレートのプレースホルダ。これらの値での起動は許可しない。 */
    private static final List<String> FORBIDDEN_VALUES = List.of(
            "CHANGE_ME_JWT_SECRET",
            "CHANGE_ME_CREDENTIAL_ENC_KEY",
            "CHANGE_ME_DB_PASS",
            "reflect-jwt-secret-key-must-be-at-least-256-bits-long-for-hs256",
            "reflect-credential-enc-key-32bytes!"
    );

    private static final int MIN_SECRET_LENGTH = 32;

    private final String jwtSecret;
    private final String credentialKey;

    public SecretsValidator(
            @Value("${jwt.secret}") String jwtSecret,
            @Value("${credential.encryption-key}") String credentialKey) {
        this.jwtSecret = jwtSecret;
        this.credentialKey = credentialKey;
    }

    @PostConstruct
    public void validate() {
        check("JWT_SECRET", "jwt.secret", jwtSecret);
        check("CREDENTIAL_ENC_KEY", "credential.encryption-key", credentialKey);
    }

    private void check(String envName, String propertyName, String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(fail(envName, propertyName, "値が設定されていません"));
        }
        if (value.length() < MIN_SECRET_LENGTH) {
            throw new IllegalStateException(fail(envName, propertyName,
                    MIN_SECRET_LENGTH + " 文字以上が必要です（現在 " + value.length() + " 文字）"));
        }
        if (FORBIDDEN_VALUES.contains(value)) {
            throw new IllegalStateException(fail(envName, propertyName,
                    "サンプル値のままです。この値は公開されているため使用できません"));
        }
    }

    private String fail(String envName, String propertyName, String reason) {
        return String.format("""

                        ===========================================================
                        起動を中止しました: %s (%s) %s

                        ランダムな値を生成して設定してください。
                          生成例: openssl rand -base64 64

                          環境変数 %s を設定するか、
                          backend/application-secret.yml に記述してください
                          （backend/application-secret.yml.example をコピーして作成）
                        ===========================================================
                        """,
                envName, propertyName, reason, envName);
    }
}
