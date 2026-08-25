package com.reflect.backend.service;

import com.reflect.backend.entity.Member;
import com.reflect.backend.entity.ProjectMember;
import com.reflect.backend.entity.ProjectSettings;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.repository.ProjectMemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * プロジェクト別の認可判定。@PreAuthorize から呼び出す。
 * - システムロール(Admin)は全プロジェクトに対して許可。
 * - それ以外は ProjectMember のプロジェクト別ロールで判定。
 */
@Service("projectAuth")
@RequiredArgsConstructor
public class ProjectAuthService {

    private final MemberRepository memberRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final SettingsService settingsService;
    private final GlobalSettingsService globalSettingsService;

    public boolean isSystemAdmin(Authentication auth) {
        return systemRole(auth).equals("Admin");
    }

    /** 当該プロジェクトでのロールが roles のいずれかに一致するか（システム Admin は常に true） */
    public boolean hasProjectRole(Authentication auth, Long projectId, String... roles) {
        if (auth == null || projectId == null) return false;
        if (isSystemAdmin(auth)) return true;
        String role = projectRole(auth, projectId);
        if (role == null) return false;
        for (String r : roles) {
            if (r.equals(role)) return true;
        }
        return false;
    }

    /** 当該プロジェクトの何らかのメンバーか（システム Admin は常に true） */
    public boolean isMember(Authentication auth, Long projectId) {
        if (auth == null || projectId == null) return false;
        if (isSystemAdmin(auth)) return true;
        return projectRole(auth, projectId) != null;
    }

    /** taskDeleteRoles 設定値に基づく削除権限 */
    public boolean canDeleteTask(Authentication auth, Long projectId) {
        if (auth == null || projectId == null) return false;
        if (isSystemAdmin(auth)) return true;
        String role = projectRole(auth, projectId);
        if (role == null) return false;
        ProjectSettings s = settingsService.getProjectSettings(projectId);
        List<String> allowed = s.getTaskDeleteRoles();
        return allowed != null && allowed.contains(role);
    }

    /** actionItemDeleteRoles 設定値に基づくアクションアイテム削除権限 */
    public boolean canDeleteActionItem(Authentication auth, Long projectId) {
        if (auth == null || projectId == null) return false;
        if (isSystemAdmin(auth)) return true;
        String role = projectRole(auth, projectId);
        if (role == null) return false;
        ProjectSettings s = settingsService.getProjectSettings(projectId);
        List<String> allowed = s.getActionItemDeleteRoles();
        return allowed != null && allowed.contains(role);
    }

    /** changeLogViewRoles（全社共通設定）に基づく閲覧権限 */
    public boolean canViewChangeLogs(Authentication auth, Long projectId) {
        if (auth == null || projectId == null) return false;
        if (isSystemAdmin(auth)) return true;
        // プロジェクトの所属メンバーであることが前提。ロールは全社共通の閲覧ロールで判定
        String role = projectRole(auth, projectId);
        if (role == null) return false;
        List<String> allowed = globalSettingsService.get().getChangeLogViewRoles();
        return allowed != null && allowed.contains(role);
    }

    /**
     * 認証ユーザーが閲覧可能なプロジェクトIDの集合。
     * システム Admin は全件可のため null を返す（呼び出し側はフィルタをスキップ）。
     */
    public Set<Long> visibleProjectIds(Authentication auth) {
        if (auth == null) return Set.of();
        if (isSystemAdmin(auth)) return null; // null = 全プロジェクト可
        Member member = memberRepository.findByEmployeeNumber(auth.getName()).orElse(null);
        if (member == null) return Set.of();
        return projectMemberRepository.findByMemberId(member.getId()).stream()
                .map(ProjectMember::getProjectId)
                .collect(java.util.stream.Collectors.toSet());
    }

    /** 認証主体のプロジェクト別ロール。所属していなければ null */
    public String projectRole(Authentication auth, Long projectId) {
        if (auth == null || projectId == null) return null;
        Optional<Member> member = memberRepository.findByEmployeeNumber(auth.getName());
        if (member.isEmpty()) return null;
        return projectMemberRepository
                .findByProjectIdAndMemberId(projectId, member.get().getId())
                .map(ProjectMember::getRole)
                .orElse(null);
    }

    private String systemRole(Authentication auth) {
        if (auth == null) return "";
        return auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(a -> a.startsWith("ROLE_"))
                .map(a -> a.substring(5))
                .findFirst().orElse("");
    }
}
