package com.reflect.backend.repository;

import com.reflect.backend.entity.CommentMention;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CommentMentionRepository extends JpaRepository<CommentMention, String> {

    List<CommentMention> findByMentionedEmpOrderByCreatedAtDesc(String mentionedEmp);

    long countByMentionedEmpAndReadAtIsNull(String mentionedEmp);

    List<CommentMention> findByMentionedEmpAndTaskId(String mentionedEmp, String taskId);

    void deleteByCommentId(String commentId);
}
