package com.reflect.backend.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 公開リポジトリのサンプル値のまま起動できないことを保証するテスト。
 * これが通らなくなった場合、既知のキーで JWT の偽造や認証情報の復号が可能になる。
 */
class SecretsValidatorTest {

    private static final String VALID = "a-sufficiently-long-random-looking-secret-value";

    private static void validate(String jwt, String cred) {
        new SecretsValidator(jwt, cred).validate();
    }

    @Test
    void 十分な長さの値なら起動できる() {
        assertDoesNotThrow(() -> validate(VALID, VALID));
    }

    @Test
    void 公開されているサンプル値は拒否する() {
        assertThrows(IllegalStateException.class, () -> validate(
                "reflect-jwt-secret-key-must-be-at-least-256-bits-long-for-hs256", VALID));
        assertThrows(IllegalStateException.class, () -> validate(
                VALID, "reflect-credential-enc-key-32bytes!"));
    }

    @Test
    void テンプレートのプレースホルダは拒否する() {
        assertThrows(IllegalStateException.class, () -> validate("CHANGE_ME_JWT_SECRET", VALID));
        assertThrows(IllegalStateException.class, () -> validate(VALID, "CHANGE_ME_CREDENTIAL_ENC_KEY"));
    }

    @Test
    void 短すぎる値は拒否する() {
        assertThrows(IllegalStateException.class, () -> validate("short", VALID));
        assertThrows(IllegalStateException.class, () -> validate(VALID, "short"));
    }

    @Test
    void 未設定や空文字は拒否する() {
        assertThrows(IllegalStateException.class, () -> validate(null, VALID));
        assertThrows(IllegalStateException.class, () -> validate("   ", VALID));
    }
}
