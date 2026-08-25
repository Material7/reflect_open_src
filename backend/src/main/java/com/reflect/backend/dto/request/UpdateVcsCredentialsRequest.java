package com.reflect.backend.dto.request;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter @Setter @NoArgsConstructor
public class UpdateVcsCredentialsRequest {
    private String svnUsername;
    private String svnPassword; // null=変更なし / ""=クリア / 値=更新
    private String gitUsername;
    private String gitPassword; // null=変更なし / ""=クリア / 値=更新
}
