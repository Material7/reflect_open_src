package com.reflect.backend.repository;

import com.reflect.backend.entity.Project;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ProjectRepository extends JpaRepository<Project, Long> {
    List<Project> findByStatusOrderByCreatedAtAsc(String status);
    Optional<Project> findByCode(String code);
    boolean existsByCode(String code);
}
