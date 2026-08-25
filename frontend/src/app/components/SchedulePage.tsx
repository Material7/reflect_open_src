import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Flag, Plus, X, ZoomIn, ZoomOut, AlertCircle, ChevronDown, ChevronRight, Lock, LockOpen } from 'lucide-react';
import { scheduleApi, actionItemsApi } from '@/lib/api';
import { displayTaskId } from '@/lib/ticket';
import type { ScheduleEvent, Task, Project, ActionItem } from '@/types';
import { useProject } from '@/context/ProjectContext';
import { PHASES, PRIORITY_BADGE, PRIORITY_LABEL, PRIORITY_ORDER, PRIORITY_OPTIONS, isTerminalStep, statusBadgeClass, actionItemStatusBadge, isCompletedStatus, isCompletedActionItemStatus } from '@/lib/constants';
import { toast } from 'sonner';
import { TaskDetailModal } from './TaskDetailModal';
import { DatePickerWithHolidays } from './DatePickerWithHolidays';
import { categoryBadge } from './ActionItemPage';
import { tagBadge } from './shared/tags';

const SIDEBAR_W_DEFAULT = 210;
const DOMAIN_W    = 80;
const ASSIGNEE_W  = 90;
const STATUS_W    = 72;
const ALERT_W     = 60;
const PRIORITY_W  = 64;
const ROW_H       = 60;   // taskId + name + タグ の3行表示
const HEADER_H    = 36;
const SECTION_H   = 28;
const DAY_HEADER_H = 28;  // 日付・曜日ヘッダーの高さ

const LABEL_H    = 15;   // スタックラベル1行の高さ
const MIN_LANE_H = 40;   // レーン最小高さ

const EDIT_ROLES = ['Admin', 'PM', 'PL'];

type ColorKey = 'indigo' | 'red' | 'orange' | 'green' | 'purple' | 'gray' | 'blue' | 'teal' | 'yellow' | 'pink';

const COLOR_OPTIONS: { key: ColorKey; dot: string }[] = [
    { key: 'indigo', dot: 'bg-indigo-500' },
    { key: 'blue',   dot: 'bg-blue-500' },
    { key: 'teal',   dot: 'bg-teal-500' },
    { key: 'green',  dot: 'bg-green-500' },
    { key: 'yellow', dot: 'bg-yellow-400' },
    { key: 'orange', dot: 'bg-orange-500' },
    { key: 'red',    dot: 'bg-red-500' },
    { key: 'pink',   dot: 'bg-pink-500' },
    { key: 'purple', dot: 'bg-purple-500' },
    { key: 'gray',   dot: 'bg-gray-400' },
];

const COLOR_TEXT: Record<string, string> = {
    indigo:  'text-indigo-500',
    blue:    'text-blue-500',
    teal:    'text-teal-500',
    green:   'text-green-500',
    yellow:  'text-yellow-500',
    orange:  'text-orange-500',
    red:     'text-red-500',
    pink:    'text-pink-500',
    purple:  'text-purple-500',
    gray:    'text-gray-400',
};

const parseDate = (s: string): Date => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const daysBetween = (a: Date, b: Date): number =>
    Math.round((b.getTime() - a.getTime()) / 86400000);

const daysInMonth = (year: number, month: number): number =>
    new Date(year, month, 0).getDate();

const extractTaskRange = (task: Task): { start: string; end: string } | null => {
    const dates: string[] = [];
    Object.values(task.phases).forEach(phase => {
        Object.values(phase.schedule).forEach(ws => {
            if (ws.plannedStartDate) dates.push(ws.plannedStartDate);
            if (ws.plannedEndDate)   dates.push(ws.plannedEndDate);
        });
    });
    if (dates.length === 0) return null;
    return {
        start: dates.reduce((a, b) => a < b ? a : b),
        end:   dates.reduce((a, b) => a > b ? a : b),
    };
};

/** フェーズの並び順はマスタ（shared/phases.json）の定義順に従う */
const PHASE_ORDER = PHASES.map(p => p.code);

const PHASE_COLORS: Record<string, { bar: string; label: string }> = {
    RA:  { bar: 'bg-violet-400', label: 'text-white' },
    AD:  { bar: 'bg-blue-400',   label: 'text-white' },
    DD:  { bar: 'bg-indigo-400', label: 'text-white' },
    UC:  { bar: 'bg-cyan-500',   label: 'text-white' },
    UTD: { bar: 'bg-teal-400',   label: 'text-white' },
    UT:  { bar: 'bg-green-400',  label: 'text-white' },
    CTD: { bar: 'bg-amber-400',  label: 'text-gray-800' },
    CT:  { bar: 'bg-orange-400', label: 'text-white' },
};

const PHASE_HEX: Record<string, string> = {
    RA:  '#5b21b6',
    AD:  '#1d4ed8',
    DD:  '#3730a3',
    UC:  '#0e7490',
    UTD: '#0f766e',
    UT:  '#15803d',
    CTD: '#b45309',
    CT:  '#c2410c',
};

