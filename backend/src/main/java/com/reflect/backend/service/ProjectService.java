package com.reflect.backend.service;

import com.reflect.backend.entity.Member;
import com.reflect.backend.entity.Project;
import com.reflect.backend.entity.ProjectMember;
import com.reflect.backend.entity.ProjectSettings;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.repository.ProjectMemberRepository;
import com.reflect.backend.repository.ProjectRepository;
import com.reflect.backend.repository.ProjectSettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectSettingsRepository settingsRepository;
    private final MemberRepository memberRepository;

    /** システム Admin は全件、それ以外は所属プロジェクトのみ */
    @Transactional(readOnly = true)
    public List<Project> listVisible(String employeeNumber, boolean systemAdmin) {
        if (systemAdmin) {
            return projectRepository.findAll();
        }
        Member member = memberRepository.findByEmployeeNumber(employeeNumber).orElse(null);
        if (member == null) return List.of();
        Set<Long> projectIds = new HashSet<>();
        for (ProjectMember pm : projectMemberRepository.findByMemberId(member.getId())) {
            projectIds.add(pm.getProjectId());
        }
        return projectRepository.findAllById(projectIds);
    }

    @Transactional
    public Project create(String code, String name, String creatorEmployeeNumber) {
        if (code == null || code.isBlank()) throw new IllegalArgumentException("code は必須です");
        if (name == null || name.isBlank()) throw new IllegalArgumentException("name は必須です");
        if (projectRepository.existsByCode(code))
            throw new IllegalArgumentException("プロジェクトコードが既に存在します: " + code);

        Project p = new Project();
        p.setCode(code);
        p.setName(name);
        p.setStatus("active");
        p.setCreatedAt(LocalDateTime.now());
        Project saved = projectRepository.save(p);

        initDefaultSettings(saved.getId());

        // 作成者を PM として所属させる（システム Admin は所属に関わらず全権のため PJ 級 Admin は使わない）
        memberRepository.findByEmployeeNumber(creatorEmployeeNumber).ifPresent(m -> {
            ProjectMember pm = new ProjectMember();
            pm.setProjectId(saved.getId());
            pm.setMemberId(m.getId());
            pm.setRole("PM");
            projectMemberRepository.save(pm);
        });
        return saved;
    }

    @Transactional
    public Project update(Long id, String name, String status) {
        Project p = projectRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("プロジェクトが見つかりません: " + id));
        if (name != null && !name.isBlank()) p.setName(name);
        if (status != null && !status.isBlank()) p.setStatus(status);
        return projectRepository.save(p);
    }

    private void initDefaultSettings(Long projectId) {
        ProjectSettings s = new ProjectSettings();
        s.setProjectId(projectId);
        s.setTaskIdPrefix("TASK");
        s.setTaskIdCounterR(1);
        s.setTaskIdCounterD(1);
        s.setSkippedPhases(List.of());
        s.setWorkflows(List.of("未着手", "作成中", "レビュー中", "承認済", "完了"));
        settingsRepository.save(s);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listMembers(Long projectId) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (ProjectMember pm : projectMemberRepository.findByProjectId(projectId)) {
            Member m = memberRepository.findById(pm.getMemberId()).orElse(null);
            if (m == null) continue;
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("id", pm.getId());
            map.put("projectId", pm.getProjectId());
            map.put("memberId", m.getId());
            map.put("employeeNumber", m.getEmployeeNumber());
            map.put("name", m.getName());
            map.put("role", pm.getRole());
            map.put("domainGroupIds", pm.getDomainGroupIds());
            result.add(map);
        }
        return result;
    }

    @Transactional
    @SuppressWarnings("unchecked")
    public Map<String, Object> upsertMember(Long projectId, Map<String, Object> body) {
        Long memberId = body.get("memberId") instanceof Number n ? n.longValue() : null;
        String empNo = (String) body.get("employeeNumber");
        Member member;
        if (memberId != null) {
            member = memberRepository.findById(memberId)
                    .orElseThrow(() -> new NoSuchElementException("メンバーが見つかりません: " + memberId));
        } else if (empNo != null) {
            member = memberRepository.findByEmployeeNumber(empNo)
                    .orElseThrow(() -> new NoSuchElementException("メンバーが見つかりません: " + empNo));
        } else {
            throw new IllegalArgumentException("memberId または employeeNumber が必要です");
        }

        ProjectMember pm = projectMemberRepository
                .findByProjectIdAndMemberId(projectId, member.getId())
                .orElseGet(() -> {
                    ProjectMember np = new ProjectMember();
                    np.setProjectId(projectId);
                    np.setMemberId(member.getId());
                    return np;
                });
        if (body.get("role") instanceof String role) pm.setRole(role);
        if (pm.getRole() == null) pm.setRole("Member");
        if (body.get("domainGroupIds") instanceof List<?> ids)
            pm.setDomainGroupIds((List<String>) ids);
        projectMemberRepository.save(pm);

        Map<String, Object> map = new LinkedHashMap<>();
        map.put("id", pm.getId());
        map.put("projectId", projectId);
        map.put("memberId", member.getId());
        map.put("employeeNumber", member.getEmployeeNumber());
        map.put("name", member.getName());
        map.put("role", pm.getRole());
        map.put("domainGroupIds", pm.getDomainGroupIds());
        return map;
    }

    @Transactional
    public void removeMember(Long projectId, Long memberId) {
        projectMemberRepository.deleteByProjectIdAndMemberId(projectId, memberId);
    }
}
