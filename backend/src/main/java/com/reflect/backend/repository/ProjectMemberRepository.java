package com.reflect.backend.repository;

import com.reflect.backend.entity.ProjectMember;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, Long> {
    List<ProjectMember> findByProjectId(Long projectId);
    List<ProjectMember> findByMemberId(Long memberId);
    Optional<ProjectMember> findByProjectIdAndMemberId(Long projectId, Long memberId);
    void deleteByProjectId(Long projectId);
    void deleteByProjectIdAndMemberId(Long projectId, Long memberId);
}
