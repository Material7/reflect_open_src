package com.reflect.backend.service;

import com.reflect.backend.dto.request.LoginRequest;
import com.reflect.backend.dto.request.UpdateVcsCredentialsRequest;
import com.reflect.backend.dto.response.LoginResponse;
import com.reflect.backend.entity.Member;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.security.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final MemberRepository memberRepository;
    private final JwtUtil jwtUtil;
    private final PasswordEncoder passwordEncoder;
    private final CredentialEncryptionService credentialEncryptionService;

    @Transactional(readOnly = true)
    public LoginResponse login(LoginRequest request) {
        Member member = memberRepository.findByEmployeeNumber(request.getEmployeeNumber())
                .orElseThrow(() -> new IllegalArgumentException("社員番号またはパスワードが正しくありません"));

        if (!passwordEncoder.matches(request.getPassword(), member.getPassword())) {
            throw new IllegalArgumentException("社員番号またはパスワードが正しくありません");
        }

        String token = jwtUtil.generateToken(member.getEmployeeNumber(), member.getRole());
        return LoginResponse.builder()
                .token(token)
                .employeeNumber(member.getEmployeeNumber())
                .name(member.getName())
                .role(member.getRole())
                .build();
    }

    @Transactional(readOnly = true)
    public LoginResponse me(String employeeNumber) {
        Member member = memberRepository.findByEmployeeNumber(employeeNumber)
                .orElseThrow(() -> new IllegalArgumentException("ユーザーが見つかりません"));
        return LoginResponse.builder()
                .employeeNumber(member.getEmployeeNumber())
                .name(member.getName())
                .role(member.getRole())
                .svnUsername(member.getSvnUsername())
                .svnPasswordSet(member.getSvnPasswordEnc() != null)
                .gitUsername(member.getGitUsername())
                .gitPasswordSet(member.getGitPasswordEnc() != null)
                .build();
    }

    @Transactional
    public void changePassword(String employeeNumber, String currentPassword, String newPassword) {
        Member member = memberRepository.findByEmployeeNumber(employeeNumber)
                .orElseThrow(() -> new IllegalArgumentException("ユーザーが見つかりません"));
        if (!passwordEncoder.matches(currentPassword, member.getPassword())) {
            throw new IllegalArgumentException("現在のパスワードが正しくありません");
        }
        member.setPassword(passwordEncoder.encode(newPassword));
        memberRepository.save(member);
    }

    @Transactional
    public void updateVcsCredentials(String employeeNumber, UpdateVcsCredentialsRequest request) {
        Member member = memberRepository.findByEmployeeNumber(employeeNumber)
                .orElseThrow(() -> new IllegalArgumentException("ユーザーが見つかりません"));

        if (request.getSvnUsername() != null) {
            member.setSvnUsername(request.getSvnUsername().isBlank() ? null : request.getSvnUsername());
        }
        if (request.getSvnPassword() != null) {
            member.setSvnPasswordEnc(request.getSvnPassword().isBlank() ? null
                    : credentialEncryptionService.encrypt(request.getSvnPassword()));
        }
        if (request.getGitUsername() != null) {
            member.setGitUsername(request.getGitUsername().isBlank() ? null : request.getGitUsername());
        }
        if (request.getGitPassword() != null) {
            member.setGitPasswordEnc(request.getGitPassword().isBlank() ? null
                    : credentialEncryptionService.encrypt(request.getGitPassword()));
        }
        memberRepository.save(member);
    }
}
