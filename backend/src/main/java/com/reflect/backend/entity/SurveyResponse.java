package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * アンケート回答（記名方式、1人1レコード）。
 * 同一 (surveyId, respondentEmployeeNumber) の組は一意。
 */
@Entity
@Table(name = "survey_responses",
        uniqueConstraints = @UniqueConstraint(columnNames = {"survey_id", "respondent_employee_number"}))
@Getter @Setter @NoArgsConstructor
public class SurveyResponse {

    @Id
    @Column(length = 50)
    private String id;

    @Column(name = "survey_id", nullable = false, length = 50)
    private String surveyId;

    /** 回答者の employeeNumber（記名なので必須） */
    @Column(name = "respondent_employee_number", nullable = false, length = 50)
    private String respondentEmployeeNumber;

    /** questionId -> 回答値（String | List<String> | Number）。JSONB */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> answers = new HashMap<>();

    @Column(name = "submitted_at")
    private LocalDateTime submittedAt;
}
