package com.reflect.backend.repository;

import com.reflect.backend.entity.Survey;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SurveyRepository extends JpaRepository<Survey, String> {
    List<Survey> findAllByOrderByCreatedAtDesc();
    List<Survey> findByProjectIdOrderByCreatedAtDesc(Long projectId);
}
