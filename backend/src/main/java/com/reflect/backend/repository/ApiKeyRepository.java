package com.reflect.backend.repository;

import com.reflect.backend.entity.ApiKey;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ApiKeyRepository extends JpaRepository<ApiKey, String> {

    List<ApiKey> findByMemberIdOrderByCreatedAtDesc(Long memberId);

    Optional<ApiKey> findByKeyHash(String keyHash);
}
