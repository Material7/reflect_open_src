package com.reflect.backend.controller;

import com.reflect.backend.entity.ActionItem;
import com.reflect.backend.service.ActionItemService;
import com.reflect.backend.service.ProjectAuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/action-items")
@RequiredArgsConstructor
public class ActionItemController {

    private final ActionItemService service;
    private final ProjectAuthService projectAuth;

    @GetMapping
    public ResponseEntity<List<ActionItem>> list(@RequestParam(required = false) Long projectId, Authentication auth) {
        List<ActionItem> items = service.findAll(projectId);
        Set<Long> visible = projectAuth.visibleProjectIds(auth);
        if (visible != null) {
            items = items.stream().filter(it -> visible.contains(it.getProjectId())).toList();
        }
        return ResponseEntity.ok(items);
    }

    @PostMapping
    @PreAuthorize("@projectAuth.hasProjectRole(authentication, #item.projectId, 'Admin','PM','PL','DL','SL','Member')")
    public ResponseEntity<ActionItem> create(@RequestBody ActionItem item, Authentication auth) {
        return ResponseEntity.ok(service.create(item, auth.getName()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("@projectAuth.hasProjectRole(authentication, @actionItemService.projectIdOf(#id), 'Admin','PM','PL','DL','SL','Member')")
    public ResponseEntity<ActionItem> update(@PathVariable String id, @RequestBody ActionItem item) {
        return ResponseEntity.ok(service.update(id, item));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@projectAuth.canDeleteActionItem(authentication, @actionItemService.projectIdOf(#id))")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
