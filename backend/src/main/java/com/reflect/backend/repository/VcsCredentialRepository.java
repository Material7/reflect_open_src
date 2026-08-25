package com.reflect.backend.repository;

import com.reflect.backend.entity.VcsCredential;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface VcsCredentialRepository extends JpaRepository<VcsCredential, String> {
    List<VcsCredential> findByMemberIdOrderByTypeAscHostAsc(Long memberId);
    Optional<VcsCredential> findByMemberIdAndTypeAndHost(Long memberId, String type, String host);
    Optional<VcsCredential> findByIdAndMemberId(String id, Long memberId);
}
