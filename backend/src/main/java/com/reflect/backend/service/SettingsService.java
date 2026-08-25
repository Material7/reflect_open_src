package com.reflect.backend.service;

import com.reflect.backend.entity.*;
import com.reflect.backend.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Caching;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
public class SettingsService {

    private final ProjectSettingsRepository settingsRepository;
    private final DomainRepository domainRepository;
    private final DeliverableTypeRepository deliverableTypeRepository;

    @Cacheable(value = "project-settings", key = "#projectId")
    public ProjectSettings getProjectSettings(Long projectId) {
        return settingsRepository.findById(projectId)
                .orElseThrow(() -> new IllegalStateException("プロジェクト設定が存在しません: " + projectId));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getAll(Long projectId) {
        return buildAllResponse(projectId);
    }

    @Transactional
    @SuppressWarnings("unchecked")
    // 統計はスキップ工程の設定に依存するため、設定変更時に stats も破棄する
    @Caching(evict = {
            @CacheEvict(value = "project-settings", key = "#projectId"),
            @CacheEvict(value = "stats", allEntries = true)
    })
    public Map<String, Object> saveAll(Long projectId, Map<String, Object> body) {
        ProjectSettings s = settingsRepository.findById(projectId).orElseGet(() -> {
            ProjectSettings ns = new ProjectSettings();
            ns.setProjectId(projectId);
            return ns;
        });
        if (body.get("taskIdPrefix") instanceof String v) s.setTaskIdPrefix(v);
        if (body.get("taskIdCounterR") instanceof Number v) s.setTaskIdCounterR(v.intValue());
        if (body.get("taskIdCounterD") instanceof Number v) s.setTaskIdCounterD(v.intValue());
        // taskStatuses は全社共通設定(GlobalSettings)へ移管。ここでは扱わない
        if (body.get("skippedPhases") instanceof List<?> v) s.setSkippedPhases((List<String>) v);
        if (body.get("workflows") instanceof List<?> v) s.setWorkflows((List<String>) v);
        if (body.get("actionItemCategories") instanceof List<?> v) s.setActionItemCategories((List<String>) v);
        if (body.get("tags") instanceof List<?> v) s.setTags((List<String>) v);
        if (body.get("actionItemDeleteRoles") instanceof List<?> v) s.setActionItemDeleteRoles((List<String>) v);
        if (body.get("taskDeleteRoles") instanceof List<?> v) s.setTaskDeleteRoles((List<String>) v);
        if (body.get("excludeStepSelectRoles") instanceof List<?> v) s.setExcludeStepSelectRoles((List<String>) v);
        // changeLogViewRoles は全社共通設定(GlobalSettings)へ移管。ここでは扱わない
        settingsRepository.save(s);

        if (body.get("domains") instanceof List<?> rawDomains) {
            domainRepository.deleteByProjectId(projectId);
            List<Domain> domains = new ArrayList<>();
            for (Object rawD : rawDomains) {
                if (!(rawD instanceof Map<?, ?> rawDMap)) continue;
                Map<String, Object> dm = (Map<String, Object>) rawDMap;
                Domain d = new Domain();
                d.setId((String) dm.get("id"));
                d.setProjectId(projectId);
                d.setName((String) dm.get("name"));
                if (dm.get("groups") instanceof List<?> rawGroups) {
                    for (Object rawG : rawGroups) {
                        if (!(rawG instanceof Map<?, ?> rawGMap)) continue;
                        Map<String, Object> gm = (Map<String, Object>) rawGMap;
                        DomainGroup g = new DomainGroup();
                        g.setId((String) gm.get("id"));
                        g.setName((String) gm.get("name"));
                        if (gm.get("leaderId") instanceof Number lid) g.setLeaderId(lid.longValue());
                        g.setDomain(d);
                        d.getGroups().add(g);
                    }
                }
                domains.add(d);
            }
            domainRepository.saveAll(domains);
        }

        if (body.get("deliverableTypes") instanceof List<?> rawTypes) {
            deliverableTypeRepository.deleteByProjectId(projectId);
            List<DeliverableType> types = new ArrayList<>();
            for (Object rawT : rawTypes) {
                Map<String, Object> tm = (Map<String, Object>) rawT;
                DeliverableType dt = new DeliverableType();
                dt.setId((String) tm.get("id"));
                dt.setProjectId(projectId);
                dt.setName((String) tm.get("name"));
                dt.setPhaseCode((String) tm.get("phaseCode"));
                if (tm.get("required") instanceof Boolean req) dt.setRequired(req);
                if (tm.get("vcsType") instanceof String vcs) dt.setVcsType(vcs);
                if (tm.get("workflowSettings") instanceof List<?> rawWfs) {
                    for (Object rawWf : rawWfs) {
                        Map<String, Object> wm = (Map<String, Object>) rawWf;
                        WorkflowSetting ws = new WorkflowSetting();
                        ws.setWorkflowName((String) wm.get("workflowName"));
                        if (wm.get("allowedRoles") instanceof List<?> roles)
                            ws.setAllowedRoles((List<String>) roles);
                        ws.setDeliverableType(dt);
                        dt.getWorkflowSettings().add(ws);
                    }
                }
                types.add(dt);
            }
            deliverableTypeRepository.saveAll(types);
        }

        return buildAllResponse(projectId);
    }

    private Map<String, Object> buildAllResponse(Long projectId) {
        ProjectSettings s = settingsRepository.findById(projectId)
                .orElseThrow(() -> new IllegalStateException("プロジェクト設定が存在しません: " + projectId));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("projectId", s.getProjectId());
        result.put("taskIdPrefix", s.getTaskIdPrefix());
        result.put("taskIdCounterR", s.getTaskIdCounterR());
        result.put("taskIdCounterD", s.getTaskIdCounterD());
        result.put("skippedPhases", s.getSkippedPhases());
        result.put("workflows", s.getWorkflows());
        result.put("actionItemCategories", s.getActionItemCategories());
        result.put("tags", s.getTags());
        result.put("actionItemDeleteRoles", s.getActionItemDeleteRoles());
        result.put("taskDeleteRoles", s.getTaskDeleteRoles());
        result.put("excludeStepSelectRoles", s.getExcludeStepSelectRoles());
        result.put("domains", domainRepository.findByProjectId(projectId));
        result.put("deliverableTypes", deliverableTypeRepository.findByProjectId(projectId));
        return result;
    }
}
