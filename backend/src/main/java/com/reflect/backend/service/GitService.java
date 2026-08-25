package com.reflect.backend.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Slf4j
@Service
public class GitService {

    @Value("${git.log-limit:30}")
    private int logLimit;

    /**
     * リモートリポジトリを shallow clone して git log を取得する。
     * 認証情報は URL 埋め込み（https://user:pass@host/path）で渡す。
     */
    public List<Map<String, Object>> getLogs(String url, String username, String password, String branch) {
        String safeUrl = VcsUrlValidator.validateGit(url);
        String normalizedBranch = VcsUrlValidator.validateBranch(branch);

        Path tempDir = null;
        try {
            tempDir = Files.createTempDirectory("git-log-");
            String cloneUrl = embedCredentials(safeUrl, username, password);

            // ログ対象の ref（ブランチ指定時は「既定ブランチに含まれない対象ブランチ固有のコミットのみ」）
            String logRef;
            if (normalizedBranch == null) {
                // ブランチ未指定: 既定ブランチを shallow single-branch で取得（従来動作）
                runCommand(List.of(
                        "git", "clone",
                        "--depth", String.valueOf(logLimit),
                        "--bare", "--filter=blob:none", "--single-branch", "--quiet",
                        cloneUrl, tempDir.toString()), 60);
                logRef = null; // 既定ブランチ（HEAD）
            } else {
                // ブランチ指定: 全ブランチを blobless で取得し、対象ブランチ固有の差分のみ表示
                runCommand(List.of(
                        "git", "clone",
                        "--bare", "--filter=blob:none", "--quiet",
                        cloneUrl, tempDir.toString()), 90);
                String defaultBranch = detectDefaultBranch(tempDir);
                logRef = (defaultBranch == null || defaultBranch.equals(normalizedBranch))
                        ? normalizedBranch                          // 既定ブランチそのもの/不明 → ブランチ全体
                        : defaultBranch + ".." + normalizedBranch;  // 既定ブランチに無いコミットのみ
            }

            // 各コミットを 1 行で出力: hash|date|author|subject
            // split("\\|", 4) で最大 4 分割するためsubjectに | が含まれても正しく扱える
            List<String> logCmd = new ArrayList<>(List.of(
                    "git", "-C", tempDir.toString(),
                    "log",
                    "--first-parent",
                    "--format=%H|%ad|%an|%s",
                    "--date=format:%Y-%m-%d %H:%M:%S",
                    "--max-count=" + logLimit
            ));
            if (logRef != null) {
                logCmd.add(logRef);
            }
            String logOutput = runCommandOutput(logCmd, 30);

            return parseLog(logOutput);

        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(sanitize("Git コマンドの実行に失敗しました: " + e.getMessage()), e);
        } finally {
            if (tempDir != null) {
                deleteQuietly(tempDir);
            }
        }
    }

    /** bare clone から既定ブランチ名（HEAD が指すブランチ）を取得。不明なら null */
    private String detectDefaultBranch(Path repoDir) {
        try {
            String out = runCommandOutput(
                    List.of("git", "-C", repoDir.toString(), "symbolic-ref", "--short", "HEAD"), 10);
            String s = out.strip();
            return s.isEmpty() ? null : s;
        } catch (Exception e) {
            return null;
        }
    }

    /** リモートのブランチ名一覧を取得（git ls-remote --heads。clone 不要で高速） */
    public List<String> listBranches(String url, String username, String password) {
        String safeUrl = VcsUrlValidator.validateGit(url);
        try {
            String remoteUrl = embedCredentials(safeUrl, username, password);
            String output = runCommandOutput(List.of("git", "ls-remote", "--heads", remoteUrl), 30);
            List<String> branches = new ArrayList<>();
            for (String line : output.split("\\r?\\n")) {
                String l = line.strip();
                if (l.isEmpty()) continue;
                int tab = l.indexOf('\t');
                String ref = tab >= 0 ? l.substring(tab + 1) : l;
                if (ref.startsWith("refs/heads/")) {
                    branches.add(ref.substring("refs/heads/".length()));
                }
            }
            return branches;
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(sanitize("Git ブランチの取得に失敗しました: " + e.getMessage()), e);
        }
    }

