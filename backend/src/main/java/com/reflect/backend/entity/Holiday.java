package com.reflect.backend.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "holidays")
@Getter @Setter @NoArgsConstructor
public class Holiday {

    @Id
    @Column(length = 50)
    private String id;

    @Column(nullable = false, length = 20)
    private String date;

    @Column(nullable = false, length = 100)
    private String name;
}
