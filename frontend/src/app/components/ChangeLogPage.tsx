import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { changeLogApi, membersApi } from '@/lib/api';
import { Member, Task, TaskChangeLog, TaskChangeLogPage } from '@/types';
import { ChevronLeft, ChevronRight, X, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useProject } from '@/context/ProjectContext';
import { displayTaskIdFrom } from '@/lib/ticket';
import { TaskDetailModal } from './TaskDetailModal';
import { TabKey } from '../App';

const OPERATION_LABELS: Record<string, string> = {
  TASK_CREATED:                'タスク作成',
  TASK_DELETED:                'タスク削除',
  STATUS_CHANGED:              'ステータス変更',
  PRIORITY_CHANGED:            '優先度変更',
  ASSIGNEE_CHANGED:            '担当者変更',
  NAME_CHANGED:                'タスク名変更',
  DOMAIN_CHANGED:              'ドメイン変更',
  WORK_STEP_CHANGED:           '作業工程変更',
  PLANNED_START_DATE_CHANGED:  '予定開始日変更',
  PLANNED_END_DATE_CHANGED:    '予定終了日変更',
  ACTUAL_START_DATE_CHANGED:   '実績開始日変更',
  ACTUAL_END_DATE_CHANGED:     '実績終了日変更',
  PLANNED_MAN_HOURS_CHANGED:   '予定工数変更',
  ACTUAL_MAN_HOURS_CHANGED:    '実績工数変更',
  ACTUAL_MAN_HOURS_LOGGED:     '実績工数記入',
  DELIVERABLE_ADDED:           '成果物追加',
  DELIVERABLE_WORKFLOW_CHANGED:'成果物ワークフロー変更',
  DELIVERABLE_UPDATED:         '成果物更新',
  DELIVERABLE_DELETED:         '成果物削除',
  REFERENCE_ADDED:             '参照追加',
  REFERENCE_UPDATED:           '参照更新',
  REFERENCE_DELETED:           '参照削除',
  API_KEY_GENERATED:           'APIキー発行',
  API_KEY_REVOKED:             'APIキー失効',
};

const OPERATION_COLORS: Record<string, string> = {
  TASK_CREATED:                'bg-green-100 text-green-800',
  TASK_DELETED:                'bg-red-100 text-red-800',
  STATUS_CHANGED:              'bg-blue-100 text-blue-800',
  PRIORITY_CHANGED:            'bg-rose-100 text-rose-800',
  ASSIGNEE_CHANGED:            'bg-blue-100 text-blue-800',
  NAME_CHANGED:                'bg-gray-100 text-gray-700',
  DOMAIN_CHANGED:              'bg-gray-100 text-gray-700',
  WORK_STEP_CHANGED:           'bg-indigo-100 text-indigo-800',
  PLANNED_START_DATE_CHANGED:  'bg-orange-100 text-orange-800',
  PLANNED_END_DATE_CHANGED:    'bg-orange-100 text-orange-800',
  ACTUAL_START_DATE_CHANGED:   'bg-orange-100 text-orange-800',
  ACTUAL_END_DATE_CHANGED:     'bg-orange-100 text-orange-800',
  PLANNED_MAN_HOURS_CHANGED:   'bg-purple-100 text-purple-800',
  ACTUAL_MAN_HOURS_CHANGED:    'bg-purple-100 text-purple-800',
  ACTUAL_MAN_HOURS_LOGGED:     'bg-purple-100 text-purple-800',
  DELIVERABLE_ADDED:           'bg-green-100 text-green-800',
  DELIVERABLE_WORKFLOW_CHANGED:'bg-teal-100 text-teal-800',
  DELIVERABLE_UPDATED:         'bg-teal-100 text-teal-800',
  DELIVERABLE_DELETED:         'bg-red-100 text-red-800',
  REFERENCE_ADDED:             'bg-green-100 text-green-800',
  REFERENCE_UPDATED:           'bg-purple-100 text-purple-800',
  REFERENCE_DELETED:           'bg-red-100 text-red-800',
  API_KEY_GENERATED:           'bg-yellow-100 text-yellow-800',
  API_KEY_REVOKED:             'bg-red-100 text-red-800',
};

