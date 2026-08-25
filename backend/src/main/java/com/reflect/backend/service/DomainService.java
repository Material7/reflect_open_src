package com.reflect.backend.service;

import com.reflect.backend.entity.Domain;
import com.reflect.backend.entity.DomainGroup;
import com.reflect.backend.entity.Member;
import com.reflect.backend.repository.DomainRepository;
import com.reflect.backend.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
public class DomainService {

    private final DomainRepository domainRepository;
    private final MemberRepository memberRepository;

    public List<Domain> findAll() {
        return domainRepository.findAll();
    }

    public Domain findById(String id) {
        return domainRepository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("ドメインが見つかりません: " + id));
    }

    /** @PreAuthorize 用: ドメインの所属プロジェクトID（存在しなければ null） */
    public Long projectIdOf(String id) {
        return domainRepository.findById(id).map(Domain::getProjectId).orElse(null);
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    @SuppressWarnings("unchecked")
    public Domain create(Map<String, Object> body) {
        String id   = (String) body.get("id");
        String name = (String) body.get("name");
        if (id == null || id.isBlank())   throw new IllegalArgumentException("id は必須です");
        if (name == null || name.isBlank()) throw new IllegalArgumentException("name は必須です");
        if (domainRepository.existsById(id)) throw new IllegalArgumentException("ドメインIDが既に存在します: " + id);

        Domain d = new Domain();
        d.setId(id);
        d.setName(name);
        applyGroups(d, body);
        return domainRepository.save(d);
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    @SuppressWarnings("unchecked")
    public Domain update(String id, Map<String, Object> body) {
        Domain d = findById(id);
        if (body.get("name") instanceof String name && !name.isBlank()) d.setName(name);
        applyGroups(d, body);
        return domainRepository.save(d);
    }

    @CacheEvict(value = "stats", allEntries = true)
    @Transactional
    public void delete(String id) {
        if (!domainRepository.existsById(id)) throw new NoSuchElementException("ドメインが見つかりません: " + id);
        domainRepository.deleteById(id);
    }

    @SuppressWarnings("unchecked")
    private void applyGroups(Domain domain, Map<String, Object> body) {
        if (!(body.get("groups") instanceof List<?> rawGroups)) return;

        Map<String, Long> oldLeaders = new HashMap<>();
        for (DomainGroup g : domain.getGroups()) {
            if (g.getId() != null && g.getLeaderId() != null) {
                oldLeaders.put(g.getId(), g.getLeaderId());
            }
        }

        domain.getGroups().clear();

        Map<String, Long> newLeaders = new HashMap<>();
        for (Object rawG : rawGroups) {
            Map<String, Object> gm = (Map<String, Object>) rawG;
            DomainGroup g = new DomainGroup();
            g.setId((String) gm.get("id"));
            g.setName((String) gm.get("name"));
            if (gm.get("leaderId") instanceof Number lid) {
                g.setLeaderId(lid.longValue());
                if (g.getId() != null) newLeaders.put(g.getId(), lid.longValue());
            }
            g.setDomain(domain);
            domain.getGroups().add(g);
        }

        // 削除されたグループ or リーダー変更 → 旧リーダーからグループIDを除去
        for (Map.Entry<String, Long> e : oldLeaders.entrySet()) {
            String gid = e.getKey();
            Long oldLeaderId = e.getValue();
            if (!Objects.equals(newLeaders.get(gid), oldLeaderId)) {
                memberRepository.findById(oldLeaderId).ifPresent(m -> {
                    m.getDomainGroupIds().remove(gid);
                    memberRepository.save(m);
                });
            }
        }

        // 新規グループ or リーダー変更 → 新リーダーにグループIDを追加
        for (Map.Entry<String, Long> e : newLeaders.entrySet()) {
            String gid = e.getKey();
            Long newLeaderId = e.getValue();
            if (!Objects.equals(oldLeaders.get(gid), newLeaderId)) {
                memberRepository.findById(newLeaderId).ifPresent(m -> {
                    if (!m.getDomainGroupIds().contains(gid)) {
                        m.getDomainGroupIds().add(gid);
                        memberRepository.save(m);
                    }
                });
            }
        }
    }
}
