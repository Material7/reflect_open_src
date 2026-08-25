package com.reflect.backend.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * VCS URL がそのまま git / svn の引数として渡るため、任意コマンド実行につながる
 * 入力を確実に拒否できることを保証するテスト。
 */
class VcsUrlValidatorTest {

    @Test
    void 通常のリポジトリURLは通る() {
        assertDoesNotThrow(() -> VcsUrlValidator.validateGit("https://github.com/example/repo.git"));
        assertDoesNotThrow(() -> VcsUrlValidator.validateGit("ssh://git@example.com/repo.git"));
        assertDoesNotThrow(() -> VcsUrlValidator.validateSvn("https://svn.example.com/repo/trunk"));
        assertDoesNotThrow(() -> VcsUrlValidator.validateSvn("svn://svn.example.com/repo"));
    }

    @Test
    void 前後の空白は除去される() {
        assertEquals("https://example.com/r.git",
                VcsUrlValidator.validateGit("  https://example.com/r.git  "));
    }

    @Test
    void gitのextトランスポートは拒否する() {
        assertThrows(IllegalArgumentException.class,
                () -> VcsUrlValidator.validateGit("ext::sh -c whoami"));
    }

    @Test
    void オプションとして解釈される入力は拒否する() {
        assertThrows(IllegalArgumentException.class,
                () -> VcsUrlValidator.validateGit("--upload-pack=touch /tmp/pwned"));
        assertThrows(IllegalArgumentException.class,
                () -> VcsUrlValidator.validateSvn("--config-dir=/tmp"));
    }

    @Test
    void 許可されないスキームは拒否する() {
        assertThrows(IllegalArgumentException.class,
                () -> VcsUrlValidator.validateGit("file:///etc/passwd"));
        assertThrows(IllegalArgumentException.class,
                () -> VcsUrlValidator.validateGit("ftp://example.com/repo"));
    }

    @Test
    void svn_sshは許可する() {
        assertDoesNotThrow(() -> VcsUrlValidator.validateSvn("svn+ssh://svn.example.com/repo"));
    }

    @Test
    void sshのオプション注入になるホスト名は拒否する() {
        assertThrows(IllegalArgumentException.class,
                () -> VcsUrlValidator.validateSvn("svn+ssh://-oProxyCommand=touch$IFS/tmp/x/repo"));
        assertThrows(IllegalArgumentException.class,
                () -> VcsUrlValidator.validateGit("ssh://-oProxyCommand=whoami/repo.git"));
    }

    @Test
    void スキームやホストが無い入力は拒否する() {
        assertThrows(IllegalArgumentException.class, () -> VcsUrlValidator.validateGit("example.com/repo"));
        assertThrows(IllegalArgumentException.class, () -> VcsUrlValidator.validateGit("https:///repo"));
        assertThrows(IllegalArgumentException.class, () -> VcsUrlValidator.validateGit(""));
        assertThrows(IllegalArgumentException.class, () -> VcsUrlValidator.validateGit(null));
    }

    @Test
    void 制御文字の混入は拒否する() {
        assertThrows(IllegalArgumentException.class,
                () -> VcsUrlValidator.validateGit("https://example.com/r.git\nrm -rf /"));
    }

    @Test
    void 通常のブランチ名は通る() {
        assertEquals("feature/add-x", VcsUrlValidator.validateBranch("feature/add-x"));
        assertEquals("release-1.0", VcsUrlValidator.validateBranch("release-1.0"));
    }

    @Test
    void 未指定のブランチはnullになる() {
        assertEquals(null, VcsUrlValidator.validateBranch(null));
        assertEquals(null, VcsUrlValidator.validateBranch("   "));
    }

    @Test
    void オプションやリビジョン範囲になるブランチ名は拒否する() {
        assertThrows(IllegalArgumentException.class, () -> VcsUrlValidator.validateBranch("--output=/tmp/x"));
        assertThrows(IllegalArgumentException.class, () -> VcsUrlValidator.validateBranch("main..secret"));
        assertThrows(IllegalArgumentException.class, () -> VcsUrlValidator.validateBranch("main;whoami"));
        assertThrows(IllegalArgumentException.class, () -> VcsUrlValidator.validateBranch("main$(whoami)"));
    }
}
