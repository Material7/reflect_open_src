package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "domains")
@Getter @Setter @NoArgsConstructor
public class Domain {

    @Id
    @Column(length = 50)
    private String id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(nullable = false, length = 100)
    private String name;

    @OneToMany(mappedBy = "domain", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    private List<DomainGroup> groups = new ArrayList<>();
}
