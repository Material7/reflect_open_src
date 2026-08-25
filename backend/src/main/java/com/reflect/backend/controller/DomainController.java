package com.reflect.backend.controller;

import com.reflect.backend.entity.Domain;
import com.reflect.backend.service.DomainService;
import com.reflect.backend.service.ProjectAuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/domains")
@RequiredArgsConstructor
public class DomainController {

    private final DomainService domainService;
    private final ProjectAuthService projectAuth;

    @GetMapping
    public ResponseEntity<List<Domain>> list(Authentication auth) {
        List<Domain> domains = domainService.findAll();
        // 所属していないプロジェクトのドメインは返さない（システム Admin は全件）
        Set<Long> visible = projectAuth.visibleProjectIds(auth);
        if (visible != null) {
            domains = domains.stream().filter(d -> visible.contains(d.getProjectId())).toList();
        }
        return ResponseEntity.ok(domains);
    }

    @GetMapping("/{id}")
    @PreAuthorize("@projectAuth.isMember(authentication, @domainService.projectIdOf(#id))")
    public ResponseEntity<Domain> get(@PathVariable String id) {
        return ResponseEntity.ok(domainService.findById(id));
    }

    @PostMapping
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<Domain> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(domainService.create(body));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<Domain> update(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(domainService.update(id, body));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        domainService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
