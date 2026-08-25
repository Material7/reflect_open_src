package com.reflect.backend.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.IOException;
import java.io.StringReader;
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
import java.util.stream.Collectors;

@Slf4j
@Service
public class SvnService {

    @Value("${svn.log-limit:30}")
    private int logLimit;

    public List<Map<String, Object>> getLogs(String url, String username, String password) {
        if (username == null || username.isBlank()) {
            throw new IllegalStateException("SVN 認証情報が設定されていません。マイページで SVN アカウントを設定してください。");
        }
        if (password == null || password.isBlank()) {
            throw new IllegalStateException("SVN パスワードが設定されていません。マイページで SVN パスワードを設定してください。");
        }

        String encodedUrl = encodeUrl(VcsUrlValidator.validateSvn(url));
        log.debug("SVN log: {}", encodedUrl);

        // 独立した一時設定ディレクトリを使用してシステムの認証キャッシュと干渉しないようにする
        Path tempCfg;
        try {
            tempCfg = Files.createTempDirectory("svn-cfg-");
        } catch (IOException e) {
            throw new IllegalStateException("SVN 設定ディレクトリの作成に失敗しました", e);
        }

        try {
            List<String> cmd = buildCommand(encodedUrl, username, password, tempCfg.toString());

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            pb.environment().put("LC_ALL", "C.utf8");
            pb.environment().put("LANG", "C.utf8");
            Process process = pb.start();

            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);

            if (!process.waitFor(15, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("SVN コマンドがタイムアウトしました");
            }
            if (process.exitValue() != 0) {
                // svn: で始まる実エラー行を優先（XMLヘッダ等のノイズを除外）
                String msg = output.lines()
                        .map(String::strip)
                        .filter(l -> l.startsWith("svn:"))
                        .collect(Collectors.joining(" / "));
                if (msg.isBlank()) {
                    msg = output.lines().filter(l -> !l.isBlank()).collect(Collectors.joining(" / "));
                }
                throw new IllegalStateException(sanitize("SVN エラー: " + (msg.isBlank() ? "不明なエラー" : msg)));
            }

            return parseXml(output);

        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(sanitize("SVN コマンドの実行に失敗しました: " + e.getMessage()), e);
        } finally {
            deleteQuietly(tempCfg);
        }
    }

    private List<String> buildCommand(String url, String username, String password, String configDir) {
        List<String> cmd = new ArrayList<>();
        cmd.add("svn");
        cmd.add("log");
        cmd.add("--xml");
        cmd.add("--limit");
        cmd.add(String.valueOf(logLimit));
        cmd.add("--non-interactive");
        cmd.add("--no-auth-cache");
        cmd.add("--config-dir");
        cmd.add(configDir);
        cmd.add("--trust-server-cert-failures=unknown-ca,cn-mismatch,expired,not-yet-valid,other");
        cmd.add("--username");
        cmd.add(username);
        cmd.add("--password");
        cmd.add(password);
        cmd.add(url);
        return cmd;
    }

    private List<Map<String, Object>> parseXml(String xml) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(new InputSource(new StringReader(xml)));

            NodeList entries = doc.getElementsByTagName("logentry");
            List<Map<String, Object>> result = new ArrayList<>();
            for (int i = 0; i < entries.getLength(); i++) {
                Element entry = (Element) entries.item(i);
                String revision = entry.getAttribute("revision");
                String author   = text(entry, "author");
                String date     = text(entry, "date");
                String message  = text(entry, "msg");

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("revision", revision);
                item.put("author",   author);
                item.put("date",     date.length() >= 19 ? date.substring(0, 19).replace('T', ' ') : date);
                item.put("message",  message != null ? message.strip() : "");
                result.add(item);
            }
            return result;
        } catch (Exception e) {
            throw new IllegalStateException(sanitize("SVN ログの解析に失敗しました: " + e.getMessage()), e);
        }
    }

    private String text(Element parent, String tag) {
        NodeList nodes = parent.getElementsByTagName(tag);
        return nodes.getLength() > 0 ? nodes.item(0).getTextContent() : "";
    }

    /**
     * URL パスの非 ASCII 文字を % エンコードして SVN に渡す。
     * ロケール設定に依存せず日本語ファイル名等を正しく扱うための前処理。
     */
    private String encodeUrl(String rawUrl) {
        try {
            return URI.create(rawUrl).toASCIIString();
        } catch (IllegalArgumentException first) {
            try {
                int schemeEnd = rawUrl.indexOf("://");
                if (schemeEnd < 0) return rawUrl;
                String scheme = rawUrl.substring(0, schemeEnd);
                String rest = rawUrl.substring(schemeEnd + 3);
                int pathStart = rest.indexOf('/');
                String authority = pathStart >= 0 ? rest.substring(0, pathStart) : rest;
                String path = pathStart >= 0 ? rest.substring(pathStart) : "/";
                return new URI(scheme, authority, path, null, null).toASCIIString();
            } catch (Exception e) {
                return rawUrl;
            }
        }
    }

    private void deleteQuietly(Path dir) {
        try {
            Files.walkFileTree(dir, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Files.delete(file);
                    return FileVisitResult.CONTINUE;
                }
                @Override
                public FileVisitResult postVisitDirectory(Path d, IOException exc) throws IOException {
                    Files.delete(d);
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            log.warn("SVN 一時設定ディレクトリの削除に失敗しました: {}", dir, e);
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
