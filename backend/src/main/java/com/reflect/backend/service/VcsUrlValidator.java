package com.reflect.backend.service;

import java.net.URI;
import java.util.Set;

/**
 * VCS リポジトリ URL の検証。
 *
 * <p>URL は外部コマンド（git / svn）の引数として渡されるため、検証せずに受け入れると
 * 以下の経路で任意コマンドが実行される。
 * <ul>
 *   <li>{@code ext::sh -c <cmd>} — git の ext トランスポートは任意コマンドを実行する</li>
 *   <li>{@code --upload-pack=<cmd>} — {@code -} 始まりの引数がオプションとして解釈される</li>
 *   <li>{@code svn+ssh://} の権威部に {@code -o} 相当を仕込む ssh 経由の実行</li>
 * </ul>
 * スキームのホワイトリストと形式検証で、これらをまとめて排除する。
 */
public final class VcsUrlValidator {

    private static final Set<String> GIT_SCHEMES = Set.of("http", "https", "ssh", "git");
    private static final Set<String> SVN_SCHEMES = Set.of("http", "https", "svn", "svn+ssh");

    /** ホスト名／IP として妥当な文字のみ。ssh 経由のトランスポートでオプション注入を防ぐ */
    private static final java.util.regex.Pattern HOST_PATTERN =
            java.util.regex.Pattern.compile("[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?");

    private VcsUrlValidator() {
    }

    public static String validateGit(String url) {
        return validate(url, GIT_SCHEMES, "Git");
    }

    public static String validateSvn(String url) {
        return validate(url, SVN_SCHEMES, "SVN");
    }

    private static String validate(String url, Set<String> allowedSchemes, String label) {
        if (url == null || url.isBlank()) {
            throw new IllegalArgumentException("url は必須です");
        }
        String u = url.strip();

        // コマンドのオプションとして解釈される形を拒否
        if (u.startsWith("-")) {
            throw new IllegalArgumentException(label + " URL が不正です: '-' で始まる URL は指定できません");
        }
        // 制御文字（改行等）の混入を拒否
        for (int i = 0; i < u.length(); i++) {
            if (Character.isISOControl(u.charAt(i))) {
                throw new IllegalArgumentException(label + " URL に制御文字が含まれています");
            }
        }

        URI uri;
        try {
            uri = new URI(u);
        } catch (Exception e) {
            throw new IllegalArgumentException(label + " URL の形式が不正です");
        }

        String scheme = uri.getScheme();
        if (scheme == null) {
            throw new IllegalArgumentException(
                    label + " URL にはスキームが必要です（例: https://…）");
        }
        scheme = scheme.toLowerCase();
        // git の ext:: / svn の ssh 経由など、コマンド実行を伴うトランスポートはここで落ちる
        if (!allowedSchemes.contains(scheme)) {
            throw new IllegalArgumentException(
                    label + " URL のスキーム '" + scheme + "' は許可されていません。"
                            + "使用できるのは " + String.join(", ", allowedSchemes.stream().sorted().toList()) + " です");
        }
        // ssh 系トランスポートではホスト名がそのまま ssh の引数になるため、
        // '-' 始まりなどオプションとして解釈される形を弾く
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            // URI がホストを解釈できない場合（不正な権威部）もここで落ちる
            throw new IllegalArgumentException(label + " URL のホスト名が不正です");
        }
        if (!HOST_PATTERN.matcher(host).matches()) {
            throw new IllegalArgumentException(
                    label + " URL のホスト名に使用できない文字が含まれています: " + host);
        }
        return u;
    }

    /**
     * ブランチ名の検証。{@code git log} の引数として渡るため、
     * オプション解釈される形とリビジョン指定記法を排除する。
     */
    public static String validateBranch(String branch) {
        if (branch == null || branch.isBlank()) {
            return null;
        }
        String b = branch.strip();
        if (b.startsWith("-")) {
            throw new IllegalArgumentException("ブランチ名が不正です: '-' で始まる名前は指定できません");
        }
        if (!b.matches("[A-Za-z0-9._/+-]+")) {
            throw new IllegalArgumentException(
                    "ブランチ名に使用できない文字が含まれています（英数字と . _ / + - のみ）");
        }
        // ".." はリビジョン範囲指定として解釈されるため拒否
        if (b.contains("..")) {
            throw new IllegalArgumentException("ブランチ名に '..' は使用できません");
        }
        return b;
    }
}
