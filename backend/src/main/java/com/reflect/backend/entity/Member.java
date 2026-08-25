package com.reflect.backend.entity;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "members")
@Getter @Setter @NoArgsConstructor
public class Member {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "employee_number", unique = true, nullable = false, length = 50)
    private String employeeNumber;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, length = 20)
    private String role;

    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    @Column(length = 255)
    private String password;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "member_domain_group_ids", joinColumns = @JoinColumn(name = "member_id"))
    @Column(name = "domain_group_id")
    private List<String> domainGroupIds = new ArrayList<>();

    @Column(name = "svn_username", length = 200)
    private String svnUsername;

    @Column(name = "svn_password_enc", length = 500)
    private String svnPasswordEnc;

    @Column(name = "git_username", length = 200)
    private String gitUsername;

    @Column(name = "git_password_enc", length = 500)
    private String gitPasswordEnc;

    /** パスワードが設定済みか（API出力用。password 自体は WRITE_ONLY のため別途公開） */
    @Transient
    @JsonProperty(access = JsonProperty.Access.READ_ONLY)
    public boolean isPasswordSet() {
        return password != null && !password.isEmpty();
    }
}
