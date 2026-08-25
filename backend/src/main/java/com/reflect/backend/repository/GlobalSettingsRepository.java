package com.reflect.backend.repository;

import com.reflect.backend.entity.GlobalSettings;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GlobalSettingsRepository extends JpaRepository<GlobalSettings, Long> {
}
