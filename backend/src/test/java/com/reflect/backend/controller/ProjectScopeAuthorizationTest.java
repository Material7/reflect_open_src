package com.reflect.backend.controller;

import com.reflect.backend.entity.Task;
import com.reflect.backend.service.ProjectAuthService;
import com.reflect.backend.service.StatsService;
import com.reflect.backend.service.TaskCommentService;
import com.reflect.backend.service.TaskExtService;
import com.reflect.backend.service.TaskService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * プロジェクトを跨いだ参照・更新が拒否されることを確認する。
 *
 * <p>これらのエンドポイントは認証だけを要求しており、所属していないプロジェクトの
 * タスク・コメント・統計を誰でも読み書きできる状態だった。@PreAuthorize 式が
 * 実際に評価されること（式の記述ミスで素通りしないこと）もここで担保する。
 */
@SpringBootTest
@AutoConfigureMockMvc
class ProjectScopeAuthorizationTest {

    private static final String TASK_ID = "11111111-2222-3333-4444-555555555555";
    private static final long OTHER_PROJECT = 2L;

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private ProjectAuthService projectAuth;

    @MockitoBean
    private TaskExtService taskExtService;

    @MockitoBean
    private TaskService taskService;

    @MockitoBean
    private TaskCommentService taskCommentService;

    @MockitoBean
    private StatsService statsService;

    /** 対象タスクが所属外プロジェクトのものである状況を作る */
    private void notAMemberOfTheTasksProject() {
        when(taskExtService.projectIdOf(TASK_ID)).thenReturn(OTHER_PROJECT);
        when(taskService.projectIdOf(TASK_ID)).thenReturn(OTHER_PROJECT);
        when(projectAuth.isMember(any(Authentication.class), eq(OTHER_PROJECT))).thenReturn(false);
    }

    @Test
    void rejects_reading_a_task_from_another_project() throws Exception {
        notAMemberOfTheTasksProject();

        mockMvc.perform(get("/api/tasks/" + TASK_ID).with(user("E999")))
                .andExpect(status().isForbidden());

        verify(taskExtService, never()).getById(anyString());
    }

    @Test
    void rejects_updating_the_status_of_a_task_from_another_project() throws Exception {
        notAMemberOfTheTasksProject();

        mockMvc.perform(patch("/api/tasks/" + TASK_ID + "/status")
                        .with(user("E999"))
                        .contentType("application/json")
                        .content("{\"status\":\"完了\"}"))
                .andExpect(status().isForbidden());

        verify(taskExtService, never()).updateStatus(anyString(), anyString());
    }

    @Test
    void rejects_posting_a_comment_to_a_task_from_another_project() throws Exception {
        notAMemberOfTheTasksProject();

        mockMvc.perform(post("/api/tasks/" + TASK_ID + "/comments")
                        .with(user("E999"))
                        .contentType("application/json")
                        .content("{\"content\":\"所属外からのコメント\"}"))
                .andExpect(status().isForbidden());

        verify(taskCommentService, never()).create(anyString(), anyString(), anyString());
    }

    @Test
    void rejects_reading_stats_of_another_project() throws Exception {
        when(projectAuth.isMember(any(Authentication.class), eq(OTHER_PROJECT))).thenReturn(false);

        mockMvc.perform(get("/api/stats/summary")
                        .param("projectId", String.valueOf(OTHER_PROJECT))
                        .with(user("E999")))
                .andExpect(status().isForbidden());

        verify(statsService, never()).getSummary(any());
    }

    @Test
    void rejects_reading_comments_of_another_project() throws Exception {
        when(projectAuth.isMember(any(Authentication.class), eq(OTHER_PROJECT))).thenReturn(false);

        mockMvc.perform(get("/api/tasks/comments")
                        .param("projectId", String.valueOf(OTHER_PROJECT))
                        .with(user("E999")))
                .andExpect(status().isForbidden());

        verify(taskCommentService, never()).findAll(any());
    }

    @Test
    void rejects_allocating_a_task_id_in_another_project() throws Exception {
        when(projectAuth.isMember(any(Authentication.class), eq(OTHER_PROJECT))).thenReturn(false);

        mockMvc.perform(post("/api/tasks/allocate-id")
                        .with(user("E999"))
                        .contentType("application/json")
                        .content("{\"projectId\":\"2\",\"type\":\"Development\"}"))
                .andExpect(status().isForbidden());

        verify(taskExtService, never()).allocateTaskId(any(), any());
    }

    @Test
    void allows_reading_a_task_from_a_project_the_user_belongs_to() throws Exception {
        when(taskExtService.projectIdOf(TASK_ID)).thenReturn(1L);
        when(projectAuth.isMember(any(Authentication.class), eq(1L))).thenReturn(true);
        when(taskExtService.getById(TASK_ID)).thenReturn(new Task());

        mockMvc.perform(get("/api/tasks/" + TASK_ID).with(user("E001")))
                .andExpect(status().isOk());
    }
}
