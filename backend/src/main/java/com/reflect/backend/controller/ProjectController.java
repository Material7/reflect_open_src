package com.reflect.backend.controller;

import com.reflect.backend.entity.Project;
import com.reflect.backend.service.ProjectAuthService;
import com.reflect.backend.service.ProjectService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectService projectService;
    private final ProjectAuthService projectAuth;

    @GetMapping
    public ResponseEntity<List<Project>> list(Authentication auth) {
        return ResponseEntity.ok(
                projectService.listVisible(auth.getName(), projectAuth.isSystemAdmin(auth)));
    }

    @PostMapping
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<Project> create(@RequestBody Map<String, String> body, Authentication auth) {
        return ResponseEntity.ok(
                projectService.create(body.get("code"), body.get("name"), auth.getName()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("@projectAuth.hasProjectRole(authentication, #id, 'Admin', 'PM')")
    public ResponseEntity<Project> update(@PathVariable Long id, @RequestBody Map<String, String> body) {
        return ResponseEntity.ok(projectService.update(id, body.get("name"), body.get("status")));
    }

    @GetMapping("/{id}/members")
    @PreAuthorize("@projectAuth.isMember(authentication, #id)")
    public ResponseEntity<List<Map<String, Object>>> listMembers(@PathVariable Long id) {
        return ResponseEntity.ok(projectService.listMembers(id));
    }

    @PostMapping("/{id}/members")
    @PreAuthorize("@projectAuth.hasProjectRole(authentication, #id, 'Admin', 'PM', 'PL')")
    public ResponseEntity<Map<String, Object>> upsertMember(
            @PathVariable Long id, @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(projectService.upsertMember(id, body));
    }

    @DeleteMapping("/{id}/members/{memberId}")
    @PreAuthorize("@projectAuth.hasProjectRole(authentication, #id, 'Admin', 'PM', 'PL')")
    public ResponseEntity<Void> removeMember(@PathVariable Long id, @PathVariable Long memberId) {
        projectService.removeMember(id, memberId);
        return ResponseEntity.noContent().build();
    }
}
