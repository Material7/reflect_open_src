import React, { useState, useMemo, useEffect } from 'react';
import { useProject } from '@/context/ProjectContext';
import { surveysApi } from '@/lib/api';
import {
  Survey, SurveyDto, SurveyQuestion, SurveyQuestionType, SurveyResults,
  SurveyResultAudience, SurveyIdentityAudience, SurveyResultTiming, SurveyAnswerValue,
} from '@/types';
import { surveyDueState } from '@/lib/constants';
import { DatePickerWithHolidays } from './DatePickerWithHolidays';
import {
  Plus, X, Trash2, Pencil, BarChart3, Send, Lock, Users, ClipboardCheck,
  ChevronUp, ChevronDown, AlertCircle, CheckCircle2, Circle, Download,
} from 'lucide-react';

const QUESTION_TYPE_LABEL: Record<SurveyQuestionType, string> = {
  single: '単一選択', multi: '複数選択', text: '自由記述', rating: '評価尺度',
};

const STATUS_BADGE: Record<Survey['status'], { label: string; cls: string }> = {
  draft: { label: '下書き', cls: 'bg-gray-100 text-gray-600' },
  open: { label: '公開中', cls: 'bg-green-100 text-green-700' },
  closed: { label: '締切', cls: 'bg-slate-200 text-slate-600' },
};

const ROLE_THRESHOLD_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '指定なし' },
  { value: 'PL', label: 'PL以上' },
  { value: 'DL', label: 'DL以上' },
  { value: 'SL', label: 'SL以上' },
];
/** しきい値 → 対象ロール audience 配列（その役職“以上”）。PM はベースライン */
const roleAudiencesFor = (threshold: string): ('pl' | 'dl' | 'sl')[] =>
  threshold === 'SL' ? ['pl', 'dl', 'sl'] : threshold === 'DL' ? ['pl', 'dl'] : threshold === 'PL' ? ['pl'] : [];
/** audience 配列 → しきい値（最下位の含まれるロール） */
const thresholdFromAudiences = (arr: readonly string[]): string =>
  arr.includes('sl') ? 'SL' : arr.includes('dl') ? 'DL' : arr.includes('pl') ? 'PL' : '';
const TIMING_OPTIONS: { value: SurveyResultTiming; label: string }[] = [
  { value: 'after_close', label: '締切後のみ' },
  { value: 'after_answer', label: '自分の回答後' },
  { value: 'always', label: '常時' },
];

/** バックエンドの canViewResults を踏襲した、集計ボタン表示判定（最終的な認可はサーバ側） */
const canViewResultsClient = (
  s: Survey,
  ctx: { emp: string | null; role: string | null; isAdmin: boolean; isTarget: boolean; responded: boolean },
): boolean => {
  if (ctx.isAdmin) return true;
  if (s.createdBy && s.createdBy === ctx.emp) return true;
  if (ctx.role === 'PM') return true; // ベースライン
  const vis = s.resultVisibleTo ?? [];
  if (vis.includes('all')) return s.projectId == null || ctx.role != null;
  if (ctx.role && vis.includes(ctx.role.toLowerCase() as SurveyResultAudience)) return true;
  if (vis.includes('respondents') && ctx.isTarget) {
    const t = s.resultTiming === 'always' || (s.resultTiming === 'after_answer' && ctx.responded)
      || (s.resultTiming === 'after_close' && s.status === 'closed');
    if (t) return true;
  }
  return false;
};

/** "YYYY-MM-DD" を "m/d"（先頭ゼロなし）に整形 */
const formatMd = (d?: string | null): string => {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length < 3) return d;
  return `${Number(parts[1])}/${Number(parts[2])}`;
};

const csvEscape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const toCsv = (rows: (string | number | null | undefined)[][]) =>
  rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
const downloadCsv = (content: string, filename: string) => {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};
const dateStamp = () => {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
};
const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'survey';
const fmtAnswerValue = (v: SurveyAnswerValue | undefined): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(' / ');
  return String(v);
};
const fmtDateTime = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 期限バッジ（未回答者視点）。回答済み/期限なしのときは null */
export const SurveyDueBadge: React.FC<{ dueDate?: string | null }> = ({ dueDate }) => {
  const state = surveyDueState(dueDate);
  if (state === 'none' || state === 'normal') {
    return dueDate ? <span className="text-xs text-gray-400">期限 {formatMd(dueDate)}</span> : null;
  }
  if (state === 'overdue') {
    return <span className="inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700">⛔ 期限切れ {formatMd(dueDate)}</span>;
  }
  const days = Math.round((new Date(dueDate + 'T00:00:00').getTime() - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime()) / 86400000);
  return <span className="inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">⚠ あと{days}日 {formatMd(dueDate)}</span>;
};

