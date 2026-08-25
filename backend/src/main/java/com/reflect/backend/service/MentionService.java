package com.reflect.backend.service;

import com.reflect.backend.entity.CommentMention;
import com.reflect.backend.entity.Member;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class MentionService {

    private final CommentMentionRepository mentionRepo;
    private final TaskCommentRepository commentRepo;
    private final TaskRepository taskRepository;
    private final MemberRepository memberRepository;

    private static final Pattern MENTION_PATTERN = Pattern.compile("<@([^>\\s]+)>");
    private static final int SNIPPET_MAX = 120;

    public record MentionView(
            String id,
            String taskId,
            String taskDisplayId,
            String taskName,
            String taskType,
            Long projectId,
            String commentId,
            String snippet,
            String createdBy,
            String createdByName,
            LocalDateTime createdAt,
            boolean read
    ) {}

    public List<MentionView> listForUser(String employeeNumber) {
        List<CommentMention> mentions = mentionRepo.findByMentionedEmpOrderByCreatedAtDesc(employeeNumber);

        Map<String, String> nameByEmp = memberRepository.findAll().stream()
                .collect(Collectors.toMap(Member::getEmployeeNumber, Member::getName, (a, b) -> a));

        Map<String, TaskComment> commentCache = new HashMap<>();
        Map<String, Task> taskCache = new HashMap<>();

        return mentions.stream().map(mn -> {
            TaskComment comment = commentCache.computeIfAbsent(mn.getCommentId(),
                    id -> commentRepo.findById(id).orElse(null));
            Task task = taskCache.computeIfAbsent(mn.getTaskId(),
                    id -> taskRepository.findById(id).orElse(null));

            String snippet = comment != null ? toSnippet(comment.getContent(), nameByEmp) : "";

            return new MentionView(
                    mn.getId(),
                    mn.getTaskId(),
                    task != null ? task.getTaskId() : null,
                    task != null ? task.getName() : null,
                    task != null ? task.getType() : null,
                    mn.getProjectId(),
                    mn.getCommentId(),
                    snippet,
                    mn.getCreatedBy(),
                    nameByEmp.getOrDefault(mn.getCreatedBy(), mn.getCreatedBy()),
                    mn.getCreatedAt(),
                    mn.getReadAt() != null
            );
        }).collect(Collectors.toList());
    }

    public long unreadCount(String employeeNumber) {
        return mentionRepo.countByMentionedEmpAndReadAtIsNull(employeeNumber);
    }

    @Transactional
    public void markReadByTask(String employeeNumber, String taskId) {
        LocalDateTime now = LocalDateTime.now();
        List<CommentMention> list = mentionRepo.findByMentionedEmpAndTaskId(employeeNumber, taskId);
        for (CommentMention mn : list) {
            if (mn.getReadAt() == null) {
                mn.setReadAt(now);
            }
        }
        mentionRepo.saveAll(list);
    }

    /** <@社員番号> を @表示名 に置換し、必要なら末尾を省略 */
    private String toSnippet(String content, Map<String, String> nameByEmp) {
        Matcher m = MENTION_PATTERN.matcher(content);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String name = nameByEmp.getOrDefault(m.group(1), m.group(1));
            m.appendReplacement(sb, Matcher.quoteReplacement("@" + name));
        }
        m.appendTail(sb);
        String resolved = sb.toString();
        return resolved.length() > SNIPPET_MAX ? resolved.substring(0, SNIPPET_MAX) + "…" : resolved;
    }
}
