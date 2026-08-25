package com.reflect.backend.service;

import com.reflect.backend.dto.request.CreateMemberRequest;
import com.reflect.backend.dto.request.UpdateMemberRequest;
import com.reflect.backend.entity.Member;
import com.reflect.backend.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class MemberService {

    private final MemberRepository memberRepository;
    private final PasswordEncoder passwordEncoder;

    @Transactional(readOnly = true)
    public List<Member> findAll() {
        return memberRepository.findAll();
    }

    /** システムロールは Admin / Member の2値に正規化する（実務ロールはプロジェクト側で管理） */
    private static String normalizeSystemRole(String role) {
        return "Admin".equals(role) ? "Admin" : "Member";
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public Member create(CreateMemberRequest request) {
        if (memberRepository.existsByEmployeeNumber(request.getEmployeeNumber())) {
            throw new IllegalArgumentException("社員番号が既に存在します: " + request.getEmployeeNumber());
        }
        Member member = new Member();
        member.setEmployeeNumber(request.getEmployeeNumber());
        member.setName(request.getName());
        member.setRole(normalizeSystemRole(request.getRole()));
        member.setDomainGroupIds(request.getDomainGroupIds());
        if (request.getPassword() != null && !request.getPassword().isBlank()) {
            member.setPassword(passwordEncoder.encode(request.getPassword()));
        }
        return memberRepository.save(member);
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public Member update(Long id, UpdateMemberRequest request) {
        Member existing = memberRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("メンバーが見つかりません: " + id));
        existing.setName(request.getName());
        existing.setRole(normalizeSystemRole(request.getRole()));
        existing.setDomainGroupIds(request.getDomainGroupIds());
        if (request.getPassword() != null && !request.getPassword().isBlank()) {
            // 空欄は「変更なし」のため許容。値がある場合のみ最低桁数を検証
            if (request.getPassword().length() < 5) {
                throw new IllegalArgumentException("パスワードは5文字以上で入力してください");
            }
            existing.setPassword(passwordEncoder.encode(request.getPassword()));
        }
        return memberRepository.save(existing);
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public void delete(Long id) {
        if (!memberRepository.existsById(id)) {
            throw new IllegalArgumentException("メンバーが見つかりません: " + id);
        }
        memberRepository.deleteById(id);
    }
}
