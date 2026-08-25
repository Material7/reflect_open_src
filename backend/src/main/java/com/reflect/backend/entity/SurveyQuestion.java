package com.reflect.backend.entity;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * アンケートの設問。Survey.questions に JSONB で埋め込む（独立テーブルは持たない）。
 * type: "single" | "multi" | "text" | "rating"
 */
@Getter @Setter @NoArgsConstructor
public class SurveyQuestion {
    /** 設問ID（フロントで採番される一意な文字列） */
    private String id;
    /** 設問種別: single | multi | text | rating */
    private String type;
    private String title;
    private boolean required;
    /** single / multi の選択肢（text / rating では未使用） */
    private List<String> options = new ArrayList<>();
    /** rating の段階数（既定5）。rating 以外では null */
    private Integer ratingMax;
}
