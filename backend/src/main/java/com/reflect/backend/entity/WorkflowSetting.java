package com.reflect.backend.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "workflow_settings")
@Getter @Setter @NoArgsConstructor
public class WorkflowSetting {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "deliverable_type_id", nullable = false)
    private DeliverableType deliverableType;

    @Column(name = "workflow_name", nullable = false, length = 100)
    private String workflowName;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "workflow_setting_allowed_roles", joinColumns = @JoinColumn(name = "workflow_setting_id"))
    @Column(name = "role")
    private List<String> allowedRoles = new ArrayList<>();
}
