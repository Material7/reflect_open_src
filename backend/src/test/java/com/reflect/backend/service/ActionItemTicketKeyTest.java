package com.reflect.backend.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.reflect.backend.config.ActionItemStatusCatalog;
import com.reflect.backend.entity.ActionItem;
import com.reflect.backend.entity.ProjectSettings;
import com.reflect.backend.repository.ActionItemRepository;
import com.reflect.backend.repository.ProjectSettingsRepository;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * アクションアイテムのチケットID重複検証を DB なしで確認する。
 * この検証が無いと、API を直接叩くことで同一チケットを複数アイテムに紐づけられる。
 */
class ActionItemTicketKeyTest {

    private final ActionItemRepository repository = mock(ActionItemRepository.class);
    private final ProjectSettingsRepository settingsRepository = mock(ProjectSettingsRepository.class);
    private final ActionItemService service = new ActionItemService(
            repository, settingsRepository, new ActionItemStatusCatalog(new ObjectMapper()));

    private ActionItem item(String id, String ticketKey) {
        ActionItem it = new ActionItem();
        it.setId(id);
        it.setProjectId(1L);
        it.setItemId("TASK-A0001");
        it.setCategory("課題");
        it.setTitle("検証アイテム");
        it.setTicketKey(ticketKey);
        return it;
    }

    private void stubSettings() {
        ProjectSettings s = new ProjectSettings();
        s.setProjectId(1L);
        s.setTaskIdPrefix("TASK");
        s.setTaskIdCounterA(1);
        when(settingsRepository.findByProjectIdForUpdate(1L)).thenReturn(Optional.of(s));
    }

    @Test
    void create_rejects_duplicate_ticket_key_in_same_project() {
        when(repository.existsByProjectIdAndTicketKeyAndIdNot(eq(1L), eq("PROJ-123"), anyString()))
                .thenReturn(true);

        assertThatThrownBy(() -> service.create(item("a-1", "PROJ-123"), "admin"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("PROJ-123");

        verify(repository, never()).save(any());
    }

    @Test
    void create_allows_unused_ticket_key() {
        stubSettings();
        when(repository.existsByProjectIdAndTicketKeyAndIdNot(eq(1L), eq("PROJ-123"), anyString()))
                .thenReturn(false);
        when(repository.save(any(ActionItem.class))).thenAnswer(inv -> inv.getArgument(0));

        ActionItem saved = service.create(item("a-1", "PROJ-123"), "admin");

        assertThat(saved.getTicketKey()).isEqualTo("PROJ-123");
    }

    @Test
    void create_skips_check_when_ticket_key_is_absent() {
        stubSettings();
        when(repository.save(any(ActionItem.class))).thenAnswer(inv -> inv.getArgument(0));

        service.create(item("a-1", null), "admin");
        service.create(item("a-2", "  "), "admin");

        verify(repository, never()).existsByProjectIdAndTicketKeyAndIdNot(any(), any(), any());
    }

    @Test
    void update_rejects_duplicate_ticket_key() {
        when(repository.findById("a-1")).thenReturn(Optional.of(item("a-1", "PROJ-1")));
        when(repository.existsByProjectIdAndTicketKeyAndIdNot(1L, "PROJ-123", "a-1")).thenReturn(true);

        assertThatThrownBy(() -> service.update("a-1", item("a-1", "PROJ-123")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("PROJ-123");

        verify(repository, never()).save(any());
    }

    @Test
    void update_allows_keeping_own_ticket_key() {
        when(repository.findById("a-1")).thenReturn(Optional.of(item("a-1", "PROJ-123")));
        // 自分自身は AndIdNot で除外されるため false が返る
        when(repository.existsByProjectIdAndTicketKeyAndIdNot(1L, "PROJ-123", "a-1")).thenReturn(false);
        when(repository.save(any(ActionItem.class))).thenAnswer(inv -> inv.getArgument(0));

        ActionItem saved = service.update("a-1", item("a-1", "PROJ-123"));

        assertThat(saved.getTicketKey()).isEqualTo("PROJ-123");
    }
}
