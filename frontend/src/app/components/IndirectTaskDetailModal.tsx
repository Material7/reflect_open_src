import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useProject } from '@/context/ProjectContext';
import { Task, WorkStepSchedule, ActualLogEntry, TaskStatus, TaskPriority } from '@/types';
import { INDIRECT_PHASE_CODE, INDIRECT_PHASE_NAME, ROLE_HIERARCHY, PRIORITY_OPTIONS, PRIORITY_LABEL, PRIORITY_BADGE, statusBadge, isRestrictedStatus } from '@/lib/constants';
import { DatePickerWithHolidays } from './DatePickerWithHolidays';
import { tagBadge, TagMultiSelect } from './shared/tags';
import { CommentPanel } from './CommentPanel';
import { commentsApi } from '@/lib/api';
import { X, Plus, Trash2, ChevronDown, Calendar, FileText, ClipboardList, MessageSquare } from 'lucide-react';

/** 工程外タスクのスケジュール（phases.EX.schedule.EX）を取り出す */
export const getIndirectSchedule = (task: Task): WorkStepSchedule =>
  task.phases?.[INDIRECT_PHASE_CODE]?.schedule?.[INDIRECT_PHASE_CODE] ?? { workStepCode: INDIRECT_PHASE_CODE };

export const sumActualHours = (s: WorkStepSchedule): number =>
  (s.actualLog ?? []).reduce((sum, e) => sum + (Number(e.hours) || 0), 0);

/** 小数時間 → "HH:MM"（0/未設定は '—'） */
export const formatHHMM = (hours?: number): string => {
  if (!hours || hours <= 0) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** "HH:MM" → 小数時間（不正なら undefined）。時間は3桁まで許容 */
export const parseHHMM = (s: string): number | undefined => {
  const m = s.trim().match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!m) return undefined;
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
};

interface Props {
  task: Task;
  onClose: () => void;
  initialMainTab?: 'detail' | 'comments';
}

