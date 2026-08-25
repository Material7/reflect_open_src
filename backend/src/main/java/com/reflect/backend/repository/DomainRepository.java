package com.reflect.backend.repository;

import com.reflect.backend.entity.Domain;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DomainRepository extends JpaRepository<Domain, String> {
    List<Domain> findByProjectId(Long projectId);
    void deleteByProjectId(Long projectId);
}
