package com.reflect.backend.controller;

import com.reflect.backend.service.ProjectAuthService;
import com.reflect.backend.service.StatsScope;
import com.reflect.backend.service.StatsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 統計 API。projectId を指定する場合は所属プロジェクトに限る（@PreAuthorize）。
 * 省略時は横断集計だが、参照可能なプロジェクトだけを対象にする（StatsScope）。
 */
@RestController
@RequestMapping("/api/stats")
@RequiredArgsConstructor
public class StatsController {

    /** projectId 指定時は所属必須。未指定（横断集計）は可視プロジェクトで絞るため誰でも可 */
    private static final String SCOPE_ALLOWED =
            "#projectId == null or @projectAuth.isMember(authentication, #projectId)";

    private final StatsService statsService;
    private final ProjectAuthService projectAuth;

    private StatsScope scope(Long projectId, Authentication auth) {
        return projectId != null
                ? StatsScope.ofProject(projectId)
                : StatsScope.ofVisible(projectAuth.visibleProjectIds(auth));
    }

    @GetMapping("/summary")
    @PreAuthorize(SCOPE_ALLOWED)
    public ResponseEntity<Map<String, Object>> summary(@RequestParam(required = false) Long projectId,
                                                       Authentication auth) {
        return ResponseEntity.ok(statsService.getSummary(scope(projectId, auth)));
    }

    @GetMapping("/phase-progress")
    @PreAuthorize(SCOPE_ALLOWED)
    public ResponseEntity<List<Map<String, Object>>> phaseProgress(@RequestParam(required = false) Long projectId,
                                                                   Authentication auth) {
        return ResponseEntity.ok(statsService.getPhaseProgress(scope(projectId, auth)));
    }

    @GetMapping("/by-domain")
    @PreAuthorize(SCOPE_ALLOWED)
    public ResponseEntity<List<Map<String, Object>>> byDomain(@RequestParam(required = false) Long projectId,
                                                              Authentication auth) {
        return ResponseEntity.ok(statsService.getByDomain(scope(projectId, auth)));
    }

    @GetMapping("/by-member")
    @PreAuthorize(SCOPE_ALLOWED)
    public ResponseEntity<List<Map<String, Object>>> byMember(@RequestParam(required = false) Long projectId,
                                                              Authentication auth) {
        return ResponseEntity.ok(statsService.getByMember(scope(projectId, auth)));
    }

    @GetMapping("/man-hours")
    @PreAuthorize(SCOPE_ALLOWED)
    public ResponseEntity<List<Map<String, Object>>> manHours(@RequestParam(required = false) Long projectId,
                                                              Authentication auth) {
        return ResponseEntity.ok(statsService.getManHours(scope(projectId, auth)));
    }

    @GetMapping("/alerts")
    @PreAuthorize(SCOPE_ALLOWED)
    public ResponseEntity<List<Map<String, Object>>> alerts(@RequestParam(required = false) Long projectId,
                                                            Authentication auth) {
        return ResponseEntity.ok(statsService.getAlerts(scope(projectId, auth)));
    }
}
