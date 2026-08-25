import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useProject } from '@/context/ProjectContext';
import { Task, TaskPhaseData, WorkStepSchedule, TaskStatus, TaskPriority, Deliverable, TaskReference, TaskReferenceKind } from '@/types';
import { PHASES, PhaseCode, WORK_STEPS, isTerminalStep, isNotStartedStep, isExcludedStep, workStepByCode, INITIAL_WORK_STEP_CODE, EXCLUDED_WORK_STEP_CODE, ROLE_HIERARCHY, WORK_STEP_TRANSITION_ROLE_LIMIT, WORK_STEP_ROLE_LIMIT, PRIORITY_OPTIONS, PRIORITY_LABEL, PRIORITY_BADGE, REQUIREMENT_PHASE_CODE, isRequirementPhase, statusBadge, COMPLETED_STATUS, IN_PROGRESS_STATUS, NOT_STARTED_STATUS, isNotStartedStatus, isInProgressStatus, isCompletedStatus, isRestrictedStatus } from '@/lib/constants';
import { WorkStepSelect } from './WorkStepSelect';
import { X, Calendar, Save, Clock, Plus, ChevronDown, Lock, List, MessageSquare, ExternalLink, Pencil, Globe, FileText, GitBranch, Database } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { TimeTrackingModal } from './TimeTrackingModal';
import { DatePickerWithHolidays } from './DatePickerWithHolidays';
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { tagBadge, TagMultiSelect } from './shared/tags';
import { svnApi, gitApi, SvnLogEntry, commentsApi } from '@/lib/api';
import { extractTicketKey, findTicketKeyConflict } from '@/lib/ticket';
import { CommentPanel } from './CommentPanel';

interface TaskDetailModalProps {
  task: Task;
  onClose: () => void;
  /** 初期表示タブ（メンションから開いた場合は 'comments'） */
  initialMainTab?: 'phases' | 'comments';
}

const REFERENCE_KIND_META: Record<TaskReferenceKind, { label: string; badge: string; Icon: LucideIcon }> = {
  web:  { label: 'Web',      badge: 'bg-sky-100 text-sky-700',       Icon: Globe },
  file: { label: 'ファイル', badge: 'bg-gray-100 text-gray-600',     Icon: FileText },
  svn:  { label: 'SVN',      badge: 'bg-orange-100 text-orange-700', Icon: Database },
  git:  { label: 'Git',      badge: 'bg-violet-100 text-violet-700', Icon: GitBranch },
};
const REFERENCE_KINDS: TaskReferenceKind[] = ['web', 'file', 'svn', 'git'];

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v.trim());

