package com.reflect.backend.repository;

import com.reflect.backend.entity.SurveyResponse;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SurveyResponseRepository extends JpaRepository<SurveyResponse, String> {
    List<SurveyResponse> findBySurveyId(String surveyId);
    Optional<SurveyResponse> findBySurveyIdAndRespondentEmployeeNumber(String surveyId, String respondentEmployeeNumber);
    long countBySurveyId(String surveyId);
    void deleteBySurveyId(String surveyId);
}
