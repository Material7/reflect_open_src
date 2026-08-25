package com.reflect.backend.service;

import com.reflect.backend.dto.response.SurveyDto;
import com.reflect.backend.dto.response.SurveyResultsDto;
import com.reflect.backend.entity.Member;
import com.reflect.backend.entity.ProjectMember;
import com.reflect.backend.entity.Survey;
import com.reflect.backend.entity.SurveyQuestion;
import com.reflect.backend.entity.SurveyResponse;
import com.reflect.backend.repository.MemberRepository;
import com.reflect.backend.repository.ProjectMemberRepository;
import com.reflect.backend.repository.SurveyRepository;
import com.reflect.backend.repository.SurveyResponseRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class SurveyService {

    private static final Set<String> VALID_RESULT_AUDIENCES = Set.of("pl", "dl", "sl", "respondents", "all");
    private static final Set<String> VALID_IDENTITY_AUDIENCES = Set.of("pl", "dl", "sl", "viewers");
    private static final Set<String> VALID_QUESTION_TYPES = Set.of("single", "multi", "text", "rating");

    private final SurveyRepository repository;
    private final SurveyResponseRepository responseRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final MemberRepository memberRepository;
    private final ProjectAuthService projectAuth;

    @Transactional(readOnly = true)
    public List<SurveyDto> findAll(Long projectId, Authentication auth) {
        List<Survey> surveys = projectId != null
                ? repository.findByProjectIdOrderByCreatedAtDesc(projectId)
                : repository.findAllByOrderByCreatedAtDesc();
        return surveys.stream().map(s -> toDto(s, auth)).collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public SurveyDto getDto(String id, Authentication auth) {
        return toDto(find(id), auth);
    }

    @Transactional(readOnly = true)
    public Long projectIdOf(String id) {
        return repository.findById(id).map(Survey::getProjectId).orElse(null);
    }

    /** 作成権限: 全社/横断アンケート(projectId=null)は認証済みなら誰でも、PJ別はそのPJのメンバーのみ */
    @Transactional(readOnly = true)
    public boolean canCreate(Survey survey, Authentication auth) {
        if (auth == null) return false;
        Long pid = survey.getProjectId();
        if (pid == null) return true;
        return projectAuth.isMember(auth, pid);
    }

    /** 管理権限（編集・締切・削除・督促）: 作成者またはシステム管理者のみ */
    @Transactional(readOnly = true)
    public boolean canManage(String id, Authentication auth) {
        Survey s = repository.findById(id).orElse(null);
        if (s == null || auth == null) return false;
        if (projectAuth.isSystemAdmin(auth)) return true;
        return auth.getName().equals(s.getCreatedBy());
    }

    /** 参照系（取得・回答・集計）の到達可否。全社アンケートは認証済みなら可、それ以外はプロジェクトメンバー */
    @Transactional(readOnly = true)
    public boolean canAccess(String id, Authentication auth) {
        Survey s = repository.findById(id).orElse(null);
        if (s == null || auth == null) return false;
        if (s.getProjectId() == null) return true;
        return projectAuth.isMember(auth, s.getProjectId());
    }

    @Transactional
    public SurveyDto create(Survey survey, Authentication auth) {
        // projectId == null は「全プロジェクト（全社）」アンケートとして許可
        if (survey.getId() == null || survey.getId().isBlank())
            survey.setId(UUID.randomUUID().toString());
        if (survey.getStatus() == null || survey.getStatus().isBlank())
            survey.setStatus("draft");
        normalize(survey);
        validate(survey);
        survey.setCreatedBy(auth.getName());
        survey.setCreatedAt(LocalDateTime.now());
        return toDto(repository.save(survey), auth);
    }

    @Transactional
    public SurveyDto update(String id, Survey patch, Authentication auth) {
        Survey existing = find(id);
        boolean wasEditable = "draft".equals(existing.getStatus());

        existing.setTitle(patch.getTitle());
        existing.setDescription(patch.getDescription());
        existing.setDueDate(patch.getDueDate());
        if (patch.getStatus() != null && !patch.getStatus().isBlank())
            existing.setStatus(patch.getStatus());
        existing.setResultVisibleTo(patch.getResultVisibleTo());
        existing.setIdentityVisibleTo(patch.getIdentityVisibleTo());
        existing.setResultTiming(patch.getResultTiming());

        // 設問・対象は draft の間のみ編集可（公開後は既存を保持）
        if (wasEditable) {
            existing.setQuestions(patch.getQuestions());
            existing.setTargetType(patch.getTargetType());
            existing.setTargetMemberIds(patch.getTargetMemberIds());
        }

        normalize(existing);
        validate(existing);
        return toDto(repository.save(existing), auth);
    }

    @Transactional
    public void delete(String id) {
        if (!repository.existsById(id))
            throw new NoSuchElementException("アンケートが見つかりません: " + id);
        responseRepository.deleteBySurveyId(id);
        repository.deleteById(id);
    }

    @Transactional
    public SurveyResponse submitResponse(String surveyId, Map<String, Object> answers, Authentication auth) {
        Survey survey = find(surveyId);
        if (!"open".equals(survey.getStatus()))
            throw new IllegalArgumentException("このアンケートは回答を受け付けていません");
        String me = auth.getName();
        if (!resolveTargetEmployeeNumbers(survey).contains(me))
            throw new SecurityException("このアンケートの回答対象者ではありません");

        SurveyResponse resp = responseRepository
                .findBySurveyIdAndRespondentEmployeeNumber(surveyId, me)
                .orElseGet(() -> {
                    SurveyResponse r = new SurveyResponse();
                    r.setId(UUID.randomUUID().toString());
                    r.setSurveyId(surveyId);
                    r.setRespondentEmployeeNumber(me);
                    return r;
                });
        resp.setAnswers(answers == null ? new LinkedHashMap<>() : answers);
        resp.setSubmittedAt(LocalDateTime.now());
        return responseRepository.save(resp);
    }

    @Transactional(readOnly = true)
    public SurveyResponse getMyResponse(String surveyId, Authentication auth) {
        return responseRepository
                .findBySurveyIdAndRespondentEmployeeNumber(surveyId, auth.getName())
                .orElse(null);
    }

    @Transactional(readOnly = true)
    public SurveyResultsDto getResults(String surveyId, Authentication auth) {
        Survey survey = find(surveyId);
        List<String> targets = resolveTargetEmployeeNumbers(survey);
        List<SurveyResponse> responses = responseRepository.findBySurveyId(surveyId);
        boolean respondedByMe = responses.stream()
                .anyMatch(r -> r.getRespondentEmployeeNumber().equals(auth.getName()));

        if (!canViewResults(auth, survey, targets, respondedByMe))
            throw new SecurityException("この集計結果を閲覧する権限がありません");
        boolean canSeeIdentity = canSeeIdentity(auth, survey);

        Map<String, String> nameByEmp = resolveNames(targets, responses);

        List<SurveyResultsDto.QuestionAggregate> aggregates = new ArrayList<>();
        for (SurveyQuestion q : survey.getQuestions()) {
            aggregates.add(aggregateQuestion(q, responses));
        }

        SurveyResultsDto.SurveyResultsDtoBuilder builder = SurveyResultsDto.builder()
                .surveyId(surveyId)
                .status(survey.getStatus())
                .canSeeIdentity(canSeeIdentity)
                .targetCount(targets.size())
                .respondentCount(responses.size())
                .aggregates(aggregates);

        if (canSeeIdentity) {
            List<SurveyResultsDto.NamedResponse> named = responses.stream()
                    .map(r -> SurveyResultsDto.NamedResponse.builder()
                            .employeeNumber(r.getRespondentEmployeeNumber())
                            .name(nameByEmp.getOrDefault(r.getRespondentEmployeeNumber(), r.getRespondentEmployeeNumber()))
                            .submittedAt(r.getSubmittedAt())
                            .answers(r.getAnswers())
                            .build())
                    .collect(Collectors.toList());
            Set<String> answered = responses.stream()
                    .map(SurveyResponse::getRespondentEmployeeNumber)
                    .collect(Collectors.toSet());
            List<SurveyResultsDto.MemberRef> unanswered = targets.stream()
                    .filter(emp -> !answered.contains(emp))
                    .map(emp -> SurveyResultsDto.MemberRef.builder()
                            .employeeNumber(emp)
                            .name(nameByEmp.getOrDefault(emp, emp))
                            .build())
                    .collect(Collectors.toList());
            builder.respondents(named).unanswered(unanswered);
        } else {
            builder.respondents(List.of()).unanswered(List.of());
        }
        return builder.build();
    }

    private Survey find(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new NoSuchElementException("アンケートが見つかりません: " + id));
    }

    private SurveyDto toDto(Survey s, Authentication auth) {
        List<String> targets = resolveTargetEmployeeNumbers(s);
        List<SurveyResponse> responses = responseRepository.findBySurveyId(s.getId());
        String me = auth != null ? auth.getName() : null;
        boolean respondedByMe = me != null && responses.stream()
                .anyMatch(r -> r.getRespondentEmployeeNumber().equals(me));
        boolean targetedToMe = me != null && targets.contains(me);
        return SurveyDto.builder()
                .survey(s)
                .targetCount(targets.size())
                .respondentCount(responses.size())
                .targetedToMe(targetedToMe)
                .respondedByMe(respondedByMe)
                .build();
    }

    /**
     * 対象者の employeeNumber 一覧を解決する。
     * targetType=all: projectId 指定時はそのプロジェクト全メンバー、全社（projectId=null）時は全アカウント。
     * targetType=members: 指定された employeeNumber 一覧。
     */
    private List<String> resolveTargetEmployeeNumbers(Survey survey) {
        if ("all".equals(survey.getTargetType())) {
            if (survey.getProjectId() == null) {
                // 全社: Admin ロールは対象外
                return memberRepository.findAll().stream()
                        .filter(m -> !"Admin".equals(m.getRole()))
                        .map(Member::getEmployeeNumber)
                        .collect(Collectors.toList());
            }
            // プロジェクト全員: プロジェクトロールが Admin のメンバーは対象外
            List<Long> memberIds = projectMemberRepository.findByProjectId(survey.getProjectId()).stream()
                    .filter(pm -> !"Admin".equals(pm.getRole()))
                    .map(ProjectMember::getMemberId)
                    .collect(Collectors.toList());
            return memberRepository.findAllById(memberIds).stream()
                    .map(Member::getEmployeeNumber)
                    .collect(Collectors.toList());
        }
        return survey.getTargetMemberIds() == null ? List.of() : new ArrayList<>(survey.getTargetMemberIds());
    }

    private Map<String, String> resolveNames(List<String> targets, List<SurveyResponse> responses) {
        Set<String> emps = new java.util.HashSet<>(targets);
        responses.forEach(r -> emps.add(r.getRespondentEmployeeNumber()));
        if (emps.isEmpty()) return Map.of();
        Map<String, String> map = new LinkedHashMap<>();
        memberRepository.findByEmployeeNumberIn(new ArrayList<>(emps))
                .forEach(m -> map.put(m.getEmployeeNumber(), m.getName()));
        return map;
    }

    // 共通ベースライン（常時可）: 作成者・システムAdmin・プロジェクトPM。
    // それ以外は resultVisibleTo / identityVisibleTo の集合で個別に許可する。
    private boolean canViewResults(Authentication auth, Survey survey, List<String> targets, boolean respondedByMe) {
        if (isBaseline(auth, survey)) return true;
        String role = projectRoleOf(auth, survey);
        List<String> vis = survey.getResultVisibleTo() == null ? List.of() : survey.getResultVisibleTo();
        if (vis.contains("all")) return survey.getProjectId() == null || role != null;
        if (roleMatches(vis, role)) return true;
        if (vis.contains("respondents")
                && targets.contains(auth.getName())
                && timingAllows(survey, respondedByMe)) return true;
        return false;
    }

    private boolean canSeeIdentity(Authentication auth, Survey survey) {
        if (isBaseline(auth, survey)) return true;
        String role = projectRoleOf(auth, survey);
        List<String> id = survey.getIdentityVisibleTo() == null ? List.of() : survey.getIdentityVisibleTo();
        if (roleMatches(id, role)) return true;
        // viewers: 結果を閲覧できる人は全員特定可（呼び出し時点で閲覧可は確定済み）
        return id.contains("viewers");
    }

    /** 集合内のロールトークン（pl/dl/sl）がプロジェクトロールに一致するか */
    private boolean roleMatches(List<String> audiences, String role) {
        if (role == null) return false;
        return audiences.contains(role.toLowerCase());
    }

    /** 作成者・システムAdmin・プロジェクトPM は常に閲覧/特定可 */
    private boolean isBaseline(Authentication auth, Survey survey) {
        if (projectAuth.isSystemAdmin(auth)) return true;
        if (auth.getName().equals(survey.getCreatedBy())) return true;
        return "PM".equals(projectRoleOf(auth, survey));
    }

    private String projectRoleOf(Authentication auth, Survey survey) {
        return survey.getProjectId() == null ? null : projectAuth.projectRole(auth, survey.getProjectId());
    }

    private boolean timingAllows(Survey survey, boolean respondedByMe) {
        return switch (survey.getResultTiming() == null ? "after_close" : survey.getResultTiming()) {
            case "always" -> true;
            case "after_answer" -> respondedByMe;
            default -> "closed".equals(survey.getStatus()); // after_close
        };
    }

    @SuppressWarnings("unchecked")
    private SurveyResultsDto.QuestionAggregate aggregateQuestion(SurveyQuestion q, List<SurveyResponse> responses) {
        SurveyResultsDto.QuestionAggregate.QuestionAggregateBuilder b = SurveyResultsDto.QuestionAggregate.builder()
                .questionId(q.getId())
                .type(q.getType());

        if ("text".equals(q.getType())) {
            List<String> texts = new ArrayList<>();
            for (SurveyResponse r : responses) {
                Object v = r.getAnswers() == null ? null : r.getAnswers().get(q.getId());
                if (v != null && !v.toString().isBlank()) texts.add(v.toString());
            }
            return b.textAnswers(texts).build();
        }

        Map<String, Long> counts = new LinkedHashMap<>();
        if ("single".equals(q.getType()) || "multi".equals(q.getType())) {
            if (q.getOptions() != null) q.getOptions().forEach(opt -> counts.put(opt, 0L));
        } else if ("rating".equals(q.getType())) {
            int max = q.getRatingMax() == null ? 5 : q.getRatingMax();
            for (int i = 1; i <= max; i++) counts.put(String.valueOf(i), 0L);
        }

        double sum = 0;
        long ratingN = 0;
        for (SurveyResponse r : responses) {
            Object v = r.getAnswers() == null ? null : r.getAnswers().get(q.getId());
            if (v == null) continue;
            if ("multi".equals(q.getType()) && v instanceof List<?> list) {
                for (Object o : (List<Object>) list) {
                    String key = String.valueOf(o);
                    counts.merge(key, 1L, Long::sum);
                }
            } else if ("rating".equals(q.getType())) {
                String key = String.valueOf(((Number) toNumber(v)).intValue());
                counts.merge(key, 1L, Long::sum);
                sum += toNumber(v).doubleValue();
                ratingN++;
            } else {
                counts.merge(String.valueOf(v), 1L, Long::sum);
            }
        }
        b.optionCounts(counts);
        if ("rating".equals(q.getType()) && ratingN > 0) {
            b.average(Math.round((sum / ratingN) * 100.0) / 100.0);
        }
        return b.build();
    }

    private Number toNumber(Object v) {
        if (v instanceof Number n) return n;
        try { return Double.parseDouble(String.valueOf(v)); }
        catch (NumberFormatException e) { return 0; }
    }

    private void normalize(Survey survey) {
        survey.setResultVisibleTo(filterAudiences(survey.getResultVisibleTo(), VALID_RESULT_AUDIENCES));
        survey.setIdentityVisibleTo(filterAudiences(survey.getIdentityVisibleTo(), VALID_IDENTITY_AUDIENCES));
        if (survey.getResultTiming() == null
                || !Set.of("after_close", "after_answer", "always").contains(survey.getResultTiming()))
            survey.setResultTiming("after_close");
        if (!"all".equals(survey.getTargetType())) survey.setTargetType("members");
        if (survey.getQuestions() == null) survey.setQuestions(new ArrayList<>());
        if (survey.getTargetMemberIds() == null) survey.setTargetMemberIds(new ArrayList<>());
    }

    private List<String> filterAudiences(List<String> in, Set<String> allowed) {
        if (in == null) return new ArrayList<>();
        return in.stream().filter(allowed::contains).distinct().collect(Collectors.toList());
    }

    private void validate(Survey survey) {
        if (survey.getTitle() == null || survey.getTitle().isBlank())
            throw new IllegalArgumentException("title は必須です");
        for (SurveyQuestion q : survey.getQuestions()) {
            if (q.getType() == null || !VALID_QUESTION_TYPES.contains(q.getType()))
                throw new IllegalArgumentException("不正な設問タイプ: " + q.getType());
            if (q.getTitle() == null || q.getTitle().isBlank())
                throw new IllegalArgumentException("設問タイトルは必須です");
        }
        // 公開時は設問と対象が必要
        if (!"draft".equals(survey.getStatus())) {
            if (survey.getQuestions().isEmpty())
                throw new IllegalArgumentException("公開するには設問が1つ以上必要です");
            if (!"all".equals(survey.getTargetType()) && survey.getTargetMemberIds().isEmpty())
                throw new IllegalArgumentException("公開するには対象者を1人以上選択してください");
        }
    }
}