/** 入力値から参照種別を推定する */
const detectReferenceKind = (value: string): TaskReferenceKind => {
  const v = value.trim();
  if (/^(svn(\+ssh)?:\/\/)/i.test(v)) return 'svn';
  if (/^(git@|git:\/\/|ssh:\/\/git)/i.test(v) || /\.git($|[/?#])/i.test(v)) return 'git';
  if (/^(https?:\/\/)/i.test(v)) return 'web';
  if (/^(\\\\|[a-zA-Z]:\\|file:\/\/|\/)/.test(v)) return 'file';
  return 'web';
};

/** ブラウザで開けるか（http(s) のみ。file はコピー主体で開かない） */
const isReferenceOpenable = (ref: Pick<TaskReference, 'kind' | 'value'>) =>
  ref.kind !== 'file' && isHttpUrl(ref.value);

/** ブラウザで開くURL。SVN でリビジョン指定があれば mod_dav_svn のペグリビジョン(?p=)を付与 */
const buildReferenceOpenUrl = (ref: Pick<TaskReference, 'kind' | 'value' | 'revision'>): string => {
  const base = ref.value.trim();
  if (ref.kind === 'svn' && ref.revision && ref.revision.trim()) {
    const rev = encodeURIComponent(ref.revision.trim());
    return base.includes('?') ? `${base}&p=${rev}` : `${base}?p=${rev}`;
  }
  return base;
};

const emptyReference = (): TaskReference => ({ id: '', kind: 'web', label: '', value: '', revision: '', branch: '', note: '' });

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({ task, onClose, initialMainTab = 'phases' }) => {
  const { tasks, updateTask, deleteTask, currentUser, getSettings, resolveProjectRole } = useProject();
  // このモーダルは 1 タスク＝1 プロジェクトを扱う。全プロジェクトのユニオンビューを使うと
  // 他プロジェクトでスキップされた工程まで除外され、成果物種別やメンバーも混ざるため、
  // 設定は必ずタスクの所属プロジェクトのものを参照する
  const settings = getSettings(task.projectId);
  // 権限判定はシステムロールではなく、このタスクが属するプロジェクトでのロールで行う
  const projectRole = resolveProjectRole(task.projectId) ?? '';
  const [activePhaseCode, setActivePhaseCode] = useState<PhaseCode>(REQUIREMENT_PHASE_CODE);
  const [activeMainTab, setActiveMainTab] = useState<'phases' | 'comments'>(initialMainTab);
  const [commentCount, setCommentCount] = useState(0);

  // タブのバッジ用にコメント件数を取得（コメントパネルが開いている間は onCountChange で同期）
  useEffect(() => {
    commentsApi.list(task.id).then(c => setCommentCount(c.length)).catch(() => {});
  }, [task.id]);

  const [isEditingAssignee, setIsEditingAssignee] = useState(false);
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [isEditingPriority, setIsEditingPriority] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [isEditingTicket, setIsEditingTicket] = useState(false);
  const [ticketUrlDraft, setTicketUrlDraft] = useState('');
  const [ticketError, setTicketError] = useState('');

  const handleSaveTicket = useCallback(() => {
    const url = ticketUrlDraft.trim();
    const key = url ? (extractTicketKey(url) ?? undefined) : undefined;
    if (key && findTicketKeyConflict(tasks, task.projectId, key, task.id)) {
      setTicketError(`チケットID「${key}」は同一プロジェクト内で既に使われています`);
      return;
    }
    updateTask({ ...task, ticketUrl: url || undefined, ticketKey: key })
      .then(() => setIsEditingTicket(false))
      .catch(e => setTicketError(e instanceof Error ? e.message : '保存に失敗しました'));
  }, [ticketUrlDraft, task, updateTask, tasks]);

  const memberNameByEmpNo = useMemo(
    () => new Map(settings.members.map(m => [m.employeeNumber, m.name])),
    [settings.members]
  );
  const assigneeName = memberNameByEmpNo.get(task.assignee) ?? task.assignee;

  const taskStatusBadge = statusBadge(task.status);
  const [trackingType, setTrackingType] = useState<'planned' | 'actual' | null>(null);
  const [showDeliverableModal, setShowDeliverableModal] = useState(false);
  const [isEditingDeliverable, setIsEditingDeliverable] = useState(false);
  const [editingDeliverableIndex, setEditingDeliverableIndex] = useState<number>(-1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newDeliverable, setNewDeliverable] = useState<Deliverable>({ type: '', name: '', workflow: '', revision: '', url: '', branch: '' });
  const [svnRevisions, setSvnRevisions] = useState<SvnLogEntry[]>([]);
  const [svnRevListOpen, setSvnRevListOpen] = useState(false);
  const [svnLoading, setSvnLoading] = useState(false);
  const [svnError, setSvnError] = useState<string | null>(null);
  const svnRevListRef = useRef<HTMLDivElement>(null);

  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [branchListOpen, setBranchListOpen] = useState(false);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const branchListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svnRevListOpen) return;
    const handler = (e: MouseEvent) => {
      if (svnRevListRef.current && !svnRevListRef.current.contains(e.target as Node)) {
        setSvnRevListOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [svnRevListOpen]);

  useEffect(() => {
    if (!branchListOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchListRef.current && !branchListRef.current.contains(e.target as Node)) {
        setBranchListOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [branchListOpen]);

  const [deliverablesByPhase, setDeliverablesByPhase] = useState<Record<string, Deliverable[]>>(
    task.deliverablesByPhase ?? {}
  );

  const [references, setReferences] = useState<TaskReference[]>(task.references ?? []);
  const [showReferenceModal, setShowReferenceModal] = useState(false);
  const [isEditingReference, setIsEditingReference] = useState(false);
  const [editingReferenceIndex, setEditingReferenceIndex] = useState<number>(-1);
  const [newReference, setNewReference] = useState<TaskReference>(emptyReference());

  const handleOpenAddReference = useCallback(() => {
    setNewReference(emptyReference());
    setIsEditingReference(false);
    setEditingReferenceIndex(-1);
    setShowReferenceModal(true);
  }, []);

  const handleOpenEditReference = useCallback((ref: TaskReference, i: number) => {
    setNewReference({ ...emptyReference(), ...ref });
    setEditingReferenceIndex(i);
    setIsEditingReference(true);
    setShowReferenceModal(true);
  }, []);

  const handleSaveReference = useCallback(() => {
    if (!newReference.label.trim() || !newReference.value.trim()) return;
    const normalized: TaskReference = {
      ...newReference,
      id: newReference.id || (crypto.randomUUID?.() ?? `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      label: newReference.label.trim(),
      value: newReference.value.trim(),
      revision: newReference.revision?.trim() || undefined,
      branch: newReference.branch?.trim() || undefined,
      note: newReference.note?.trim() || undefined,
    };
    setReferences(prev => isEditingReference
      ? prev.map((r, i) => i === editingReferenceIndex ? normalized : r)
      : [...prev, normalized]);
    setShowReferenceModal(false);
  }, [newReference, isEditingReference, editingReferenceIndex]);

  const handleDeleteReference = useCallback(() => {
    setReferences(prev => prev.filter((_, i) => i !== editingReferenceIndex));
    setShowReferenceModal(false);
  }, [editingReferenceIndex]);

  const activePhases = PHASES.filter(p => {
    if (settings.skippedPhases.includes(p.code)) return false;
    if (task.type === 'Requirement' || task.type === 'Development') return p.target === task.type;
    return true;
  });

  // activePhaseCode が無効なフェーズ（スキップ等）を指している場合、先頭の有効フェーズにフォールバック
  const effectivePhaseCode: PhaseCode = activePhases.find(p => p.code === activePhaseCode)
    ? activePhaseCode
    : (activePhases[0]?.code ?? activePhaseCode) as PhaseCode;

  const deliverables = deliverablesByPhase[effectivePhaseCode] || [];

  const getPhaseData = (code: PhaseCode): TaskPhaseData =>
    task.phases[code] || { currentWorkStepCode: INITIAL_WORK_STEP_CODE, schedule: {} };

  const currentPhaseData = getPhaseData(effectivePhaseCode);

  const currentWorkStep = currentPhaseData.currentWorkStepCode;

  // EXC（個別除外）が選択されている場合は現在の作業工程以外を無効化
  const isExcluded = isExcludedStep(currentWorkStep);

  // 選択不可の工程コードを計算
  // ステップレベル制限を基底とし、遷移制限で上書き（緩和・強化どちらも可）
  const disabledWorkSteps = (() => {
    const userLevel = ROLE_HIERARCHY[projectRole] ?? 99;
    const disabled = new Set(
      Object.entries(WORK_STEP_ROLE_LIMIT)
        .filter(([, required]) => userLevel > required)
        .map(([code]) => code)
    );
    const transitionLimits = WORK_STEP_TRANSITION_ROLE_LIMIT[currentWorkStep] ?? {};
    for (const [code, required] of Object.entries(transitionLimits)) {
      if (userLevel > required) {
        disabled.add(code);
      } else {
        disabled.delete(code); // 遷移制限が緩和（例: GRP→END は全ロール許可）
      }
    }
    // EXC（個別除外）はプロジェクト設定の許可ロール（＋Admin）のみ選択可
    const role = projectRole;
    const excAllowed = role === 'Admin' || (settings.excludeStepSelectRoles ?? []).includes(role);
    if (!excAllowed) {
      disabled.add(EXCLUDED_WORK_STEP_CODE);
    } else {
      disabled.delete(EXCLUDED_WORK_STEP_CODE);
    }
    return [...disabled];
  })();

  // Schedule for the CURRENT selected work step
  const currentSchedule = currentPhaseData.schedule[currentWorkStep] || { workStepCode: currentWorkStep };

  // 状況詳細: 入力欄は非同期更新される task に直接バインドせず、ローカル下書きで保持する
  // （毎キーストロークで updateTask が走り IME 入力中に値が巻き戻って文字が重複するバグの対策）
  const [statusDetailDraft, setStatusDetailDraft] = useState(currentSchedule.statusDetail ?? '');
  useEffect(() => {
    setStatusDetailDraft(currentSchedule.statusDetail ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePhaseCode, currentWorkStep, task.id]);

  // 報告内容: 工程単位（作業工程が変わってもリセットしない。工程切替・タスク切替でのみ同期）
  const [reportContentDraft, setReportContentDraft] = useState(currentPhaseData.reportContent ?? '');
  useEffect(() => {
    setReportContentDraft(task.phases[effectivePhaseCode]?.reportContent ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePhaseCode, task.id]);

  const formatTimeFromHours = (hours: number | undefined): string => {
    if (!hours) return '00:00';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const parseHoursFromTime = (time: string): number => {
    if (!time) return 0;
    const [hStr, mStr] = time.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return 0;
    return h + m / 60;
  };

  const handlePhaseChange = (newPhase: PhaseCode) => {
    setActivePhaseCode(newPhase);
    setActiveMainTab('phases');
  };

  const handleWorkStepChange = (newStepCode: string) => {
    if (isExcludedStep(newStepCode)) {
      const phaseData = task.phases[effectivePhaseCode] || { currentWorkStepCode: INITIAL_WORK_STEP_CODE, schedule: {} };
      const hasScheduleData = Object.values(phaseData.schedule).some(s =>
        s.plannedStartDate || s.actualStartDate || s.plannedEndDate || s.actualEndDate ||
        (s.plannedManHours && s.plannedManHours > 0) ||
        (s.actualManHours && s.actualManHours > 0) ||
        s.statusDetail
      );
      const hasDeliverables = (deliverablesByPhase[effectivePhaseCode]?.length ?? 0) > 0;

      if (hasScheduleData || hasDeliverables) {
        const confirmed = window.confirm(
          `現在の作業工程を「${workStepByCode(EXCLUDED_WORK_STEP_CODE)?.name ?? EXCLUDED_WORK_STEP_CODE} (${EXCLUDED_WORK_STEP_CODE})」に設定します。\n` +
          'この工程に入力されているすべての項目がクリアされます。\n' +
          'よろしいですか？'
        );
        if (!confirmed) return;
      }

      // 工程のスケジュールデータと成果物をクリアして EXC に設定
      const updatedPhases = { ...task.phases };
      updatedPhases[effectivePhaseCode] = {
        currentWorkStepCode: EXCLUDED_WORK_STEP_CODE,
        schedule: { [EXCLUDED_WORK_STEP_CODE]: { workStepCode: EXCLUDED_WORK_STEP_CODE } },
      };

      const updatedDeliverables = { ...deliverablesByPhase };
      delete updatedDeliverables[effectivePhaseCode];
      setDeliverablesByPhase(updatedDeliverables);

      const relevantCodes = (task.type === 'Requirement'
        ? [REQUIREMENT_PHASE_CODE]
        : (Object.keys(updatedPhases) as PhaseCode[]).filter(c => !isRequirementPhase(c))
      ).filter(c => !settings.skippedPhases.includes(c));

      const hasNonNew = relevantCodes.some(c => !isNotStartedStep(updatedPhases[c]?.currentWorkStepCode));
      const allEnd   = relevantCodes.every(c => isTerminalStep(updatedPhases[c]?.currentWorkStepCode));

      let newStatus = task.status;
      if (allEnd) newStatus = COMPLETED_STATUS;
      else if (hasNonNew && isNotStartedStatus(task.status)) newStatus = IN_PROGRESS_STATUS;
      else if (!hasNonNew && isInProgressStatus(task.status)) newStatus = NOT_STARTED_STATUS;

      updateTask({ ...task, phases: updatedPhases, status: newStatus, deliverablesByPhase: updatedDeliverables, references });
      return;
    }

    const updatedPhases = { ...task.phases };
    const original = updatedPhases[effectivePhaseCode] || { currentWorkStepCode: INITIAL_WORK_STEP_CODE, schedule: {} };
    const phaseData = { ...original, schedule: { ...original.schedule } };

    phaseData.currentWorkStepCode = newStepCode;

    if (!phaseData.schedule[newStepCode]) {
      phaseData.schedule[newStepCode] = { workStepCode: newStepCode };
    }

    updatedPhases[effectivePhaseCode] = phaseData;

    // 要件タスクはRA、開発タスクはAD〜CT（スキップ除く）のみを対象にする
    const relevantCodes = (task.type === 'Requirement'
      ? [REQUIREMENT_PHASE_CODE]
      : (Object.keys(updatedPhases) as PhaseCode[]).filter(c => !isRequirementPhase(c))
    ).filter(c => !settings.skippedPhases.includes(c));

    const hasNonNew = relevantCodes.some(c => !isNotStartedStep(updatedPhases[c]?.currentWorkStepCode));
    const allEnd   = relevantCodes.every(c => isTerminalStep(updatedPhases[c]?.currentWorkStepCode));

    let newStatus = task.status;
    if (allEnd) newStatus = COMPLETED_STATUS;
    else if (hasNonNew && isNotStartedStatus(task.status)) newStatus = IN_PROGRESS_STATUS;
    else if (!hasNonNew && isInProgressStatus(task.status)) newStatus = NOT_STARTED_STATUS;

    updateTask({ ...task, phases: updatedPhases, status: newStatus });
  };

  const handleDateChange = (field: 'plannedStartDate' | 'plannedEndDate' | 'actualStartDate' | 'actualEndDate', value: string) => {
    const updatedPhases = { ...task.phases };
    const original = updatedPhases[effectivePhaseCode];
    const phaseData = { ...original, schedule: { ...original.schedule } };

    phaseData.schedule[currentWorkStep] = {
      ...phaseData.schedule[currentWorkStep],
      [field]: value
    };

    updatedPhases[effectivePhaseCode] = phaseData;
    updateTask({ ...task, phases: updatedPhases });
  };

  const handlePlannedHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const hours = parseHoursFromTime(value);

    const updatedPhases = { ...task.phases };
    const original = updatedPhases[effectivePhaseCode];
    const phaseData = { ...original, schedule: { ...original.schedule } };

    phaseData.schedule[currentWorkStep] = {
      ...phaseData.schedule[currentWorkStep],
      plannedManHours: hours
    };

    updatedPhases[effectivePhaseCode] = phaseData;
    updateTask({ ...task, phases: updatedPhases });
  };

  const handleStatusDetailChange = (value: string) => {
    const updatedPhases = { ...task.phases };
    const original = updatedPhases[effectivePhaseCode];
    const phaseData = { ...original, schedule: { ...original.schedule } };
    phaseData.schedule[currentWorkStep] = {
      ...phaseData.schedule[currentWorkStep],
      statusDetail: value
    };
    updatedPhases[effectivePhaseCode] = phaseData;
    updateTask({ ...task, phases: updatedPhases });
  };

  // 報告内容は工程単位（schedule の外・phaseData 直下に保存）
  const handleReportContentChange = (value: string) => {
    const updatedPhases = { ...task.phases };
    const original = updatedPhases[effectivePhaseCode] || { currentWorkStepCode: INITIAL_WORK_STEP_CODE, schedule: {} };
    updatedPhases[effectivePhaseCode] = { ...original, reportContent: value };
    updateTask({ ...task, phases: updatedPhases });
  };

  const handleTimeTrackingSave = (total: number, log: Record<string, number>, contentLog?: Record<string, string>) => {
    if (!trackingType) return;

    const updatedPhases = { ...task.phases };
    const original = updatedPhases[effectivePhaseCode];
    const phaseData = { ...original, schedule: { ...original.schedule } };

    const existingSchedule = phaseData.schedule[currentWorkStep] || { workStepCode: currentWorkStep };
    const schedule = { ...existingSchedule };

    if (trackingType === 'planned') {
      schedule.plannedManHours = total;
      schedule.plannedManHoursLog = log;
    } else if (currentUser) {
      const perMember = { ...(schedule.actualManHoursPerMember || {}) };
      const contentPerMember = { ...(schedule.actualWorkContentPerMember || {}) };
      if (Object.keys(log).length === 0) {
        delete perMember[currentUser.employeeNumber];
        delete contentPerMember[currentUser.employeeNumber];
      } else {
        perMember[currentUser.employeeNumber] = log;
        if (contentLog && Object.keys(contentLog).length > 0) {
          contentPerMember[currentUser.employeeNumber] = contentLog;
        } else {
          delete contentPerMember[currentUser.employeeNumber];
        }
      }
      schedule.actualManHoursPerMember = perMember;
      schedule.actualWorkContentPerMember = contentPerMember;
      schedule.actualManHours = Object.values(perMember).reduce(
        (sum, ml) => sum + Object.values(ml).reduce((s, h) => s + h, 0), 0
      );
      schedule.actualManHoursLog = log;
    }

    phaseData.schedule[currentWorkStep] = schedule;
    updatedPhases[effectivePhaseCode] = phaseData;
    updateTask({ ...task, phases: updatedPhases });
  };

  const currentStepInfo = WORK_STEPS.find(ws => ws.code === currentWorkStep);
  const progress = currentStepInfo?.progress || 0;

  const scheduleValues = Object.values(currentPhaseData.schedule) as WorkStepSchedule[];
  const totalPlannedHours = scheduleValues
    .reduce((sum, sched) => sum + (sched.plannedManHours || 0), 0);

  const totalActualHours = scheduleValues.reduce((sum, sched) => {
    if (sched.actualManHoursPerMember) {
      return sum + Object.values(sched.actualManHoursPerMember).reduce(
        (s, ml) => s + Object.values(ml).reduce((ms, h) => ms + h, 0), 0
      );
    }
    return sum + (sched.actualManHours || 0);
  }, 0);

  const handleOpenAddDeliverable = useCallback(() => {
    setNewDeliverable({ type: '', name: '', workflow: '', revision: '', url: '', branch: '' });
    setIsEditingDeliverable(false);
    setSvnRevisions([]);
    setSvnRevListOpen(false);
    setSvnError(null);
    setShowDeliverableModal(true);
  }, []);

  const vcsType = useMemo(() => {
    const def = settings.deliverableTypes?.find(dt => dt.name === newDeliverable.type);
    return def?.vcsType ?? 'svn';
  }, [settings.deliverableTypes, newDeliverable.type]);

  const fetchSvnRevisions = useCallback(async () => {
    if (!newDeliverable.url.trim()) return;
    setSvnLoading(true);
    setSvnError(null);
    setSvnRevisions([]);
    setSvnRevListOpen(true);
    try {
      const data = vcsType === 'git'
        ? await gitApi.getLogs(newDeliverable.url.trim(), newDeliverable.branch)
        : await svnApi.getLogs(newDeliverable.url.trim());
      setSvnRevisions(data);
    } catch (e) {
      setSvnError(e instanceof Error && e.message ? e.message : '表示に失敗しました');
    } finally {
      setSvnLoading(false);
    }
  }, [newDeliverable.url, newDeliverable.branch, vcsType]);

  const fetchBranches = useCallback(async () => {
    if (!newDeliverable.url.trim()) return;
    setBranchLoading(true);
    setBranchError(null);
    setBranchOptions([]);
    setBranchListOpen(true);
    try {
      setBranchOptions(await gitApi.listBranches(newDeliverable.url.trim()));
    } catch (e) {
      setBranchError(e instanceof Error && e.message ? e.message : 'ブランチの取得に失敗しました');
    } finally {
      setBranchLoading(false);
    }
  }, [newDeliverable.url]);

  const handleOpenEditDeliverable = useCallback((d: Deliverable, i: number) => {
    setNewDeliverable(d);
    setEditingDeliverableIndex(i);
    setIsEditingDeliverable(true);
    setShowDeliverableModal(true);
  }, []);

  const handleSaveAndClose = useCallback(() => {
    updateTask({ ...task, deliverablesByPhase, references });
    onClose();
  }, [task, deliverablesByPhase, references, updateTask, onClose]);

  const hoursDiffBadge = useMemo(() => {
    if (totalActualHours <= 0 || totalPlannedHours <= 0) return null;
    const diff = totalActualHours - totalPlannedHours;
    if (diff === 0) return null;
    const sign = diff > 0 ? '+' : '-';
    const color = diff > 0 ? 'text-red-500' : 'text-blue-500';
    return (
      <span className={`text-[10px] font-semibold ${color}`}>
        ({sign}{formatTimeFromHours(Math.abs(diff))})
      </span>
    );
  }, [totalActualHours, totalPlannedHours]);

  const currentUserActualLog = currentUser
    ? (currentSchedule.actualManHoursPerMember?.[currentUser.employeeNumber] || {})
    : {};
  const currentUserActualContent = currentUser
    ? (currentSchedule.actualWorkContentPerMember?.[currentUser.employeeNumber] || {})
    : {};

  const otherMemberLogs = currentUser
    ? Object.entries(currentSchedule.actualManHoursPerMember || {})
        .filter(([empNo]) => empNo !== currentUser.employeeNumber)
        .map(([empNo, log]) => ({
          name: settings.members.find(m => m.employeeNumber === empNo)?.name || empNo,
          log,
          contentLog: currentSchedule.actualWorkContentPerMember?.[empNo],
        }))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-xl shadow-2xl w-full md:w-fit md:max-w-[95vw] h-[95dvh] md:max-h-[90vh] md:h-auto flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-gray-300 flex justify-between items-start bg-gray-50">
          <div>
            {/* 1行目: ドメイン / 種別 / ReflectタスクID */}
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded font-medium">
                {settings.domains.find(d => d.id === task.domainId)?.name}
              </span>
              <span className="text-gray-500 text-xs uppercase tracking-wide font-semibold">
                {task.type === 'Development' ? '開発タスク' : '要件タスク'}
              </span>
              <span className="text-gray-500 text-xs font-mono font-semibold">{task.taskId}</span>
            </div>

            {/* 2行目: チケットID / タスク名 */}
            <div className="flex items-center gap-3 flex-wrap">
              {isEditingTicket ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      autoFocus
                      value={ticketUrlDraft}
                      onChange={e => { setTicketUrlDraft(e.target.value); setTicketError(''); }}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveTicket(); if (e.key === 'Escape') setIsEditingTicket(false); }}
                      placeholder="https://tracker.example.com/browse/PROJ-123"
                      className={`w-72 max-w-full border rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white ${ticketError ? 'border-red-400' : 'border-indigo-400'}`}
                    />
                    <button onClick={handleSaveTicket} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap">保存</button>
                    <button onClick={() => setIsEditingTicket(false)} className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap">取消</button>
                  </div>
                  {ticketError && <p className="text-xs text-red-500">{ticketError}</p>}
                </div>
              ) : (task.ticketKey || task.ticketUrl) ? (
                <span className="inline-flex items-center gap-1 text-xl font-bold">
                  {task.ticketUrl ? (
                    <a
                      href={task.ticketUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-blue-600 hover:underline"
                    >
                      {task.ticketKey ?? task.ticketUrl}<ExternalLink size={16} />
                    </a>
                  ) : (
                    <span className="font-mono text-gray-600">{task.ticketKey}</span>
                  )}
                  <button
                    onClick={() => { setTicketUrlDraft(task.ticketUrl ?? ''); setTicketError(''); setIsEditingTicket(true); }}
                    className="text-gray-400 hover:text-indigo-600"
                    title="チケットURLを編集"
                  >
                    <Pencil size={14} />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => { setTicketUrlDraft(''); setTicketError(''); setIsEditingTicket(true); }}
                  className="font-mono text-xl font-bold text-gray-400 hover:text-indigo-600 tracking-widest"
                  title="クリックしてチケットURLを紐づける"
                >
                  ★★★
                </button>
              )}
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
                        options={settings.tags ?? []}
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
            {/* 3行目: 担当者アイコン / 担当者名 / ステータス */}
            <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
              <span className="bg-gray-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">
                {assigneeName.charAt(0)}
              </span>
              {isEditingAssignee ? (
                <select
                  autoFocus
                  value={task.assignee}
                  onChange={(e) => {
                    updateTask({ ...task, assignee: e.target.value });
                    setIsEditingAssignee(false);
                  }}
                  onBlur={() => setIsEditingAssignee(false)}
                  className="border border-indigo-400 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {settings.members
                    .filter((m) => m.employeeNumber !== "admin")
                    .map((m) => (
                      <option key={m.id} value={m.employeeNumber}>{m.name}</option>
                    ))}
                </select>
              ) : (
                <button
                  onClick={() => setIsEditingAssignee(true)}
                  className="hover:text-indigo-600 hover:underline cursor-pointer"
                >
                  {assigneeName}
                </button>
              )}
              {/* 優先度（ステータスの左） */}
              {isEditingPriority ? (
                <div className="relative">
                  <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded shadow-lg min-w-[90px]">
                    {[{ value: '' as const, label: '未設定' }, ...PRIORITY_OPTIONS].map((opt) => (
                      <div
                        key={opt.value || 'none'}
                        onClick={() => {
                          updateTask({ ...task, priority: (opt.value || null) as TaskPriority | null });
                          setIsEditingPriority(false);
                        }}
                        className={`flex items-center px-3 py-1.5 text-xs cursor-pointer ${
                          (task.priority ?? '') === opt.value
                            ? 'bg-gray-100 text-gray-900 font-semibold'
                            : 'hover:bg-gray-50 text-gray-700'
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
                    {settings.taskStatuses.map((s) => {
                      const relevantCodes = task.type === 'Requirement'
                        ? [REQUIREMENT_PHASE_CODE]
                        : activePhases.map(p => p.code);
                      const allDone = relevantCodes.every(c => isTerminalStep(task.phases[c]?.currentWorkStepCode));
                      const allNonNew = relevantCodes.every(c => !isNotStartedStep(task.phases[c]?.currentWorkStepCode));
                      const roleRestricted = isRestrictedStatus(s) && (ROLE_HIERARCHY[projectRole] ?? 99) > ROLE_HIERARCHY['SL'];
                      const completionRestricted = isCompletedStatus(s) && !allDone;
                      const newRestricted = isNotStartedStatus(s) && allNonNew;
                      const canSelect = !roleRestricted && !completionRestricted && !newRestricted;
                      const color = statusBadge(s);
                      return (
                        <div
                          key={s}
                          onClick={() => {
                            if (!canSelect) return;
                            updateTask({ ...task, status: s as TaskStatus });
                            setIsEditingStatus(false);
                          }}
                          className={`flex items-center justify-between px-3 py-1.5 text-xs gap-3 ${
                            !canSelect
                              ? 'cursor-not-allowed text-gray-300 bg-gray-50'
                              : s === task.status
                              ? `cursor-pointer ${color.bg} ${color.text}`
                              : 'cursor-pointer hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <span>{s}</span>
                          {!canSelect && <Lock size={11} className="text-gray-300" />}
                        </div>
                      );
                    })}
                    {/* 削除 (固定項目・権限ロールのみ表示) */}
                    {(projectRole === 'Admin' || (settings.taskDeleteRoles ?? []).includes(projectRole)) && (
                      <>
                        <div className="border-t border-gray-200 my-0.5" />
                        <div
                          onClick={() => {
                            setIsEditingStatus(false);
                            const confirmed = window.confirm(
                              `タスク「${task.name}」を削除しますか？\nこの操作は取り消せません。`
                            );
                            if (confirmed) {
                              deleteTask(task.id);
                              onClose();
                            }
                          }}
                          className="flex items-center px-3 py-1.5 text-xs gap-3 cursor-pointer text-red-600 hover:bg-red-50"
                        >
                          削除
                        </div>
                      </>
                    )}
                  </div>
                  {/* 外側クリックで閉じる */}
                  <div className="fixed inset-0 z-40" onClick={() => setIsEditingStatus(false)} />
                </div>
              ) : (
                <button
                  onClick={() => setIsEditingStatus(true)}
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 transition-opacity hover:opacity-75 ${taskStatusBadge.bg} ${taskStatusBadge.text} ${taskStatusBadge.ring}`}
                >
                  {task.status}
                  <ChevronDown size={11} />
                </button>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-200 rounded">
            <X size={24} />
          </button>
        </div>

        {/* Phase Tabs + Comments Tab */}
        <div className="shrink-0 flex border-b border-gray-300 overflow-x-auto">
          {activePhases.length > 0 ? (
            activePhases.map((phase) => {
              const stepCode = task.phases[phase.code]?.currentWorkStepCode;
              const isInProgress = !!stepCode && !isTerminalStep(stepCode);
              const tabProgress = WORK_STEPS.find(ws => ws.code === stepCode)?.progress ?? 0;
              const tooltipWorkStep = WORK_STEPS.find(ws => ws.code === stepCode);
              return (
              <Tooltip key={phase.code} delayDuration={600}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handlePhaseChange(phase.code)}
                    className={`px-7 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                      effectivePhaseCode === phase.code && activeMainTab === 'phases'
                        ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
                        : isInProgress
                        ? 'border-transparent text-blue-500 hover:text-blue-600 hover:bg-gray-50'
                        : 'border-transparent text-gray-400 hover:text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-lg font-bold leading-none">{phase.code}</span>
                      <div className="w-10 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all duration-300"
                          style={{ width: `${tabProgress}%` }}
                        />
                      </div>
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-center">
                  <div className="font-semibold">{phase.name}</div>
                  <div className="text-xs opacity-80 mt-0.5">{stepCode ?? INITIAL_WORK_STEP_CODE}：{tooltipWorkStep?.name ?? ''}</div>
                </TooltipContent>
              </Tooltip>
              );
            })
          ) : (
             <div className="px-5 py-3 text-sm text-gray-400">表示可能な工程がありません</div>
          )}
          {/* コメントタブ */}
          <button
            onClick={() => setActiveMainTab(t => t === 'comments' ? 'phases' : 'comments')}
            className={`ml-auto px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
              activeMainTab === 'comments'
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50'
                : 'border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'
            }`}
          >
            <MessageSquare size={14} />
            コメント
            {commentCount > 0 && (
              <span className="text-xs bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 leading-none">
                {commentCount}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-5 overflow-hidden flex-1 min-h-0 bg-white flex flex-col">
          {/* コメントパネル */}
          {activeMainTab === 'comments' && (
            <CommentPanel taskId={task.id} projectId={task.projectId} onCountChange={setCommentCount} />
          )}
          {activeMainTab === 'phases' && <div className="flex gap-2 flex-1 min-h-0">

            {/* Left: Task Detail */}
            <div className="w-[440px] shrink-0">
              <div className="grid grid-cols-3 gap-x-4 gap-y-0">

                {/* Status Control Column */}
                <div className="col-span-1 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      現在の作業工程
                    </label>
                    <WorkStepSelect
                      value={currentWorkStep}
                      onChange={handleWorkStepChange}
                      disabledCodes={disabledWorkSteps}
                    />
                  </div>

                  <div className={isExcluded ? 'opacity-40 pointer-events-none' : ''}>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      進捗率
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-300">
                        <div
                          className="h-full bg-green-500 transition-all duration-500 ease-out"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-gray-900">{progress}%</span>
                    </div>
                  </div>

                  {/* Planned Hours */}
                  <div className={isExcluded ? 'opacity-40 pointer-events-none' : ''}>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      予定工数(合計)
                    </label>
                    <div className="px-2 py-1.5 border border-gray-300 rounded-md bg-white text-xs font-semibold text-gray-900">
                      {totalPlannedHours > 0 ? formatTimeFromHours(totalPlannedHours) : '--:--'}
                    </div>
                  </div>

                  {/* Total Actual Hours */}
                  <div className={isExcluded ? 'opacity-40 pointer-events-none' : ''}>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      実績工数(合計)
                    </label>
                    <div className="flex items-center justify-between px-2 py-1.5 border border-gray-300 rounded-md bg-white text-xs font-semibold text-gray-900">
                      <span>{totalActualHours > 0 ? formatTimeFromHours(totalActualHours) : '--:--'}</span>
                      {hoursDiffBadge}
                    </div>
                  </div>
                </div>

                {/* Schedule & Details Column */}
                <div className={`col-span-2 flex flex-col gap-4${isExcluded ? ' opacity-40 pointer-events-none' : ''}`}>

                  <div className="rounded-lg px-3 py-4 border border-gray-300 flex-1 flex flex-col">
                    <h3 className="text-xs font-bold text-gray-800 mb-3 flex items-center gap-1.5">
                      <Calendar size={14} />
                      {isNotStartedStep(currentWorkStep) ? '予定・状況詳細' : `日程・工数・状況詳細 (${currentWorkStep})`}
                    </h3>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">開始予定日</label>
                        <DatePickerWithHolidays
                          value={currentSchedule.plannedStartDate || ''}
                          onChange={(v) => handleDateChange('plannedStartDate', v)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">完了予定日</label>
                        <DatePickerWithHolidays
                          value={currentSchedule.plannedEndDate || ''}
                          onChange={(v) => handleDateChange('plannedEndDate', v)}
                        />
                      </div>
                      {!isNotStartedStep(currentWorkStep) && (
                      <>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">開始日 (実績)</label>
                        <DatePickerWithHolidays
                          value={currentSchedule.actualStartDate || ''}
                          onChange={(v) => handleDateChange('actualStartDate', v)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">完了日 (実績)</label>
                        <DatePickerWithHolidays
                          value={currentSchedule.actualEndDate || ''}
                          onChange={(v) => handleDateChange('actualEndDate', v)}
                        />
                      </div>
                      </>
                      )}

                      <div className="col-span-2 border-t border-dashed border-gray-300 my-1"></div>

                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                          予定工数 (hh:mm)
                          <span className="ml-1 font-normal text-gray-400 text-[9px]">(任意)</span>
                        </label>
                        <div className="relative group">
                          <input
                            type="time"
                            value={formatTimeFromHours(currentSchedule.plannedManHours)}
                            onChange={handlePlannedHoursChange}
                            className="w-full h-7 px-2 py-1.5 border border-gray-300 rounded-md text-xs font-sans focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                          />
                        </div>
                      </div>
                      {!isNotStartedStep(currentWorkStep) && (
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">
                          実績工数 (hh:mm)
                          <span className="ml-1 text-red-500 font-bold">*</span>
                        </label>
                        <div
                          onClick={() => setTrackingType('actual')}
                          className="relative cursor-pointer group"
                        >
                          <input
                            type="text"
                            readOnly
                            value={formatTimeFromHours(currentSchedule.actualManHours)}
                            placeholder="クリックして入力"
                            className="w-full h-7 px-2 py-1.5 border border-gray-300 rounded-md text-xs font-sans focus:outline-none bg-white group-hover:border-indigo-400 group-hover:bg-indigo-50/20 transition-colors cursor-pointer"
                          />
                          <Clock size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-indigo-500" />
                        </div>
                      </div>
                      )}
                    </div>

                    {/* 状況詳細（作業工程ごと） */}
                    <div className="border-t border-dashed border-gray-300 mt-3 pt-3 flex-1 flex flex-col">
                      <label className="block text-[10px] font-semibold text-gray-500 mb-0.5">状況詳細</label>
                      <textarea
                        value={statusDetailDraft}
                        onChange={(e) => setStatusDetailDraft(e.target.value)}
                        onBlur={() => { if (statusDetailDraft !== (currentSchedule.statusDetail ?? '')) handleStatusDetailChange(statusDetailDraft); }}
                        className="w-full flex-1 min-h-[3rem] px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                        placeholder="特記事項や遅延理由などを入力..."
                      />
                    </div>
                  </div>

                  {/* 報告内容（工程単位・週報向け） */}
                  <div className="rounded-lg px-3 py-4 border border-gray-300 flex flex-col">
                    <h3 className="text-xs font-bold text-gray-800 mb-2 flex items-center gap-1.5">
                      <FileText size={14} />
                      報告内容
                    </h3>
                    <textarea
                      value={reportContentDraft}
                      onChange={(e) => setReportContentDraft(e.target.value)}
                      onBlur={() => { if (reportContentDraft !== (task.phases[effectivePhaseCode]?.reportContent ?? '')) handleReportContentChange(reportContentDraft); }}
                      className="w-full min-h-[4rem] px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-y"
                      placeholder="週報に記載する報告内容を入力..."
                    />
                  </div>

                </div>
              </div>
            </div>

            {/* Right: Deliverables & References Table */}
            <div className={`w-[600px] shrink-0 rounded-lg px-3 py-4 border border-gray-300 flex flex-col min-h-0${isExcluded ? ' opacity-40 pointer-events-none' : ''}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-gray-800">タスク成果物・参照</h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleOpenAddDeliverable}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                  >
                    <Plus size={14} />
                    成果物
                  </button>
                  <button
                    onClick={handleOpenAddReference}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50 rounded transition-colors"
                  >
                    <Plus size={14} />
                    参照
                  </button>
                </div>
              </div>
              <div className="border border-gray-300 rounded-lg overflow-y-auto flex-1 min-h-0">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-50 border-b border-gray-300">
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 w-20">区分</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">名前</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 w-24">種別</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 w-[5rem]">ワークフロー</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 w-[5rem]">リビジョン</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-600 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {deliverables.length === 0 && references.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">成果物・参照がありません</td></tr>
                    )}
                    {deliverables.map((d, i) => (
                    <tr
                      key={`del-${d.type}-${d.name}-${i}`}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => handleOpenEditDeliverable(d, i)}
                    >
                      <td className="px-3 py-2 whitespace-nowrap"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700">成果物</span></td>
                      <td className="px-3 py-2 text-gray-900">{d.name}</td>
                      <td className="px-3 py-2 text-gray-700">{d.type}</td>
                      <td className="px-3 py-2 text-gray-700">{d.workflow}</td>
                      <td className="px-3 py-2 text-gray-500">{d.revision}</td>
                      <td className="px-3 py-2"></td>
                    </tr>
                    ))}
                    {references.map((ref, i) => {
                      const meta = REFERENCE_KIND_META[ref.kind];
                      const openable = isReferenceOpenable(ref);
                      return (
                      <tr
                        key={`ref-${ref.id || i}`}
                        className="hover:bg-purple-50/40 cursor-pointer"
                        onClick={() => handleOpenEditReference(ref, i)}
                      >
                        <td className="px-3 py-2 whitespace-nowrap"><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">参照</span></td>
                        <td className="px-3 py-2 text-gray-900">
                          <span className="block truncate max-w-[180px]" title={ref.value}>{ref.label}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.badge}`}>
                            <meta.Icon size={11} />{meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-300">—</td>
                        <td className="px-3 py-2 text-gray-500">
                          {ref.revision ? <span className="font-mono">{ref.revision}</span> : null}
                          {ref.branch ? <span className="text-gray-400"> @{ref.branch}</span> : null}
                          {!ref.revision && !ref.branch ? '—' : null}
                        </td>
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-0.5">
                            {openable && (
                              <a
                                href={buildReferenceOpenUrl(ref)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="ブラウザで開く"
                                className="p-1 rounded text-gray-500 hover:text-indigo-600 hover:bg-indigo-50"
                              >
                                <ExternalLink size={13} />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>}
        </div>

        <div className="px-6 py-4 border-t border-gray-300 bg-gray-50 flex justify-end">
          <button
            onClick={handleSaveAndClose}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Save size={18} />
            閉じる
          </button>
        </div>
      </div>

      {/* Time Tracking Modal */}
      <TimeTrackingModal
        isOpen={trackingType !== null}
        onClose={() => setTrackingType(null)}
        onSave={handleTimeTrackingSave}
        title={trackingType === 'planned' ? '予定工数入力' : '実績工数入力'}
        initialLog={trackingType === 'planned' ? currentSchedule.plannedManHoursLog : currentUserActualLog}
        currentUserName={trackingType === 'actual' ? (currentUser?.name ?? '') : undefined}
        otherMemberLogs={trackingType === 'actual' ? otherMemberLogs : undefined}
        withContent={trackingType === 'actual'}
        initialContentLog={trackingType === 'actual' ? currentUserActualContent : undefined}
      />

      {/* Deliverable Add Modal */}
      {showDeliverableModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-base font-bold text-gray-900">成果物を追加</h3>
              <button onClick={() => setShowDeliverableModal(false)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">種別<span className="ml-1 text-red-500">*</span></label>
                <select
                  value={newDeliverable.type}
                  onChange={(e) => setNewDeliverable({ ...newDeliverable, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  required
                >
                  <option value="" disabled>選択してください</option>
                  {(settings.deliverableTypes || [])
                    .filter((t: { phaseCode: string }) => t.phaseCode === effectivePhaseCode)
                    .map((t: { id: string; name: string; required: boolean }) => (
                      <option key={t.id} value={t.name}>
                        {t.required ? `[必須] ${t.name}` : t.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">名前<span className="ml-1 text-red-500">*</span></label>
                <input
                  type="text"
                  value={newDeliverable.name}
                  onChange={(e) => setNewDeliverable({ ...newDeliverable, name: e.target.value })}
                  placeholder="成果物の名前を入力"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">ワークフロー</label>
                <select
                  value={newDeliverable.workflow}
                  onChange={(e) => setNewDeliverable({ ...newDeliverable, workflow: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="" disabled>選択してください</option>
                  {(() => {
                    const allWorkflows: string[] = settings.workflows || [];
                    const selectedType = (settings.deliverableTypes || []).find(
                      (t: { name: string }) => t.name === newDeliverable.type
                    );
                    const workflowSettings = selectedType?.workflowSettings || [];
                    const userRole = projectRole;
                    const currentMasterIndex = newDeliverable.workflow
                      ? allWorkflows.indexOf(newDeliverable.workflow)
                      : -1;
                    return allWorkflows.filter((w: string) => {
                      const wfSetting = workflowSettings.find(
                        (ws: { workflowName: string; allowedRoles: string[] }) => ws.workflowName === w
                      );
                      if (!wfSetting) return false;
                      if (userRole && !wfSetting.allowedRoles.includes(userRole)) return false;
                      const wIndex = allWorkflows.indexOf(w);
                      // 新規追加時は先頭のみ、編集時は現在位置以前＋次の1つまで
                      return currentMasterIndex === -1 ? wIndex === 0 : wIndex <= currentMasterIndex + 1;
                    }).map((w: string) => (
                      <option key={w} value={w}>{w}</option>
                    ));
                  })()}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  URL
                  <span className="ml-1.5 font-normal text-gray-400 text-[10px]">
                    ({vcsType === 'git' ? 'Git' : 'SVN'})
                  </span>
                </label>
                <textarea
                  rows={3}
                  value={newDeliverable.url}
                  onChange={(e) => setNewDeliverable({ ...newDeliverable, url: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              {vcsType === 'git' && (
                <div className="relative" ref={branchListRef}>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    ブランチ名
                    <span className="ml-1.5 font-normal text-gray-400 text-[10px]">(省略時はデフォルトブランチ)</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newDeliverable.branch ?? ''}
                      onChange={(e) => setNewDeliverable({ ...newDeliverable, branch: e.target.value })}
                      placeholder="例: main, develop"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={fetchBranches}
                      disabled={!newDeliverable.url.trim() || branchLoading}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
                    >
                      <List size={13} />
                      {branchLoading ? '取得中...' : 'ブランチ候補'}
                    </button>
                  </div>

                  {branchListOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
                      {branchError ? (
                        <div className="px-3 py-2 text-xs text-red-600">{branchError}</div>
                      ) : branchOptions.length === 0 && !branchLoading ? (
                        <div className="px-3 py-2 text-xs text-gray-400">ブランチが見つかりませんでした</div>
                      ) : (
                        branchOptions.map((b) => (
                          <button
                            key={b}
                            type="button"
                            onClick={() => { setNewDeliverable({ ...newDeliverable, branch: b }); setBranchListOpen(false); }}
                            className="w-full text-left px-3 py-2 text-xs font-mono text-gray-700 hover:bg-indigo-50 border-b border-gray-100 last:border-b-0"
                          >
                            {b}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="relative" ref={svnRevListRef}>
                <label className="block text-xs font-semibold text-gray-700 mb-1">リビジョン</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDeliverable.revision}
                    onChange={(e) => setNewDeliverable({ ...newDeliverable, revision: e.target.value })}
                    placeholder="例: v1.0"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={fetchSvnRevisions}
                    disabled={!newDeliverable.url.trim() || svnLoading}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
                  >
                    <List size={13} />
                    {svnLoading ? '取得中...' : vcsType === 'git' ? 'コミットリスト' : 'リビジョンリスト'}
                  </button>
                </div>

                {svnRevListOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
                    {svnError ? (
                      <div className="px-3 py-2 text-xs text-red-600">{svnError}</div>
                    ) : svnRevisions.length === 0 && !svnLoading ? (
                      <div className="px-3 py-2 text-xs text-gray-500">リビジョンが見つかりません</div>
                    ) : (
                      svnRevisions.map((r) => (
                        <button
                          key={r.revision}
                          type="button"
                          onClick={() => {
                            setNewDeliverable((prev: Deliverable) => ({ ...prev, revision: r.revision }));
                            setSvnRevListOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 border-b border-gray-100 last:border-0"
                        >
                          <span className="font-mono font-semibold text-indigo-700 mr-2">r{r.revision}</span>
                          <span className="text-gray-500 mr-2">{r.author}</span>
                          <span className="text-gray-400 mr-2">{r.date}</span>
                          <span className="text-gray-700 line-clamp-1">{r.message || '（コメントなし）'}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between mt-6">
              {isEditingDeliverable ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                >
                  削除
                </button>
              ) : <div />}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeliverableModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    if (!newDeliverable.type || !newDeliverable.name) return;
                    setDeliverablesByPhase(prev => {
                      const current = prev[effectivePhaseCode] || [];
                      if (isEditingDeliverable) {
                        return { ...prev, [effectivePhaseCode]: current.map((d, i) => i === editingDeliverableIndex ? newDeliverable : d) };
                      } else {
                        return { ...prev, [effectivePhaseCode]: [...current, newDeliverable] };
                      }
                    });
                    setShowDeliverableModal(false);
                  }}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                    newDeliverable.type && newDeliverable.name
                      ? 'bg-indigo-600 hover:bg-indigo-700'
                      : 'bg-indigo-300 cursor-not-allowed'
                  }`}
                >
                  {isEditingDeliverable ? '保存' : '追加'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-base font-bold text-gray-900 mb-2">成果物の削除</h3>
            <p className="text-sm text-gray-600 mb-6">「{newDeliverable.name}」を削除しますか？この操作は取り消せません。</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  setDeliverablesByPhase(prev => ({
                    ...prev,
                    [effectivePhaseCode]: (prev[effectivePhaseCode] || []).filter((_, i) => i !== editingDeliverableIndex),
                  }));
                  setShowDeleteConfirm(false);
                  setShowDeliverableModal(false);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reference Add / Edit Modal */}
      {showReferenceModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-base font-bold text-gray-900">{isEditingReference ? '参照を編集' : '参照を追加'}</h3>
              <button onClick={() => setShowReferenceModal(false)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">表示名<span className="ml-1 text-red-500">*</span></label>
                <input
                  type="text"
                  value={newReference.label}
                  onChange={(e) => setNewReference({ ...newReference, label: e.target.value })}
                  placeholder="例: 設計方針Wiki"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">種別<span className="ml-1 text-red-500">*</span></label>
                <select
                  value={newReference.kind}
                  onChange={(e) => setNewReference({ ...newReference, kind: e.target.value as TaskReferenceKind })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {REFERENCE_KINDS.map(k => (
                    <option key={k} value={k}>{REFERENCE_KIND_META[k].label}</option>
                  ))}
                </select>
                {newReference.kind === 'file' && (
                  <p className="text-[11px] text-gray-400 mt-1">ファイルはブラウザで開けないため、コピーして利用します。</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">URL / ファイルパス<span className="ml-1 text-red-500">*</span></label>
                <textarea
                  rows={2}
                  value={newReference.value}
                  onChange={(e) => setNewReference({ ...newReference, value: e.target.value })}
                  onBlur={(e) => {
                    // 追加時のみ、種別が既定(web)のままなら入力値から自動判定
                    if (!isEditingReference && newReference.kind === 'web' && e.target.value.trim()) {
                      setNewReference(prev => ({ ...prev, kind: detectReferenceKind(e.target.value) }));
                    }
                  }}
                  placeholder={'例: https://example.com/wiki\n\\\\server\\share\\design.xlsx'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
                />
                {newReference.kind === 'svn' && newReference.revision?.trim() && isHttpUrl(newReference.value) && (
                  <p className="text-[11px] text-gray-400 mt-1">開く際: <span className="font-mono">{buildReferenceOpenUrl(newReference)}</span></p>
                )}
              </div>

              {(newReference.kind === 'svn' || newReference.kind === 'git') && (
                <div className="grid grid-cols-2 gap-3">
                  {newReference.kind === 'git' && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">ブランチ<span className="ml-1 font-normal text-gray-400 text-[10px]">(任意)</span></label>
                      <input
                        type="text"
                        value={newReference.branch ?? ''}
                        onChange={(e) => setNewReference({ ...newReference, branch: e.target.value })}
                        placeholder="例: main"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">リビジョン<span className="ml-1 font-normal text-gray-400 text-[10px]">(任意)</span></label>
                    <input
                      type="text"
                      value={newReference.revision ?? ''}
                      onChange={(e) => setNewReference({ ...newReference, revision: e.target.value })}
                      placeholder={newReference.kind === 'svn' ? '例: 1234' : '例: a1b2c3d'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">備考<span className="ml-1 font-normal text-gray-400 text-[10px]">(任意)</span></label>
                <input
                  type="text"
                  value={newReference.note ?? ''}
                  onChange={(e) => setNewReference({ ...newReference, note: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-between mt-6">
              {isEditingReference ? (
                <button
                  onClick={handleDeleteReference}
                  className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                >
                  削除
                </button>
              ) : <div />}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowReferenceModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveReference}
                  disabled={!newReference.label.trim() || !newReference.value.trim()}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                    newReference.label.trim() && newReference.value.trim() ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-gray-300 cursor-not-allowed'
                  }`}
                >
                  {isEditingReference ? '更新' : '追加'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