const newQuestion = (): SurveyQuestion => ({
  id: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `q-${Date.now()}-${Math.random()}`),
  type: 'single', title: '', required: true, options: ['選択肢1'], ratingMax: 5,
});

/** projectId: null = 全プロジェクト（全社） */
interface SurveyForm {
  projectId: number | null;
  title: string;
  description: string;
  targetType: 'members' | 'all';
  targetMemberIds: string[];
  dueDate: string;
  questions: SurveyQuestion[];
  resultVisibleTo: SurveyResultAudience[];
  identityVisibleTo: SurveyIdentityAudience[];
  resultTiming: SurveyResultTiming;
}

export const SurveyListPage: React.FC = () => {
  const { surveys, projects, currentUser, getProjectMembers, createSurvey, updateSurvey, deleteSurvey } = useProject();
  const [filterProjectId, setFilterProjectId] = useState<string>('');
  const [editing, setEditing] = useState<SurveyDto | 'new' | null>(null);
  const [answering, setAnswering] = useState<SurveyDto | null>(null);
  const [viewingResults, setViewingResults] = useState<SurveyDto | null>(null);

  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const projectLabel = (pid: number | null) => pid == null ? '全プロジェクト' : (projectNameById.get(pid) ?? '—');
  const isAdmin = currentUser?.role === 'Admin';
  const myRole = (pid: number | null) =>
    pid == null ? null : (getProjectMembers(pid).find(m => m.employeeNumber === currentUser?.employeeNumber)?.role ?? null);

  const filtered = useMemo(() => {
    return surveys.filter(d => !filterProjectId || String(d.survey.projectId) === filterProjectId);
  }, [surveys, filterProjectId]);

  const canManage = (s: Survey) => isAdmin || s.createdBy === currentUser?.employeeNumber;

  const handleDelete = async (id: string) => {
    if (!window.confirm('このアンケートを削除しますか？回答も削除されます。')) return;
    await deleteSurvey(id);
  };

  const handleClose = async (dto: SurveyDto) => {
    if (!window.confirm('このアンケートを締切にしますか？以降は回答できなくなります。')) return;
    const s = dto.survey;
    await updateSurvey(s.id, { ...s, status: 'closed' });
  };

  return (
    <div className="flex flex-col h-full gap-4 p-1">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={20} className="text-indigo-500" />
          <h2 className="text-lg font-bold text-gray-800">アンケート</h2>
        </div>
        <div className="flex items-center gap-2">
          <select value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white">
            <option value="">全プロジェクト</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {projects.length > 0 && (
            <button onClick={() => setEditing('new')}
              className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
              <Plus size={16} /> 新規作成
            </button>
          )}
        </div>
      </div>

      {/* 一覧 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-gray-400 text-sm">アンケートがありません</div>
        ) : (
          <div className="space-y-2">
            {filtered.map(dto => {
              const s = dto.survey;
              const manage = canManage(s);
              const role = myRole(s.projectId);
              const showResults = s.status !== 'draft' && canViewResultsClient(s, {
                emp: currentUser?.employeeNumber ?? null, role, isAdmin,
                isTarget: dto.targetedToMe, responded: dto.respondedByMe,
              });
              const needsMyAnswer = dto.targetedToMe && s.status === 'open' && !dto.respondedByMe;
              return (
                <div key={s.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-indigo-200 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${STATUS_BADGE[s.status].cls}`}>{STATUS_BADGE[s.status].label}</span>
                        <span className="font-semibold text-gray-800 truncate">{s.title}</span>
                        {needsMyAnswer && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">要回答</span>}
                        {dto.respondedByMe && <span className="inline-flex items-center gap-0.5 text-[11px] text-green-600"><CheckCircle2 size={12} />回答済み</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                        <span>{projectLabel(s.projectId)}</span>
                        <span className="inline-flex items-center gap-0.5"><Users size={12} />回答 {dto.respondentCount}/{dto.targetCount}</span>
                        <span>{s.questions.length}問</span>
                        {needsMyAnswer ? <SurveyDueBadge dueDate={s.dueDate} />
                          : s.dueDate && <span className="text-gray-400">期限 {formatMd(s.dueDate)}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {needsMyAnswer && (
                        <button onClick={() => setAnswering(dto)}
                          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg shadow-sm">
                          <Send size={16} /> 回答する
                        </button>
                      )}
                      {dto.targetedToMe && s.status === 'open' && dto.respondedByMe && (
                        <button onClick={() => setAnswering(dto)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1.5">再回答</button>
                      )}
                      {showResults && (
                        <button onClick={() => setViewingResults(dto)} title="集計"
                          className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"><BarChart3 size={16} /></button>
                      )}
                      {manage && (
                        <>
                          <button onClick={() => setEditing(dto)} title="編集"
                            className="p-1.5 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"><Pencil size={15} /></button>
                          {s.status === 'open' && (
                            <button onClick={() => handleClose(dto)} title="締切にする"
                              className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg"><Lock size={15} /></button>
                          )}
                          <button onClick={() => handleDelete(s.id)} title="削除"
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={15} /></button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <SurveyFormModal
          dto={editing === 'new' ? null : editing}
          defaultProjectId={filterProjectId ? Number(filterProjectId) : (projects[0]?.id ?? 0)}
          onClose={() => setEditing(null)}
          onSave={async (input, id) => { id ? await updateSurvey(id, input) : await createSurvey(input); setEditing(null); }}
        />
      )}
      {answering && <AnswerModal dto={answering} onClose={() => setAnswering(null)} />}
      {viewingResults && <ResultsModal dto={viewingResults} onClose={() => setViewingResults(null)} />}
    </div>
  );
};

const SurveyFormModal: React.FC<{
  dto: SurveyDto | null;
  defaultProjectId: number;
  onClose: () => void;
  onSave: (input: Omit<Survey, 'id' | 'createdBy' | 'createdAt'>, id?: string) => Promise<void>;
}> = ({ dto, defaultProjectId, onClose, onSave }) => {
  const { projects, getProjectMembers, members: globalMembers } = useProject();
  const existing = dto?.survey ?? null;
  const isDraft = !existing || existing.status === 'draft';

  const [form, setForm] = useState<SurveyForm>(() => existing ? {
    projectId: existing.projectId,
    title: existing.title,
    description: existing.description ?? '',
    targetType: existing.targetType,
    targetMemberIds: existing.targetMemberIds ?? [],
    dueDate: existing.dueDate ?? '',
    questions: existing.questions.length ? existing.questions : [newQuestion()],
    resultVisibleTo: existing.resultVisibleTo ?? [],
    identityVisibleTo: existing.identityVisibleTo ?? [],
    resultTiming: existing.resultTiming,
  } : {
    projectId: defaultProjectId,
    title: '', description: '',
    targetType: 'members', targetMemberIds: [], dueDate: '',
    questions: [newQuestion()],
    resultVisibleTo: [], identityVisibleTo: [], resultTiming: 'after_close',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 対象候補: 全プロジェクト(null)時は全社アカウント、それ以外はプロジェクト所属メンバー。Admin は対象外
  const targetCandidates = (form.projectId == null
    ? globalMembers
    : getProjectMembers(form.projectId)
  ).map(m => ({ employeeNumber: m.employeeNumber, name: m.name, role: m.role }))
    .filter(m => m.role !== 'Admin');
  const set = (patch: Partial<SurveyForm>) => setForm(f => ({ ...f, ...patch }));

  // ロール（pl/dl/sl）が結果を閲覧できる構成か（'all' でも可）
  const roleCanView = (role: string, resultVisibleTo: SurveyResultAudience[]) =>
    resultVisibleTo.includes('all') || resultVisibleTo.includes(role as SurveyResultAudience);

  const isGlobalSurvey = form.projectId == null; // 全社アンケートはロールしきい値を解決できない

  // 集計結果を閲覧できる範囲を再構築（しきい値 ∪ 回答者 ∪ 全員）。individual は結果を超えられないため絞る
  const rebuildResult = (threshold: string, respondents: boolean, all: boolean) => setForm(f => {
    const resultVisibleTo: SurveyResultAudience[] = [...roleAudiencesFor(threshold)];
    if (respondents) resultVisibleTo.push('respondents');
    if (all) resultVisibleTo.push('all');
    const identityVisibleTo = f.identityVisibleTo.filter(x => x === 'viewers' || roleCanView(x, resultVisibleTo));
    return { ...f, resultVisibleTo, identityVisibleTo };
  });
  const resultThreshold = thresholdFromAudiences(form.resultVisibleTo);
  const resultRespondents = form.resultVisibleTo.includes('respondents');
  const resultAll = form.resultVisibleTo.includes('all');

  // 個別回答の特定は「しきい値（○○以上）」または「集計閲覧者すべて(viewers)」の排他
  const identityMode = form.identityVisibleTo.includes('viewers') ? 'viewers' : thresholdFromAudiences(form.identityVisibleTo);
  const setIdentityMode = (mode: string) => setForm(f => {
    if (mode === 'viewers') return { ...f, identityVisibleTo: ['viewers'] };
    // ロールしきい値。ただし結果を閲覧できるロールに限る（個別特定 ⊆ 集計閲覧）
    const roles = roleAudiencesFor(mode).filter(r => roleCanView(r, f.resultVisibleTo));
    return { ...f, identityVisibleTo: roles };
  });

  // 漏洩ガード: 回答者が集計を見られ、かつ集計閲覧者すべてが個別特定可 = 回答者相互に個別回答が見える
  const identityLeakWarning = resultRespondents && form.identityVisibleTo.includes('viewers');

  const setQuestion = (idx: number, patch: Partial<SurveyQuestion>) =>
    setForm(f => ({ ...f, questions: f.questions.map((q, i) => i === idx ? { ...q, ...patch } : q) }));
  const moveQuestion = (idx: number, dir: -1 | 1) =>
    setForm(f => {
      const next = [...f.questions];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return f;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...f, questions: next };
    });

  const toggleMember = (emp: string) =>
    setForm(f => ({
      ...f,
      targetMemberIds: f.targetMemberIds.includes(emp)
        ? f.targetMemberIds.filter(e => e !== emp)
        : [...f.targetMemberIds, emp],
    }));

  const buildPayload = (status: Survey['status']): Omit<Survey, 'id' | 'createdBy' | 'createdAt'> => ({
    projectId: form.projectId,
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    status,
    targetType: form.targetType,
    targetMemberIds: form.targetType === 'all' ? [] : form.targetMemberIds,
    dueDate: form.dueDate || null,
    questions: form.questions,
    resultVisibleTo: form.resultVisibleTo,
    identityVisibleTo: form.identityVisibleTo,
    resultTiming: form.resultTiming,
  });

  const validate = (publishing: boolean): string | null => {
    if (!form.title.trim()) return 'タイトルを入力してください';
    for (const q of form.questions) {
      if (!q.title.trim()) return '設問タイトルが空の項目があります';
      if ((q.type === 'single' || q.type === 'multi') && (q.options ?? []).filter(o => o.trim()).length < 1)
        return '選択式の設問には選択肢が必要です';
    }
    if (publishing) {
      if (form.questions.length === 0) return '公開するには設問が必要です';
      if (form.targetType === 'members' && form.targetMemberIds.length === 0) return '公開するには対象者を選択してください';
    }
    return null;
  };

  const submit = async (status: Survey['status']) => {
    const err = validate(status !== 'draft');
    if (err) { setError(err); return; }
    setSaving(true);
    try {
      await onSave(buildPayload(status), existing?.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-gray-800">{existing ? 'アンケート編集' : 'アンケート作成'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {!isDraft && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              公開済みのため、設問・対象は編集できません（タイトル・説明・期限・権限・締切は変更可）。
            </div>
          )}

          {/* 基本情報 */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">プロジェクト</label>
              <select value={form.projectId == null ? 'all' : String(form.projectId)} disabled={!!existing}
                onChange={e => set({ projectId: e.target.value === 'all' ? null : Number(e.target.value), targetMemberIds: [] })}
                className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 disabled:bg-gray-100">
                <option value="all">全プロジェクト</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.code}）</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">タイトル<span className="text-red-500">*</span></label>
              <input value={form.title} onChange={e => set({ title: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5" placeholder="例: 6月度ふりかえりアンケート" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
              <textarea value={form.description} onChange={e => set({ description: e.target.value })}
                rows={2} className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">回答期限</label>
              <div className="w-44"><DatePickerWithHolidays value={form.dueDate} onChange={v => set({ dueDate: v })} clearable /></div>
            </div>
          </div>

          {/* 対象ユーザー */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">対象ユーザー</label>
            <div className="flex items-center gap-3 mb-2 text-sm">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" disabled={!isDraft} checked={form.targetType === 'members'} onChange={() => set({ targetType: 'members' })} />
                個別に選択
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" disabled={!isDraft} checked={form.targetType === 'all'} onChange={() => set({ targetType: 'all' })} />
                {form.projectId == null ? '全プロジェクトのメンバー' : 'プロジェクト全員'}
              </label>
            </div>
            {form.targetType === 'members' && (
              <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto divide-y">
                {targetCandidates.length === 0 ? (
                  <div className="text-xs text-gray-400 px-3 py-2">メンバーがいません</div>
                ) : targetCandidates.map(m => (
                  <label key={m.employeeNumber} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" disabled={!isDraft}
                      checked={form.targetMemberIds.includes(m.employeeNumber)}
                      onChange={() => toggleMember(m.employeeNumber)} />
                    <span>{m.name}</span>
                    <span className="text-xs text-gray-400">{m.role}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 設問ビルダー */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">設問</label>
            <div className="space-y-3">
              {form.questions.map((q, idx) => (
                <QuestionEditor key={q.id} q={q} idx={idx} total={form.questions.length} editable={isDraft}
                  onChange={p => setQuestion(idx, p)} onMove={dir => moveQuestion(idx, dir)}
                  onRemove={() => set({ questions: form.questions.filter((_, i) => i !== idx) })} />
              ))}
            </div>
            {isDraft && (
              <button onClick={() => set({ questions: [...form.questions, newQuestion()] })}
                className="mt-2 inline-flex items-center gap-0.5 text-xs text-indigo-600 hover:text-indigo-800 border border-dashed border-indigo-300 rounded-lg px-3 py-1.5 w-full justify-center hover:bg-indigo-50">
                <Plus size={13} />設問を追加
              </button>
            )}
          </div>

          {/* 権限設定 */}
          <div className="border-t pt-4">
            <h4 className="text-xs font-semibold text-gray-700 mb-1">権限設定</h4>
            <p className="text-[11px] text-gray-400 mb-3">作成者・PM・システムAdmin は常に閲覧・特定できます。「○○以上」はプロジェクトロールの階層で、その役職以上に許可します。</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1.5">集計結果を見れる人</label>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {!isGlobalSurvey && (
                    <select value={resultThreshold} disabled={resultAll} onChange={e => rebuildResult(e.target.value, resultRespondents, resultAll)}
                      className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 disabled:bg-gray-100 disabled:text-gray-400">
                      {ROLE_THRESHOLD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                  <label className={`inline-flex items-center gap-1.5 text-sm ${resultAll ? 'text-gray-300' : ''}`}>
                    <input type="checkbox" checked={resultRespondents} disabled={resultAll}
                      onChange={e => rebuildResult(resultThreshold, e.target.checked, resultAll)} />
                    回答対象者
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={resultAll}
                      onChange={e => rebuildResult(resultThreshold, resultRespondents, e.target.checked)} />
                    {isGlobalSurvey ? '回答者全員' : 'プロジェクト全員'}
                  </label>
                </div>
                {resultAll && <p className="text-[11px] text-gray-400 mt-1">「{isGlobalSurvey ? '回答者全員' : 'プロジェクト全員'}」が有効なため、しきい値・回答対象者の指定は無効です</p>}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1.5">個別回答を特定できる人</label>
                <select value={identityMode} onChange={e => setIdentityMode(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5">
                  <option value="">指定なし（作成者・PM・管理者のみ）</option>
                  {!isGlobalSurvey && ROLE_THRESHOLD_OPTIONS.filter(o => o.value).map(o => (
                    <option key={o.value} value={o.value} disabled={!roleCanView(o.value.toLowerCase(), form.resultVisibleTo)}>{o.label}</option>
                  ))}
                  <option value="viewers">集計結果を見れる人すべて</option>
                </select>
                <p className="text-[11px] text-gray-400 mt-0.5">個別特定は集計を閲覧できる範囲内のみ指定できます</p>
                {identityLeakWarning && (
                  <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1"><AlertCircle size={12} />回答対象者が互いの個別回答を閲覧できる設定です。回答者層に見せたくない場合はご注意ください。</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">対象者への結果公開タイミング</label>
                <select value={form.resultTiming} disabled={!form.resultVisibleTo.includes('respondents')}
                  onChange={e => set({ resultTiming: e.target.value as SurveyResultTiming })}
                  className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 disabled:bg-gray-100 disabled:text-gray-400">
                  {TIMING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {!form.resultVisibleTo.includes('respondents') && (
                  <p className="text-[11px] text-gray-400 mt-0.5">「回答対象者」を選ぶと有効になります</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {error && <div className="px-5 text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} />{error}</div>}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="text-sm text-gray-600 px-3 py-1.5">キャンセル</button>
          {isDraft && (
            <button onClick={() => submit('draft')} disabled={saving}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">下書き保存</button>
          )}
          <button onClick={() => submit(existing && existing.status !== 'draft' ? existing.status : 'open')} disabled={saving}
            className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-1.5 disabled:opacity-50">
            {existing && existing.status !== 'draft' ? '更新' : '公開'}
          </button>
        </div>
      </div>
    </div>
  );
};

const QuestionEditor: React.FC<{
  q: SurveyQuestion; idx: number; total: number; editable: boolean;
  onChange: (patch: Partial<SurveyQuestion>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}> = ({ q, idx, total, editable, onChange, onMove, onRemove }) => {
  const setOption = (i: number, v: string) => onChange({ options: (q.options ?? []).map((o, j) => j === i ? v : o) });
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-gray-400 w-5">Q{idx + 1}</span>
        <input value={q.title} onChange={e => onChange({ title: e.target.value })} disabled={!editable}
          className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100" placeholder="設問タイトル" />
        {editable && (
          <div className="flex items-center gap-0.5">
            <button onClick={() => onMove(-1)} disabled={idx === 0} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ChevronUp size={14} /></button>
            <button onClick={() => onMove(1)} disabled={idx === total - 1} className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ChevronDown size={14} /></button>
            <button onClick={onRemove} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 mb-2 pl-7">
        <select value={q.type} disabled={!editable}
          onChange={e => {
            const type = e.target.value as SurveyQuestionType;
            onChange({ type, options: (type === 'single' || type === 'multi') ? (q.options?.length ? q.options : ['選択肢1']) : q.options, ratingMax: type === 'rating' ? (q.ratingMax ?? 5) : q.ratingMax });
          }}
          className="text-xs border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100">
          {(['single', 'multi', 'text', 'rating'] as SurveyQuestionType[]).map(t => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" checked={q.required} disabled={!editable} onChange={e => onChange({ required: e.target.checked })} /> 必須
        </label>
        {q.type === 'rating' && (
          <label className="inline-flex items-center gap-1 text-xs text-gray-600">
            段階
            <input type="number" min={2} max={10} value={q.ratingMax ?? 5} disabled={!editable}
              onChange={e => onChange({ ratingMax: Math.max(2, Math.min(10, Number(e.target.value))) })}
              className="w-14 text-xs border border-gray-300 rounded px-1.5 py-1 disabled:bg-gray-100" />
          </label>
        )}
      </div>
      {(q.type === 'single' || q.type === 'multi') && (
        <div className="pl-7 space-y-1">
          {(q.options ?? []).map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {q.type === 'single' ? <Circle size={12} className="text-gray-300" /> : <span className="w-3 h-3 border border-gray-300 rounded-sm" />}
              <input value={opt} onChange={e => setOption(i, e.target.value)} disabled={!editable}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 disabled:bg-gray-100" />
              {editable && (q.options?.length ?? 0) > 1 && (
                <button onClick={() => onChange({ options: q.options?.filter((_, j) => j !== i) })} className="p-0.5 text-gray-400 hover:text-red-500"><X size={13} /></button>
              )}
            </div>
          ))}
          {editable && (
            <button onClick={() => onChange({ options: [...(q.options ?? []), `選択肢${(q.options?.length ?? 0) + 1}`] })}
              className="inline-flex items-center gap-0.5 text-[11px] text-indigo-600 hover:text-indigo-800 ml-4"><Plus size={11} />選択肢を追加</button>
          )}
        </div>
      )}
    </div>
  );
};

const AnswerModal: React.FC<{ dto: SurveyDto; onClose: () => void }> = ({ dto, onClose }) => {
  const { submitSurveyResponse } = useProject();
  const s = dto.survey;
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    surveysApi.myResponse(s.id).then(r => { if (r?.answers) setAnswers(r.answers); }).catch(() => {});
  }, [s.id]);

  const setAns = (qid: string, v: SurveyAnswerValue) => setAnswers(a => ({ ...a, [qid]: v }));
  const toggleMulti = (qid: string, opt: string) => setAnswers(a => {
    const cur = Array.isArray(a[qid]) ? (a[qid] as string[]) : [];
    return { ...a, [qid]: cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt] };
  });

  const submit = async () => {
    for (const q of s.questions) {
      if (!q.required) continue;
      const v = answers[q.id];
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (empty) { setError(`「${q.title}」は必須です`); return; }
    }
    setSaving(true);
    try { await submitSurveyResponse(s.id, answers); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : '送信に失敗しました'); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-gray-800 truncate">{s.title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {s.description && <p className="text-sm text-gray-500 whitespace-pre-wrap">{s.description}</p>}
          {s.questions.map((q, idx) => (
            <div key={q.id}>
              <div className="text-sm font-medium text-gray-700 mb-1.5">
                <span className="text-gray-400 mr-1">Q{idx + 1}.</span>{q.title}
                {q.required && <span className="text-red-500 ml-1">*</span>}
              </div>
              {q.type === 'text' && (
                <textarea value={(answers[q.id] as string) ?? ''} onChange={e => setAns(q.id, e.target.value)}
                  rows={3} className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-1.5" />
              )}
              {q.type === 'single' && (
                <div className="space-y-1">
                  {(q.options ?? []).map(opt => (
                    <label key={opt} className="flex items-center gap-2 text-sm">
                      <input type="radio" name={q.id} checked={answers[q.id] === opt} onChange={() => setAns(q.id, opt)} />{opt}
                    </label>
                  ))}
                </div>
              )}
              {q.type === 'multi' && (
                <div className="space-y-1">
                  {(q.options ?? []).map(opt => (
                    <label key={opt} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(opt)}
                        onChange={() => toggleMulti(q.id, opt)} />{opt}
                    </label>
                  ))}
                </div>
              )}
              {q.type === 'rating' && (
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: q.ratingMax ?? 5 }, (_, i) => i + 1).map(n => (
                    <button key={n} onClick={() => setAns(q.id, n)}
                      className={`w-9 h-9 rounded-lg border text-sm font-medium ${answers[q.id] === n ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-600 hover:border-indigo-400'}`}>{n}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        {error && <div className="px-5 text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} />{error}</div>}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="text-sm text-gray-600 px-3 py-1.5">キャンセル</button>
          <button onClick={submit} disabled={saving}
            className="inline-flex items-center gap-1 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-1.5 disabled:opacity-50">
            <Send size={14} /> 回答を送信
          </button>
        </div>
      </div>
    </div>
  );
};

const ResultsModal: React.FC<{ dto: SurveyDto; onClose: () => void }> = ({ dto, onClose }) => {
  const s = dto.survey;
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    surveysApi.results(s.id).then(setResults).catch(e => setError(e instanceof Error ? e.message : '取得に失敗しました'));
  }, [s.id]);

  const questionById = useMemo(() => new Map(s.questions.map(q => [q.id, q])), [s.questions]);

  // 回答明細CSV（記名で個別回答が見える場合のみ）: 1人1行、設問ごとに列
  const exportResponsesCsv = () => {
    if (!results) return;
    const header = ['回答者', '社員番号', '提出日時', ...s.questions.map((q, i) => `Q${i + 1} ${q.title}`)];
    const answered = results.respondents.map(r => [
      r.name, r.employeeNumber, fmtDateTime(r.submittedAt),
      ...s.questions.map(q => fmtAnswerValue(r.answers[q.id])),
    ]);
    const unanswered = results.unanswered.map(m => [m.name, m.employeeNumber, '(未回答)', ...s.questions.map(() => '')]);
    downloadCsv(toCsv([header, ...answered, ...unanswered]), `アンケート回答_${safeFileName(s.title)}_${dateStamp()}.csv`);
  };

  // 集計CSV: 設問×選択肢(または記述)ごとに件数
  const exportAggregateCsv = () => {
    if (!results) return;
    const rows: (string | number)[][] = [['設問', '種別', '回答/選択肢', '件数']];
    results.aggregates.forEach((agg, idx) => {
      const q = questionById.get(agg.questionId);
      const qlabel = `Q${idx + 1} ${q?.title ?? ''}`;
      const typeLabel = q ? QUESTION_TYPE_LABEL[q.type] : agg.type;
      if (agg.type === 'text') {
        const texts = results.canSeeIdentity
          ? results.respondents.filter(r => String(r.answers[agg.questionId] ?? '').trim() !== '').map(r => String(r.answers[agg.questionId]))
          : (agg.textAnswers ?? []);
        if (texts.length === 0) rows.push([qlabel, typeLabel, '(回答なし)', '']);
        else texts.forEach(t => rows.push([qlabel, typeLabel, t, '']));
      } else {
        Object.entries(agg.optionCounts ?? {}).forEach(([opt, count]) =>
          rows.push([qlabel, typeLabel, q?.type === 'rating' ? `${opt}点` : opt, count]));
        if (agg.average != null) rows.push([qlabel, typeLabel, '平均', agg.average]);
      }
    });
    downloadCsv(toCsv(rows), `アンケート集計_${safeFileName(s.title)}_${dateStamp()}.csv`);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-800 truncate">{s.title}</h3>
            {results && <p className="text-xs text-gray-500">回答 {results.respondentCount}/{results.targetCount}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {results && results.canSeeIdentity && (
              <button onClick={exportResponsesCsv}
                className="inline-flex items-center gap-1 text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 hover:bg-gray-50">
                <Download size={13} /> 回答CSV
              </button>
            )}
            {results && (
              <button onClick={exportAggregateCsv}
                className="inline-flex items-center gap-1 text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 hover:bg-gray-50">
                <Download size={13} /> 集計CSV
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && <div className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} />{error}</div>}
          {!results && !error && <div className="text-sm text-gray-400">読み込み中...</div>}

          {results?.canSeeIdentity && results.unanswered.length > 0 && (
            <div className="border border-red-100 bg-red-50/50 rounded-lg px-3 py-2.5">
              <h4 className="text-xs font-semibold text-red-600 mb-1.5">未回答（{results.unanswered.length}名）</h4>
              <div className="flex flex-wrap gap-1.5">
                {results.unanswered.map(m => (
                  <span key={m.employeeNumber} className="text-xs bg-white border border-red-100 text-red-600 px-2 py-0.5 rounded">{m.name}</span>
                ))}
              </div>
            </div>
          )}

          {results && results.aggregates.map((agg, idx) => {
            const q = questionById.get(agg.questionId);
            if (!q) return null;
            return (
              <div key={agg.questionId}>
                <div className="text-sm font-medium text-gray-700 mb-2">
                  <span className="text-gray-400 mr-1">Q{idx + 1}.</span>{q.title}
                  <span className="ml-2 text-xs text-gray-400">{QUESTION_TYPE_LABEL[q.type]}</span>
                </div>
                {agg.type === 'text' ? (
                  <div className="space-y-1.5">
                    {(results.canSeeIdentity
                      ? results.respondents
                          .filter(r => r.answers[agg.questionId] != null && String(r.answers[agg.questionId]).trim() !== '')
                          .map(r => ({ name: r.name, text: String(r.answers[agg.questionId]) }))
                      : (agg.textAnswers ?? []).map(t => ({ name: null as string | null, text: t }))
                    ).map((item, i) => (
                      <div key={i} className="text-sm bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
                        {item.name && <span className="text-xs text-indigo-600 mr-2">{item.name}</span>}
                        <span className="text-gray-700 whitespace-pre-wrap">{item.text}</span>
                      </div>
                    ))}
                    {((results.canSeeIdentity ? results.respondents.length : (agg.textAnswers?.length ?? 0)) === 0) &&
                      <div className="text-xs text-gray-400">回答なし</div>}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {agg.average != null && <div className="text-xs text-gray-500 mb-1">平均: <span className="font-semibold text-indigo-600">{agg.average}</span></div>}
                    {Object.entries(agg.optionCounts ?? {}).map(([opt, count]) => {
                      const total = results.respondentCount || 1;
                      const pct = Math.round((count / total) * 100);
                      return (
                        <div key={opt} className="flex items-center gap-2 text-sm">
                          <span className="w-28 truncate text-gray-600">{q.type === 'rating' ? `${opt} 点` : opt}</span>
                          <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                            <div className="h-full bg-indigo-400" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-16 text-right text-xs text-gray-500">{count}件 ({pct}%)</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