    private String embedCredentials(String url, String username, String password) {
        if (username == null || username.isBlank()) return url;
        try {
            URI uri = new URI(url);
            String userInfo = (password != null && !password.isBlank())
                    ? username + ":" + password
                    : username;
            return new URI(uri.getScheme(), userInfo, uri.getHost(), uri.getPort(),
                    uri.getPath(), uri.getQuery(), uri.getFragment()).toString();
        } catch (Exception e) {
            log.warn("Git URL への認証情報埋め込みに失敗。認証なしで試行します: {}", e.getMessage());
            return url;
        }
    }

    private void runCommand(List<String> cmd, int timeoutSec) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        pb.environment().put("GIT_TERMINAL_PROMPT", "0");
        pb.environment().put("LC_ALL", "C.UTF-8");
        pb.environment().put("LANG", "C.UTF-8");
        Process process = pb.start();

        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

        if (!process.waitFor(timeoutSec, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("Git コマンドがタイムアウトしました");
        }
        if (process.exitValue() != 0) {
            String msg = output.lines().filter(l -> !l.isBlank()).findFirst().orElse("不明なエラー");
            throw new IllegalStateException(sanitize("Git エラー: " + msg));
        }
    }

    private String runCommandOutput(List<String> cmd, int timeoutSec) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        pb.environment().put("GIT_TERMINAL_PROMPT", "0");
        pb.environment().put("LC_ALL", "C.UTF-8");
        pb.environment().put("LANG", "C.UTF-8");
        Process process = pb.start();

        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

        if (!process.waitFor(timeoutSec, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("Git log コマンドがタイムアウトしました");
        }
        if (process.exitValue() != 0) {
            String msg = output.lines().filter(l -> !l.isBlank()).findFirst().orElse("不明なエラー");
            throw new IllegalStateException(sanitize("Git log エラー: " + msg));
        }
        return output;
    }

    /** "%H|%ad|%an|%s" 形式の 1 行をパースする */
    private List<Map<String, Object>> parseLog(String output) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (String line : output.lines().toList()) {
            if (line.isBlank()) continue;
            String[] f = line.split("\\|", 4);
            String hash    = f.length > 0 ? f[0].strip() : "";
            String date    = f.length > 1 ? f[1].strip() : "";
            String author  = f.length > 2 ? f[2].strip() : "";
            String message = f.length > 3 ? f[3].strip() : "";

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("revision", hash.length() >= 7 ? hash.substring(0, 7) : hash);
            item.put("date",     date);
            item.put("author",   author);
            item.put("message",  message);
            result.add(item);
        }
        return result;
    }

    private void deleteQuietly(Path dir) {
        try {
            Files.walkFileTree(dir, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path f, BasicFileAttributes a) throws IOException {
                    Files.delete(f);
                    return FileVisitResult.CONTINUE;
                }
                @Override
                public FileVisitResult postVisitDirectory(Path d, IOException e) throws IOException {
                    Files.delete(d);
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            log.warn("一時ディレクトリの削除に失敗: {}", dir, e);
        }
    }

    /**
     * 外部コマンドの出力をクライアントに返す前に、URL に埋め込まれた認証情報
     * （scheme://user:pass@host）を伏せ字にする。git / svn はエラー時に対象 URL を
     * そのまま出力するため、これを行わないとパスワードが応答とログに残る。
     */
    static String sanitize(String text) {
        if (text == null) return "";
        return text.replaceAll("([A-Za-z][A-Za-z0-9+.-]*://)[^/@\\s]*@", "$1<認証情報を伏せ字にしました>@");
    }

}
