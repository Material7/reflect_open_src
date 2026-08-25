package com.reflect.backend.repository;

import com.reflect.backend.entity.Task;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface TaskRepository extends JpaRepository<Task, String> {
    List<Task> findByTypeOrderByTaskId(String type);
    List<Task> findByProjectIdOrderByTaskId(Long projectId);
    List<Task> findByProjectIdAndTypeOrderByTaskId(Long projectId, String type);
    Optional<Task> findByTaskId(String taskId);
    Optional<Task> findByProjectIdAndTaskId(Long projectId, String taskId);

    /** タスク名の完全一致（大小文字無視）。projectId 指定時はそのプロジェクト内に限定 */
    @Query("SELECT t FROM Task t WHERE LOWER(t.name) = LOWER(:name) AND " +
           "(:projectId IS NULL OR t.projectId = :projectId) ORDER BY t.taskId")
    List<Task> findByNameIgnoreCase(@Param("name") String name, @Param("projectId") Long projectId);

    /** 表示用タスクID（例: TASK-R0001）の完全一致。プロジェクト横断で重複しうるため List で返す */
    @Query("SELECT t FROM Task t WHERE t.taskId = :taskId AND " +
           "(:projectId IS NULL OR t.projectId = :projectId) ORDER BY t.projectId")
    List<Task> findAllByTaskId(@Param("taskId") String taskId, @Param("projectId") Long projectId);

    /** 同一プロジェクト内で、指定タスク以外に同じチケットIDが登録済みか */
    boolean existsByProjectIdAndTicketKeyAndIdNot(Long projectId, String ticketKey, String id);

    @Query("SELECT t FROM Task t WHERE " +
           "(:projectId IS NULL OR t.projectId = :projectId) AND " +
           "(:type     IS NULL OR t.type     = :type)     AND " +
           "(:status   IS NULL OR t.status   = :status)   AND " +
           "(:assignee IS NULL OR t.assignee = :assignee) AND " +
           "(:domainId IS NULL OR t.domainId = :domainId) AND " +
           "(:name     IS NULL OR LOWER(t.name) LIKE LOWER(CONCAT('%', :name, '%'))) " +
           "ORDER BY t.taskId")
    List<Task> search(@Param("projectId") Long projectId,
                      @Param("type")     String type,
                      @Param("status")   String status,
                      @Param("assignee") String assignee,
                      @Param("domainId") String domainId,
                      @Param("name")     String name);
}
