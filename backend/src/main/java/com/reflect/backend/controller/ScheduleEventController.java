package com.reflect.backend.controller;

import com.reflect.backend.entity.ScheduleEvent;
import com.reflect.backend.service.ProjectAuthService;
import com.reflect.backend.service.ScheduleEventService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/schedule-events")
@RequiredArgsConstructor
public class ScheduleEventController {

    private final ScheduleEventService service;
    private final ProjectAuthService projectAuth;

    @GetMapping
    public ResponseEntity<List<ScheduleEvent>> list(@RequestParam(required = false) Long projectId, Authentication auth) {
        List<ScheduleEvent> events = service.findAll(projectId);
        Set<Long> visible = projectAuth.visibleProjectIds(auth);
        if (visible != null) {
            events = events.stream().filter(e -> visible.contains(e.getProjectId())).toList();
        }
        return ResponseEntity.ok(events);
    }

    @PostMapping
    @PreAuthorize("@projectAuth.hasProjectRole(authentication, #event.projectId, 'Admin','PM','PL')")
    public ResponseEntity<ScheduleEvent> create(@RequestBody ScheduleEvent event, Authentication auth) {
        return ResponseEntity.ok(service.create(event, auth.getName()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("@projectAuth.hasProjectRole(authentication, @scheduleEventService.projectIdOf(#id), 'Admin','PM','PL')")
    public ResponseEntity<ScheduleEvent> update(@PathVariable String id, @RequestBody ScheduleEvent event) {
        return ResponseEntity.ok(service.update(id, event));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@projectAuth.hasProjectRole(authentication, @scheduleEventService.projectIdOf(#id), 'Admin','PM','PL')")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
