package com.reflect.backend.controller;

import com.reflect.backend.entity.Member;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.service.VcsCredentialService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * マイページの VCS（SVN/Git）認証情報管理。サーバー（ホスト）単位で複数登録できる。
 */
@RestController
@RequestMapping("/api/auth/me/vcs-credentials")
@RequiredArgsConstructor
public class VcsCredentialController {

    private final VcsCredentialService service;
    private final MemberRepository memberRepository;

    private Long memberId(String employeeNumber) {
        return memberRepository.findByEmployeeNumber(employeeNumber)
                .map(Member::getId)
                .orElseThrow(() -> new IllegalArgumentException("ユーザーが見つかりません"));
    }

    @GetMapping
    public List<Map<String, Object>> list(@AuthenticationPrincipal String employeeNumber) {
        return service.list(memberId(employeeNumber));
    }

    /** 作成・更新（id があれば更新、なければ type+host で upsert） */
    @PostMapping
    public Map<String, Object> save(@AuthenticationPrincipal String employeeNumber,
                                    @RequestBody Map<String, String> body) {
        return service.save(memberId(employeeNumber),
                body.get("id"), body.get("type"), body.get("host"),
                body.get("username"), body.get("password"));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal String employeeNumber,
                                       @PathVariable String id) {
        service.delete(memberId(employeeNumber), id);
        return ResponseEntity.noContent().build();
    }
}