const extractPhaseRanges = (task: Task): { phaseCode: string; start: string; end: string; currentWorkStepCode: string }[] => {
    const result: { phaseCode: string; start: string; end: string; currentWorkStepCode: string }[] = [];
    for (const [phaseCode, phaseData] of Object.entries(task.phases)) {
        const dates: string[] = [];
        for (const ws of Object.values(phaseData.schedule)) {
            if (ws.plannedStartDate) dates.push(ws.plannedStartDate);
            if (ws.plannedEndDate)   dates.push(ws.plannedEndDate);
        }
        if (dates.length > 0) {
            result.push({
                phaseCode,
                currentWorkStepCode: phaseData.currentWorkStepCode ?? '',
                start: dates.reduce((a, b) => a < b ? a : b),
                end:   dates.reduce((a, b) => a > b ? a : b),
            });
        }
    }
    return result.sort((a, b) => {
        const ai = PHASE_ORDER.indexOf(a.phaseCode as typeof PHASE_ORDER[number]);
        const bi = PHASE_ORDER.indexOf(b.phaseCode as typeof PHASE_ORDER[number]);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
};

type FormState = {
    type: 'milestone' | 'event';
    title: string;
    date: string;
    endDate: string;
    description: string;
    color: ColorKey;
};

const emptyForm = (): FormState => ({
    type: 'milestone', title: '', date: '', endDate: '', description: '', color: 'indigo',
});

// コンポーネント内で定義すると毎レンダーで新しい関数参照が生まれ、
// React が別コンポーネントとみなしてアンマウント→マウントを繰り返す。
interface GridLineDay { left: number; isSat: boolean; isSun: boolean; isHoliday: boolean }
interface GridLinesProps {
    days: GridLineDay[];
    months: { label: string; left: number }[];
    todayX: number;
    totalChartWidth: number;
}
const GridLines = React.memo(function GridLines({ days, months, todayX, totalChartWidth }: GridLinesProps) {
    return (
        <>
            {days.map(d => (
                <div key={d.left} style={{ position: 'absolute', left: d.left, top: 0, bottom: 0, width: 1, backgroundColor: d.isSat || d.isSun || d.isHoliday ? '#e5e7eb' : '#f3f4f6' }} />
            ))}
            {months.map(m => (
                <div key={m.label} style={{ position: 'absolute', left: m.left, top: 0, bottom: 0, width: 1, backgroundColor: '#d1d5db' }} />
            ))}
            {todayX >= 0 && todayX <= totalChartWidth && (
                <div style={{ position: 'absolute', left: todayX, top: 0, bottom: 0, width: 2 }} className="bg-red-400 opacity-50" />
            )}
        </>
    );
});

interface ScheduleModalProps {
    open: boolean;
    editTarget: ScheduleEvent | null;
    defaultType: 'milestone' | 'event';
    projects: Project[];
    defaultProjectId: number;
    onClose: () => void;
    onCreated: (e: ScheduleEvent) => void;
    onUpdated: (e: ScheduleEvent) => void;
    onDeleteRequested: (e: ScheduleEvent) => void;
}
const ScheduleModal: React.FC<ScheduleModalProps> = ({
    open, editTarget, defaultType, projects, defaultProjectId, onClose, onCreated, onUpdated, onDeleteRequested,
}) => {
    const [form, setForm] = useState<FormState>(emptyForm());
    const [projectId, setProjectId] = useState<number>(defaultProjectId);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setForm(editTarget
            ? { type: editTarget.type, title: editTarget.title, date: editTarget.date, endDate: editTarget.endDate ?? '', description: editTarget.description ?? '', color: (editTarget.color as ColorKey) ?? 'indigo' }
            : { ...emptyForm(), type: defaultType }
        );
        setProjectId(editTarget ? editTarget.projectId : defaultProjectId);
    }, [open, editTarget, defaultType, defaultProjectId]);

    if (!open) return null;

    const handleSave = async () => {
        if (!form.title.trim() || !form.date) { toast.error('タイトルと日付は必須です'); return; }
        if (!projectId) { toast.error('プロジェクトを選択してください'); return; }
        setSaving(true);
        try {
            const payload = { projectId, type: form.type, title: form.title.trim(), date: form.date, endDate: form.endDate || undefined, description: form.description.trim() || undefined, color: form.color };
            if (editTarget) {
                onUpdated(await scheduleApi.update(editTarget.id, payload));
                toast.success('更新しました');
            } else {
                onCreated(await scheduleApi.create(payload));
                toast.success('追加しました');
            }
            onClose();
        } catch (err) {
            toast.error((err as Error).message ?? '保存に失敗しました');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-900">{editTarget ? 'スケジュールを編集' : 'スケジュールを追加'}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">プロジェクト <span className="text-red-500">*</span></label>
                    <select value={projectId} onChange={e => setProjectId(Number(e.target.value))} disabled={!!editTarget}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-100">
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.code}）</option>)}
                    </select>
                </div>
                <div className="flex gap-2">
                    {(['milestone', 'event'] as const).map(t => (
                        <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                            className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${form.type === t ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                            {t === 'milestone' ? 'マイルストーン' : 'イベント'}
                        </button>
                    ))}
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">タイトル <span className="text-red-500">*</span></label>
                    <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div className="flex gap-3">
                    <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            {form.type === 'event' ? '開始日' : '期日'} <span className="text-red-500">*</span>
                        </label>
                        <DatePickerWithHolidays value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
                    </div>
                    {form.type === 'event' && (
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-700 mb-1">終了日</label>
                            <DatePickerWithHolidays value={form.endDate} min={form.date} clearable onChange={v => setForm(f => ({ ...f, endDate: v }))} />
                        </div>
                    )}
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">説明</label>
                    <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">カラー</label>
                    <div className="flex gap-2">
                        {COLOR_OPTIONS.map(({ key, dot }) => (
                            <button key={key} onClick={() => setForm(f => ({ ...f, color: key }))}
                                className={`w-7 h-7 rounded-full ${dot} transition-transform ${form.color === key ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`} />
                        ))}
                    </div>
                </div>
                <div className="flex items-center justify-between pt-2">
                    {editTarget ? (
                        <button onClick={() => { onDeleteRequested(editTarget); onClose(); }}
                            className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">削除</button>
                    ) : <div />}
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">キャンセル</button>
                        <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                            {saving ? '保存中...' : '保存'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

interface LaneSidebarProps {
    icon: React.ReactNode;
    label: string;
    type: 'milestone' | 'event';
    laneH: number;
    totalW: number;
    canEdit: boolean;
    onAdd: (type: 'milestone' | 'event') => void;
    locked?: boolean;
    onToggleLock?: () => void;
}
const LaneSidebar: React.FC<LaneSidebarProps> = ({ icon, label, type, laneH, totalW, canEdit, onAdd, locked, onToggleLock }) => (
    <div
        style={{ width: totalW, minWidth: totalW, height: laneH }}
        className="sticky left-0 z-10 bg-white border-r border-b flex items-center px-3 gap-2"
    >
        {icon}
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <div className="ml-auto flex items-center gap-1">
            {onToggleLock && (
                <button
                    onClick={onToggleLock}
                    className={`p-1 rounded hover:bg-indigo-50 ${locked ? 'text-indigo-600' : 'text-gray-400 hover:text-indigo-600'}`}
                    title={locked ? '下スクロール時も固定表示中（クリックで固定解除）' : '固定解除中（クリックで常に固定表示）'}
                >
                    {locked ? <Lock size={13} /> : <LockOpen size={13} />}
                </button>
            )}
            {canEdit && (
                <button
                    onClick={() => onAdd(type)}
                    className="p-1 rounded text-gray-600 hover:text-indigo-600 hover:bg-indigo-50"
                    title={`${label}を追加`}
                >
                    <Plus size={14} />
                </button>
            )}
        </div>
    </div>
);

// アクションアイテムの★マーカー色（紫＝アクションアイテムのテーマ色）

interface SchedulePageProps {
    onOpenActionItem?: (itemId: string) => void;
}

export const SchedulePage: React.FC<SchedulePageProps> = ({ onOpenActionItem }) => {
    const { tasks, settings, projects, isSystemAdmin, resolveProjectRole } = useProject();
    const [actionItems, setActionItems] = useState<ActionItem[]>([]);
    const [showActionItems, setShowActionItems] = useState(true);
    const [tasksCollapsed, setTasksCollapsed] = useState(false);
    const [filterProjectId, setFilterProjectId] = useState<string>('');
    const memberNameMap = useMemo(() =>
        new Map(settings.members.map(m => [m.employeeNumber, m.name])),
        [settings.members]);
    const domainNameMap = useMemo(() =>
        new Map(settings.domains.map(d => [d.id, d.name])),
        [settings.domains]);
    const projectCodeById = useMemo(() =>
        new Map(projects.map(p => [p.id, p.code])),
        [projects]);
    // 全プロジェクト表示中のみ、ラベルにプロジェクト接頭辞を付ける（単一フィルタ時は冗長なので省略）
    const showProjectPrefix = !filterProjectId && projects.length > 1;
    const projectPrefixOf = (projectId: number) =>
        showProjectPrefix ? `[${projectCodeById.get(projectId) ?? '?'}] ` : '';
    // 編集権限はプロジェクト単位。編集ロールを持つプロジェクトのみ追加・編集可
    const editableProjects = useMemo(
        () => projects.filter(p => isSystemAdmin || EDIT_ROLES.includes(resolveProjectRole(p.id) ?? '')),
        [projects, isSystemAdmin, resolveProjectRole],
    );
    const canEdit = filterProjectId
        ? (isSystemAdmin || EDIT_ROLES.includes(resolveProjectRole(Number(filterProjectId)) ?? ''))
        : editableProjects.length > 0;

    const [events, setEvents]       = useState<ScheduleEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [dayWidth, setDayWidth]   = useState(22);
    const [scheduleLocked, setScheduleLocked] = useState(true); // スケジュールレーンを下スクロール時も固定するか
    const [sidebarW, setSidebarW]   = useState(SIDEBAR_W_DEFAULT);
    const sidebarWRef               = useRef(sidebarW);
    sidebarWRef.current             = sidebarW;

    const outerRef   = useRef<HTMLDivElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);

    const handleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = sidebarWRef.current;
        const onMove = (me: MouseEvent) => {
            setSidebarW(Math.max(120, Math.min(500, startW + me.clientX - startX)));
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, []);

    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const selectedTask = selectedTaskId ? tasks.find(t => t.id === selectedTaskId) ?? null : null;

    const [modalOpen, setModalOpen]         = useState(false);
    const [editTarget, setEditTarget]       = useState<ScheduleEvent | null>(null);
    const [modalDefaultType, setModalDefaultType] = useState<'milestone' | 'event'>('milestone');
    const [deleteTarget, setDeleteTarget]   = useState<ScheduleEvent | null>(null);
    const [deleting, setDeleting]           = useState(false);

    type SortKey = 'taskId' | 'name' | 'domainId' | 'assignee' | 'status' | 'alert' | 'priority';
    const [sortKey, setSortKey] = useState<SortKey | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('asc'); }
    };
    const sortIcon = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

    const [filterKeyword, setFilterKeyword]             = useState('');
    const [filterDomainId, setFilterDomainId]           = useState('');
    const [filterAssignee, setFilterAssignee]           = useState('');
    const [filterStatus, setFilterStatus]               = useState('');
    const [filterPriority, setFilterPriority]           = useState('');
    const [filterTag, setFilterTag]                     = useState('');
    const [filterAlertOnly, setFilterAlertOnly]         = useState(false);
    const [filterHideCompleted, setFilterHideCompleted] = useState(false);

    const handleClearFilters = useCallback(() => {
        setFilterProjectId('');
        setFilterKeyword('');
        setFilterDomainId('');
        setFilterAssignee('');
        setFilterStatus('');
        setFilterPriority('');
        setFilterTag('');
        setFilterAlertOnly(false);
        setFilterHideCompleted(false);
    }, []);

    const isFilterActive = !!(filterProjectId || filterKeyword || filterDomainId || filterAssignee || filterStatus || filterPriority || filterTag || filterAlertOnly || filterHideCompleted);

    const allTags = useMemo(() => {
        const set = new Set<string>(settings.tags ?? []);
        tasks.forEach(t => (t.tags ?? []).forEach(tag => set.add(tag)));
        actionItems.forEach(it => (it.tags ?? []).forEach(tag => set.add(tag)));
        return Array.from(set);
    }, [settings.tags, tasks, actionItems]);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const [ev, ai] = await Promise.all([
                scheduleApi.getAll(),
                actionItemsApi.getAll().catch(() => [] as ActionItem[]),
            ]);
            setEvents(ev);
            setActionItems(ai);
        } catch {
            toast.error('スケジュールの取得に失敗しました');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // ローディング完了後、当日線を中央にスクロール
    useEffect(() => {
        if (isLoading) return;
        const el = scrollContainerRef.current;
        if (!el) return;
        const frozenW = sidebarW + DOMAIN_W + ASSIGNEE_W + STATUS_W + ALERT_W + PRIORITY_W;
        const visibleW = el.clientWidth - frozenW;
        el.scrollLeft = todayX - visibleW / 2;
    }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    const { chartStart, totalDays } = useMemo(() => {
        const allDates: string[] = [];
        // 空文字・不正な日付を混入させない（1件でも混ざると min/max が壊れ、日付軸全体が消える）
        const pushDate = (d?: string | null) => { if (d && /^\d{4}-\d{2}-\d{2}/.test(d)) allDates.push(d); };
        events.forEach(e => { pushDate(e.date); pushDate(e.endDate); });
        tasks.forEach(t => { const r = extractTaskRange(t); if (r) { pushDate(r.start); pushDate(r.end); } });
        actionItems.forEach(it => pushDate(it.dueDate));

        let start: Date, end: Date;
        if (allDates.length === 0) {
            const now = new Date();
            start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            end   = new Date(now.getFullYear(), now.getMonth() + 7, 0);
        } else {
            const minD = parseDate(allDates.reduce((a, b) => a < b ? a : b));
            const maxD = parseDate(allDates.reduce((a, b) => a > b ? a : b));
            start = new Date(minD.getFullYear(), minD.getMonth() - 1, 1);
            end   = new Date(maxD.getFullYear(), maxD.getMonth() + 2, 0);
        }
        // 念のため totalDays が不正（0/NaN）にならないようフォールバック
        let span = daysBetween(start, end);
        if (!Number.isFinite(span) || span <= 0) {
            const now = new Date();
            start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            end   = new Date(now.getFullYear(), now.getMonth() + 7, 0);
            span  = daysBetween(start, end);
        }
        return { chartStart: start, totalDays: span };
    }, [events, tasks, actionItems]);

    const xOf           = (dateStr: string) => daysBetween(chartStart, parseDate(dateStr)) * dayWidth;
    const wOf           = (s: string, e: string) => Math.max(daysBetween(parseDate(s), parseDate(e)) * dayWidth + dayWidth, dayWidth);
    const todayX        = daysBetween(chartStart, new Date()) * dayWidth;
    const totalChartWidth = totalDays * dayWidth;

    const months = useMemo(() => {
        const result: { label: string; shortLabel: string; left: number; width: number }[] = [];
        const cur = new Date(chartStart.getFullYear(), chartStart.getMonth(), 1);
        const endDate = new Date(chartStart.getTime() + totalDays * 86400000);
        while (cur <= endDate) {
            const dim = daysInMonth(cur.getFullYear(), cur.getMonth() + 1);
            result.push({
                label:      `${cur.getFullYear()}年${cur.getMonth() + 1}月`,
                shortLabel: `${cur.getMonth() + 1}月`,
                left:  daysBetween(chartStart, cur) * dayWidth,
                width: dim * dayWidth,
            });
            cur.setMonth(cur.getMonth() + 1);
        }
        return result;
    }, [chartStart, totalDays, dayWidth]);

    const holidaySet = useMemo(() =>
        new Set(settings.holidays.map(h => h.date)),
        [settings.holidays]);

    const days = useMemo(() => {
        const DOW = ['日', '月', '火', '水', '木', '金', '土'] as const;
        return Array.from({ length: totalDays }, (_, i) => {
            const d = new Date(chartStart.getTime() + i * 86400000);
            const dow = d.getDay();
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return { dayNum: d.getDate(), weekday: DOW[dow], isSat: dow === 6, isSun: dow === 0, isHoliday: holidaySet.has(dateStr), left: i * dayWidth };
        });
    }, [chartStart, totalDays, dayWidth, holidaySet]);

    const visibleEvents = useMemo(
        () => filterProjectId ? events.filter(e => String(e.projectId) === filterProjectId) : events,
        [events, filterProjectId]
    );

    const stackedItems = useMemo(() => {
        const sorted = [...visibleEvents].sort((a, b) => {
            const dc = a.date.localeCompare(b.date);
            if (dc !== 0) return dc;
            return a.type === b.type ? 0 : a.type === 'milestone' ? -1 : 1;
        });
        const CHAR_W = 7;
        const BASE_W = 16; // symbol + gap + padding
        const rowEnds: number[] = []; // 各行の右端座標
        return sorted.map(ev => {
            const lx = daysBetween(chartStart, parseDate(ev.date)) * dayWidth;
            const labelLen = ev.title.length + projectPrefixOf(ev.projectId).length;
            const labelW = BASE_W + labelLen * CHAR_W;
            let row = rowEnds.findIndex(end => lx >= end);
            if (row === -1) row = rowEnds.length;
            rowEnds[row] = lx + labelW;
            return { event: ev, lx, row };
        });
    }, [visibleEvents, chartStart, dayWidth, showProjectPrefix]); // eslint-disable-line react-hooks/exhaustive-deps

    const maxRow     = stackedItems.length > 0 ? Math.max(...stackedItems.map(i => i.row)) : 0;
    const schedLaneH = Math.max(MIN_LANE_H, (maxRow + 1) * LABEL_H + 8);
    const baselineY  = schedLaneH - 4;   // 横線Y

    const todayDate = new Date().toISOString().split('T')[0];
    const getAlertState = (task: Task): boolean =>
        Object.values(task.phases).some(phaseData => {
            const code = phaseData.currentWorkStepCode;
            if (isTerminalStep(code)) return false;
            const plannedEnd = phaseData.schedule[code]?.plannedEndDate;
            if (!plannedEnd) return false; // 完了予定日未設定は対象外
            return plannedEnd < todayDate;
        });

    const filteredTasks = useMemo(() =>
        tasks.filter(task => {
            if (task.type === 'Indirect') return false; // 工程外タスクは別管理
            if (filterProjectId && String(task.projectId) !== filterProjectId) return false;
            if (filterKeyword) {
                const kw = filterKeyword.toLowerCase();
                if (!task.name.toLowerCase().includes(kw) && !(task.taskId ?? '').toLowerCase().includes(kw) && !(task.ticketKey ?? '').toLowerCase().includes(kw)) return false;
            }
            if (filterDomainId && task.domainId !== filterDomainId) return false;
            if (filterAssignee && task.assignee !== filterAssignee) return false;
            if (filterStatus && task.status !== filterStatus) return false;
            if (filterPriority && (task.priority ?? '') !== (filterPriority === 'NONE' ? '' : filterPriority)) return false;
            if (filterTag && !(task.tags ?? []).includes(filterTag)) return false;
            if (filterAlertOnly && !getAlertState(task)) return false;
            if (filterHideCompleted && isCompletedStatus(task.status)) return false;
            return true;
        }),
        [tasks, filterProjectId, filterKeyword, filterDomainId, filterAssignee, filterStatus, filterPriority, filterTag, filterAlertOnly, filterHideCompleted] // eslint-disable-line react-hooks/exhaustive-deps
    );

    const ganttTasks = useMemo(() => {
        const mapped = filteredTasks.map(t => ({ task: t, range: extractTaskRange(t), phaseRanges: extractPhaseRanges(t) }));
        if (sortKey === 'alert') {
            mapped.sort((a, b) => {
                const av = getAlertState(a.task) ? 1 : 0;
                const bv = getAlertState(b.task) ? 1 : 0;
                return sortDir === 'asc' ? av - bv : bv - av;
            });
        } else if (sortKey === 'priority') {
            mapped.sort((a, b) => {
                const av = PRIORITY_ORDER[a.task.priority ?? ''] ?? 3;
                const bv = PRIORITY_ORDER[b.task.priority ?? ''] ?? 3;
                return sortDir === 'asc' ? av - bv : bv - av;
            });
        } else if (sortKey) {
            mapped.sort((a, b) => {
                const av = (a.task[sortKey] ?? '') as string;
                const bv = (b.task[sortKey] ?? '') as string;
                return sortDir === 'asc' ? av.localeCompare(bv, 'ja') : bv.localeCompare(av, 'ja');
            });
        } else {
            mapped.sort((a, b) => {
                if (!a.range && !b.range) return 0;
                if (!a.range) return 1;
                if (!b.range) return -1;
                return a.range.start.localeCompare(b.range.start);
            });
        }
        return mapped;
    }, [filteredTasks, sortKey, sortDir]);

    const isItemOverdue = (it: ActionItem) => !!it.dueDate && !isCompletedActionItemStatus(it.status) && it.dueDate < todayDate;
    const visibleActionItems = useMemo(() => {
        if (!showActionItems) return [];
        return actionItems.filter(it => {
            if (!it.dueDate) return false; // 期限なしは非表示
            if (filterProjectId && String(it.projectId) !== filterProjectId) return false;
            if (filterAssignee && it.assignee !== filterAssignee) return false;
            if (filterStatus && it.status !== filterStatus) return false;
            if (filterPriority && (it.priority ?? '') !== (filterPriority === 'NONE' ? '' : filterPriority)) return false;
            if (filterTag && !(it.tags ?? []).includes(filterTag)) return false;
            if (filterHideCompleted && isCompletedActionItemStatus(it.status)) return false;
            if (filterAlertOnly && !isItemOverdue(it)) return false;
            if (filterKeyword) {
                const kw = filterKeyword.toLowerCase();
                if (!it.title.toLowerCase().includes(kw) && !(it.itemId ?? '').toLowerCase().includes(kw) && !(it.memo ?? '').toLowerCase().includes(kw)) return false;
            }
            // ドメイン絞り込みはアクションアイテムには適用しない（ドメインを持たないため）
            return true;
        }).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    }, [actionItems, showActionItems, filterProjectId, filterAssignee, filterStatus, filterPriority, filterTag, filterHideCompleted, filterAlertOnly, filterKeyword]); // eslint-disable-line react-hooks/exhaustive-deps


    const openCreate = (type?: 'milestone' | 'event') => {
        setEditTarget(null);
        setModalDefaultType(type ?? 'milestone');
        setModalOpen(true);
    };
    const openEdit = (e: ScheduleEvent) => {
        setEditTarget(e);
        setModalOpen(true);
    };
    const closeModal = () => { setModalOpen(false); setEditTarget(null); };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await scheduleApi.delete(deleteTarget.id);
            setEvents(prev => prev.filter(e => e.id !== deleteTarget.id));
            toast.success('削除しました');
            setDeleteTarget(null);
        } catch {
            toast.error('削除に失敗しました');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div ref={outerRef} className="-m-4 md:-m-8 flex flex-col" style={{ height: 'calc(100% + 2rem)' }}>
            {/* モバイル向け注意表示 */}
            <div className="md:hidden flex items-center justify-center flex-1 p-8 text-center">
                <div className="text-gray-400">
                    <p className="text-base font-medium text-gray-600 mb-2">スケジュール画面</p>
                    <p className="text-sm">この画面はPC環境でご利用ください</p>
                </div>
            </div>
            <div className="hidden md:contents">

            {/* ツールバー */}
            <div ref={toolbarRef} className="border-b bg-white shrink-0">
                {/* Row 1: 凡例 + ズーム */}
                <div className="px-6 py-2.5 flex items-center justify-between">
                    {/* 凡例（左） */}
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><span className="text-gray-600">◆</span>マイルストーン</span>
                        <span className="flex items-center gap-1"><span className="text-gray-600">●</span>イベント</span>
                        <span className="flex items-center gap-1"><span className="text-purple-500">★</span>アクションアイテム</span>
                        <span className="w-px h-3 bg-gray-300" />
                        {PHASE_ORDER.map(code => (
                            <span key={code} className="flex items-center gap-1">
                                <span className={`inline-block w-5 h-2.5 rounded ${PHASE_COLORS[code]?.bar ?? 'bg-gray-300'} opacity-80`} />
                                {code}
                            </span>
                        ))}
                    </div>
                    {/* ズーム（右） */}
                    <div className="flex items-center gap-2">
                        <button onClick={() => setDayWidth(w => Math.max(3, w - 3))} className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 text-gray-600" title="縮小"><ZoomOut size={15} /></button>
                        <span className="text-xs text-gray-400 w-14 text-center tabular-nums">{dayWidth} px/日</span>
                        <button onClick={() => setDayWidth(w => Math.min(40, w + 3))} className="p-1.5 rounded border border-gray-300 hover:bg-gray-50 text-gray-600" title="拡大"><ZoomIn size={15} /></button>
                    </div>
                </div>
                {/* Row 2: フィルタパネル */}
                <div className="px-6 pb-3 flex flex-wrap gap-3 items-end border-t border-gray-100">
                    {/* タスク件数 */}
                    <div className="flex items-center gap-1.5 pt-3">
                        <div className="flex items-baseline gap-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
                            <span className="text-xl font-bold text-indigo-600">{filteredTasks.length}</span>
                            <span className="text-xs text-gray-500">件</span>
                            {isFilterActive && (
                                <span className="text-xs text-gray-400 ml-1">/ {tasks.length}</span>
                            )}
                        </div>
                        {isFilterActive && (
                            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-1">絞込中</span>
                        )}
                    </div>
                    {/* プロジェクト */}
                    <div className="pt-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">プロジェクト</label>
                        <select
                            value={filterProjectId}
                            onChange={e => setFilterProjectId(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">すべて</option>
                            {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                        </select>
                    </div>
                    {/* キーワード */}
                    <div className="min-w-[160px] flex-1 pt-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">キーワード</label>
                        <input
                            type="text"
                            value={filterKeyword}
                            onChange={e => setFilterKeyword(e.target.value)}
                            placeholder="タスク名・タスクID"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    {/* ドメイン */}
                    <div className="pt-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">ドメイン</label>
                        <select
                            value={filterDomainId}
                            onChange={e => setFilterDomainId(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">すべて</option>
                            {settings.domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                    </div>
                    {/* 担当者 */}
                    <div className="pt-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">担当者</label>
                        <select
                            value={filterAssignee}
                            onChange={e => setFilterAssignee(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">すべて</option>
                            {settings.members.filter(m => m.employeeNumber !== 'admin').map(m => (
                                <option key={m.id} value={m.employeeNumber}>{m.name}</option>
                            ))}
                        </select>
                    </div>
                    {/* ステータス */}
                    <div className="pt-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">ステータス</label>
                        <select
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">すべて</option>
                            {settings.taskStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    {/* 優先度 */}
                    <div className="pt-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">優先度</label>
                        <select
                            value={filterPriority}
                            onChange={e => setFilterPriority(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">すべて</option>
                            {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                            <option value="NONE">未設定</option>
                        </select>
                    </div>
                    {/* タグ */}
                    <div className="pt-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">タグ</label>
                        <select
                            value={filterTag}
                            onChange={e => setFilterTag(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">すべて</option>
                            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    {/* アラートのみ */}
                    <div className="flex items-center gap-2 pb-[9px] pt-3">
                        <input
                            type="checkbox"
                            id="ganttFilterAlertOnly"
                            checked={filterAlertOnly}
                            onChange={e => setFilterAlertOnly(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <label htmlFor="ganttFilterAlertOnly" className="text-sm text-gray-700 cursor-pointer whitespace-nowrap select-none">
                            アラートのみ
                        </label>
                    </div>
                    {/* 完了を非表示 */}
                    <div className="flex items-center gap-2 pb-[9px] pt-3">
                        <input
                            type="checkbox"
                            id="ganttFilterHideCompleted"
                            checked={filterHideCompleted}
                            onChange={e => setFilterHideCompleted(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <label htmlFor="ganttFilterHideCompleted" className="text-sm text-gray-700 cursor-pointer whitespace-nowrap select-none">
                            完了を非表示
                        </label>
                    </div>
                    {/* アクションアイテムを表示 */}
                    <div className="flex items-center gap-2 pb-[9px] pt-3">
                        <input
                            type="checkbox"
                            id="ganttShowActionItems"
                            checked={showActionItems}
                            onChange={e => setShowActionItems(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                        />
                        <label htmlFor="ganttShowActionItems" className="text-sm text-gray-700 cursor-pointer whitespace-nowrap select-none">
                            アクションアイテム
                        </label>
                    </div>
                    {/* クリア */}
                    {isFilterActive && (
                        <button
                            onClick={handleClearFilters}
                            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors pb-[9px] pt-3 mt-3"
                        >
                            <X size={14} />
                            クリア
                        </button>
                    )}
                </div>
            </div>

            {/* ガント本体 */}
            {isLoading ? (
                <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">読み込み中...</div>
            ) : (
                <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-auto bg-white select-none">
                    <div style={{ minWidth: sidebarW + DOMAIN_W + ASSIGNEE_W + STATUS_W + ALERT_W + PRIORITY_W + totalChartWidth }}>

                        {/* 月ヘッダー（sticky top） */}
                        <div className="flex sticky top-0 z-20" style={{ height: HEADER_H }}>
                            <div style={{ width: sidebarW, minWidth: sidebarW, height: HEADER_H }}
                                className="sticky left-0 z-30 bg-gray-50 border-r border-b flex items-center px-3 relative">
                                <div onMouseDown={handleResizeStart} className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 transition-colors" />
                            </div>
                            <div style={{ width: DOMAIN_W, minWidth: DOMAIN_W, height: HEADER_H, position: 'sticky', left: sidebarW }} className="z-30 bg-gray-50 border-b" />
                            <div style={{ width: ASSIGNEE_W, minWidth: ASSIGNEE_W, height: HEADER_H, position: 'sticky', left: sidebarW + DOMAIN_W }} className="z-30 bg-gray-50 border-b" />
                            <div style={{ width: PRIORITY_W, minWidth: PRIORITY_W, height: HEADER_H, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W }} className="z-30 bg-gray-50 border-b" />
                            <div style={{ width: STATUS_W,  minWidth: STATUS_W,  height: HEADER_H, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W }} className="z-30 bg-gray-50 border-b" />
                            <div style={{ width: ALERT_W,   minWidth: ALERT_W,   height: HEADER_H, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W + STATUS_W }} className="z-30 bg-gray-50 border-r border-b" />
                            <div style={{ width: totalChartWidth, height: HEADER_H, position: 'relative' }} className="bg-gray-50 border-b overflow-hidden">
                                {months.map(m => (
                                    <div key={m.label} style={{ position: 'absolute', left: m.left, width: m.width, height: HEADER_H }}
                                        className="border-r flex items-center px-2 overflow-hidden">
                                        <span className="text-xs text-gray-600 font-medium whitespace-nowrap">
                                            {m.width >= 60 ? m.label : m.shortLabel}
                                        </span>
                                    </div>
                                ))}
                                {todayX >= 0 && todayX <= totalChartWidth && (
                                    <div style={{ position: 'absolute', left: todayX, top: 0, bottom: 0, width: 2 }} className="bg-red-400 opacity-60" />
                                )}
                            </div>
                        </div>

                        {/* 日付・曜日ヘッダー（sticky top HEADER_H） */}
                        <div className="flex z-20 shadow-sm" style={{ height: DAY_HEADER_H, position: 'sticky', top: HEADER_H }}>
                            <div style={{ width: sidebarW, minWidth: sidebarW, height: DAY_HEADER_H }} className="sticky left-0 z-30 bg-gray-50 border-r border-b" />
                            <div style={{ width: DOMAIN_W, minWidth: DOMAIN_W, height: DAY_HEADER_H, position: 'sticky', left: sidebarW }} className="z-30 bg-gray-50 border-b" />
                            <div style={{ width: ASSIGNEE_W, minWidth: ASSIGNEE_W, height: DAY_HEADER_H, position: 'sticky', left: sidebarW + DOMAIN_W }} className="z-30 bg-gray-50 border-b" />
                            <div style={{ width: PRIORITY_W, minWidth: PRIORITY_W, height: DAY_HEADER_H, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W }} className="z-30 bg-gray-50 border-b" />
                            <div style={{ width: STATUS_W, minWidth: STATUS_W, height: DAY_HEADER_H, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W }} className="z-30 bg-gray-50 border-b" />
                            <div style={{ width: ALERT_W,  minWidth: ALERT_W,  height: DAY_HEADER_H, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W + STATUS_W }} className="z-30 bg-gray-50 border-r border-b" />
                            <div style={{ width: totalChartWidth, height: DAY_HEADER_H, position: 'relative' }} className="bg-gray-50 border-b overflow-hidden">
                                {todayX >= 0 && todayX <= totalChartWidth && (
                                    <div style={{ position: 'absolute', left: todayX, top: 0, bottom: 0, width: 2 }} className="bg-red-400 opacity-60 z-10" />
                                )}
                                {dayWidth >= 14 && days.map(d => (
                                    <div
                                        key={d.left}
                                        style={{ position: 'absolute', left: d.left, width: dayWidth, height: DAY_HEADER_H }}
                                        className={`border-r flex flex-col items-center justify-center overflow-hidden select-none
                                            ${d.isSun || d.isHoliday ? 'bg-red-50 text-red-500' : d.isSat ? 'bg-blue-50 text-blue-500' : 'text-gray-500'}`}
                                    >
                                        <span className="text-[10px] font-medium leading-none">{d.dayNum}</span>
                                        {dayWidth >= 22 && (
                                            <span className="text-[9px] leading-none mt-0.5">{d.weekday}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ─── スケジュールレーン（マイルストーン＋イベント統合） ─── */}
                        <div
                            className="flex"
                            style={scheduleLocked
                                ? { height: schedLaneH, position: 'sticky', top: HEADER_H + DAY_HEADER_H, zIndex: 16 }
                                : { height: schedLaneH }}
                        >
                            <LaneSidebar
                                icon={<Flag size={14} className="text-indigo-500 shrink-0" />}
                                label="スケジュール"
                                type="milestone"
                                laneH={schedLaneH}
                                totalW={sidebarW + DOMAIN_W + ASSIGNEE_W + STATUS_W + ALERT_W + PRIORITY_W}
                                canEdit={canEdit}
                                onAdd={openCreate}
                                locked={scheduleLocked}
                                onToggleLock={() => setScheduleLocked(v => !v)}
                            />
                            <div style={{ width: totalChartWidth, height: schedLaneH, position: 'relative' }} className="border-b bg-white overflow-hidden">
                                <GridLines days={days} months={months} todayX={todayX} totalChartWidth={totalChartWidth} />
                                {/* 横線（ベースライン） */}
                                <div style={{ position: 'absolute', left: 0, right: 0, top: baselineY, height: 1 }} className="bg-gray-200" />

                                {stackedItems.map(({ event, lx, row }) => {
                                    const textColor = COLOR_TEXT[event.color ?? 'indigo'] ?? COLOR_TEXT.indigo;
                                    const symbol    = event.type === 'milestone' ? '◆' : '●';
                                    const projectName = projects.find(p => p.id === event.projectId)?.name;
                                    const baseHint = event.type === 'event' && event.endDate
                                        ? `${event.title}（${event.date} 〜 ${event.endDate}）`
                                        : `${event.title}（${event.date}）`;
                                    const titleHint = projectName ? `${projectName}\n${baseHint}` : baseHint;
                                    return (
                                        <div
                                            key={event.id}
                                            style={{ position: 'absolute', left: lx, top: row * LABEL_H }}
                                            className={`flex items-center gap-0.5 text-xs whitespace-nowrap leading-tight ${canEdit ? 'cursor-pointer hover:opacity-70' : ''}`}
                                            title={event.description ? `${titleHint}\n${event.description}` : titleHint}
                                            onClick={() => canEdit && openEdit(event)}
                                        >
                                            <span className={`shrink-0 ${textColor}`}>{symbol}</span>
                                            {showProjectPrefix && (
                                                <span className="font-semibold text-indigo-600">[{projectCodeById.get(event.projectId) ?? '?'}]</span>
                                            )}
                                            <span className="text-gray-700">{event.title}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* ─── タスクセクション（ソート列ヘッダー） ─── */}
                        <div className="flex z-15" style={{ height: SECTION_H, position: 'sticky', top: HEADER_H + DAY_HEADER_H + (scheduleLocked ? schedLaneH : 0), zIndex: 15 }}>
                            {([
                                { key: 'name',     label: 'タスク名', w: sidebarW,   left: 0 },
                                { key: 'domainId', label: 'ドメイン',   w: DOMAIN_W,   left: sidebarW },
                                { key: 'assignee', label: '担当者',     w: ASSIGNEE_W, left: sidebarW + DOMAIN_W },
                                { key: 'priority', label: '優先度',     w: PRIORITY_W, left: sidebarW + DOMAIN_W + ASSIGNEE_W },
                                { key: 'status',   label: 'ステータス', w: STATUS_W,   left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W },
                                { key: 'alert',    label: 'アラート',   w: ALERT_W,    left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W + STATUS_W },
                            ] as const).map(col => (
                                <div
                                    key={col.key}
                                    style={{ width: col.w, minWidth: col.w, position: 'sticky', left: col.left, zIndex: 16 }}
                                    className="bg-indigo-50 border-r border-b border-indigo-200 px-2 flex items-center cursor-pointer hover:bg-indigo-100 select-none"
                                    onClick={() => handleSort(col.key as SortKey)}
                                >
                                    <span className="text-xs font-bold text-indigo-800 whitespace-nowrap flex items-center gap-1">
                                        {col.key === 'name' && (
                                            <button
                                                onClick={e => { e.stopPropagation(); setTasksCollapsed(v => !v); }}
                                                className="text-indigo-500 hover:text-indigo-700 -ml-0.5 shrink-0"
                                                title={tasksCollapsed ? 'タスクを展開' : 'タスクを折りたたんでアクションアイテムのみ表示'}
                                            >
                                                {tasksCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                            </button>
                                        )}
                                        {col.label}{sortIcon(col.key as SortKey)}
                                    </span>
                                </div>
                            ))}
                            <div style={{ width: totalChartWidth }} className="bg-indigo-50 border-b border-indigo-200" />
                        </div>

                        {!tasksCollapsed && ganttTasks.length === 0 && (
                            <div className="flex" style={{ height: ROW_H }}>
                                <div style={{ width: sidebarW, minWidth: sidebarW, position: 'sticky', left: 0 }} className="z-10 bg-white border-r border-b px-3 flex items-center">
                                    <span className="text-xs text-gray-300">タスクなし</span>
                                </div>
                                <div style={{ width: DOMAIN_W,   minWidth: DOMAIN_W,   position: 'sticky', left: sidebarW }}                           className="z-10 bg-white border-r border-b" />
                                <div style={{ width: ASSIGNEE_W, minWidth: ASSIGNEE_W, position: 'sticky', left: sidebarW + DOMAIN_W }}                 className="z-10 bg-white border-r border-b" />
                                <div style={{ width: PRIORITY_W, minWidth: PRIORITY_W, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W }}                 className="z-10 bg-white border-r border-b" />
                                <div style={{ width: STATUS_W, minWidth: STATUS_W, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W }}              className="z-10 bg-white border-r border-b" />
                                <div style={{ width: ALERT_W,  minWidth: ALERT_W,  position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W + STATUS_W }} className="z-10 bg-white border-r border-b" />
                                <div style={{ width: totalChartWidth, position: 'relative', height: ROW_H }} className="border-b">
                                    <GridLines days={days} months={months} todayX={todayX} totalChartWidth={totalChartWidth} />
                                </div>
                            </div>
                        )}

                        {!tasksCollapsed && ganttTasks.map(({ task, phaseRanges }) => (
                            <div key={task.id} className="flex" style={{ height: ROW_H }}>
                                <div style={{ width: sidebarW, minWidth: sidebarW, position: 'sticky', left: 0 }}
                                    className="z-10 bg-white border-r border-b flex flex-col justify-center px-2 overflow-hidden">
                                    <span
                                        className={`text-xs font-mono leading-tight cursor-pointer hover:underline ${task.type === 'Requirement' ? 'text-teal-700' : 'text-indigo-700'}`}
                                        onClick={() => setSelectedTaskId(task.id)}
                                    >{displayTaskId(task)}</span>
                                    <span className="text-xs text-gray-700 truncate leading-tight" title={task.name}>{task.name}</span>
                                    {(task.tags ?? []).length > 0 && (
                                        <div className="flex items-center gap-0.5 overflow-hidden leading-tight" title={task.tags!.join('、')}>
                                            {task.tags!.map(t => (
                                                <span key={t} className={`text-[9px] px-1 rounded shrink-0 ${tagBadge(t)}`}>{t}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div style={{ width: DOMAIN_W, minWidth: DOMAIN_W, position: 'sticky', left: sidebarW }}
                                    className="z-10 bg-white border-r border-b flex items-center px-2 overflow-hidden">
                                    <span className="text-xs text-gray-500 truncate">{domainNameMap.get(task.domainId) || task.domainId || '—'}</span>
                                </div>
                                <div style={{ width: ASSIGNEE_W, minWidth: ASSIGNEE_W, position: 'sticky', left: sidebarW + DOMAIN_W }}
                                    className="z-10 bg-white border-r border-b flex items-center px-2 overflow-hidden">
                                    <span className="text-xs text-gray-500 truncate">{memberNameMap.get(task.assignee) ?? (task.assignee || '—')}</span>
                                </div>
                                <div style={{ width: PRIORITY_W, minWidth: PRIORITY_W, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W }}
                                    className="z-10 bg-white border-r border-b flex items-center px-1.5 overflow-hidden">
                                    {task.priority
                                        ? <span className={`text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap ${PRIORITY_BADGE[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>
                                        : <span className="text-xs text-gray-300">—</span>}
                                </div>
                                <div style={{ width: STATUS_W, minWidth: STATUS_W, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W }}
                                    className="z-10 bg-white border-r border-b flex items-center px-2 overflow-hidden">
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap ${statusBadgeClass(task.status)}`}>{task.status}</span>
                                </div>
                                <div style={{ width: ALERT_W, minWidth: ALERT_W, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W + STATUS_W }}
                                    className="z-10 bg-white border-r border-b flex items-center px-1.5 overflow-hidden">
                                    {getAlertState(task) && (
                                        <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                                            <AlertCircle size={14} />
                                            <span>遅延</span>
                                        </div>
                                    )}
                                </div>
                                <div style={{ width: totalChartWidth, height: ROW_H, position: 'relative' }} className="border-b">
                                    <GridLines days={days} months={months} todayX={todayX} totalChartWidth={totalChartWidth} />
                                    {phaseRanges.length > 0 ? phaseRanges.map((pr, idx) => {
                                        // 後工程の開始日より前までにバーをクリップ（重なり部分は後工程を優先）
                                        const laterStarts = phaseRanges.slice(idx + 1).map(r => r.start).filter(s => s < pr.end);
                                        const displayEnd  = laterStarts.length > 0 ? laterStarts.reduce((a, b) => a < b ? a : b) : pr.end;
                                        if (displayEnd <= pr.start) return null; // 完全に後工程に覆われている場合は非表示

                                        const isDone = isTerminalStep(pr.currentWorkStepCode);
                                        const pc  = isDone ? { bar: 'bg-gray-300', label: 'text-gray-500' } : (PHASE_COLORS[pr.phaseCode] ?? { bar: 'bg-gray-300', label: 'text-gray-600' });
                                        const lx  = xOf(pr.start);
                                        const bw  = wOf(pr.start, displayEnd);
                                        return (
                                            <React.Fragment key={pr.phaseCode}>
                                                {/* 工程バー */}
                                                <div
                                                    title={`[${pr.phaseCode}] ${displayTaskId(task)} ${task.name}\n${pr.start} 〜 ${pr.end}`}
                                                    style={{ position: 'absolute', left: lx, top: '18%', width: bw, height: '64%', borderRadius: 3 }}
                                                    className={`${pc.bar} opacity-80`}
                                                />
                                                {/* クリップ発生時: 実際の終了日に破線縦線 */}
                                                {displayEnd < pr.end && (() => {
                                                    const lineColor = isDone ? '#9ca3af' : (PHASE_HEX[pr.phaseCode] ?? '#9ca3af');
                                                    return <div style={{ position: 'absolute', left: xOf(pr.end) + dayWidth, top: '18%', height: '64%', width: 1, backgroundImage: `repeating-linear-gradient(to bottom, ${lineColor} 0px, ${lineColor} 4px, transparent 4px, transparent 8px)` }} />;
                                                })()}
                                                {/* 工程ラベル（バー左端・左寄せ） */}
                                                <span
                                                    style={{ position: 'absolute', left: lx + 2, top: '50%', transform: 'translateY(-50%)' }}
                                                    className={`text-[11px] font-semibold whitespace-nowrap pointer-events-none select-none ${pc.label}`}
                                                >
                                                    {pr.phaseCode}
                                                </span>
                                            </React.Fragment>
                                        );
                                    }) : (
                                        <span className="absolute inset-y-0 left-2 flex items-center text-xs" style={{ color: '#f4a7b9' }}>日程未設定</span>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* ─── アクションアイテムセクション ─── */}
                        {showActionItems && visibleActionItems.length > 0 && (
                            <>
                                <div className="flex" style={{ height: SECTION_H }}>
                                    <div
                                        style={{ width: sidebarW + DOMAIN_W + ASSIGNEE_W + STATUS_W + ALERT_W + PRIORITY_W, minWidth: sidebarW + DOMAIN_W + ASSIGNEE_W + STATUS_W + ALERT_W + PRIORITY_W, position: 'sticky', left: 0, zIndex: 16 }}
                                        className="bg-purple-50 border-r border-b border-purple-200 px-3 flex items-center"
                                    >
                                        <span className="text-xs font-bold text-purple-700 whitespace-nowrap">アクションアイテム（{visibleActionItems.length}）</span>
                                    </div>
                                    <div style={{ width: totalChartWidth }} className="bg-purple-50 border-b border-purple-200" />
                                </div>

                                {visibleActionItems.map(it => {
                                    const overdue = isItemOverdue(it);
                                    const lx = it.dueDate ? xOf(it.dueDate) : 0;
                                    return (
                                        <div key={it.id} className="flex" style={{ height: ROW_H }}>
                                            <div style={{ width: sidebarW, minWidth: sidebarW, position: 'sticky', left: 0 }}
                                                className="z-10 bg-white border-r border-b flex flex-col justify-center px-2 overflow-hidden">
                                                <span className="text-xs font-mono leading-tight text-amber-700 cursor-pointer hover:underline"
                                                    onClick={() => onOpenActionItem?.(it.id)}>{it.itemId ?? '—'}</span>
                                                <span className="text-xs text-gray-700 truncate leading-tight" title={it.title}>{it.title}</span>
                                                {(it.tags ?? []).length > 0 && (
                                                    <div className="flex items-center gap-0.5 overflow-hidden leading-tight" title={it.tags!.join('、')}>
                                                        {it.tags!.map(t => (
                                                            <span key={t} className={`text-[9px] px-1 rounded shrink-0 ${tagBadge(t)}`}>{t}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ width: DOMAIN_W, minWidth: DOMAIN_W, position: 'sticky', left: sidebarW }}
                                                className="z-10 bg-white border-r border-b flex items-center px-2 overflow-hidden">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded truncate ${categoryBadge(it.category)}`}>{it.category}</span>
                                            </div>
                                            <div style={{ width: ASSIGNEE_W, minWidth: ASSIGNEE_W, position: 'sticky', left: sidebarW + DOMAIN_W }}
                                                className="z-10 bg-white border-r border-b flex items-center px-2 overflow-hidden">
                                                <span className="text-xs text-gray-500 truncate">{it.assignee ? (memberNameMap.get(it.assignee) ?? it.assignee) : '—'}</span>
                                            </div>
                                            <div style={{ width: PRIORITY_W, minWidth: PRIORITY_W, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W }}
                                                className="z-10 bg-white border-r border-b flex items-center px-1.5 overflow-hidden">
                                                {it.priority
                                                    ? <span className={`text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap ${PRIORITY_BADGE[it.priority]}`}>{PRIORITY_LABEL[it.priority]}</span>
                                                    : <span className="text-xs text-gray-300">—</span>}
                                            </div>
                                            <div style={{ width: STATUS_W, minWidth: STATUS_W, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W }}
                                                className="z-10 bg-white border-r border-b flex items-center px-2 overflow-hidden">
                                                <span className={`text-xs px-1.5 py-0.5 rounded-full whitespace-nowrap ${actionItemStatusBadge(it.status)}`}>{it.status}</span>
                                            </div>
                                            <div style={{ width: ALERT_W, minWidth: ALERT_W, position: 'sticky', left: sidebarW + DOMAIN_W + ASSIGNEE_W + PRIORITY_W + STATUS_W }}
                                                className="z-10 bg-white border-r border-b flex items-center px-1.5 overflow-hidden">
                                                {overdue && (
                                                    <div className="flex items-center gap-1 text-red-600 text-xs font-medium">
                                                        <AlertCircle size={14} /><span>超過</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ width: totalChartWidth, height: ROW_H, position: 'relative' }} className="border-b">
                                                <GridLines days={days} months={months} todayX={todayX} totalChartWidth={totalChartWidth} />
                                                <div
                                                    style={{ position: 'absolute', left: lx + dayWidth / 2 - 6, top: '50%', transform: 'translateY(-50%)' }}
                                                    className="flex items-center gap-1 cursor-pointer hover:opacity-75"
                                                    title={`${it.title}（期限: ${it.dueDate}）`}
                                                    onClick={() => onOpenActionItem?.(it.id)}
                                                >
                                                    <span className={`text-sm leading-none shrink-0 ${overdue ? 'text-red-500 drop-shadow-[0_0_2px_rgba(239,68,68,0.9)]' : 'text-purple-500'}`}>★</span>
                                                    <span className="text-[11px] text-gray-700 whitespace-nowrap pl-1 select-none">{it.title}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </>
                        )}

                    </div>
                </div>
            )}

            {/* タスク詳細モーダル */}
            {selectedTask && (
                <TaskDetailModal task={selectedTask} onClose={() => setSelectedTaskId(null)} />
            )}

            {/* 作成・編集モーダル */}
            <ScheduleModal
                open={modalOpen}
                editTarget={editTarget}
                defaultType={modalDefaultType}
                projects={editableProjects}
                defaultProjectId={filterProjectId ? Number(filterProjectId) : (editableProjects[0]?.id ?? 0)}
                onClose={closeModal}
                onCreated={e => setEvents(prev => [...prev, e])}
                onUpdated={e => setEvents(prev => prev.map(ev => ev.id === e.id ? e : ev))}
                onDeleteRequested={e => setDeleteTarget(e)}
            />

            {/* 削除確認 */}
            {deleteTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteTarget(null)}>
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <h3 className="text-base font-semibold text-gray-900">削除の確認</h3>
                        <p className="text-sm text-gray-600">「<span className="font-medium">{deleteTarget.title}</span>」を削除しますか？</p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">キャンセル</button>
                            <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
                                {deleting ? '削除中...' : '削除'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            </div>{/* hidden md:contents */}
        </div>
    );
};
