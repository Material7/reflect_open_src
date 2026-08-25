package com.reflect.backend.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Getter @Setter @NoArgsConstructor
public class CreateMemberRequest {

    @NotBlank
    @Size(max = 50)
    private String employeeNumber;

    @NotBlank
    @Size(max = 100)
    private String name;

    @NotBlank
    @Size(max = 20)
    private String role;

    @Size(min = 5, message = "パスワードは5文字以上で入力してください")
    private String password;

    private List<String> domainGroupIds = new ArrayList<>();
}
