package com.reflect.backend.service;

import com.reflect.backend.config.TaskStatusCatalog;
import com.reflect.backend.entity.GlobalSettings;
import com.reflect.backend.repository.GlobalSettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class GlobalSettingsService {

    private final GlobalSettingsRepository repository;
    private final TaskStatusCatalog taskStatusCatalog;

    /** 認可チェック等で参照（キャッシュ）。未作成時はデフォルト値を返す */
    @Cacheable("global-settings")
    @Transactional(readOnly = true)
    public GlobalSettings get() {
        GlobalSettings s = repository.findById(1L).orElseGet(() -> {
            GlobalSettings ns = new GlobalSettings();
            ns.setId(1L);
            return ns;
        });
        // 既存行で列が未設定(null/空)の場合はデフォルトを補完
        if (s.getChangeLogViewRoles() == null || s.getChangeLogViewRoles().isEmpty()) {
            s.setChangeLogViewRoles(new ArrayList<>(List.of("Admin", "PM", "PL")));
        }
        if (s.getTaskStatuses() == null || s.getTaskStatuses().isEmpty()) {
            s.setTaskStatuses(new ArrayList<>(taskStatusCatalog.names()));
        }
        return s;
    }

    @Transactional
    @CacheEvict(value = "global-settings", allEntries = true)
    @SuppressWarnings("unchecked")
    public GlobalSettings update(java.util.Map<String, Object> body) {
        GlobalSettings s = repository.findById(1L).orElseGet(() -> {
            GlobalSettings ns = new GlobalSettings();
            ns.setId(1L);
            return ns;
        });
        if (body.get("changeLogViewRoles") instanceof List<?> v) {
            s.setChangeLogViewRoles((List<String>) v);
        }
        if (body.get("taskStatuses") instanceof List<?> v) {
            s.setTaskStatuses((List<String>) v);
        }
        return repository.save(s);
    }
}
