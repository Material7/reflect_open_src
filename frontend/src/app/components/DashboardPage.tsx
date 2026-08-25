import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
  LineChart, Line,
} from 'recharts';
import { useProject } from '@/context/ProjectContext';
import { PHASES, WORK_STEPS, isTerminalStep, isExcludedStep, isNotStartedStep, isCompletedStep, workStepByCode, INITIAL_WORK_STEP, surveyDueState, systemRoleLabel, PRIORITY_LABEL, PRIORITY_BADGE, PRIORITY_ORDER, PhaseCode, isRequirementPhase, statusColor, isCompletedStatus, isInProgressStatus, isClosedStatus, isRestrictedStatus, IN_PROGRESS_STATUS, RESTRICTED_STATUS_NAMES, ACTION_ITEM_STATUS_NAMES, isCompletedActionItemStatus } from '@/lib/constants';
import { displayTaskId } from '@/lib/ticket';
import { Task, ScheduleEvent, ActionItem } from '@/types';
import { TaskDetailModal } from './TaskDetailModal';
import { tagBadge } from './shared/tags';
import { IndirectTaskDetailModal } from './IndirectTaskDetailModal';
import { WeeklyReportModal } from './WeeklyReportModal';
import { ChevronUp, ChevronDown, ChevronsUpDown, CalendarDays, ArrowRight, FileText, AtSign, ClipboardCheck } from 'lucide-react';
import { scheduleApi, mentionsApi, MentionView, actionItemsApi } from '@/lib/api';

type DashSortKey = 'taskId' | 'name' | 'type' | 'domain' | 'phase' | 'priority' | 'status';
type AiSortKey = 'itemId' | 'title' | 'category' | 'priority' | 'status' | 'dueDate' | 'project';
type SortDir = 'asc' | 'desc';



interface DashboardPageProps {
  onNavigate: (tab: 'requirement' | 'development' | 'schedule' | 'surveys', taskId?: string, openComments?: boolean) => void;
  onOpenActionItem?: (itemId: string) => void;
}

const DUE_SEVERITY: Record<string, number> = { overdue: 0, due_soon: 1, normal: 2, none: 3 };

const SurveyDueChip: React.FC<{ dueDate?: string | null }> = ({ dueDate }) => {
  const state = surveyDueState(dueDate);
  if (state === 'overdue')
    return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 whitespace-nowrap">⛔ 期限切れ {dueDate?.slice(5)}</span>;
  if (state === 'due_soon') {
    const days = Math.round((new Date(dueDate + 'T00:00:00').getTime() - new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime()) / 86400000);
    return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 whitespace-nowrap">⚠ あと{days}日</span>;
  }
  if (dueDate) return <span className="text-[10px] text-gray-400 whitespace-nowrap">{dueDate.slice(5)}</span>;
  return null;
};

const EVENT_COLOR_TEXT: Record<string, string> = {
  indigo: 'text-indigo-500', red: 'text-red-500', orange: 'text-orange-500',
  green: 'text-green-500', purple: 'text-purple-500', gray: 'text-gray-400',
};
const EVENT_COLOR_DOT: Record<string, string> = {
  indigo: 'bg-indigo-500', red: 'bg-red-500', orange: 'bg-orange-500',
  green: 'bg-green-500', purple: 'bg-purple-500', gray: 'bg-gray-400',
};

