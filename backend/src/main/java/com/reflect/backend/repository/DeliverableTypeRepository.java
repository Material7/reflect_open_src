package com.reflect.backend.repository;

import com.reflect.backend.entity.DeliverableType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DeliverableTypeRepository extends JpaRepository<DeliverableType, String> {
    List<DeliverableType> findByProjectId(Long projectId);
    void deleteByProjectId(Long projectId);
}