export const IndirectTaskDetailModal: React.FC<Props> = ({ task, onClose, initialMainTab = 'detail' }) => {
  const { updateTask, deleteTask, getSettings, resolveProjectRole } = useProject();
  // 1 タスク＝1 プロジェクト。ユニオンビューだと他プロジェクトのメンバーやドメインが混ざる
  const settings = getSettings(task.projectId);
  // 権限判定はこのタスクが属するプロジェクトでのロールで行う
  const projectRole = resolveProjectRole(task.projectId) ?? '';
  const [activeMainTab, setActiveMainTab] = useState<'detail' | 'comments'>(initialMainTab);
  const [commentCount, setCommentCount] = useState(0);
  const [isEditingAssignee, setIsEditingAssignee] = useState(false);
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);

  useEffect(() => {
    commentsApi.list(task.id).then(c => setCommentCount(c.length)).catch(() => {});
  }, [task.id]);

  const todayStr = new Date().toISOString().split('T')[0];
  const [logDate, setLogDate] = useState(todayStr);
  const [logContent, setLogContent] = useState('');
  const [logHours, setLogHours] = useState('');

  const schedule = useMemo(() => getIndirectSchedule(task), [task]);
  const actualTotal = useMemo(() => sumActualHours(schedule), [schedule]);

  // 状況詳細: 非同期更新される task に直接バインドせずローカル下書きで保持（文字重複バグ対策）
  const [statusDetailDraft, setStatusDetailDraft] = useState(schedule.statusDetail ?? '');
  useEffect(() => {
    setStatusDetailDraft(schedule.statusDetail ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const memberNameByEmpNo = useMemo(
    () => new Map(settings.members.map(m => [m.employeeNumber, m.name])),
    [settings.members]
  );
  const assigneeName = memberNameByEmpNo.get(task.assignee) ?? task.assignee;
  const statusColor = statusBadge(task.status);
  const canDelete = projectRole === 'Admin' || (getSettings(task.projectId).taskDeleteRoles ?? []).includes(projectRole);

  /** schedule を部分更新してタスクを保存 */
  const saveSchedule = useCallback((patch: Partial<WorkStepSchedule>) => {
    const cur = getIndirectSchedule(task);
    const next: WorkStepSchedule = { ...cur, ...patch, workStepCode: INDIRECT_PHASE_CODE };
    next.actualManHours = sumActualHours(next);
    updateTask({
      ...task,
      phases: { ...task.phases, [INDIRECT_PHASE_CODE]: { currentWorkStepCode: INDIRECT_PHASE_CODE, schedule: { [INDIRECT_PHASE_CODE]: next } } },
    });
  }, [task, updateTask]);

  // 編集中の作業記録ID（null = 新規追加モード）
  const [editingLogId, setEditingLogId] = useState<string | null>(null);

  const resetLogInput = useCallback(() => {
    setEditingLogId(null);
    setLogDate(todayStr);
    setLogContent('');
    setLogHours('');
  }, [todayStr]);

  const submitLog = useCallback(() => {
    const hours = parseHHMM(logHours);
    if (!logContent.trim() || hours === undefined || hours <= 0) return;
    const date = logDate || todayStr;
    const existing = schedule.actualLog ?? [];
    const log = (editingLogId
      ? existing.map(e => e.id === editingLogId ? { ...e, date, content: logContent.trim(), hours } : e)
      : [...existing, { id: (crypto.randomUUID?.() ?? `log-${Date.now()}`), date, content: logContent.trim(), hours } as ActualLogEntry]
    ).slice().sort((a, b) => a.date.localeCompare(b.date));
    saveSchedule({ actualLog: log });
    resetLogInput();
  }, [logHours, logContent, logDate, todayStr, schedule.actualLog, saveSchedule, editingLogId, resetLogInput]);

  const startEditLog = useCallback((e: ActualLogEntry) => {
    setEditingLogId(e.id);
    setLogDate(e.date);
    setLogContent(e.content);
    setLogHours(formatHHMM(e.hours));
  }, []);

  const removeLog = useCallback((id: string) => {
    saveSchedule({ actualLog: (schedule.actualLog ?? []).filter(e => e.id !== id) });
    if (editingLogId === id) resetLogInput();
  }, [schedule.actualLog, saveSchedule, editingLogId, resetLogInput]);

  // 予定工数（HH:MM 入力）。タスク切替時のみ表示値を同期
  const [plannedInput, setPlannedInput] = useState('');
  useEffect(() => {
    setPlannedInput(schedule.plannedManHours ? formatHHMM(schedule.plannedManHours) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);
  const handlePlannedChange = (v: string) => {
    setPlannedInput(v);
    if (v.trim() === '') { saveSchedule({ plannedManHours: undefined }); return; }
    const parsed = parseHHMM(v);
    if (parsed !== undefined) saveSchedule({ plannedManHours: parsed });
  };
  const handlePlannedBlur = () => {
    if (plannedInput.trim() === '') return;
    const parsed = parseHHMM(plannedInput);
    setPlannedInput(parsed !== undefined ? formatHHMM(parsed) : plannedInput);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className={`bg-white rounded-t-2xl md:rounded-xl shadow-2xl w-full ${activeMainTab === 'comments' ? 'md:w-fit' : 'md:w-[78rem]'} md:max-w-[95vw] h-[95dvh] md:max-h-[90vh] md:h-auto flex flex-col overflow-hidden`}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-300 flex justify-between items-start bg-gray-50">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded font-medium">
                {settings.domains.find(d => d.id === task.domainId)?.name}
              </span>
              <span className="text-gray-500 text-xs uppercase tracking-wide font-semibold">工程外タスク</span>
              <span className="text-gray-500 text-xs font-mono font-semibold">{task.taskId}</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900">{task.name}</h2>
              {/* タグ（タイトルの右側） */}
              <div className="flex items-center flex-wrap gap-1.5">
                {(task.tags ?? []).map(t => (
                  <span key={t} className={`px-2 py-0.5 rounded text-xs font-medium ${tagBadge(t)}`}>{t}</span>
                ))}
                {isEditingTags ? (
                  <>
                    <div className="relative z-40 min-w-[220px]">
                      <TagMultiSelect
                        options={getSettings(task.projectId).tags ?? []}
                        value={task.tags ?? []}
                        onChange={next => updateTask({ ...task, tags: next })}
                      />
                    </div>
                    <div className="fixed inset-0 z-30" onClick={() => setIsEditingTags(false)} />
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditingTags(true)}
                    title="タグ"
                    className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset bg-gray-50 text-gray-400 ring-gray-200 transition-opacity hover:opacity-75"
                  >
                    {(task.tags ?? []).length > 0 ? 'タグ編集' : 'タグ'}
                    <ChevronDown size={11} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
              <span className="bg-gray-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">{assigneeName.charAt(0)}</span>
              {isEditingAssignee ? (
                <select
                  autoFocus
                  value={task.assignee}
                  onChange={e => { updateTask({ ...task, assignee: e.target.value }); setIsEditingAssignee(false); }}
                  onBlur={() => setIsEditingAssignee(false)}
                  className="border border-indigo-400 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {settings.members.filter(m => m.employeeNumber !== 'admin').map(m => (
                    <option key={m.id} value={m.employeeNumber}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <button onClick={() => setIsEditingAssignee(true)} className="hover:text-indigo-600 hover:underline cursor-pointer">{assigneeName}</button>
              )}
              {/* 優先度（ステータスの左） */}
              {isEditingPriority ? (
                <div className="relative">
                  <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded shadow-lg min-w-[90px]">
                    {[{ value: '' as const, label: '未設定' }, ...PRIORITY_OPTIONS].map(opt => (
                      <div
                        key={opt.value || 'none'}
                        onClick={() => { updateTask({ ...task, priority: (opt.value || null) as TaskPriority | null }); setIsEditingPriority(false); }}
                        className={`flex items-center px-3 py-1.5 text-xs cursor-pointer ${
                          (task.priority ?? '') === opt.value ? 'bg-gray-100 text-gray-900 font-semibold' : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        {opt.label}
                      </div>
                    ))}
                  </div>
                  <div className="fixed inset-0 z-40" onClick={() => setIsEditingPriority(false)} />
                </div>
              ) : (
                <button
                  onClick={() => setIsEditingPriority(true)}
                  title="優先度"
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset transition-opacity hover:opacity-75 ${
                    task.priority ? `${PRIORITY_BADGE[task.priority]} ring-black/5` : 'bg-gray-50 text-gray-400 ring-gray-200'
                  }`}
                >
                  {task.priority ? PRIORITY_LABEL[task.priority] : '優先度'}
                  <ChevronDown size={11} />
                </button>
              )}
              {isEditingStatus ? (
                <div className="relative">
                  <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded shadow-lg min-w-[100px]">
                    {settings.taskStatuses.map(s => {
                      const roleRestricted = isRestrictedStatus(s) && (ROLE_HIERARCHY[projectRole] ?? 99) > ROLE_HIERARCHY['SL'];
                      const color = statusBadge(s);
                      return (
                        <div
                          key={s}
                          onClick={() => { if (roleRestricted) return; updateTask({ ...task, status: s as TaskStatus }); setIsEditingStatus(false); }}
                          className={`px-3 py-1.5 text-xs ${roleRestricted ? 'cursor-not-allowed text-gray-300 bg-gray-50' : s === task.status ? `cursor-pointer ${color.bg} ${color.text}` : 'cursor-pointer hover:bg-gray-50 text-gray-700'}`}
                        >
                          {s}
                        </div>
                      );
                    })}
                    {canDelete && (
                      <>
                        <div className="border-t border-gray-200 my-0.5" />
                        <div
                          onClick={() => { setIsEditingStatus(false); if (window.confirm(`タスク「${task.name}」を削除しますか？\nこの操作は取り消せません。`)) { deleteTask(task.id); onClose(); } }}
                          className="px-3 py-1.5 text-xs cursor-pointer text-red-600 hover:bg-red-50"
                        >
                          削除
                        </div>
                      </>
                    )}
                  </div>
                  <div className="fixed inset-0 z-40" onClick={() => setIsEditingStatus(false)} />
                </div>
              ) : (
                <button onClick={() => setIsEditingStatus(true)} className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 transition-opacity hover:opacity-75 ${statusColor.bg} ${statusColor.text} ${statusColor.ring}`}>
                  {task.status}<ChevronDown size={11} />
                </button>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-200 rounded"><X size={24} /></button>
        </div>

        {/* タブ（工程外 / コメント） */}
        <div className="shrink-0 flex border-b border-gray-300">
          <button
            onClick={() => setActiveMainTab('detail')}
            className={`px-7 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeMainTab === 'detail' ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50' : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
            }`}
          >
            <div className="flex flex-col items-center gap-1">
              <span className="text-lg font-bold leading-none">{INDIRECT_PHASE_CODE}</span>
              <span className="text-[11px] leading-none">{INDIRECT_PHASE_NAME}</span>
            </div>
          </button>
          <button
            onClick={() => setActiveMainTab('comments')}
            className={`ml-auto px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
              activeMainTab === 'comments' ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50' : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
            }`}
          >
            <MessageSquare size={14} />
            コメント
            {commentCount > 0 && (
              <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 leading-none">{commentCount}</span>
            )}
          </button>
        </div>

        {/* コメントパネル */}
        {activeMainTab === 'comments' && (
          <div className="px-4 py-5 overflow-y-auto flex-1 min-h-0 bg-white">
            <CommentPanel taskId={task.id} projectId={task.projectId} onCountChange={setCommentCount} className="w-[720px] max-w-full" />
          </div>
        )}

        {/* Body: 左=予実・状況詳細 / 右=実績作業記録 */}
        {activeMainTab === 'detail' && (
        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 md:grid-cols-5 gap-4 p-6 bg-white">
          {/* 左カラム（予実・状況詳細） */}
          <div className="md:col-span-2 flex flex-col gap-4">
            {/* 日程・工数カード */}
            <div className="rounded-lg px-3 py-4 border border-gray-300 bg-white">
              <h3 className="text-xs font-bold text-gray-800 mb-3 flex items-center gap-1.5"><Calendar size={14} /> 日程・工数</h3>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">開始予定日</label>
                  <DatePickerWithHolidays value={schedule.plannedStartDate || ''} onChange={v => saveSchedule({ plannedStartDate: v || undefined })} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">完了予定日</label>
                  <DatePickerWithHolidays value={schedule.plannedEndDate || ''} onChange={v => saveSchedule({ plannedEndDate: v || undefined })} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">開始日（実績）</label>
                  <DatePickerWithHolidays value={schedule.actualStartDate || ''} onChange={v => saveSchedule({ actualStartDate: v || undefined })} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">完了日（実績）</label>
                  <DatePickerWithHolidays value={schedule.actualEndDate || ''} onChange={v => saveSchedule({ actualEndDate: v || undefined })} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">予定工数（hh:mm）</label>
                  <input
                    type="text" inputMode="numeric"
                    value={plannedInput}
                    onChange={e => handlePlannedChange(e.target.value)}
                    onBlur={handlePlannedBlur}
                    placeholder="00:00"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">実績工数（合計）</label>
                  <div className="px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white font-semibold text-gray-900">{formatHHMM(actualTotal)}</div>
                </div>
              </div>
            </div>

            {/* 状況詳細カード */}
            <div className="rounded-lg px-3 py-4 border border-gray-300 bg-white">
              <h3 className="text-xs font-bold text-gray-800 mb-3 flex items-center gap-1.5"><FileText size={14} /> 状況詳細</h3>
              <textarea
                value={statusDetailDraft}
                onChange={e => setStatusDetailDraft(e.target.value)}
                onBlur={() => { if (statusDetailDraft !== (schedule.statusDetail ?? '')) saveSchedule({ statusDetail: statusDetailDraft }); }}
                placeholder="進捗・状況・特記事項を記入"
                className="h-32 w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
          </div>

          {/* 右カラム（実績作業記録カード） */}
          <div className="md:col-span-3 min-w-0">
            <div className="rounded-lg px-3 py-4 border border-gray-300 bg-white h-full flex flex-col">
              <h3 className="text-xs font-bold text-gray-800 mb-3 flex items-center gap-1.5"><ClipboardList size={14} /> 実績作業記録</h3>
              {/* 入力行 */}
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <div className="w-36">
                  <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">日付</label>
                  <DatePickerWithHolidays value={logDate} onChange={setLogDate} />
                </div>
                <div className="flex-1 min-w-[14rem]">
                  <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">作業内容</label>
                  <input type="text" value={logContent} onChange={e => setLogContent(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitLog(); }}
                    placeholder="例：定例会議、日報記載"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="w-24">
                  <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">工数(hh:mm)</label>
                  <input type="text" inputMode="numeric" value={logHours} onChange={e => setLogHours(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitLog(); }}
                    placeholder="00:00"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <button onClick={submitLog} className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 flex items-center gap-1">
                  <Plus size={15} /> {editingLogId ? '更新' : '追加'}
                </button>
                {editingLogId && (
                  <button onClick={resetLogInput} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200">
                    取消
                  </button>
                )}
              </div>
              {/* ログ一覧 */}
              <div className="border border-gray-200 rounded-lg overflow-auto max-h-80">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10"><tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                    <th className="px-3 py-2 text-left font-semibold w-28">日付</th>
                    <th className="px-3 py-2 text-left font-semibold">作業内容</th>
                    <th className="px-3 py-2 text-right font-semibold w-20">工数</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {(schedule.actualLog ?? []).length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400 text-xs">記録がありません</td></tr>
                    ) : (schedule.actualLog ?? []).map(e => (
                      <tr key={e.id} onClick={() => startEditLog(e)} title="クリックで編集"
                        className={`cursor-pointer ${editingLogId === e.id ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                        <td className="px-3 py-2 text-gray-600 font-mono text-xs whitespace-nowrap">{e.date.replace(/-/g, '/')}</td>
                        <td className="px-3 py-2 text-gray-800">{e.content}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">{formatHHMM(e.hours)}</td>
                        <td className="px-2 py-2">
                          <button onClick={ev => { ev.stopPropagation(); removeLog(e.id); }} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* フッター（閉じるボタン） */}
        <div className="px-6 py-4 border-t border-gray-300 bg-gray-50 flex justify-end">
          <button
            onClick={() => { if (statusDetailDraft !== (schedule.statusDetail ?? '')) saveSchedule({ statusDetail: statusDetailDraft }); onClose(); }}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
