package com.reflect.backend.controller;

import com.reflect.backend.entity.Member;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.service.GitService;
import com.reflect.backend.service.VcsCredentialService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/git")
@RequiredArgsConstructor
public class GitController {

    private final GitService gitService;
    private final MemberRepository memberRepository;
    private final VcsCredentialService vcsCredentialService;

    @GetMapping("/logs")
    public ResponseEntity<List<Map<String, Object>>> getLogs(
            @RequestParam String url,
            @RequestParam(required = false) String branch,
            @AuthenticationPrincipal String employeeNumber) {
        if (url.isBlank()) throw new IllegalArgumentException("url は必須です");

        Member member = memberRepository.findByEmployeeNumber(employeeNumber).orElse(null);
        String username = null, password = null;
        if (member != null) {
            Optional<VcsCredentialService.Resolved> cred =
                    vcsCredentialService.resolve(member.getId(), "GIT", url);
            if (cred.isPresent()) {
                username = cred.get().username();
                password = cred.get().password();
            }
        }

        try {
            return ResponseEntity.ok(gitService.getLogs(url, username, password, branch));
        } catch (IllegalStateException e) {
            throw new IllegalArgumentException(e.getMessage());
        }
    }

    @GetMapping("/branches")
    public ResponseEntity<List<String>> getBranches(
            @RequestParam String url,
            @AuthenticationPrincipal String employeeNumber) {
        if (url.isBlank()) throw new IllegalArgumentException("url は必須です");

        Member member = memberRepository.findByEmployeeNumber(employeeNumber).orElse(null);
        String username = null, password = null;
        if (member != null) {
            Optional<VcsCredentialService.Resolved> cred =
                    vcsCredentialService.resolve(member.getId(), "GIT", url);
            if (cred.isPresent()) {
                username = cred.get().username();
                password = cred.get().password();
            }
        }

        try {
            return ResponseEntity.ok(gitService.listBranches(url, username, password));
        } catch (IllegalStateException e) {
            throw new IllegalArgumentException(e.getMessage());
        }
    }
}
