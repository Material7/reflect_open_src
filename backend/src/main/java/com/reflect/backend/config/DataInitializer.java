package com.reflect.backend.config;

import com.reflect.backend.entity.GlobalSettings;
import com.reflect.backend.entity.Member;
import com.reflect.backend.entity.Project;
import com.reflect.backend.entity.ProjectMember;
import com.reflect.backend.entity.ProjectSettings;
import com.reflect.backend.repository.GlobalSettingsRepository;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.repository.ProjectMemberRepository;
import com.reflect.backend.repository.ProjectRepository;
import com.reflect.backend.repository.ProjectSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.List;

/**
 * アプリ起動時に DB が空の場合だけ初期データを投入する。
 * 生成されたパスワードは起動ログに一度だけ出力される。
 * 本番環境では初回ログイン後に必ずパスワードを変更すること。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

    private final MemberRepository memberRepository;
    private final ProjectSettingsRepository settingsRepository;
    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final GlobalSettingsRepository globalSettingsRepository;
    private final PasswordEncoder passwordEncoder;
    private final TaskStatusCatalog taskStatusCatalog;

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

    @Override
    @Transactional
    public void run(String... args) {
        if (memberRepository.count() > 0) return;

        String adminPass = randomPassword();

        Member admin = initMembers(adminPass);
        Project project = initProject();
        initProjectSettings(project.getId());
        initProjectMembership(project.getId(), admin.getId());
        initGlobalSettings();

        log.warn("========================================================");
        log.warn("  初期パスワード（初回ログイン後に必ず変更してください）");
        log.warn("  admin  : {}", adminPass);
        log.warn("========================================================");
    }

    private String randomPassword() {
        StringBuilder sb = new StringBuilder(12);
        for (int i = 0; i < 12; i++) {
            sb.append(CHARS.charAt(SECURE_RANDOM.nextInt(CHARS.length())));
        }
        return sb.toString();
    }

    private Member initMembers(String adminPass) {
        Member admin = new Member();
        admin.setEmployeeNumber("admin");
        admin.setName("システム管理者");
        admin.setRole("Admin");
        admin.setPassword(passwordEncoder.encode(adminPass));

        return memberRepository.save(admin);
    }

    private Project initProject() {
        Project p = new Project();
        p.setCode("SAMPLE");
        p.setName("サンプルプロジェクト");
        p.setStatus("active");
        p.setCreatedAt(LocalDateTime.now());
        return projectRepository.save(p);
    }

    private void initProjectSettings(Long projectId) {
        ProjectSettings s = new ProjectSettings();
        s.setProjectId(projectId);
        s.setTaskIdPrefix("TASK");
        s.setTaskIdCounterR(1);
        s.setTaskIdCounterD(1);
        s.setSkippedPhases(List.of());
        s.setWorkflows(List.of("未着手", "作成中", "レビュー中", "承認済", "完了"));
        settingsRepository.save(s);
    }

    private void initProjectMembership(Long projectId, Long memberId) {
        ProjectMember pm = new ProjectMember();
        pm.setProjectId(projectId);
        pm.setMemberId(memberId);
        pm.setRole("Admin");
        projectMemberRepository.save(pm);
    }

    private void initGlobalSettings() {
        GlobalSettings g = new GlobalSettings();
        g.setId(1L);
        g.setChangeLogViewRoles(List.of("Admin", "PM", "PL"));
        g.setTaskStatuses(taskStatusCatalog.names());
        globalSettingsRepository.save(g);
    }
}
