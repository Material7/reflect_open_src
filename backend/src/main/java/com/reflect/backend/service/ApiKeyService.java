package com.reflect.backend.service;

import com.reflect.backend.entity.ApiKey;
import com.reflect.backend.entity.Member;
import com.reflect.backend.repository.ApiKeyRepository;
import com.reflect.backend.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class ApiKeyService {

    private final ApiKeyRepository apiKeyRepository;
    private final MemberRepository memberRepository;
    private final TaskChangeLogService changeLogService;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    /**
     * 新しい API キーを生成して保存する。
     * 戻り値の "key" フィールドには平文キーが含まれる（一度だけ返す）。
     */
    @Transactional
    public Map<String, Object> generate(String employeeNumber) {
        Member member = memberRepository.findByEmployeeNumber(employeeNumber)
                .orElseThrow(() -> new IllegalArgumentException("メンバーが見つかりません: " + employeeNumber));

        if (!apiKeyRepository.findByMemberIdOrderByCreatedAtDesc(member.getId()).isEmpty()) {
            throw new IllegalArgumentException("APIキーは1つのみ発行できます。既存のキーを削除してから再発行してください。");
        }

        // rfl_ + 32 桁の小文字 hex = 36 文字
        String rawKey = "rfl_" + randomHex(32);
        String hash   = sha256Hex(rawKey);
        String prefix = rawKey.substring(0, 12); // "rfl_xxxxxxxx"

        ApiKey entity = new ApiKey();
        entity.setId(UUID.randomUUID().toString());
        entity.setMemberId(member.getId());
        entity.setKeyHash(hash);
        entity.setKeyPrefix(prefix);
        entity.setCreatedAt(LocalDateTime.now());

        apiKeyRepository.save(entity);

        changeLogService.logApiKeyOperation("API_KEY_GENERATED", employeeNumber, prefix);

        Map<String, Object> result = toMap(entity);
        result.put("key", rawKey); // 平文は発行時のみ
        return result;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list(String employeeNumber) {
        Member member = memberRepository.findByEmployeeNumber(employeeNumber)
                .orElseThrow(() -> new IllegalArgumentException("メンバーが見つかりません: " + employeeNumber));

        return apiKeyRepository.findByMemberIdOrderByCreatedAtDesc(member.getId())
                .stream()
                .map(this::toMap)
                .toList();
    }

    @Transactional
    public void revoke(String id, String employeeNumber) {
        Member member = memberRepository.findByEmployeeNumber(employeeNumber)
                .orElseThrow(() -> new IllegalArgumentException("メンバーが見つかりません: " + employeeNumber));

        ApiKey key = apiKeyRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("APIキーが見つかりません: " + id));

        if (!key.getMemberId().equals(member.getId())) {
            throw new IllegalArgumentException("このAPIキーを削除する権限がありません");
        }

        String prefix = key.getKeyPrefix();
        apiKeyRepository.delete(key);

        changeLogService.logApiKeyOperation("API_KEY_REVOKED", employeeNumber, prefix);
    }

    /**
     * リクエストヘッダーの生キーを検証し、対応するメンバーを返す。
     * 有効なら lastUsedAt を更新する。
     */
    @Transactional
    public Optional<Member> authenticate(String rawKey) {
        String hash = sha256Hex(rawKey);
        Optional<ApiKey> opt = apiKeyRepository.findByKeyHash(hash);
        if (opt.isEmpty()) return Optional.empty();

        ApiKey apiKey = opt.get();
        apiKey.setLastUsedAt(LocalDateTime.now());
        apiKeyRepository.save(apiKey);

        return memberRepository.findById(apiKey.getMemberId());
    }

    private Map<String, Object> toMap(ApiKey k) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id",          k.getId());
        m.put("keyPrefix",   k.getKeyPrefix());
        m.put("name",        k.getName());
        m.put("createdAt",   k.getCreatedAt());
        m.put("lastUsedAt",  k.getLastUsedAt());
        return m;
    }

    private static String randomHex(int length) {
        byte[] bytes = new byte[length / 2];
        SECURE_RANDOM.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(length);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String sha256Hex(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