type ChangeLogSortKey = 'changedAt' | 'taskDisplayId' | 'taskName' | 'operation' | 'changedBy' | 'oldValue' | 'newValue';
type SortDir = 'asc' | 'desc';

interface ChangeLogPageProps {
  onNavigate: (tab: 'requirement' | 'development', taskId?: string) => void;
}

export const ChangeLogPage: React.FC<ChangeLogPageProps> = ({ onNavigate }) => {
  const { tasks, projects, isSystemAdmin, resolveProjectRole, globalSettings } = useProject();
  const ticketKeyByTaskId = useMemo(() => new Map(tasks.map(t => [t.id, t.ticketKey])), [tasks]);

  // 変更ログを閲覧できるプロジェクト（システム管理者は全件、一般ユーザーは
  // 自分のプロジェクトロールが changeLogViewRoles に含まれるものだけ）。
  // 一般ユーザーは全プロジェクト横断（projectId 未指定）を取得できないため、
  // 選択肢と初期選択をこの一覧に絞る。
  const viewableProjects = useMemo(() => {
    if (isSystemAdmin) return projects;
    const roles = globalSettings.changeLogViewRoles ?? [];
    return projects.filter(p => roles.includes(resolveProjectRole(p.id) ?? ''));
  }, [isSystemAdmin, projects, globalSettings.changeLogViewRoles, resolveProjectRole]);
  const [data, setData] = useState<TaskChangeLogPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [detailTask, setDetailTask] = useState<Task | null>(null);

  const [filterOpen, setFilterOpen] = useState(true);
  const [filterProjectId, setFilterProjectId] = useState('');
  const [operation, setOperation] = useState('');
  const [taskDisplayId, setTaskDisplayId] = useState('');
  const [changedBy, setChangedBy] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const [sortKey, setSortKey] = useState<ChangeLogSortKey>('changedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const nameMap = useMemo(
    () => new Map(members.map(m => [m.employeeNumber, m.name])),
    [members]
  );

  const resolveChangedBy = (employeeNumber: string) =>
    nameMap.get(employeeNumber) ?? employeeNumber;

  const sortedContent = useMemo(() => {
    if (!data) return [];
    const rows = [...data.content];
    rows.sort((a, b) => {
      let aVal: string;
      let bVal: string;
      if (sortKey === 'changedBy') {
        aVal = resolveChangedBy(a.changedBy) ?? '';
        bVal = resolveChangedBy(b.changedBy) ?? '';
      } else if (sortKey === 'operation') {
        aVal = OPERATION_LABELS[a.operation] ?? a.operation ?? '';
        bVal = OPERATION_LABELS[b.operation] ?? b.operation ?? '';
      } else {
        aVal = (a[sortKey] as string) ?? '';
        bVal = (b[sortKey] as string) ?? '';
      }
      const cmp = aVal.localeCompare(bVal, 'ja');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data, sortKey, sortDir, nameMap]);

  const handleSort = (key: ChangeLogSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: ChangeLogSortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown size={12} className="inline ml-1 text-gray-400" />;
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="inline ml-1 text-indigo-600" />
      : <ChevronDown size={12} className="inline ml-1 text-indigo-600" />;
  };

  const fetch = useCallback(async (p = 0) => {
    setLoading(true);
    setError('');
    try {
      const result = await changeLogApi.list({
        projectId: filterProjectId ? Number(filterProjectId) : undefined,
        page: p,
        size: PAGE_SIZE,
        operation: operation || undefined,
        taskDisplayId: taskDisplayId || undefined,
        changedBy: changedBy || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      });
      setData(result);
      setPage(p);
    } catch {
      setError('変更ログの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [filterProjectId, operation, taskDisplayId, changedBy, fromDate, toDate]);

  const isFilterActive = !!(filterProjectId || operation || taskDisplayId || changedBy || fromDate || toDate);

  // 一般ユーザーは全プロジェクト横断を取得できないため、閲覧可能な先頭
  // プロジェクトを初期選択する（未選択のままだと取得に失敗するのを防ぐ）
  useEffect(() => {
    if (!isSystemAdmin && !filterProjectId && viewableProjects.length > 0) {
      setFilterProjectId(String(viewableProjects[0].id));
    }
  }, [isSystemAdmin, viewableProjects, filterProjectId]);

  // 初回マウント時のみ fetch（フィルタ変更 useEffect との二重実行を防ぐ）。
  // 一般ユーザーはプロジェクト未選択の状態では取得しない（上の初期選択後に
  // デバウンス useEffect が発火して取得する）。
  const isFirstRender = useRef(true);
  useEffect(() => {
    membersApi.getAll().then(res => setMembers(res as Member[])).catch(() => {});
    if (isSystemAdmin || filterProjectId) fetch(0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // フィルタ変更で自動再検索（300ms デバウンス）
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const timer = setTimeout(() => fetch(0), 300);
    return () => clearTimeout(timer);
  }, [filterProjectId, operation, taskDisplayId, changedBy, fromDate, toDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    // 一般ユーザーは「すべて」を選べないため、閲覧可能な先頭プロジェクトに戻す
    setFilterProjectId(isSystemAdmin ? '' : String(viewableProjects[0]?.id ?? ''));
    setOperation('');
    setTaskDisplayId('');
    setChangedBy('');
    setFromDate('');
    setToDate('');
  };

  const handleOpenDetail = (log: TaskChangeLog) => {
    if (!log.taskId) return;
    const task = tasks.find(t => t.id === log.taskId);
    if (task) setDetailTask(task);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const renderDetail = (log: TaskChangeLog) => {
    const parts: string[] = [];
    if (log.phaseCode) parts.push(log.phaseCode);
    if (log.workStepCode) parts.push(log.workStepCode);
    if (log.deliverableName) parts.push(`「${log.deliverableName}」`);
    return parts.join(' / ') || '—';
  };

  const renderValue = (val: string | null) => {
    if (val === null || val === undefined || val === '') return <span className="text-gray-400">—</span>;
    return <span>{val}</span>;
  };

  return (
    <>
    <div className="flex flex-col h-full gap-4">
      {/* フィルタパネル */}
      <div className="bg-white rounded-xl border border-gray-300 shadow-sm shrink-0">
        {/* ヘッダー（トグル） */}
        <button
          onClick={() => setFilterOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">絞り込み</span>
            {isFilterActive && (
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                適用中
              </span>
            )}
          </span>
          <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${filterOpen ? 'rotate-180' : ''}`} />
        </button>
        {/* コンテンツ（アコーディオン） */}
        <div className={`grid transition-all duration-200 ease-in-out ${filterOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="px-4 pb-4 pt-1 flex flex-wrap gap-3 items-end border-t border-gray-100">
              {/* プロジェクト */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">プロジェクト</label>
                <select
                  value={filterProjectId}
                  onChange={e => setFilterProjectId(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {isSystemAdmin && <option value="">すべて</option>}
                  {viewableProjects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select>
              </div>
              {/* 操作種別 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">操作種別</label>
                <select
                  value={operation}
                  onChange={e => setOperation(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">すべて</option>
                  {Object.entries(OPERATION_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              {/* タスクID */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">タスクID</label>
                <input
                  type="text"
                  value={taskDisplayId}
                  onChange={e => setTaskDisplayId(e.target.value)}
                  placeholder="TASK-R0001"
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {/* 変更者 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">変更者</label>
                <select
                  value={changedBy}
                  onChange={e => setChangedBy(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">すべて</option>
                  {members.map(m => (
                    <option key={m.employeeNumber} value={m.employeeNumber}>{m.name}</option>
                  ))}
                </select>
              </div>
              {/* 日付（開始） */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">日付（開始）</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {/* 日付（終了） */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">日付（終了）</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {/* クリア */}
              {isFilterActive && (
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
                >
                  <X size={14} />
                  クリア
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ログテーブル */}
      <div className="flex-1 min-h-0 bg-white rounded-xl border border-gray-300 shadow-sm overflow-hidden flex flex-col">
        {/* ヘッダー */}
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
          <p className="text-sm text-gray-900">
            {data ? `${data.totalElements.toLocaleString()} 件` : '—'}
          </p>
          {data && data.totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => fetch(page - 1)}
                disabled={page === 0 || loading}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-gray-600">
                {page + 1} / {data.totalPages}
              </span>
              <button
                onClick={() => fetch(page + 1)}
                disabled={page >= data.totalPages - 1 || loading}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* エラー */}
        {error && (
          <div className="px-5 py-4 text-sm text-red-600 shrink-0">{error}</div>
        )}

        {/* ローディング */}
        {loading && (
          <div className="px-5 py-8 text-center text-sm text-gray-400 shrink-0">読み込み中...</div>
        )}

        {/* テーブル */}
        {!loading && data && (
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  {([ ['changedAt', '日時', true], ['taskDisplayId', 'タスクID', true], ['taskName', 'タスク名', false], ['operation', '操作', true], [null, '詳細', true], ['changedBy', '変更者', true], ['oldValue', '変更前', false], ['newValue', '変更後', false] ] as [ChangeLogSortKey | null, string, boolean][]).map(([col, label, nowrap]) =>
                    col ? (
                      <th key={col} className={`px-4 py-3 font-semibold text-gray-600 ${nowrap ? 'whitespace-nowrap' : ''}`}>
                        <button onClick={() => handleSort(col)} className="flex items-center gap-0.5 text-xs font-semibold text-gray-600 hover:text-indigo-600 transition-colors">
                          {label}<SortIcon col={col} />
                        </button>
                      </th>
                    ) : (
                      <th key={label} className={`px-4 py-3 font-semibold text-gray-600 text-xs ${nowrap ? 'whitespace-nowrap' : ''}`}>{label}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedContent.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      変更ログがありません
                    </td>
                  </tr>
                ) : (
                  sortedContent.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                      {/* 日時 */}
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                        {formatDate(log.changedAt)}
                      </td>

                      {/* タスクID */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {log.taskDisplayId && log.taskId ? (
                          <button
                            onClick={() => handleOpenDetail(log)}
                            className="text-indigo-600 hover:text-indigo-800 hover:underline font-mono text-xs font-semibold"
                          >
                            {displayTaskIdFrom(log.taskDisplayId, ticketKeyByTaskId.get(log.taskId))}
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>

                      {/* タスク名 */}
                      <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate" title={log.taskName ?? ''}>
                        {log.taskName ?? <span className="text-gray-400">—</span>}
                      </td>

                      {/* 操作 */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${OPERATION_COLORS[log.operation] ?? 'bg-gray-100 text-gray-700'}`}>
                          {OPERATION_LABELS[log.operation] ?? log.operation}
                        </span>
                      </td>

                      {/* 詳細（フェーズ/工程/成果物名） */}
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {renderDetail(log)}
                      </td>

                      {/* 変更者 */}
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap text-xs">
                        {resolveChangedBy(log.changedBy)}
                      </td>

                      {/* 変更前 */}
                      <td className="px-4 py-3 text-gray-500 max-w-[150px] truncate text-xs" title={log.oldValue ?? ''}>
                        {renderValue(log.oldValue)}
                      </td>

                      {/* 変更後 */}
                      <td className="px-4 py-3 text-gray-900 max-w-[150px] truncate text-xs font-medium" title={log.newValue ?? ''}>
                        {renderValue(log.newValue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* フッターページネーション */}
        {data && data.totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50 shrink-0">
            <span className="text-xs text-gray-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.totalElements)} / {data.totalElements} 件
            </span>
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => fetch(page - 1)}
                disabled={page === 0 || loading}
                className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={13} /> 前へ
              </button>
              <button
                onClick={() => fetch(page + 1)}
                disabled={page >= data.totalPages - 1 || loading}
                className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                次へ <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    {detailTask && (
      <TaskDetailModal task={detailTask} onClose={() => setDetailTask(null)} />
    )}
    </>
  );
};