interface MiniCalendarProps { year: number; month: number; events: ScheduleEvent[]; today: string; selectedDate?: string | null; onDateClick?: (date: string) => void; holidays?: Set<string>; projectCodeById?: Map<number, string> }
const MiniCalendar: React.FC<MiniCalendarProps> = ({ year, month, events, today, selectedDate, onDateClick, holidays, projectCodeById }) => {
  const DOW = ['日','月','火','水','木','金','土'];
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow   = new Date(year, month - 1, 1).getDay();
  const monthStr   = `${year}-${String(month).padStart(2,'0')}`;
  const eventMap   = new Map<string, ScheduleEvent[]>();
  events.forEach(ev => {
    if (ev.date.startsWith(monthStr)) {
      const arr = eventMap.get(ev.date) ?? []; arr.push(ev); eventMap.set(ev.date, arr);
    }
  });
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center">
      <div className="w-fit">
      <p className="text-base font-semibold text-gray-600 mb-2 text-center">{year}年{month}月</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 2.75rem)' }}>
        {DOW.map((d, i) => (
          <div key={d} className={`text-center text-sm font-medium py-1.5 ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-400'}`}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={i} className="py-1" />;
          const dateStr = `${monthStr}-${String(day).padStart(2,'0')}`;
          const evs = eventMap.get(dateStr) ?? [];
          const isToday = dateStr === today;
          const dow = (firstDow + day - 1) % 7;
          const hasEvent = evs.length > 0;
          const isSelected = dateStr === selectedDate;
          return (
            <div key={i}
              className={`flex flex-col items-center py-1 rounded ${hasEvent ? 'cursor-pointer' : ''} ${isSelected ? 'bg-indigo-50 ring-1 ring-indigo-300 rounded' : ''}`}
              onClick={() => hasEvent && onDateClick?.(dateStr)}
            >
              <span className={`text-base w-7 h-7 flex items-center justify-center rounded-full font-medium leading-none
                ${isToday?'bg-indigo-600 text-white':(dow===0||holidays?.has(dateStr))?'text-red-400':dow===6?'text-blue-400':'text-gray-600'}`}>
                {day}
              </span>
              {evs.length > 0 && (
                <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center" style={{maxWidth:22}}>
                  {evs.slice(0,6).map(ev => (
                    <span key={ev.id} title={projectCodeById?.size ? `[${projectCodeById.get(ev.projectId) ?? '?'}] ${ev.title}` : ev.title} style={{fontSize:'9px',lineHeight:1}}
                      className={`${EVENT_COLOR_TEXT[ev.color??'indigo']??EVENT_COLOR_TEXT.indigo}`}>
                      {ev.type === 'milestone' ? '◆' : '●'}
                    </span>
                  ))}
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

function dateDiffDays(from: string, to: string): number {
  const a = new Date(from); const b = new Date(to);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const PHASE_BAR_COLORS = { 未着手: '#cbd5e1', 進行中: '#6366f1', 完了: '#22c55e', 個別除外: '#f59e0b' };

/** タスク一覧と同一ロジック: 現在フェーズと作業工程を返す */
function getCurrentState(task: Task, skippedPhases: string[]) {
  let currentPhase;
  if (task.type === 'Requirement') {
    currentPhase = PHASES.find(p => isRequirementPhase(p.code))!;
  } else {
    const activePhases = PHASES.filter(p =>
      !isRequirementPhase(p.code) && !skippedPhases.includes(p.code)
    );
    currentPhase =
      activePhases.find(p => {
        const code = task.phases?.[p.code]?.currentWorkStepCode;
        return !isTerminalStep(code);
      }) ??
      activePhases[activePhases.length - 1] ??
      PHASES[PHASES.length - 1];
  }
  const phaseData = task.phases?.[currentPhase.code];
  const workStep = workStepByCode(phaseData?.currentWorkStepCode) ?? INITIAL_WORK_STEP;
  return { phase: currentPhase, workStep };
}

const DashSortIconBase: React.FC<{ col: string; sortKey: string; sortDir: SortDir }> = ({ col, sortKey, sortDir }) => {
  if (sortKey !== col) return <ChevronsUpDown size={10} className="inline ml-0.5 text-gray-300" />;
  return sortDir === 'asc'
    ? <ChevronUp size={10} className="inline ml-0.5 text-indigo-500" />
    : <ChevronDown size={10} className="inline ml-0.5 text-indigo-500" />;
};

const Empty: React.FC<{ message: string; height?: number }> = ({ message, height = 160 }) => (
  <div className="flex items-center justify-center text-gray-300 text-sm" style={{ height }}>
    {message}
  </div>
);

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate, onOpenActionItem }) => {
  const { tasks, settings, projects, currentUser, surveys, skippedPhasesOf } = useProject();
  const projectCodeById = useMemo(() => new Map(projects.map(p => [p.id, p.code])), [projects]);
  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const [filterProjectId, setFilterProjectId] = useState<string>('');
  const projectScopedTasks = useMemo(() => {
    const base = tasks.filter(t => t.type !== 'Indirect');
    return filterProjectId ? base.filter(t => String(t.projectId) === filterProjectId) : base;
  }, [tasks, filterProjectId]);
  const surveyPanels = useMemo(() => {
    const emp = currentUser?.employeeNumber;
    const scoped = surveys.filter(d => !filterProjectId || String(d.survey.projectId) === filterProjectId);
    // 要回答（回答者視点）: 自分が対象 & 公開中 & 未回答
    const toAnswer = scoped
      .filter(d => d.targetedToMe && d.survey.status === 'open' && !d.respondedByMe)
      .sort((a, b) => DUE_SEVERITY[surveyDueState(a.survey.dueDate)] - DUE_SEVERITY[surveyDueState(b.survey.dueDate)]);
    // 督促（作成者視点）: 自分が作成 & 公開中 & 未回答者あり
    const toFollowUp = scoped
      .filter(d => d.survey.createdBy === emp && d.survey.status === 'open' && d.respondentCount < d.targetCount)
      .sort((a, b) => DUE_SEVERITY[surveyDueState(a.survey.dueDate)] - DUE_SEVERITY[surveyDueState(b.survey.dueDate)]);
    return { toAnswer, toFollowUp };
  }, [surveys, filterProjectId, currentUser]);

  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  useEffect(() => {
    actionItemsApi.getAll().then(setActionItems).catch(() => { /* 認証エラーは api.ts 側で処理 */ });
  }, []);
  const [aiSortKey, setAiSortKey] = useState<AiSortKey>('dueDate');
  const [aiSortDir, setAiSortDir] = useState<SortDir>('asc');
  const handleAiSort = (key: AiSortKey) => {
    if (aiSortKey === key) setAiSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setAiSortKey(key); setAiSortDir('asc'); }
  };
  const myActionItems = useMemo(() => {
    const emp = currentUser?.employeeNumber;
    if (!emp) return [];
    const filtered = actionItems
      .filter(it => it.assignee === emp && !isCompletedActionItemStatus(it.status))
      .filter(it => !filterProjectId || String(it.projectId) === filterProjectId);
    const val = (it: ActionItem): string | number => {
      switch (aiSortKey) {
        case 'itemId':   return it.itemId ?? '';
        case 'title':    return it.title;
        case 'category': return it.category;
        case 'priority': return PRIORITY_ORDER[it.priority ?? ''] ?? 3;
        case 'status':   { const i = ACTION_ITEM_STATUS_NAMES.indexOf(it.status); return i < 0 ? 999 : i; }
        case 'dueDate':  return it.dueDate || '9999-99-99';
        case 'project':  return projectNameById.get(it.projectId) ?? '';
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'ja');
      return aiSortDir === 'asc' ? cmp : -cmp;
    });
  }, [actionItems, currentUser, filterProjectId, aiSortKey, aiSortDir, projectNameById]);

  // 複数プロジェクトがあり、かつ単一プロジェクトに絞り込んでいない時のみ接頭辞/列を表示
  const showProjectPrefix = projects.length > 1 && !filterProjectId;
  const [myTasksFilter, setMyTasksFilter] = useState<string>('active');
  const [viewMode, setViewMode] = useState<'mine' | 'all'>('mine');
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailCommentMode, setDetailCommentMode] = useState(false);
  const [weeklyReportOpen, setWeeklyReportOpen] = useState(false);

  const [mentions, setMentions] = useState<MentionView[]>([]);
  const loadMentions = React.useCallback(() => {
    mentionsApi.list().then(setMentions).catch(() => {});
  }, []);
  useEffect(() => {
    loadMentions();
    window.addEventListener('mentions-updated', loadMentions);
    return () => window.removeEventListener('mentions-updated', loadMentions);
  }, [loadMentions]);

  const openMention = React.useCallback((mn: MentionView) => {
    const t = tasks.find(tk => tk.id === mn.taskId);
    if (t) {
      setDetailCommentMode(true);
      setDetailTask(t);
    }
  }, [tasks]);
  const [sortKey, setSortKey] = useState<DashSortKey>('taskId');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);
  useEffect(() => {
    scheduleApi.getAll().then(setScheduleEvents).catch(() => {});
  }, []);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const itemRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());

  // イベント読み込み完了後、当日にイベントがあれば初期選択
  useEffect(() => {
    if (scheduleEvents.length === 0) return;
    const t = todayStr();
    if (scheduleEvents.some(e => e.date === t)) setSelectedDate(t);
  }, [scheduleEvents]);

  useEffect(() => {
    if (!selectedDate) return;
    const el = itemRefsMap.current.get(selectedDate);
    if (el && timelineRef.current) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedDate, scheduleEvents]);

  const today = todayStr();

  const holidaySet = useMemo(() =>
    new Set(settings.holidays.map(h => h.date)),
    [settings.holidays]);

  const scopedScheduleEvents = useMemo(
    () => filterProjectId ? scheduleEvents.filter(e => String(e.projectId) === filterProjectId) : scheduleEvents,
    [scheduleEvents, filterProjectId]
  );

  const sortedScheduleEvents = useMemo(() =>
    [...scopedScheduleEvents].sort((a, b) => a.date.localeCompare(b.date)),
    [scopedScheduleEvents]);

  const nextMilestone = useMemo(() =>
    sortedScheduleEvents.find(e => e.type === 'milestone' && e.date >= today) ?? null,
    [sortedScheduleEvents, today]);

  const daysUntilNext = nextMilestone ? dateDiffDays(today, nextMilestone.date) : null;

  const countdownStyle = daysUntilNext === null ? null
    : daysUntilNext <= 7  ? { bg: 'bg-red-50    border border-red-200',    num: 'text-red-600',    label: 'text-red-400'    }
    : daysUntilNext <= 30 ? { bg: 'bg-orange-50  border border-orange-200', num: 'text-orange-500', label: 'text-orange-400' }
    :                       { bg: 'bg-indigo-50  border border-indigo-200', num: 'text-indigo-600', label: 'text-indigo-400' };

  const baseTasks = useMemo(
    () => viewMode === 'mine' ? projectScopedTasks.filter(t => t.assignee === currentUser?.employeeNumber) : projectScopedTasks,
    [projectScopedTasks, viewMode, currentUser]
  );

  /**
   * 表示対象プロジェクトのいずれかで実施される工程。
   * ユニオンビューの settings.skippedPhases だと、1 プロジェクトがスキップしただけで
   * 他プロジェクトの工程まで集計から消えてしまう。
   */
  const activePhases = useMemo(() => {
    const scoped = filterProjectId
      ? [Number(filterProjectId)]
      : projects.map(p => p.id);
    return PHASES.filter(p => scoped.some(id => !skippedPhasesOf(id).includes(p.code)));
  }, [filterProjectId, projects, skippedPhasesOf]);

  /** そのタスクの所属プロジェクトで当該工程がスキップされているか */
  const isPhaseSkipped = useCallback(
    (task: Task, code: PhaseCode) => skippedPhasesOf(task.projectId).includes(code),
    [skippedPhasesOf],
  );

  const [burndownPhase, setBurndownPhase] = useState<string>('すべて');

  // 除外工程を抜いた作業工程順。最終工程を残数 0 の到達点として扱う
  const BURNDOWN_STEPS = useMemo(() => WORK_STEPS.filter(ws => !isExcludedStep(ws.code)), []);
  const burndownGoalCode = BURNDOWN_STEPS[BURNDOWN_STEPS.length - 1]?.code;

  const burndownData = useMemo(() => {
    const stepIndices: number[] = [];

    baseTasks.forEach(task => {
      const candidates = activePhases.filter(p => !isPhaseSkipped(task, p.code));
      const targets = burndownPhase === 'すべて'
        ? candidates.filter(p => p.target === task.type)
        : candidates.filter(p =>
            p.code === burndownPhase &&
            p.target === task.type
          );

      targets.forEach(phase => {
        const wsCode = task.phases[phase.code as PhaseCode]?.currentWorkStepCode;
        if (!wsCode || isExcludedStep(wsCode) || wsCode === burndownGoalCode) return;
        const idx = BURNDOWN_STEPS.findIndex(ws => ws.code === wsCode);
        if (idx !== -1) stepIndices.push(idx);
      });
    });

    const total = stepIndices.length;

    return BURNDOWN_STEPS.map((ws, i) => ({
      name: ws.code,
      fullName: ws.name,
      remaining: ws.code === burndownGoalCode ? 0 : stepIndices.filter(idx => idx >= i).length,
      ideal: Math.round(total * (1 - i / Math.max(BURNDOWN_STEPS.length - 1, 1))),
    }));
  }, [baseTasks, burndownPhase, activePhases, isPhaseSkipped, BURNDOWN_STEPS, burndownGoalCode]);

  const summary = useMemo(() => {
    let req = 0, dev = 0, completed = 0, inProgress = 0, onHold = 0;
    for (const t of baseTasks) {
      if (t.type === 'Requirement') req++; else dev++;
      if (isCompletedStatus(t.status)) completed++;
      else if (isInProgressStatus(t.status)) inProgress++;
      else if (isRestrictedStatus(t.status)) onHold++;
    }
    const total = baseTasks.length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, req, dev, completed, inProgress, onHold, rate };
  }, [baseTasks]);

  const domainNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    settings.domains.forEach(d => { m[d.id] = d.name; });
    return m;
  }, [settings.domains]);

  const myTasks = useMemo(() => {
    if (myTasksFilter === 'active') return baseTasks.filter(t => !isClosedStatus(t.status));
    if (myTasksFilter === 'all') return baseTasks;
    return baseTasks.filter(t => t.status === myTasksFilter);
  }, [baseTasks, myTasksFilter]);

  const sortedTasks = useMemo(() => {
    const statusOrder = settings.taskStatuses;
    return [...myTasks].sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      switch (sortKey) {
        case 'taskId':  valA = a.taskId; valB = b.taskId; break;
        case 'name':    valA = a.name;   valB = b.name;   break;
        case 'type':    valA = a.type;   valB = b.type;   break;
        case 'domain':  valA = domainNameMap[a.domainId] ?? ''; valB = domainNameMap[b.domainId] ?? ''; break;
        case 'status': {
          valA = statusOrder.indexOf(a.status);
          valB = statusOrder.indexOf(b.status);
          break;
        }
        case 'phase': {
          const sa = getCurrentState(a, skippedPhasesOf(a.projectId));
          const sb = getCurrentState(b, skippedPhasesOf(b.projectId));
          const phaseOrder = PHASES.map(p => p.code);
          valA = phaseOrder.indexOf(sa.phase.code) * 1000 + sa.workStep.progress;
          valB = phaseOrder.indexOf(sb.phase.code) * 1000 + sb.workStep.progress;
          break;
        }
        case 'priority': {
          valA = PRIORITY_ORDER[a.priority ?? ''] ?? 3;
          valB = PRIORITY_ORDER[b.priority ?? ''] ?? 3;
          break;
        }
      }
      const cmp = typeof valA === 'number' && typeof valB === 'number'
        ? valA - valB
        : String(valA).localeCompare(String(valB), 'ja');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [myTasks, sortKey, sortDir, domainNameMap, settings.taskStatuses, skippedPhasesOf]);

  const handleSort = (key: DashSortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const phaseProgressData = useMemo(() => {
    return activePhases.map(phase => {
      const relevant = baseTasks.filter(t =>
        phase.target === t.type
        && !isPhaseSkipped(t, phase.code)
      );
      let notStarted = 0, inProgress = 0, completed = 0, excluded = 0;
      relevant.forEach(task => {
        const ws = task.phases?.[phase.code]?.currentWorkStepCode;
        if (isNotStartedStep(ws)) notStarted++;
        else if (isCompletedStep(ws)) completed++;
        else if (isExcludedStep(ws)) excluded++;
        else inProgress++;
      });
      return { name: `${phase.code}(${phase.name})`, 未着手: notStarted, 進行中: inProgress, 完了: completed, 個別除外: excluded };
    });
  }, [baseTasks, activePhases, isPhaseSkipped]);

  const phaseProgressEmpty = phaseProgressData.every(d => d.未着手 === 0 && d.進行中 === 0 && d.完了 === 0);

  const manHoursData = useMemo(() => {
    return activePhases.map(phase => {
      let planned = 0, actual = 0;
      baseTasks.forEach(task => {
        if (isPhaseSkipped(task, phase.code)) return;
        Object.values(task.phases?.[phase.code]?.schedule ?? {}).forEach(sched => {
          planned += sched.plannedManHours ?? 0;
          actual += sched.actualManHours ?? 0;
        });
      });
      return { name: `${phase.code}(${phase.name})`, 予定: Math.round(planned * 10) / 10, 実績: Math.round(actual * 10) / 10 };
    });
  }, [baseTasks, activePhases, isPhaseSkipped]);

  const manHoursEmpty = manHoursData.every(d => d.予定 === 0 && d.実績 === 0);

  const myManHoursData = useMemo(() => {
    const empNo = currentUser?.employeeNumber ?? '';
    return activePhases.map(phase => {
      let hours = 0;
      projectScopedTasks.forEach(task => {
        if (isPhaseSkipped(task, phase.code)) return;
        Object.values(task.phases?.[phase.code]?.schedule ?? {}).forEach(sched => {
          hours += Object.values(sched.actualManHoursPerMember?.[empNo] ?? {}).reduce((a, b) => a + b, 0);
        });
      });
      return { name: phase.name, hours: Math.round(hours * 10) / 10 };
    });
  }, [projectScopedTasks, activePhases, isPhaseSkipped, currentUser]);

  const myManHoursTotal = myManHoursData.reduce((a, d) => a + d.hours, 0);
  const myManHoursMax = Math.max(...myManHoursData.map(d => d.hours), 1);
  const myManHoursEmpty = myManHoursTotal === 0;

  const domainData = useMemo(() =>
    settings.domains
      .map(domain => {
        const dt = baseTasks.filter(t => t.domainId === domain.id);
        const comp = dt.filter(t => isCompletedStatus(t.status)).length;
        return { name: domain.name, total: dt.length, completed: comp, rate: dt.length > 0 ? Math.round((comp / dt.length) * 100) : 0 };
      })
      .filter(d => d.total > 0),
    [baseTasks, settings.domains]
  );

  const todayLabel = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

  return (
    <>
    <div className="space-y-6">

      {/* ── ウェルカムバー ─────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">
            こんにちは、{currentUser?.name}さん
            <span className="ml-2 text-sm font-normal text-gray-400">({systemRoleLabel(currentUser?.role)})</span>
          </h2>
          <p className="text-sm text-gray-400 mt-0.5">{todayLabel}</p>
        </div>

        <div className="flex items-center gap-3">
          {/* プロジェクトフィルタ */}
          {projects.length > 1 && (
            <select
              value={filterProjectId}
              onChange={e => setFilterProjectId(e.target.value)}
              title="表示するプロジェクト"
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 max-w-[12rem]"
            >
              <option value="">全プロジェクト</option>
              {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          )}
          {/* 週報作成ボタン */}
          <button
            onClick={() => setWeeklyReportOpen(true)}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-sm text-indigo-600 border border-indigo-200 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <FileText size={14} />
            週報作成
          </button>

        {/* 自分 / 全体 トグルスイッチ */}
        <div className="flex items-center gap-2 select-none">
          <span
            onClick={() => setViewMode('mine')}
            className={`text-sm font-medium cursor-pointer transition-colors ${viewMode === 'mine' ? 'text-indigo-700' : 'text-gray-400 hover:text-gray-600'}`}
          >
            自分
          </span>
          <button
            onClick={() => setViewMode(viewMode === 'mine' ? 'all' : 'mine')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              viewMode === 'all' ? 'bg-indigo-600' : 'bg-gray-300'
            }`}
            aria-label="表示切り替え"
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                viewMode === 'all' ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span
            onClick={() => setViewMode('all')}
            className={`text-sm font-medium cursor-pointer transition-colors ${viewMode === 'all' ? 'text-indigo-700' : 'text-gray-400 hover:text-gray-600'}`}
          >
            全体
          </span>
        </div>
        </div>
      </div>

      {/* ── サマリーカード ────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: '総タスク数', value: summary.total, sub: `要件 ${summary.req} / 開発 ${summary.dev}`, color: 'text-gray-800' },
          { label: '完了率', value: `${summary.rate}%`, sub: `${summary.completed} / ${summary.total} 完了`, color: 'text-green-600' },
          { label: IN_PROGRESS_STATUS, value: summary.inProgress, sub: `ステータス: ${IN_PROGRESS_STATUS}`, color: 'text-indigo-600' },
          { label: '要注意', value: summary.onHold, sub: RESTRICTED_STATUS_NAMES.join(' / '), color: 'text-amber-500' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3 md:px-5 md:py-4">
            <p className="text-xs md:text-sm font-medium text-gray-500 mb-1">{card.label}</p>
            <p className={`text-2xl md:text-[28px] font-bold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* ── スケジュールパネル ─────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <CalendarDays size={15} className="text-indigo-500" />
            スケジュール
          </h3>
          <button
            onClick={() => onNavigate('schedule')}
            className="flex items-center gap-0.5 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
          >
            詳細を見る <ArrowRight size={12} />
          </button>
        </div>

        {scopedScheduleEvents.length === 0 ? (
          <Empty message="スケジュールデータなし" height={100} />
        ) : (() => {
          const now = new Date();
          const m1 = { year: now.getFullYear(), month: now.getMonth() + 1 };
          const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          const m2 = { year: next.getFullYear(), month: next.getMonth() + 1 };
          return (
            <div className="flex flex-col md:flex-row gap-5 md:items-stretch md:h-[340px]">
              {/* カウントダウン */}
              <div className="md:shrink-0 md:w-52">
                {nextMilestone && countdownStyle ? (
                  <div className={`rounded-xl px-5 py-4 ${countdownStyle.bg} flex flex-col justify-between`}>
                    <div>
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">次のマイルストーン</p>
                      {showProjectPrefix && (
                        <p className="text-xs font-semibold text-indigo-600 mb-0.5">{projectNameById.get(nextMilestone.projectId) ?? projectCodeById.get(nextMilestone.projectId) ?? ''}</p>
                      )}
                      <p className="text-base font-semibold text-gray-800 leading-snug line-clamp-2">◆ {nextMilestone.title}</p>
                      <p className="text-xs text-gray-400 mt-1.5">{nextMilestone.date}</p>
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-4">
                      <span className={`text-5xl font-bold tabular-nums ${countdownStyle.num}`}>{daysUntilNext}</span>
                      <span className={`text-base font-medium ${countdownStyle.label}`}>日後</span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl px-5 py-4 bg-gray-50 border border-gray-200 flex items-center justify-center min-h-[80px] md:h-full">
                    <p className="text-sm text-gray-300">今後のマイルストーンなし</p>
                  </div>
                )}
              </div>

              {/* ミニカレンダー 2ヶ月（残スペースの2/3を使用）- モバイルでは非表示 */}
              <div className="hidden md:flex flex-[1.5] gap-3 border border-gray-100 rounded-xl px-1 py-3 bg-gray-50/50">
                <MiniCalendar year={m1.year} month={m1.month} events={scopedScheduleEvents} today={today} selectedDate={selectedDate} onDateClick={setSelectedDate} holidays={holidaySet} projectCodeById={showProjectPrefix ? projectCodeById : undefined} />
                <div className="w-px bg-gray-200 self-stretch" />
                <MiniCalendar year={m2.year} month={m2.month} events={scopedScheduleEvents} today={today} selectedDate={selectedDate} onDateClick={setSelectedDate} holidays={holidaySet} projectCodeById={showProjectPrefix ? projectCodeById : undefined} />
              </div>

              {/* タイムラインリスト（残スペースの1/3） */}
              <div ref={timelineRef} className="flex-1 min-w-0 overflow-auto space-y-0.5 max-h-64 md:max-h-none">
                {sortedScheduleEvents.map(ev => {
                  const diff = dateDiffDays(today, ev.date);
                  const isPast = diff < 0;
                  const colorText = EVENT_COLOR_TEXT[ev.color ?? 'indigo'] ?? EVENT_COLOR_TEXT.indigo;
                  const diffLabel = diff === 0 ? '今日' : diff > 0 ? `${diff}日後` : `${-diff}日前`;
                  const diffColor = isPast ? 'text-gray-300' : diff === 0 ? 'text-red-500 font-semibold' : diff <= 7 ? 'text-red-400 font-semibold' : 'text-gray-400';
                  const isHighlighted = ev.date === selectedDate;
                  return (
                    <div key={ev.id}
                      ref={el => {
                        if (el) { if (!itemRefsMap.current.has(ev.date)) itemRefsMap.current.set(ev.date, el); }
                        else itemRefsMap.current.delete(ev.date);
                      }}
                      className={`flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors ${isPast ? 'opacity-40' : 'hover:bg-gray-50'} ${isHighlighted ? 'bg-indigo-50 border border-indigo-200' : 'border border-transparent'}`}>
                      <span className={`shrink-0 text-base leading-none ${colorText}`}>{ev.type === 'milestone' ? '◆' : '●'}</span>
                      <span className="shrink-0 w-28 text-gray-600 tabular-nums">{ev.date}</span>
                      <span className="flex-1 text-gray-900 truncate">
                        {showProjectPrefix && (
                          <span className="font-semibold text-indigo-600">[{projectCodeById.get(ev.projectId) ?? '?'}] </span>
                        )}
                        {ev.title}
                      </span>
                      {ev.type === 'event' && ev.endDate && (
                        <span className="shrink-0 text-gray-600 text-xs">〜{ev.endDate}</span>
                      )}
                      <span className={`shrink-0 w-14 text-right tabular-nums ${diffColor}`}>{diffLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── メンションパネル ───────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <AtSign size={15} className="text-indigo-500" />
            自分宛コメント
            {mentions.some(mn => !mn.read) && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
                {mentions.filter(mn => !mn.read).length}
              </span>
            )}
          </h3>
        </div>
        {mentions.length === 0 ? (
          <Empty message="自分宛のコメントはありません" height={80} />
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {mentions.slice(0, 30).map(mn => (
              <button
                key={mn.id}
                onClick={() => openMention(mn)}
                className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                  mn.read
                    ? 'border-gray-100 bg-white hover:bg-gray-50'
                    : 'border-indigo-100 bg-indigo-50/50 hover:bg-indigo-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {!mn.read && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                  <span className="text-[11px] font-mono text-indigo-600 shrink-0">{mn.taskDisplayId ?? '—'}</span>
                  <span className="text-xs font-medium text-gray-700 truncate">{mn.taskName ?? '(削除されたタスク)'}</span>
                  <span className="text-[10px] text-gray-400 ml-auto shrink-0">
                    {new Date(mn.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="text-xs text-gray-500 truncate pl-0.5">
                  <span className="text-gray-400">{mn.createdByName}：</span>{mn.snippet}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── 自分のアクションアイテム ──────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            自分のアクションアイテム
            {myActionItems.length > 0 && <span className="text-xs font-normal text-gray-400">{myActionItems.length}件</span>}
          </h3>
        </div>
        {myActionItems.length === 0 ? (
          <Empty message="担当のアクションアイテムはありません" height={120} />
        ) : (
          <div className="overflow-auto max-h-[300px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-xs text-gray-700 border-b border-gray-100">
                  {showProjectPrefix && (
                    <th className="text-left pb-2 font-medium pr-3 whitespace-nowrap">
                      <button onClick={() => handleAiSort('project')} className="flex items-center gap-0.5 text-xs hover:text-gray-600 transition-colors whitespace-nowrap">
                        プロジェクト<DashSortIconBase col="project" sortKey={aiSortKey} sortDir={aiSortDir} />
                      </button>
                    </th>
                  )}
                  {([ ['itemId','ID'], ['title','タイトル'], ['category','種別'], ['priority','優先度'], ['status','ステータス'], ['dueDate','期限'] ] as [AiSortKey, string][]).map(([key, label]) => (
                    <th key={key} className="text-left pb-2 font-medium pr-3">
                      <button onClick={() => handleAiSort(key)} className="flex items-center gap-0.5 text-xs hover:text-gray-600 transition-colors whitespace-nowrap">
                        {label}<DashSortIconBase col={key} sortKey={aiSortKey} sortDir={aiSortDir} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {myActionItems.map(it => {
                  const overdue = !!it.dueDate && it.dueDate < todayStr();
                  return (
                    <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50">
                      {showProjectPrefix && (
                        <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap max-w-[120px] truncate">{projectNameById.get(it.projectId) ?? '—'}</td>
                      )}
                      <td className="py-1.5 pr-3">
                        <button onClick={() => onOpenActionItem?.(it.id)} className="font-mono text-purple-600 hover:text-purple-800 hover:underline text-xs font-semibold">{it.itemId ?? '—'}</button>
                      </td>
                      <td className="py-1.5 text-gray-800 pr-3 max-w-[200px] truncate" title={it.title}>{it.title}</td>
                      <td className="py-1.5 text-gray-500 pr-3 whitespace-nowrap">{it.category}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        {it.priority
                          ? <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_BADGE[it.priority]}`}>{PRIORITY_LABEL[it.priority]}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{it.status}</span>
                      </td>
                      <td className={`py-1.5 pr-3 whitespace-nowrap ${overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                        {it.dueDate ? it.dueDate.replace(/-/g, '/') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── アンケートパネル ───────────────────────────────── */}
      {(surveyPanels.toAnswer.length > 0 || surveyPanels.toFollowUp.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <ClipboardCheck size={15} className="text-indigo-500" />
              アンケート
              {surveyPanels.toAnswer.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
                  {surveyPanels.toAnswer.length}
                </span>
              )}
            </h3>
            <button onClick={() => onNavigate('surveys')} className="flex items-center gap-0.5 text-xs text-indigo-500 hover:text-indigo-700 transition-colors">
              一覧へ <ArrowRight size={12} />
            </button>
          </div>

          {surveyPanels.toAnswer.length > 0 && (
            <div className="mb-3">
              <p className="text-[11px] font-semibold text-gray-400 mb-1.5">要回答（自分が対象）</p>
              <div className="space-y-1.5">
                {surveyPanels.toAnswer.map(d => (
                  <button key={d.survey.id} onClick={() => onNavigate('surveys')}
                    className="w-full text-left rounded-lg border border-gray-100 bg-white hover:bg-gray-50 px-3 py-2 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                      <span className="text-xs font-medium text-gray-700 truncate flex-1">{d.survey.title}</span>
                      <SurveyDueChip dueDate={d.survey.dueDate} />
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5 pl-3.5">{d.survey.projectId == null ? '全プロジェクト' : (projectNameById.get(d.survey.projectId) ?? '')}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {surveyPanels.toFollowUp.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 mb-1.5">自分が作成（未回答者あり）</p>
              <div className="space-y-1.5">
                {surveyPanels.toFollowUp.map(d => (
                  <button key={d.survey.id} onClick={() => onNavigate('surveys')}
                    className="w-full text-left rounded-lg border border-gray-100 bg-white hover:bg-gray-50 px-3 py-2 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700 truncate flex-1">{d.survey.title}</span>
                      <span className="text-[10px] text-gray-500 whitespace-nowrap">回答 {d.respondentCount}/{d.targetCount}</span>
                      <SurveyDueChip dueDate={d.survey.dueDate} />
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{d.survey.projectId == null ? '全プロジェクト' : (projectNameById.get(d.survey.projectId) ?? '')}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 自分のタスク + 自分の実績工数 ──────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[7fr_2fr] gap-6">

        {/* 自分のタスク */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">{viewMode === 'mine' ? '自分のタスク' : '全タスク'}</h3>
            <div className="flex gap-1 flex-wrap justify-end">
              {(['active', 'all', ...settings.taskStatuses] as string[]).map(s => (
                <button
                  key={s}
                  onClick={() => setMyTasksFilter(s)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${myTasksFilter === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {s === 'active' ? '進行中のみ' : s === 'all' ? 'すべて' : s}
                </button>
              ))}
            </div>
          </div>
          {myTasks.length === 0 ? (
            <Empty message={myTasksFilter === 'active' ? '進行中のタスクはありません' : 'タスクはありません'} height={140} />
          ) : (
            <>
              {/* モバイル用カードリスト */}
              <div className="md:hidden space-y-2 max-h-[312px] overflow-auto">
                {sortedTasks.map(task => {
                  const { phase, workStep } = getCurrentState(task, skippedPhasesOf(task.projectId));
                  return (
                    <div key={task.id} onClick={() => setDetailTask(task)} className="border border-gray-100 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-mono text-indigo-600 text-xs font-semibold">{displayTaskId(task)}</span>
                        <div className="flex items-center gap-1">
                          {task.priority && <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_BADGE[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>}
                          <span className="px-1.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: statusColor(task.status).bg, color: statusColor(task.status).text }}>{task.status}</span>
                        </div>
                      </div>
                      {showProjectPrefix && (
                        <p className="text-[11px] font-semibold text-indigo-600 truncate mb-0.5">{projectNameById.get(task.projectId) ?? ''}</p>
                      )}
                      <p className="text-xs font-medium text-gray-800 truncate mb-1">{task.name}</p>
                      {(task.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mb-1">
                          {task.tags!.map(t => <span key={t} className={`px-1 rounded text-[10px] font-medium ${tagBadge(t)}`}>{t}</span>)}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{domainNameMap[task.domainId] ?? task.domainId}</span>
                        <span className="px-1 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">{phase.code}</span>
                        <span className="font-mono">{workStep.code}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* デスクトップ用テーブル */}
              <div className="hidden md:block overflow-auto max-h-[312px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="text-xs text-gray-700 border-b border-gray-100">
                      {showProjectPrefix && (
                        <th className="text-left pb-2 font-medium pr-3 whitespace-nowrap">プロジェクト</th>
                      )}
                      {([ ['taskId','タスクID'], ['name','タスク名'], ['type','種別'], ['domain','ドメイン'], ['phase','現在工程'], ['priority','優先度'], ['status','ステータス'] ] as [DashSortKey, string][]).map(([key, label]) => (
                        <th key={key} className="text-left pb-2 font-medium pr-3">
                          <button onClick={() => handleSort(key)} className="flex items-center gap-0.5 text-xs hover:text-gray-600 transition-colors whitespace-nowrap">
                            {label}<DashSortIconBase col={key} sortKey={sortKey} sortDir={sortDir} />
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTasks.map(task => {
                      const { phase, workStep } = getCurrentState(task, skippedPhasesOf(task.projectId));
                      return (
                      <tr key={task.id} className="border-b border-gray-50 hover:bg-gray-50">
                        {showProjectPrefix && (
                          <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap max-w-[120px] truncate">{projectNameById.get(task.projectId) ?? '—'}</td>
                        )}
                        <td className="py-1.5 pr-3">
                          <button onClick={() => setDetailTask(task)} className="font-mono text-indigo-600 hover:text-indigo-800 hover:underline text-xs font-semibold">{displayTaskId(task)}</button>
                        </td>
                        <td className="py-1.5 text-gray-800 pr-3 max-w-[140px]">
                          <div className="truncate">{task.name}</div>
                          {(task.tags ?? []).length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5">
                              {task.tags!.map(t => <span key={t} className={`px-1 rounded text-[10px] font-medium ${tagBadge(t)}`}>{t}</span>)}
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 text-gray-500 pr-3">{task.type === 'Requirement' ? '要件' : '開発'}</td>
                        <td className="py-1.5 text-gray-500 pr-3">{domainNameMap[task.domainId] ?? task.domainId}</td>
                        <td className="py-1.5 pr-3">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium text-xs border border-indigo-200">{phase.code}</span>
                            <span className="font-mono text-gray-700 text-xs">{workStep.code}</span>
                          </div>
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {task.priority
                            ? <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_BADGE[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="py-1.5">
                          <span className="px-1.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: statusColor(task.status).bg, color: statusColor(task.status).text }}>{task.status}</span>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* 自分の実績工数（右側） */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">自分の実績工数</h3>
            {!myManHoursEmpty && (
              <span className="text-xs text-gray-400">合計 <span className="font-semibold text-indigo-600">{Math.round(myManHoursTotal * 10) / 10}h</span></span>
            )}
          </div>
          {myManHoursEmpty ? <Empty message="実績工数なし" height={200} /> : (
            <div className="space-y-3 overflow-auto max-h-[312px]">
              {myManHoursData.map(d => (
                <div key={d.name}>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="font-medium">{d.name}</span>
                    <span className={`font-semibold ${d.hours > 0 ? 'text-indigo-600' : 'text-gray-300'}`}>
                      {d.hours > 0 ? `${d.hours}h` : '—'}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className="bg-indigo-400 h-1.5 rounded-full transition-all"
                      style={{ width: `${(d.hours / myManHoursMax) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 工程別バーンダウンチャート ────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-700">工程別バーンダウン</h3>
          <div className="flex gap-1 flex-wrap justify-end">
            {(['すべて', ...activePhases.map(p => p.code)]).map(ph => (
              <button
                key={ph}
                onClick={() => setBurndownPhase(ph)}
                className={`px-2 py-1 rounded text-xs transition-colors ${burndownPhase === ph ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {ph}
              </button>
            ))}
          </div>
        </div>
        {burndownData.every(d => d.remaining === 0 && d.ideal === 0)
          ? <Empty message="データなし" height={200} />
          : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={burndownData} margin={{ top: 4, right: 16, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                <Tooltip
                  formatter={(value: number, name: string) => [`${value} 件`, name]}
                  labelFormatter={(label: string) => {
                    const item = burndownData.find(d => d.name === label);
                    return `${label}：${item?.fullName ?? ''}`;
                  }}
                />
                <Legend iconSize={10} verticalAlign="top" wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
                <Line
                  type="linear"
                  dataKey="ideal"
                  name="理想ライン"
                  stroke="#d1d5db"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                />
                <Line
                  type="linear"
                  dataKey="remaining"
                  name="残件数"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#6366f1' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )
        }
      </div>

      {/* ── ドメイン別状況 + 工数サマリー ──────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* ドメイン別状況 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">ドメイン別状況</h3>
          {domainData.length === 0 ? <Empty message="データなし" /> : (
            <div className="space-y-4 overflow-auto max-h-52">
              {domainData.map(d => (
                <div key={d.name}>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-gray-400">{d.completed} / {d.total} 完了 &nbsp;<span className="font-semibold text-indigo-600">{d.rate}%</span></span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${d.rate}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 工数サマリー（予定 vs 実績） */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">工数サマリー（時間）</h3>
          {manHoursEmpty ? <Empty message="登録工数なし" /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={manHoursData} margin={{ top: 0, right: 10, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend iconSize={10} verticalAlign="top" formatter={(value) => <span style={{ color: '#111827', fontSize: 11 }}>{value}</span>} wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
                <Bar dataKey="予定" fill="#4ade80" radius={[4, 4, 0, 0]} />
                <Bar dataKey="実績" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>

      {/* ── 工程別進捗（横型プログレスバー）──────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">工程別進捗</h3>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {(Object.entries(PHASE_BAR_COLORS) as [keyof typeof PHASE_BAR_COLORS, string][]).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1 text-xs text-gray-500">
                <span className="w-2.5 h-2.5 rounded-sm inline-block shrink-0" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
        {phaseProgressEmpty ? <Empty message="データなし" height={120} /> : (
          <div className="space-y-4">
            {phaseProgressData.map(phase => {
              const total = phase.未着手 + phase.進行中 + phase.完了 + phase.個別除外;
              const rate = total > 0 ? Math.round((phase.完了 / total) * 100) : 0;
              const pct = (n: number) => total > 0 ? (n / total) * 100 : 0;
              return (
                <div key={phase.name}>
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-xs font-medium text-gray-700 w-24 md:w-32 shrink-0 truncate" title={phase.name}>{phase.name}</span>
                    <div className="flex-1 h-5 rounded-md overflow-hidden flex bg-gray-100 min-w-0">
                      {phase.完了   > 0 && <div className="h-full transition-all" style={{ width: `${pct(phase.完了)}%`,   backgroundColor: PHASE_BAR_COLORS.完了   }} title={`完了: ${phase.完了}`} />}
                      {phase.進行中 > 0 && <div className="h-full transition-all" style={{ width: `${pct(phase.進行中)}%`, backgroundColor: PHASE_BAR_COLORS.進行中 }} title={`進行中: ${phase.進行中}`} />}
                      {phase.個別除外 > 0 && <div className="h-full transition-all" style={{ width: `${pct(phase.個別除外)}%`, backgroundColor: PHASE_BAR_COLORS.個別除外 }} title={`個別除外: ${phase.個別除外}`} />}
                      {phase.未着手 > 0 && <div className="h-full transition-all" style={{ width: `${pct(phase.未着手)}%`, backgroundColor: PHASE_BAR_COLORS.未着手 }} title={`未着手: ${phase.未着手}`} />}
                    </div>
                    <div className="text-xs text-right shrink-0 w-28">
                      <span className="font-semibold text-gray-700">{phase.完了}<span className="text-gray-400 font-normal"> / {total}</span></span>
                      <span className={`ml-2 font-bold tabular-nums ${rate >= 80 ? 'text-green-600' : rate >= 40 ? 'text-indigo-600' : 'text-gray-400'}`}>{rate}%</span>
                    </div>
                  </div>
                  <div className="pl-[6.5rem] md:pl-[8.5rem] flex gap-3 text-xs text-gray-400">
                    {phase.未着手   > 0 && <span>未着手 <span className="font-medium text-gray-500">{phase.未着手}</span></span>}
                    {phase.進行中   > 0 && <span>進行中 <span className="font-medium text-indigo-500">{phase.進行中}</span></span>}
                    {phase.完了     > 0 && <span>完了 <span className="font-medium text-green-600">{phase.完了}</span></span>}
                    {phase.個別除外 > 0 && <span>除外 <span className="font-medium text-amber-500">{phase.個別除外}</span></span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>

    {/* タスク詳細モーダル */}
    {detailTask && (
      detailTask.type === 'Indirect' ? (
        <IndirectTaskDetailModal
          task={detailTask}
          onClose={() => { setDetailTask(null); setDetailCommentMode(false); }}
          initialMainTab={detailCommentMode ? 'comments' : 'detail'}
        />
      ) : (
        <TaskDetailModal
          task={detailTask}
          onClose={() => { setDetailTask(null); setDetailCommentMode(false); }}
          initialMainTab={detailCommentMode ? 'comments' : 'phases'}
        />
      )
    )}

    {/* 週報作成モーダル */}
    {weeklyReportOpen && (
      <WeeklyReportModal onClose={() => setWeeklyReportOpen(false)} initialProjectId={filterProjectId ? Number(filterProjectId) : undefined} />
    )}
    </>
  );
};
