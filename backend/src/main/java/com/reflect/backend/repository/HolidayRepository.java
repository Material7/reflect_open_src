package com.reflect.backend.repository;

import com.reflect.backend.entity.Holiday;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HolidayRepository extends JpaRepository<Holiday, String> {
}
