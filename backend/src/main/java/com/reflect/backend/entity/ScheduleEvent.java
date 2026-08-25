package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "schedule_events")
@Getter @Setter @NoArgsConstructor
public class ScheduleEvent {

    @Id
    @Column(length = 50)
    private String id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(nullable = false, length = 20)
    private String type; // "milestone" | "event"

    @Column(nullable = false, length = 255)
    private String title;

    @Column(nullable = false, length = 20)
    private String date; // YYYY-MM-DD

    @Column(length = 20)
    private String endDate; // YYYY-MM-DD（イベントの終了日、nullable）

    @Column(length = 500)
    private String description;

    @Column(length = 20)
    private String color; // "indigo" | "red" | "orange" | "green" | "purple" | "gray"

    @Column(length = 50)
    private String createdBy; // employeeNumber

    @Column
    private LocalDateTime createdAt;
}
