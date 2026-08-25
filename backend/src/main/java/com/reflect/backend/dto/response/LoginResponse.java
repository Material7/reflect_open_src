package com.reflect.backend.dto.response;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class LoginResponse {
    private String token;
    private String employeeNumber;
    private String name;
    private String role;
    private String svnUsername;
    private Boolean svnPasswordSet;
    private String gitUsername;
    private Boolean gitPasswordSet;
}
