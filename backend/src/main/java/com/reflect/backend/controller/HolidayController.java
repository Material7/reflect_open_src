package com.reflect.backend.controller;

import com.reflect.backend.entity.Holiday;
import com.reflect.backend.service.HolidayService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/holidays")
@RequiredArgsConstructor
public class HolidayController {

    private final HolidayService holidayService;

    @GetMapping
    public ResponseEntity<List<Holiday>> list() {
        return ResponseEntity.ok(holidayService.findAll());
    }

    @PostMapping
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<Holiday> create(@RequestBody Holiday holiday) {
        return ResponseEntity.ok(holidayService.create(holiday));
    }

    @PostMapping("/batch")
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<List<Holiday>> batchCreate(@RequestBody List<Holiday> holidays) {
        return ResponseEntity.ok(holidayService.batchCreate(holidays));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('Admin')")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        holidayService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
