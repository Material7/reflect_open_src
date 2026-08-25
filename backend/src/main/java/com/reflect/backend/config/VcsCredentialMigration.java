package com.reflect.backend.config;

import com.reflect.backend.entity.Member;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.service.VcsCredentialService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 旧 Member の SVN/Git 単一認証情報を VcsCredential（host="" の既定）へ一度だけ移行する。
 * 移行後は Member 側の項目を null 化するため、再起動しても二重移行されない（冪等）。
 */
@Slf4j
@Component
@Order(20)
@RequiredArgsConstructor
public class VcsCredentialMigration implements CommandLineRunner {

    private final MemberRepository memberRepository;
    private final VcsCredentialService vcsCredentialService;

    @Override
    @Transactional
    public void run(String... args) {
        List<Member> members = memberRepository.findAll();
        int migrated = 0;
        for (Member m : members) {
            boolean changed = false;
            if (m.getSvnUsername() != null && !m.getSvnUsername().isBlank()) {
                vcsCredentialService.migrateDefault(m.getId(), "SVN", m.getSvnUsername(), m.getSvnPasswordEnc());
                m.setSvnUsername(null);
                m.setSvnPasswordEnc(null);
                changed = true; migrated++;
            }
            if (m.getGitUsername() != null && !m.getGitUsername().isBlank()) {
                vcsCredentialService.migrateDefault(m.getId(), "GIT", m.getGitUsername(), m.getGitPasswordEnc());
                m.setGitUsername(null);
                m.setGitPasswordEnc(null);
                changed = true; migrated++;
            }
            if (changed) memberRepository.save(m);
        }
        if (migrated > 0) {
            log.info("VCS認証情報を {} 件、ホスト未指定の既定エントリとして移行しました", migrated);
        }
    }
}
