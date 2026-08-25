package com.reflect.backend.service;

import com.reflect.backend.entity.CommentMention;
import com.reflect.backend.entity.Task;
import com.reflect.backend.entity.TaskComment;
import com.reflect.backend.repository.CommentMentionRepository;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.repository.TaskCommentRepository;
import com.reflect.backend.repository.TaskRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
public class TaskCommentService {

    private final TaskCommentRepository repo;
    private final TaskRepository taskRepository;
    private final CommentMentionRepository mentionRepo;
    private final MemberRepository memberRepository;

    /** 本文中のメンション表現 <@社員番号> を抽出するパターン */
    private static final Pattern MENTION_PATTERN = Pattern.compile("<@([^>\\s]+)>");

    public List<TaskComment> findAll(Long projectId) {
        return projectId != null
                ? repo.findByProjectIdOrderByCreatedAtAsc(projectId)
                : repo.findAllByOrderByCreatedAtAsc();
    }

    public List<TaskComment> findByTaskId(String taskId) {
        return repo.findByTaskIdOrderByCreatedAtAsc(taskId);
    }

    @Transactional
    public TaskComment create(String taskId, String content, String createdBy) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new NoSuchElementException("タスクが見つかりません: " + taskId));
        TaskComment c = new TaskComment();
        c.setId(UUID.randomUUID().toString());
        c.setProjectId(task.getProjectId());
        c.setTaskId(taskId);
        c.setContent(content.trim());
        c.setCreatedBy(createdBy);
        c.setCreatedAt(LocalDateTime.now());
        repo.save(c);

        createMentions(c);
        return c;
    }

    /** 本文から <@社員番号> を抽出し、有効なメンバー宛（自分自身を除く）にメンション行を作成 */
    private void createMentions(TaskComment c) {
        Set<String> emps = new LinkedHashSet<>();
        Matcher m = MENTION_PATTERN.matcher(c.getContent());
        while (m.find()) {
            emps.add(m.group(1));
        }
        LocalDateTime now = LocalDateTime.now();
        for (String emp : emps) {
            if (emp.equals(c.getCreatedBy())) continue;               // 自分宛は通知しない
            if (!memberRepository.existsByEmployeeNumber(emp)) continue; // 実在しない社員番号は無視
            CommentMention mention = new CommentMention();
            mention.setId(UUID.randomUUID().toString());
            mention.setCommentId(c.getId());
            mention.setProjectId(c.getProjectId());
            mention.setTaskId(c.getTaskId());
            mention.setMentionedEmp(emp);
            mention.setCreatedBy(c.getCreatedBy());
            mention.setCreatedAt(now);
            mentionRepo.save(mention);
        }
    }

    @Transactional
    public void delete(String commentId, String employeeNumber, String role) {
        TaskComment c = repo.findById(commentId)
            .orElseThrow(() -> new RuntimeException("コメントが見つかりません"));
        if (!c.getCreatedBy().equals(employeeNumber) && !"Admin".equals(role)) {
            throw new RuntimeException("削除権限がありません");
        }
        mentionRepo.deleteByCommentId(commentId);
        repo.deleteById(commentId);
    }
}
