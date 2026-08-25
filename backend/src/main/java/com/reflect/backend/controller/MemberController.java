package com.reflect.backend.controller;

import com.reflect.backend.dto.request.CreateMemberRequest;
import com.reflect.backend.dto.request.UpdateMemberRequest;
import com.reflect.backend.entity.Member;
import com.reflect.backend.service.MemberService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/members")
@RequiredArgsConstructor
public class MemberController {

    private final MemberService memberService;

    @GetMapping
    public ResponseEntity<List<Member>> getMembers() {
        return ResponseEntity.ok(memberService.findAll());
    }

    @PostMapping
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<Member> createMember(@Valid @RequestBody CreateMemberRequest request) {
        return ResponseEntity.ok(memberService.create(request));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<Member> updateMember(
            @PathVariable Long id,
            @Valid @RequestBody UpdateMemberRequest request) {
        return ResponseEntity.ok(memberService.update(id, request));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<Void> deleteMember(@PathVariable Long id) {
        memberService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
