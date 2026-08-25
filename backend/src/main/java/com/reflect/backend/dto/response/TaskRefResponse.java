package com.reflect.backend.dto.response;

import com.reflect.backend.entity.Task;
import lombok.Builder;
import lombok.Getter;

/** タスク名などからUUIDを引くための軽量参照DTO（phases等の重い項目は含めない） */
@Getter
@Builder
public class TaskRefResponse {
    private String id;         // 内部UUID
    private String taskId;     // 表示用ID（例: TASK-D0001）
    private Long projectId;
    private String name;
    private String type;
    private String status;

    public static TaskRefResponse from(Task t) {
        return TaskRefResponse.builder()
                .id(t.getId())
                .taskId(t.getTaskId())
                .projectId(t.getProjectId())
                .name(t.getName())
                .type(t.getType())
                .status(t.getStatus())
                .build();
    }
}
