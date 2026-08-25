package com.reflect.backend.service;

import com.reflect.backend.entity.Holiday;
import com.reflect.backend.repository.HolidayRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class HolidayService {

    private final HolidayRepository holidayRepository;

    @Transactional(readOnly = true)
    public List<Holiday> findAll() {
        return holidayRepository.findAll();
    }

    @Transactional
    public Holiday create(Holiday holiday) {
        if (holiday.getDate() == null || holiday.getDate().isBlank())
            throw new IllegalArgumentException("date は必須です（YYYY-MM-DD）");
        if (holiday.getName() == null || holiday.getName().isBlank())
            throw new IllegalArgumentException("name は必須です");
        if (holiday.getId() == null || holiday.getId().isBlank())
            holiday.setId(UUID.randomUUID().toString());
        return holidayRepository.save(holiday);
    }

    @Transactional
    public List<Holiday> batchCreate(List<Holiday> holidays) {
        holidays.forEach(h -> {
            if (h.getDate() == null || h.getDate().isBlank())
                throw new IllegalArgumentException("date は必須です: " + h.getName());
            if (h.getName() == null || h.getName().isBlank())
                throw new IllegalArgumentException("name は必須です");
            if (h.getId() == null || h.getId().isBlank())
                h.setId(UUID.randomUUID().toString());
        });
        return holidayRepository.saveAll(holidays);
    }

    @Transactional
    public void delete(String id) {
        if (!holidayRepository.existsById(id))
            throw new NoSuchElementException("祝日が見つかりません: " + id);
        holidayRepository.deleteById(id);
    }
}
