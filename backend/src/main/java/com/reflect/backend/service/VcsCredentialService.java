package com.reflect.backend.service;

import com.reflect.backend.entity.VcsCredential;
import com.reflect.backend.repository.VcsCredentialRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.util.*;

@Service
@RequiredArgsConstructor
public class VcsCredentialService {

    private final VcsCredentialRepository repository;
    private final CredentialEncryptionService encryptionService;

    /** ログ取得時に解決した認証情報（平文パスワード） */
    public record Resolved(String username, String password) {}

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list(Long memberId) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (VcsCredential c : repository.findByMemberIdOrderByTypeAscHostAsc(memberId)) {
            result.add(toResponse(c));
        }
        return result;
    }

    private Map<String, Object> toResponse(VcsCredential c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.getId());
        m.put("type", c.getType());
        m.put("host", c.getHost());
        m.put("username", c.getUsername());
        m.put("passwordSet", c.getPasswordEnc() != null);
        return m;
    }

    @Transactional
    public Map<String, Object> save(Long memberId, String id, String type, String host,
                                    String username, String password) {
        String t = normalizeType(type);
        String h = normalizeHost(host);
        if (username == null || username.isBlank()) throw new IllegalArgumentException("ユーザー名は必須です");

        VcsCredential c;
        if (id != null && !id.isBlank()) {
            c = repository.findByIdAndMemberId(id, memberId)
                    .orElseThrow(() -> new IllegalArgumentException("認証情報が見つかりません"));
            // ホスト変更時の重複チェック（同一メンバー・同一種別で host 重複は不可）
            if (!c.getHost().equals(h) || !c.getType().equals(t)) {
                repository.findByMemberIdAndTypeAndHost(memberId, t, h)
                        .filter(o -> !o.getId().equals(c.getId()))
                        .ifPresent(o -> { throw new IllegalArgumentException("同じ種別・ホストの認証情報が既に存在します"); });
            }
            c.setType(t);
            c.setHost(h);
        } else {
            // type+host で upsert
            c = repository.findByMemberIdAndTypeAndHost(memberId, t, h).orElseGet(() -> {
                VcsCredential n = new VcsCredential();
                n.setId(UUID.randomUUID().toString());
                n.setMemberId(memberId);
                n.setType(t);
                n.setHost(h);
                return n;
            });
        }

        c.setUsername(username.trim());
        if (password != null && !password.isBlank()) {
            c.setPasswordEnc(encryptionService.encrypt(password));
        } else if (c.getPasswordEnc() == null) {
            throw new IllegalArgumentException("パスワードは必須です");
        }
        return toResponse(repository.save(c));
    }

    @Transactional
    public void delete(Long memberId, String id) {
        VcsCredential c = repository.findByIdAndMemberId(id, memberId)
                .orElseThrow(() -> new IllegalArgumentException("認証情報が見つかりません"));
        repository.delete(c);
    }

    /** URL のホストに対応する認証情報を解決。完全一致 → host="" の既定 の順。 */
    @Transactional(readOnly = true)
    public Optional<Resolved> resolve(Long memberId, String type, String url) {
        String t = normalizeType(type);
        String host = extractHost(url);
        VcsCredential c = repository.findByMemberIdAndTypeAndHost(memberId, t, host)
                .or(() -> host.isEmpty() ? Optional.empty()
                        : repository.findByMemberIdAndTypeAndHost(memberId, t, ""))
                .orElse(null);
        if (c == null || c.getUsername() == null) return Optional.empty();
        String pw = c.getPasswordEnc() != null ? encryptionService.decrypt(c.getPasswordEnc()) : null;
        return Optional.of(new Resolved(c.getUsername(), pw));
    }

    /** 旧 Member の SVN/Git 単一項目からの移行用：(member, type, host="") が無ければ作成 */
    @Transactional
    public void migrateDefault(Long memberId, String type, String username, String passwordEnc) {
        if (username == null || username.isBlank()) return;
        String t = normalizeType(type);
        if (repository.findByMemberIdAndTypeAndHost(memberId, t, "").isPresent()) return;
        VcsCredential c = new VcsCredential();
        c.setId(UUID.randomUUID().toString());
        c.setMemberId(memberId);
        c.setType(t);
        c.setHost("");
        c.setUsername(username);
        c.setPasswordEnc(passwordEnc);
        repository.save(c);
    }

    private String normalizeType(String type) {
        String t = type == null ? "" : type.trim().toUpperCase();
        if (!t.equals("SVN") && !t.equals("GIT")) throw new IllegalArgumentException("type は SVN または GIT です");
        return t;
    }

    private String normalizeHost(String host) {
        if (host == null) return "";
        String h = host.trim().toLowerCase();
        // 誤って URL を入れた場合に備えてホスト部を抽出
        if (h.contains("://") || h.startsWith("git@")) return extractHost(h);
        // 末尾のパス・ポートは除去
        int slash = h.indexOf('/');
        if (slash >= 0) h = h.substring(0, slash);
        int colon = h.indexOf(':');
        if (colon >= 0) h = h.substring(0, colon);
        return h;
    }

    /** URL からホスト名を抽出（http(s) と ssh git@host:path に対応） */
    String extractHost(String url) {
        if (url == null) return "";
        String u = url.trim();
        if (u.isEmpty()) return "";
        if (u.startsWith("git@") || (u.contains("@") && !u.contains("://"))) {
            int at = u.indexOf('@');
            String rest = u.substring(at + 1);
            int colon = rest.indexOf(':');
            int slash = rest.indexOf('/');
            int end = colon >= 0 ? colon : (slash >= 0 ? slash : rest.length());
            return rest.substring(0, end).toLowerCase();
        }
        try {
            String h = URI.create(u).getHost();
            return h != null ? h.toLowerCase() : "";
        } catch (Exception e) {
            return "";
        }
    }
}
