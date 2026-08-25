package com.reflect.backend.dto.response;

import com.reflect.backend.entity.Survey;
import lombok.Builder;
import lombok.Getter;

/**
 * 一覧/作成/更新で返すアンケートDTO。
 * survey 本体に加え、バッジ表示用の集計（対象数・回答数・自分の回答有無）を含む。
 */
@Getter
@Builder
public class SurveyDto {
    private Survey survey;
    /** 対象者数（targetType=all のときは公開時点ではなく現在のプロジェクトメンバー数） */
    private int targetCount;
    private long respondentCount;
    private boolean targetedToMe;
    private boolean respondedByMe;
}
