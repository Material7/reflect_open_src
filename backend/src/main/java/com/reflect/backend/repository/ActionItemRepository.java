package com.reflect.backend.repository;

import com.reflect.backend.entity.ActionItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ActionItemRepository extends JpaRepository<ActionItem, String> {
    List<ActionItem> findAllByOrderByCreatedAtDesc();
    List<ActionItem> findByProjectIdOrderByCreatedAtDesc(Long projectId);

    /** 同一プロジェクト内で、指定アイテム以外に同じチケットIDが登録済みか */
    boolean existsByProjectIdAndTicketKeyAndIdNot(Long projectId, String ticketKey, String id);
}
