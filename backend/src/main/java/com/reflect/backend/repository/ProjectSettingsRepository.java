package com.reflect.backend.repository;

import com.reflect.backend.entity.ProjectSettings;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;

public interface ProjectSettingsRepository extends JpaRepository<ProjectSettings, Long> {

    /** allocate-id の排他制御用：行ロックを取得して読み込む */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM ProjectSettings s WHERE s.projectId = :projectId")
    Optional<ProjectSettings> findByProjectIdForUpdate(Long projectId);
}
