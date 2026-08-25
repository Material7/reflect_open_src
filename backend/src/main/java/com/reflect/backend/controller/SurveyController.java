package com.reflect.backend.controller;

import com.reflect.backend.dto.response.SurveyDto;
import com.reflect.backend.dto.response.SurveyResultsDto;
import com.reflect.backend.entity.Survey;
import com.reflect.backend.entity.SurveyResponse;
import com.reflect.backend.service.SurveyService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/surveys")
@RequiredArgsConstructor
public class SurveyController {

    private final SurveyService service;

    @GetMapping
    public ResponseEntity<List<SurveyDto>> list(@RequestParam(required = false) Long projectId,
                                                Authentication auth) {
        return ResponseEntity.ok(service.findAll(projectId, auth));
    }

    @GetMapping("/{id}")
    @PreAuthorize("@surveyService.canAccess(#id, authentication)")
    public ResponseEntity<SurveyDto> get(@PathVariable String id, Authentication auth) {
        return ResponseEntity.ok(service.getDto(id, auth));
    }

    // 作成: 全社/横断アンケート(projectId=null)は認証済みなら誰でも、PJ別はそのPJのメンバーのみ。
    // 編集・締切・削除などの管理は作成者＋システムAdminのみ（canManage で制御）。
    @PostMapping
    @PreAuthorize("@surveyService.canCreate(#survey, authentication)")
    public ResponseEntity<SurveyDto> create(@RequestBody Survey survey, Authentication auth) {
        return ResponseEntity.ok(service.create(survey, auth));
    }

    @PutMapping("/{id}")
    @PreAuthorize("@surveyService.canManage(#id, authentication)")
    public ResponseEntity<SurveyDto> update(@PathVariable String id, @RequestBody Survey survey, Authentication auth) {
        return ResponseEntity.ok(service.update(id, survey, auth));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@surveyService.canManage(#id, authentication)")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/responses")
    @PreAuthorize("@surveyService.canAccess(#id, authentication)")
    public ResponseEntity<SurveyResponse> submit(@PathVariable String id,
                                                 @RequestBody Map<String, Object> answers,
                                                 Authentication auth) {
        return ResponseEntity.ok(service.submitResponse(id, answers, auth));
    }

    @GetMapping("/{id}/responses/me")
    @PreAuthorize("@surveyService.canAccess(#id, authentication)")
    public ResponseEntity<SurveyResponse> myResponse(@PathVariable String id, Authentication auth) {
        return ResponseEntity.ok(service.getMyResponse(id, auth));
    }

    @GetMapping("/{id}/results")
    @PreAuthorize("@surveyService.canAccess(#id, authentication)")
    public ResponseEntity<SurveyResultsDto> results(@PathVariable String id, Authentication auth) {
        return ResponseEntity.ok(service.getResults(id, auth));
    }
}
