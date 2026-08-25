package com.reflect.backend.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * アンケート集計結果。権限に応じて個別回答（記名）の有無が変わる。
 * - aggregates: 常に返す（選択式は件数、記述式は匿名化したテキスト一覧）
 * - respondents / unanswered: canSeeIdentity=true のときのみ中身が入る
 */
@Getter
@Builder
public class SurveyResultsDto {
    private String surveyId;
    private String status;
    private boolean canSeeIdentity;
    private int targetCount;
    private long respondentCount;
    private List<QuestionAggregate> aggregates;
    /** 記名回答（canSeeIdentity 時のみ） */
    private List<NamedResponse> respondents;
    /** 未回答者一覧（canSeeIdentity 時のみ） */
    private List<MemberRef> unanswered;

    @Getter
    @Builder
    public static class QuestionAggregate {
        private String questionId;
        private String type;
        /** single/multi/rating: 選択肢ごとの件数（rating はキーが段階値） */
        private Map<String, Long> optionCounts;
        /** rating の平均 */
        private Double average;
        /** text: 匿名化した回答テキスト一覧 */
        private List<String> textAnswers;
    }

    @Getter
    @Builder
    public static class NamedResponse {
        private String employeeNumber;
        private String name;
        private LocalDateTime submittedAt;
        private Map<String, Object> answers;
    }

    @Getter
    @Builder
    public static class MemberRef {
        private String employeeNumber;
        private String name;
    }
}
