package com.reflect.backend.repository;

import com.reflect.backend.entity.ScheduleEvent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ScheduleEventRepository extends JpaRepository<ScheduleEvent, String> {
    List<ScheduleEvent> findAllByOrderByDateAsc();
    List<ScheduleEvent> findByProjectIdOrderByDateAsc(Long projectId);
}
