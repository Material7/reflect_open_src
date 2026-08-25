package com.reflect.backend.repository;

import com.reflect.backend.entity.TaskComment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TaskCommentRepository extends JpaRepository<TaskComment, String> {
    List<TaskComment> findAllByOrderByCreatedAtAsc();
    List<TaskComment> findByProjectIdOrderByCreatedAtAsc(Long projectId);
    List<TaskComment> findByTaskIdOrderByCreatedAtAsc(String taskId);
}
