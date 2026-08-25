package com.reflect.backend.repository;

import com.reflect.backend.entity.TaskChangeLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;

public interface TaskChangeLogRepository
        extends JpaRepository<TaskChangeLog, String>,
                JpaSpecificationExecutor<TaskChangeLog> {

    List<TaskChangeLog> findByTaskIdOrderByChangedAtDesc(String taskId);

    List<TaskChangeLog> findByTaskDisplayIdOrderByChangedAtDesc(String taskDisplayId);

    List<TaskChangeLog> findByProjectIdOrderByChangedAtDesc(Long projectId);
}
