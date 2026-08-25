package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "deliverable_types")
@Getter @Setter @NoArgsConstructor
public class DeliverableType {

    @Id
    @Column(length = 50)
    private String id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(name = "phase_code", nullable = false, length = 10)
    private String phaseCode;

    @Column(nullable = false)
    private boolean required;

    @Column(name = "vcs_type", length = 10)
    private String vcsType; // "svn" | "git" | "none" | null

    @OneToMany(mappedBy = "deliverableType", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    private List<WorkflowSetting> workflowSettings = new ArrayList<>();
}
