package com.reflect.backend.service;

import java.util.Set;
import java.util.stream.Collectors;

/**
 * 統計の集計範囲。認証ユーザーが参照してよいプロジェクトだけを集計対象にするために使う。
 *
 * @param projectId         単一プロジェクトに絞る場合のID（所属は呼び出し前に検証済みであること）。
 *                          null なら横断集計
 * @param visibleProjectIds 横断集計時に対象とするプロジェクトID。null はシステム管理者＝全プロジェクト
 */
public record StatsScope(Long projectId, Set<Long> visibleProjectIds) {

    /** 所属検証済みの単一プロジェクトを対象にする */
    public static StatsScope ofProject(Long projectId) {
        return new StatsScope(projectId, null);
    }

    /** 認証ユーザーが参照可能なプロジェクトを横断集計する（null は全プロジェクト） */
    public static StatsScope ofVisible(Set<Long> visibleProjectIds) {
        return new StatsScope(null, visibleProjectIds);
    }

    /** 集計対象に含めてよいプロジェクトか */
    public boolean includes(Long id) {
        if (projectId != null) return projectId.equals(id);
        return visibleProjectIds == null || visibleProjectIds.contains(id);
    }

    /**
     * キャッシュキー。参照可能なプロジェクトが異なるユーザー間で結果が混ざらないよう、
     * 集計範囲そのものをキーに含める。
     */
    public String cacheKey() {
        if (projectId != null) return "p" + projectId;
        if (visibleProjectIds == null) return "all";
        return "v" + visibleProjectIds.stream().sorted()
                .map(String::valueOf)
                .collect(Collectors.joining(","));
    }
}
