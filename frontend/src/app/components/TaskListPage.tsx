import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useProject } from '@/context/ProjectContext';
import { WORK_STEPS, WorkStepMaster, isTerminalStep, workStepByCode, INITIAL_WORK_STEP, INITIAL_WORK_STEP_CODE, PHASES, PhaseCode, PRIORITY_OPTIONS, PRIORITY_LABEL, PRIORITY_BADGE, PRIORITY_ORDER, REQUIREMENT_PHASE_CODE, isRequirementPhase, statusBadgeClass, NOT_STARTED_STATUS } from '@/lib/constants';
import { Task, TaskType, TaskStatus, TaskPriority, WorkStepSchedule, Deliverable, TaskPhaseData } from '@/types';
import { AlertCircle, Clock, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, X, Plus, Upload, Download, CheckCircle, AlertCircle as AlertCircleIcon, FileDown, ChevronDown } from 'lucide-react';
import { TaskDetailModal } from './TaskDetailModal';
import { tagBadge } from './shared/tags';
import { commentsApi } from '@/lib/api';
import { mentionsToPlainText } from '@/lib/mentions';
import { extractTicketKey, displayTaskId, findTicketKeyConflict } from '@/lib/ticket';

type SortKey = 'taskId' | 'project' | 'domain' | 'name' | 'assignee' | 'phase' | 'priority' | 'status' | 'workStep' | 'progress' | 'alert';
type SortDirection = 'asc' | 'desc';

/** CSV取り込み時の優先度ラベル→コード変換（高/中/低 と HIGH/MEDIUM/LOW を許容） */
const LABEL_TO_PRIORITY: Record<string, TaskPriority> = {
  '高': 'HIGH', '中': 'MEDIUM', '低': 'LOW', 'HIGH': 'HIGH', 'MEDIUM': 'MEDIUM', 'LOW': 'LOW',
};

interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

interface AddTaskForm {
  name: string;
  domainId: string;
  assignee: string;
  ticketUrl: string;
}

type CsvFormat = 'simple' | 'schedule' | 'deliverables';

interface CsvRow {
  rowIndex: number;
  name: string;
  domainName: string;
  assigneeName: string;
  domainId: string | null;
  errors: string[];
}

interface ScheduleImportTask {
  taskId: string;
  name: string;
  type: TaskType;
  domainId: string | null;
  domainName: string;
  assignee: string;
  status: string;
  priority: '' | TaskPriority;
  phases: Partial<Record<PhaseCode, TaskPhaseData>>;
  existingTask: Task | null;
  errors: string[];
}

interface DeliverableImportTask {
  taskId: string;
  name: string;
  deliverablesByPhase: Record<string, Deliverable[]>;
  existingTask: Task | null;
  errors: string[];
}

interface ManHoursImportRow {
  rowIndex: number;
  kind: 'planned' | 'actual'; // 種別: 予定 / 実績
  taskId: string;
  phaseCode: string;
  wsCode: string;
  plannedManHours?: number;
  empNo?: string;
  memberName?: string;
  date?: string;          // 実績工数: 日付 YYYY-MM-DD
  actualManHours?: number;
  workContent?: string;   // 実績工数: 作業内容
  existingTask: Task | null;
  errors: string[];
}

const LINE_SPLIT_RE = /\r?\n/;

/** クォートを含むCSV行を正しく分割する */
const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
};

/** "hh:mm" 文字列を小数時間に変換 */
const parseHours = (s: string): number | undefined => {
  if (!s.trim()) return undefined;
  const [h, m] = s.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return undefined;
  return h + m / 60;
};

const EMPTY_PHASE_DATA = () => ({ currentWorkStepCode: INITIAL_WORK_STEP_CODE, schedule: {} });

const TaskListSortIconBase: React.FC<{
  columnKey: SortKey; sortKey: SortKey; direction: SortDirection; accentClass: string;
}> = ({ columnKey, sortKey, direction, accentClass }) => {
  if (sortKey !== columnKey) return <ArrowUpDown size={14} className="text-gray-400 opacity-0 group-hover:opacity-50 ml-1 inline-block" />;
  return direction === 'asc'
    ? <ArrowUp size={14} className={`${accentClass} ml-1 inline-block`} />
    : <ArrowDown size={14} className={`${accentClass} ml-1 inline-block`} />;
};

const ErrIcon = ({ errors }: { errors: string[] }) => (
  <div className="group relative">
    <AlertCircleIcon size={14} className="text-red-500 cursor-pointer" />
    <div className="absolute right-0 bottom-5 z-10 hidden group-hover:block bg-gray-900 text-white text-[11px] rounded px-2 py-1 shadow-lg" style={{ whiteSpace: 'nowrap' }}>
      {errors.join(' / ')}
    </div>
  </div>
);

const buildInitialPhases = (): Record<Exclude<PhaseCode, 'EX'>, ReturnType<typeof EMPTY_PHASE_DATA>> => ({
  RA: EMPTY_PHASE_DATA(),
  AD: EMPTY_PHASE_DATA(),
  DD: EMPTY_PHASE_DATA(),
  UC: EMPTY_PHASE_DATA(),
  UTD: EMPTY_PHASE_DATA(),
  UT: EMPTY_PHASE_DATA(),
  CTD: EMPTY_PHASE_DATA(),
  CT: EMPTY_PHASE_DATA(),
});

interface TaskListPageProps {
  type: TaskType;
  initialOpenTaskId?: string | null;
  initialOpenComments?: boolean;
  onInitialOpenHandled?: () => void;
}

export const TaskListPage: React.FC<TaskListPageProps> = ({ type, initialOpenTaskId, initialOpenComments, onInitialOpenHandled }) => {
  const { tasks, settings, projects, getSettings, addTask, updateTask, currentUser, members, skippedPhasesOf } = useProject();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState(false);
  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const toggleCheck = useCallback((id: string) => {
    setCheckedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const toggleAll = useCallback((ids: string[]) => {
    setCheckedIds(prev => prev.size === ids.length ? new Set() : new Set(ids));
  }, []);
  const applyBulkStatus = useCallback(() => {
    if (!bulkStatus) return;
    tasks.filter(t => checkedIds.has(t.id)).forEach(t => updateTask({ ...t, status: bulkStatus as TaskStatus }));
    setBulkStatus(''); setCheckedIds(new Set());
  }, [bulkStatus, checkedIds, tasks, updateTask]);
  const applyBulkAssignee = useCallback(() => {
    if (!bulkAssignee) return;
    tasks.filter(t => checkedIds.has(t.id)).forEach(t => updateTask({ ...t, assignee: bulkAssignee }));
    setBulkAssignee(''); setCheckedIds(new Set());
  }, [bulkAssignee, checkedIds, tasks, updateTask]);

  // ダッシュボードの「一覧へ」から特定タスクを自動オープン
  React.useEffect(() => {
    if (initialOpenTaskId) {
      setSelectedTaskId(initialOpenTaskId);
      setOpenComments(!!initialOpenComments);
      onInitialOpenHandled?.();
    }
  }, [initialOpenTaskId]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddTaskForm>({ name: '', domainId: '', assignee: '', ticketUrl: '' });
  const [addErrors, setAddErrors] = useState<Partial<AddTaskForm>>({});
  const [addProjectId, setAddProjectId] = useState<number>(projects[0]?.id ?? 0);
  // 追加モーダルで選択中プロジェクトの設定（ドメイン・担当者候補の絞り込み用）
  const addSettings = useMemo(() => getSettings(addProjectId), [getSettings, addProjectId]);

  const [showCsvMenuModal, setShowCsvMenuModal] = useState(false);

  const [showManHoursImportModal, setShowManHoursImportModal] = useState(false);
  const [manHoursImportRows, setManHoursImportRows] = useState<ManHoursImportRow[]>([]);
  const [manHoursDragOver, setManHoursDragOver] = useState(false);
  const [manHoursImported, setManHoursImported] = useState(false);
  const manHoursInputRef = useRef<HTMLInputElement>(null);

  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvFormat, setCsvFormat] = useState<CsvFormat | null>(null);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvScheduleTasks, setCsvScheduleTasks] = useState<ScheduleImportTask[]>([]);
  const [csvDeliverableTasks, setCsvDeliverableTasks] = useState<DeliverableImportTask[]>([]);
  const [csvDragOver, setCsvDragOver] = useState(false);
  const [csvImported, setCsvImported] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const selectedTask = selectedTaskId ? tasks.find(t => t.id === selectedTaskId) || null : null;
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: 'asc' });

  // 完了予定日を過ぎても END/EXC になっていないフェーズがあれば遅延
  const todayDate = new Date().toISOString().split('T')[0];
  const getAlertState = (task: Task): boolean =>
    Object.values(task.phases).some(phaseData => {
      const code = phaseData.currentWorkStepCode;
      if (isTerminalStep(code)) return false;
      const plannedEnd = phaseData.schedule[code]?.plannedEndDate;
      if (!plannedEnd) return false; // 完了予定日未設定は対象外
      return plannedEnd < todayDate;
    });

  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const [filterOpen, setFilterOpen]           = useState(true);
  const [filterProjectId, setFilterProjectId] = useState(urlParams.get(`${type}_project`) ?? '');
  // CSV インポート先プロジェクト（フィルタ中ならそれ、なければ先頭）
  const importProjectId = filterProjectId ? Number(filterProjectId) : (projects[0]?.id ?? 0);
  const [filterKeyword, setFilterKeyword]     = useState(urlParams.get(`${type}_kw`) ?? '');
  const [filterDomainId, setFilterDomainId]   = useState(urlParams.get(`${type}_domain`) ?? '');
  const [filterAssignee, setFilterAssignee]   = useState(urlParams.get(`${type}_assignee`) ?? '');
  const [filterStatus, setFilterStatus]       = useState(urlParams.get(`${type}_status`) ?? '');
  const [filterPriority, setFilterPriority]   = useState(urlParams.get(`${type}_priority`) ?? '');
  const [filterTag, setFilterTag]             = useState(urlParams.get(`${type}_tag`) ?? '');
  const [filterPhase, setFilterPhase]         = useState(urlParams.get(`${type}_phase`) ?? '');
  const [filterAlertOnly, setFilterAlertOnly] = useState(urlParams.get(`${type}_alert`) === '1');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    filterProjectId? p.set(`${type}_project`, filterProjectId): p.delete(`${type}_project`);
    filterKeyword  ? p.set(`${type}_kw`, filterKeyword)      : p.delete(`${type}_kw`);
    filterDomainId ? p.set(`${type}_domain`, filterDomainId) : p.delete(`${type}_domain`);
    filterAssignee ? p.set(`${type}_assignee`, filterAssignee): p.delete(`${type}_assignee`);
    filterStatus   ? p.set(`${type}_status`, filterStatus)   : p.delete(`${type}_status`);
    filterPriority ? p.set(`${type}_priority`, filterPriority): p.delete(`${type}_priority`);
    filterTag      ? p.set(`${type}_tag`, filterTag)         : p.delete(`${type}_tag`);
    filterPhase    ? p.set(`${type}_phase`, filterPhase)     : p.delete(`${type}_phase`);
    filterAlertOnly? p.set(`${type}_alert`, '1')             : p.delete(`${type}_alert`);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [type, filterProjectId, filterKeyword, filterDomainId, filterAssignee, filterStatus, filterPriority, filterTag, filterPhase, filterAlertOnly]);

  const handleClearFilters = useCallback(() => {
    setFilterProjectId('');
    setFilterKeyword('');
    setFilterDomainId('');
    setFilterAssignee('');
    setFilterStatus('');
    setFilterPriority('');
    setFilterTag('');
    setFilterPhase('');
    setFilterAlertOnly(false);
  }, []);

  const isFilterActive = !!(filterProjectId || filterKeyword || filterDomainId || filterAssignee || filterStatus || filterPriority || filterTag || filterPhase || filterAlertOnly);

  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      if (task.type !== type) return false;
      if (filterProjectId && String(task.projectId) !== filterProjectId) return false;

      if (filterKeyword) {
        const kw = filterKeyword.toLowerCase();
        if (
          !task.name.toLowerCase().includes(kw) &&
          !(task.taskId ?? '').toLowerCase().includes(kw) &&
          !(task.ticketKey ?? '').toLowerCase().includes(kw)
        ) return false;
      }
      if (filterDomainId && task.domainId !== filterDomainId) return false;
      if (filterAssignee && task.assignee !== filterAssignee) return false;
      if (filterStatus && task.status !== filterStatus) return false;
      if (filterPriority && (task.priority ?? '') !== (filterPriority === 'NONE' ? '' : filterPriority)) return false;
      if (filterTag && !(task.tags ?? []).includes(filterTag)) return false;

      if (filterPhase) {
        let phaseCode: string;
        if (task.type === 'Requirement') {
          phaseCode = REQUIREMENT_PHASE_CODE;
        } else {
          const skipped = skippedPhasesOf(task.projectId);
          const activePhases = PHASES.filter(p => !isRequirementPhase(p.code) && !skipped.includes(p.code));
          const found = activePhases.find(p => {
            const code = task.phases[p.code]?.currentWorkStepCode;
            return !isTerminalStep(code);
          }) ?? activePhases[activePhases.length - 1] ?? PHASES[PHASES.length - 1];
          phaseCode = found?.code ?? '';
        }
        if (phaseCode !== filterPhase) return false;
      }

      if (filterAlertOnly && !getAlertState(task)) return false;

      return true;
    });
  }, [tasks, type, filterProjectId, filterKeyword, filterDomainId, filterAssignee, filterStatus, filterPriority, filterTag, filterPhase, filterAlertOnly, skippedPhasesOf]);

  /**
   * 表示対象プロジェクトのいずれかで実施される工程。
   * ユニオンビューの settings.skippedPhases だと、1 プロジェクトがスキップしただけで
   * 他プロジェクトの工程まで選択肢から消えてしまう。
   */
  const activePhases = useMemo(() => {
    const scoped = filterProjectId ? [Number(filterProjectId)] : projects.map(p => p.id);
    return PHASES.filter(p => scoped.some(id => !skippedPhasesOf(id).includes(p.code)));
  }, [filterProjectId, projects, skippedPhasesOf]);

  const allTags = useMemo(() => {
    const set = new Set<string>(settings.tags ?? []);
    tasks.forEach(t => { if (t.type === type) (t.tags ?? []).forEach(tag => set.add(tag)); });
    return Array.from(set);
  }, [settings.tags, tasks, type]);

  const domainNameMap = useMemo(
    () => new Map(settings.domains.map(d => [d.id, d.name])),
    [settings.domains]
  );
  const getDomainName = useCallback((id: string) => domainNameMap.get(id) ?? 'Unknown', [domainNameMap]);

  const memberNameByEmpNo = useMemo(
    () => new Map(settings.members.map(m => [m.employeeNumber, m.name])),
    [settings.members]
  );
  const getAssigneeName = useCallback((empNo: string) => memberNameByEmpNo.get(empNo) ?? empNo, [memberNameByEmpNo]);

  const getCurrentState = (task: Task) => {
    let currentPhase;

    if (task.type === 'Requirement') {
      currentPhase = PHASES.find(p => isRequirementPhase(p.code))!;
    } else {
      // AD→CT の順で END でない最初の工程（スキップ設定はタスクの所属プロジェクトのもの）
      const skipped = skippedPhasesOf(task.projectId);
      const activePhases = PHASES.filter(p =>
        !isRequirementPhase(p.code) && !skipped.includes(p.code)
      );
      currentPhase =
        activePhases.find(p => {
          const code = task.phases[p.code]?.currentWorkStepCode;
          return !isTerminalStep(code);
        }) ??
        activePhases[activePhases.length - 1] ??
        PHASES[PHASES.length - 1];
    }

    const phaseData = task.phases[currentPhase.code];
    const workStep = workStepByCode(phaseData?.currentWorkStepCode) ?? INITIAL_WORK_STEP;

    return { phase: currentPhase, workStep };
  };

  const handleSort = (key: SortKey) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleOpenAddModal = useCallback(() => {
    const defaultAssignee =
      currentUser && currentUser.employeeNumber !== 'admin'
        ? currentUser.employeeNumber
        : '';
    setAddForm({
      name: '',
      domainId: '',
      assignee: defaultAssignee,
      ticketUrl: '',
    });
    setAddProjectId(filterProjectId ? Number(filterProjectId) : (projects[0]?.id ?? 0));
    setAddErrors({});
    setShowAddModal(true);
  }, [currentUser, filterProjectId, projects]);

  const handleAddTask = useCallback(async () => {
    const errors: Partial<AddTaskForm> = {};
    if (!addForm.name.trim()) errors.name = 'タスク名は必須です';
    if (!addForm.domainId) errors.domainId = 'ドメインを選択してください';
    if (!addForm.assignee) errors.assignee = '担当者を選択してください';
    if (!addProjectId) errors.name = 'プロジェクトを選択してください';

    const ticketUrl = addForm.ticketUrl.trim();
    const ticketKey = ticketUrl ? extractTicketKey(ticketUrl) : null;
    if (ticketKey && findTicketKeyConflict(tasks, addProjectId, ticketKey)) {
      errors.ticketUrl = `チケットID「${ticketKey}」は同一プロジェクト内で既に使われています`;
    }
    if (Object.keys(errors).length > 0) {
      setAddErrors(errors);
      return;
    }

    try {
      await addTask(addProjectId, {
        type,
        status: NOT_STARTED_STATUS,
        domainId: addForm.domainId,
        name: addForm.name.trim(),
        assignee: addForm.assignee,
        ...(ticketUrl ? { ticketUrl, ticketKey: ticketKey ?? undefined } : {}),
        phases: buildInitialPhases() as Task['phases'],
      });
      setShowAddModal(false);
    } catch (e) {
      setAddErrors({ ticketUrl: e instanceof Error ? e.message : '保存に失敗しました' });
    }
  }, [addForm, addProjectId, type, addTask, tasks]);


  const parseCsv = useCallback((text: string): CsvRow[] => {
    const lines = text.split(LINE_SPLIT_RE).filter(l => l.trim());
    if (lines.length === 0) return [];
    const firstCols = parseCsvLine(lines[0]);
    const isHeader = firstCols[0] === 'タスク名' || firstCols[0] === 'task_name';
    const dataLines = isHeader ? lines.slice(1) : lines;
    const memberEmpNoSet = new Set(settings.members.filter(m => m.employeeNumber !== 'admin').map(m => m.employeeNumber));
    return dataLines.map((line, i) => {
      const cols = parseCsvLine(line);
      const name = cols[0] ?? '';
      const domainName = cols[1] ?? '';
      const assigneeName = cols[2] ?? '';
      const errors: string[] = [];
      if (!name) errors.push('タスク名が空です');
      const domain = settings.domains.find(d => d.name === domainName);
      if (!domainName) errors.push('ドメインが空です');
      else if (!domain) errors.push(`ドメイン「${domainName}」が見つかりません`);
      if (!assigneeName) errors.push('担当者が空です');
      else if (!memberEmpNoSet.has(assigneeName)) errors.push(`担当者「${assigneeName}」が見つかりません`);
      return { rowIndex: i + (isHeader ? 2 : 1), name, domainName, assigneeName, domainId: domain?.id ?? null, errors };
    });
  }, [settings.domains, settings.members]);

  // 列: タスクID, チケットID, タスク名, ドメイン, 担当者, 担当者名, ステータス,
  //     工程, 工程名, 作業工程, 作業工程名, 現在の作業工程, 開始予定日, 完了予定日,
  //     開始日(実績), 完了日(実績), 予定工数(hh:mm), 実績工数合計(hh:mm), 状況詳細, 優先度
  // ※ チケットID・担当者名は出力専用（取込時は無視）。種別は画面の種別を使用。
  const parseScheduleCsv = useCallback((lines: string[]): ScheduleImportTask[] => {
    const taskMap = new Map<string, ScheduleImportTask>();
    const memberEmpNoSet = new Set(settings.members.filter(m => m.employeeNumber !== 'admin').map(m => m.employeeNumber));
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const c = parseCsvLine(line);
      const taskId = c[0]; const name = c[2];
      const domainName = c[3]; const assignee = c[4]; const status = c[6];
      const priority = LABEL_TO_PRIORITY[(c[19] ?? '').trim()] ?? '';
      const phaseCode = c[7] as PhaseCode; const wsCode = c[9];
      const isCurrent = c[11] === '○';
      const sched: WorkStepSchedule = {
        workStepCode: wsCode,
        ...(c[12] && { plannedStartDate: c[12] }),
        ...(c[13] && { plannedEndDate: c[13] }),
        ...(c[14] && { actualStartDate: c[14] }),
        ...(c[15] && { actualEndDate: c[15] }),
        ...(parseHours(c[16] ?? '') !== undefined && { plannedManHours: parseHours(c[16] ?? '') }),
        ...(parseHours(c[17] ?? '') !== undefined && { actualManHours: parseHours(c[17] ?? '') }),
        ...(c[18] && { statusDetail: c[18] }),
      };
      if (!taskId || !phaseCode || !wsCode) continue;
      if (!taskMap.has(taskId)) {
        const domain = settings.domains.find(d => d.name === domainName);
        const existingTask = tasks.find(t => t.taskId === taskId) ?? null;
        const errors: string[] = [];
        if (!domain) errors.push(`ドメイン「${domainName}」が見つかりません`);
        if (assignee && !memberEmpNoSet.has(assignee)) errors.push(`担当者「${assignee}」が見つかりません`);
        taskMap.set(taskId, {
          taskId, name, type,
          domainId: domain?.id ?? null, domainName, assignee, status, priority,
          phases: {}, existingTask, errors,
        });
      }
      const t = taskMap.get(taskId)!;
      if (!t.phases[phaseCode]) t.phases[phaseCode] = { currentWorkStepCode: wsCode, schedule: {} };
      if (isCurrent) t.phases[phaseCode]!.currentWorkStepCode = wsCode;
      t.phases[phaseCode]!.schedule[wsCode] = sched;
    }
    return [...taskMap.values()];
  }, [settings.domains, settings.members, tasks, type]);

  // 列: タスクID, チケットID, タスク名, ドメイン, 担当者, 担当者名, ステータス,
  //     工程, 工程名, 成果物種別, 成果物名, ワークフロー, リビジョン, URL, 優先度
  const parseDeliverablesCsv = useCallback((lines: string[]): DeliverableImportTask[] => {
    const taskMap = new Map<string, DeliverableImportTask>();
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const c = parseCsvLine(line);
      const taskId = c[0]; const name = c[2]; const phaseCode = c[7];
      const deliverable: Deliverable = { type: c[9] ?? '', name: c[10] ?? '', workflow: c[11] ?? '', revision: c[12] ?? '', url: c[13] ?? '' };
      if (!taskId || !phaseCode || !deliverable.name) continue;
      if (!taskMap.has(taskId)) {
        const existingTask = tasks.find(t => t.taskId === taskId) ?? null;
        const errors: string[] = [];
        if (!existingTask) errors.push(`タスクID「${taskId}」が見つかりません`);
        taskMap.set(taskId, { taskId, name, deliverablesByPhase: {}, existingTask, errors });
      }
      const t = taskMap.get(taskId)!;
      if (!t.deliverablesByPhase[phaseCode]) t.deliverablesByPhase[phaseCode] = [];
      t.deliverablesByPhase[phaseCode].push(deliverable);
    }
    return [...taskMap.values()];
  }, [tasks]);

  const handleCsvFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setCsvFormat('simple');
      setCsvRows([{ rowIndex: 0, name: '', domainName: '', assigneeName: '', domainId: null, errors: ['CSVファイルを選択してください'] }]);
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target?.result as string).replace(/^\uFEFF/, '');
      const lines = text.split(LINE_SPLIT_RE).filter(l => l.trim());
      if (lines.length === 0) { setCsvFormat('simple'); setCsvRows([]); return; }
      const header = parseCsvLine(lines[0]);
      let fmt: CsvFormat;
      if (header[0] === 'タスクID' && header[9] === '作業工程') fmt = 'schedule';
      else if (header[0] === 'タスクID' && header[9] === '成果物種別') fmt = 'deliverables';
      else fmt = 'simple';
      setCsvFormat(fmt);
      setCsvImported(false);
      if (fmt === 'schedule') setCsvScheduleTasks(parseScheduleCsv(lines));
      else if (fmt === 'deliverables') setCsvDeliverableTasks(parseDeliverablesCsv(lines));
      else setCsvRows(parseCsv(text));
    };
    reader.readAsText(file, 'UTF-8');
  }, [parseCsv, parseScheduleCsv, parseDeliverablesCsv]);

  const handleCsvImport = useCallback(() => {
    if (csvFormat === 'schedule') {
      csvScheduleTasks.filter(t => t.errors.length === 0).forEach(t => {
        const base = buildInitialPhases() as Task['phases'];
        // 既存タスクのフェーズを引き継ぎ、CSVデータで上書きマージ
        if (t.existingTask) Object.assign(base, JSON.parse(JSON.stringify(t.existingTask.phases)));
        for (const [code, phaseData] of Object.entries(t.phases) as [PhaseCode, TaskPhaseData][]) {
          if (!base[code]) base[code] = { currentWorkStepCode: INITIAL_WORK_STEP_CODE, schedule: {} };
          base[code].currentWorkStepCode = phaseData.currentWorkStepCode;
          Object.assign(base[code].schedule, phaseData.schedule);
        }
        if (t.existingTask) {
          updateTask({ ...t.existingTask, phases: base });
        } else {
          addTask(importProjectId, { type: t.type, status: t.status || NOT_STARTED_STATUS, priority: t.priority || null, domainId: t.domainId!, name: t.name, assignee: t.assignee, phases: base });
        }
      });
    } else if (csvFormat === 'deliverables') {
      csvDeliverableTasks.filter(t => t.errors.length === 0 && t.existingTask).forEach(t => {
        const merged = { ...(t.existingTask!.deliverablesByPhase ?? {}) };
        for (const [phase, deliverables] of Object.entries(t.deliverablesByPhase)) merged[phase] = deliverables;
        updateTask({ ...t.existingTask!, deliverablesByPhase: merged });
      });
    } else {
      csvRows.filter(r => r.errors.length === 0).forEach((row, i) => {
        addTask(importProjectId, { type, status: NOT_STARTED_STATUS, domainId: row.domainId!, name: row.name, assignee: row.assigneeName, phases: buildInitialPhases() as Task['phases'] });
      });
    }
    setCsvImported(true);
  }, [csvFormat, csvRows, csvScheduleTasks, csvDeliverableTasks, type, addTask, updateTask, importProjectId]);

  const resetCsvImport = useCallback(() => {
    setCsvFormat(null);
    setCsvRows([]);
    setCsvScheduleTasks([]);
    setCsvDeliverableTasks([]);
    setCsvImported(false);
    if (csvInputRef.current) csvInputRef.current.value = '';
  }, []);

  const closeCsvModal = useCallback(() => {
    setShowCsvModal(false);
    resetCsvImport();
  }, [resetCsvImport]);

  const sortedTasks = useMemo(() => {
    const sorted = [...filteredTasks];
    sorted.sort((a, b) => {
      let valA: string | number | boolean = '';
      let valB: string | number | boolean = '';

      const stateA = getCurrentState(a);
      const stateB = getCurrentState(b);

      switch (sortConfig.key) {
        case 'taskId':
          valA = a.taskId;
          valB = b.taskId;
          break;
        case 'project':
          valA = projectNameById.get(a.projectId) ?? '';
          valB = projectNameById.get(b.projectId) ?? '';
          break;
        case 'domain':
          valA = getDomainName(a.domainId);
          valB = getDomainName(b.domainId);
          break;
        case 'name':
          valA = a.name;
          valB = b.name;
          break;
        case 'assignee':
          valA = getAssigneeName(a.assignee);
          valB = getAssigneeName(b.assignee);
          break;
        case 'phase':
          valA = PHASES.findIndex(p => p.code === stateA.phase.code);
          valB = PHASES.findIndex(p => p.code === stateB.phase.code);
          break;
        case 'priority':
          valA = PRIORITY_ORDER[a.priority ?? ''] ?? 3;
          valB = PRIORITY_ORDER[b.priority ?? ''] ?? 3;
          break;
        case 'status':
          valA = settings.taskStatuses.indexOf(a.status);
          valB = settings.taskStatuses.indexOf(b.status);
          break;
        case 'workStep':
          valA = stateA.workStep.progress;
          valB = stateB.workStep.progress;
          break;
        case 'progress':
          valA = stateA.workStep.progress;
          valB = stateB.workStep.progress;
          break;
        case 'alert':
          valA = getAlertState(a);
          valB = getAlertState(b);
          break;
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredTasks, sortConfig, domainNameMap, projectNameById, skippedPhasesOf]);

  const handleExportCsv = useCallback(() => {
    const now = new Date();
    const ts = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');
    const typeLabel = type === 'Requirement' ? '要件' : '開発';

    const formatHours = (hours: number | undefined): string => {
      if (!hours) return '';
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    const toCsvRow = (cells: (string | number)[]) =>
      cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');

    const downloadCsv = (content: string, filename: string) => {
      const blob = new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    };

    const applicablePhases = PHASES.filter(p =>
      p.target === type
    );

    // アプリと同じ「現在工程」判定: END/EXC でない最初の工程（無ければ最終工程）。
    // これにより「現在の作業工程」の○は各タスクで実際に進行中の工程1つだけに付く。
    const currentPhaseCode = (task: Task): string => {
      if (type === 'Requirement') return REQUIREMENT_PHASE_CODE;
      const found = applicablePhases.find(p => {
        const c = task.phases[p.code]?.currentWorkStepCode;
        return !!c && !isTerminalStep(c);
      });
      return (found ?? applicablePhases[applicablePhases.length - 1])?.code ?? '';
    };

    const taskBaseFields = (task: Task) => [
      task.taskId, task.ticketKey ?? '', task.name,
      getDomainName(task.domainId), task.assignee, getAssigneeName(task.assignee), task.status,
    ];

    const scheduleRows: string[] = [toCsvRow([
      'タスクID', 'チケットID', 'タスク名', 'ドメイン', '担当者', '担当者名', 'ステータス',
      '工程', '工程名', '作業工程', '作業工程名', '現在の作業工程',
      '開始予定日', '完了予定日', '開始日(実績)', '完了日(実績)',
      '予定工数(hh:mm)', '実績工数合計(hh:mm)', '状況詳細', '優先度',
    ])];

    for (const task of sortedTasks) {
      const curPhaseCode = currentPhaseCode(task);
      for (const phase of applicablePhases) {
        const phaseData = task.phases[phase.code];
        if (!phaseData) continue;

        // 現在の作業工程 ＋ スケジュールデータが存在する工程をすべて対象にする
        const stepCodes = new Set<string>([phaseData.currentWorkStepCode]);
        Object.keys(phaseData.schedule).forEach(code => stepCodes.add(code));

        // WORK_STEPS の定義順に並べ替え
        const orderedSteps = WORK_STEPS.filter(ws => stepCodes.has(ws.code));

        for (const ws of orderedSteps) {
          const sched = phaseData.schedule[ws.code];
          scheduleRows.push(toCsvRow([
            ...taskBaseFields(task),
            phase.code, phase.name,
            ws.code, ws.name,
            (phase.code === curPhaseCode && ws.code === phaseData.currentWorkStepCode) ? '○' : '',
            sched?.plannedStartDate ?? '',
            sched?.plannedEndDate ?? '',
            sched?.actualStartDate ?? '',
            sched?.actualEndDate ?? '',
            formatHours(sched?.plannedManHours),
            formatHours(sched?.actualManHours),
            sched?.statusDetail ?? '',
            task.priority ? PRIORITY_LABEL[task.priority] : '',
          ]));
        }
      }
    }

    downloadCsv(scheduleRows.join('\r\n'), `Reflect_${typeLabel}_タスク_${ts}.csv`);

    const deliverableRows: string[] = [toCsvRow([
      'タスクID', 'チケットID', 'タスク名', 'ドメイン', '担当者', '担当者名', 'ステータス',
      '工程', '工程名', '成果物種別', '成果物名', 'ワークフロー', 'リビジョン', 'URL', '優先度',
    ])];

    for (const task of sortedTasks) {
      for (const phase of applicablePhases) {
        const deliverables = task.deliverablesByPhase?.[phase.code] ?? [];
        for (const d of deliverables) {
          deliverableRows.push(toCsvRow([
            ...taskBaseFields(task),
            phase.code, phase.name,
            d.type, d.name, d.workflow, d.revision, d.url,
            task.priority ? PRIORITY_LABEL[task.priority] : '',
          ]));
        }
      }
    }

    // ブラウザが1つ目のダウンロードを処理してから2つ目を発行する
    setTimeout(() => {
      downloadCsv(deliverableRows.join('\r\n'), `Reflect_${typeLabel}_成果物_${ts}.csv`);
    }, 150);

  }, [sortedTasks, type, getDomainName, getAssigneeName]);

  const handleExportCommentsCsv = useCallback(async () => {
    const now = new Date();
    const ts = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');

    const toCsvRow = (cells: (string | number)[]) =>
      cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');

    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const typeLabel = type === 'Requirement' ? '要件' : '開発';
    // メンション <@社員番号> を @表示名 へ変換するための対応表
    const nameByEmpNo = new Map(members.map(m => [m.employeeNumber, m.name]));

    const allComments = await commentsApi.listAll();

    const rows: string[] = [toCsvRow([
      'タスクID', 'チケットID', 'タスク名', 'ドメイン', '担当者', '担当者名', '投稿者', '投稿者名', '投稿日時', 'コメント',
    ])];

    for (const c of allComments) {
      const task = taskMap.get(c.taskId);
      if (!task) continue;
      if (type === 'Requirement' ? task.type !== 'Requirement' : task.type !== 'Development') continue;
      rows.push(toCsvRow([
        task.taskId,
        task.ticketKey ?? '',
        task.name,
        getDomainName(task.domainId),
        task.assignee,
        nameByEmpNo.get(task.assignee) ?? task.assignee,
        c.createdBy,
        nameByEmpNo.get(c.createdBy) ?? c.createdBy,
        new Date(c.createdAt).toLocaleString('ja-JP'),
        mentionsToPlainText(c.content, nameByEmpNo),
      ]));
    }

    const blob = new Blob(['﻿', rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reflect_${typeLabel}_コメント_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [tasks, type, getDomainName]);

  // 列: 種別, タスクID, チケットID, タスク名, ドメイン, 工程, 作業工程,
  //     担当者, 担当者名, 日付, 予定工数(hh:mm), 実績工数(hh:mm), 作業内容
  // ※ チケットID・担当者名は出力専用（取込時は無視）。種別=予定 の担当者列も取込時は無視。
  const parseManHoursCsv = useCallback((lines: string[]): ManHoursImportRow[] | null => {
    if (lines.length === 0) return null;
    const header = parseCsvLine(lines[0]);
    if (header[0] !== '種別' || header[6] !== '作業工程') return null;

    const rows: ManHoursImportRow[] = [];
    lines.slice(1).forEach((line, i) => {
      if (!line.trim()) return;
      const c = parseCsvLine(line);
      const kindRaw = (c[0] ?? '').trim();
      const taskId = c[1]; const phaseCode = c[5]; const wsCode = c[6];
      const errors: string[] = [];
      if (kindRaw !== '予定' && kindRaw !== '実績') errors.push(`種別「${kindRaw}」は「予定」または「実績」にしてください`);
      if (!taskId) { errors.push('タスクIDが空です'); }
      if (!phaseCode) { errors.push('工程が空です'); }
      if (!wsCode) { errors.push('作業工程が空です'); }
      const existingTask = tasks.find(t => t.taskId === taskId) ?? null;
      if (taskId && !existingTask) errors.push(`タスクID「${taskId}」が見つかりません`);
      if (phaseCode && !PHASES.find(p => p.code === phaseCode)) errors.push(`工程「${phaseCode}」が不正です`);
      if (wsCode && !WORK_STEPS.find(ws => ws.code === wsCode)) errors.push(`作業工程「${wsCode}」が不正です`);

      if (kindRaw === '予定') {
        const h = parseHours(c[10] ?? '');
        if (h === undefined) errors.push('予定工数の形式が不正です(hh:mm)');
        rows.push({ rowIndex: i, kind: 'planned', taskId, phaseCode, wsCode, plannedManHours: h, existingTask, errors });
      } else {
        const empNo = c[7] ?? ''; const memberName = c[8] ?? '';
        const date = (c[9] ?? '').replace(/\//g, '-');
        const h = parseHours(c[11] ?? '');
        const workContent = c[12] ?? '';
        if (!empNo) errors.push('担当者が空です');
        if (!date) errors.push('日付が空です');
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('日付の形式が不正です(YYYY-MM-DD)');
        if (h === undefined) errors.push('実績工数の形式が不正です(hh:mm)');
        rows.push({ rowIndex: i, kind: 'actual', taskId, phaseCode, wsCode, empNo, memberName, date, actualManHours: h, workContent, existingTask, errors });
      }
    });
    return rows;
  }, [tasks]);

  const handleManHoursCsvFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      setManHoursImportRows([{ rowIndex: 0, kind: 'planned', taskId: '', phaseCode: '', wsCode: '', existingTask: null, errors: ['CSVファイルを選択してください'] }]);
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target?.result as string).replace(/^\uFEFF/, '');
      const lines = text.split(LINE_SPLIT_RE).filter(l => l.trim());
      const result = parseManHoursCsv(lines);
      if (!result) {
        setManHoursImportRows([{ rowIndex: 0, kind: 'planned', taskId: '', phaseCode: '', wsCode: '', existingTask: null, errors: ['対応していないフォーマットです（1列目が「種別」のCSVを指定してください）'] }]);
        return;
      }
      setManHoursImportRows(result);
      setManHoursImported(false);
    };
    reader.readAsText(file, 'UTF-8');
  }, [parseManHoursCsv]);

  const handleManHoursCsvImport = useCallback(() => {
    const validRows = manHoursImportRows.filter(r => r.errors.length === 0 && r.existingTask);
    // 複数行が同一タスクを更新するため、タスク単位でまとめて1回 updateTask する
    const byTask = new Map<string, ManHoursImportRow[]>();
    for (const row of validRows) {
      const id = row.existingTask!.id;
      byTask.set(id, [...(byTask.get(id) ?? []), row]);
    }
    for (const rows of byTask.values()) {
      const task = rows[0].existingTask!;
      const updatedPhases: Task['phases'] = { ...task.phases };
      for (const row of rows) {
        const phaseData = updatedPhases[row.phaseCode as PhaseCode];
        if (!phaseData) continue;
        const newPhaseData = { ...phaseData, schedule: { ...phaseData.schedule } };
        const sched: WorkStepSchedule = { ...(newPhaseData.schedule[row.wsCode] ?? { workStepCode: row.wsCode }) };

        if (row.kind === 'planned' && row.plannedManHours !== undefined) {
          sched.plannedManHours = row.plannedManHours;
        } else if (row.kind === 'actual' && row.empNo && row.date && row.actualManHours !== undefined) {
          const perMember: Record<string, Record<string, number>> = { ...(sched.actualManHoursPerMember ?? {}) };
          perMember[row.empNo] = { ...(perMember[row.empNo] ?? {}), [row.date]: row.actualManHours };
          sched.actualManHoursPerMember = perMember;
          const contentPerMember: Record<string, Record<string, string>> = { ...(sched.actualWorkContentPerMember ?? {}) };
          if (row.workContent) {
            contentPerMember[row.empNo] = { ...(contentPerMember[row.empNo] ?? {}), [row.date]: row.workContent };
          } else if (contentPerMember[row.empNo]) {
            const m = { ...contentPerMember[row.empNo] }; delete m[row.date]; contentPerMember[row.empNo] = m;
          }
          sched.actualWorkContentPerMember = contentPerMember;
          sched.actualManHours = Object.values(perMember).reduce((sum, dateMap) =>
            sum + Object.values(dateMap as Record<string, number>).reduce((s, h) => s + (h || 0), 0), 0);
        }
        newPhaseData.schedule[row.wsCode] = sched;
        updatedPhases[row.phaseCode as PhaseCode] = newPhaseData;
      }
      updateTask({ ...task, phases: updatedPhases });
    }
    setManHoursImported(true);
  }, [manHoursImportRows, updateTask]);

  const handleExportManHoursCsv = useCallback(() => {
    const now = new Date();
    const ts = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');
    const typeLabel = type === 'Requirement' ? '要件' : '開発';

    const formatHours = (hours: number | undefined): string => {
      if (!hours) return '';
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    const toCsvRow = (cells: (string | number)[]) =>
      cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');

    const downloadCsv = (content: string, filename: string) => {
      const blob = new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    };

    const applicablePhases = PHASES.filter(p =>
      p.target === type
    );

    const memberNameMap: Record<string, string> = {};
    settings.members.forEach(m => { memberNameMap[m.employeeNumber] = m.name; });

    // 種別=予定: 作業工程ごとに1行（担当者は空。予定は工程単位の見積のため）
    // 種別=実績: 担当者×日付ごとに1行（従来どおり）
    // 並びは タスク→工程→作業工程 でまとめ、各作業工程の予定行→実績行の順。
    const rows: string[] = [toCsvRow([
      '種別', 'タスクID', 'チケットID', 'タスク名', 'ドメイン', '工程', '作業工程',
      '担当者', '担当者名', '日付', '予定工数(hh:mm)', '実績工数(hh:mm)', '作業内容',
    ])];

    for (const task of sortedTasks) {
      for (const phase of applicablePhases) {
        const phaseData = task.phases[phase.code];
        if (!phaseData) continue;
        for (const ws of WORK_STEPS) {
          const sched = phaseData.schedule[ws.code];
          if (!sched) continue;
          const idFields = [task.taskId, task.ticketKey ?? '', task.name, getDomainName(task.domainId), phase.code, ws.code];

          if (sched.plannedManHours) {
            rows.push(toCsvRow([
              '予定', ...idFields, '', '', '', formatHours(sched.plannedManHours), '', '',
            ]));
          }
          if (sched.actualManHoursPerMember) {
            for (const [empNo, dateMap] of Object.entries(sched.actualManHoursPerMember as Record<string, Record<string, number>>)) {
              const contentMap = sched.actualWorkContentPerMember?.[empNo] ?? {};
              for (const [date, h] of Object.entries(dateMap as Record<string, number>).sort((a, b) => a[0].localeCompare(b[0]))) {
                if (!h) continue;
                rows.push(toCsvRow([
                  '実績', ...idFields,
                  empNo, memberNameMap[empNo] ?? empNo,
                  date, '', formatHours(h), contentMap[date] ?? '',
                ]));
              }
            }
          }
        }
      }
    }

    downloadCsv(rows.join('\r\n'), `Reflect_${typeLabel}_工数_${ts}.csv`);
  }, [sortedTasks, type, getDomainName, settings.members]);

  const handleDownloadSample = useCallback(() => {
    const domainSample = settings.domains[0]?.name ?? 'ドメイン名';
    const assigneeSample = settings.members.find(m => m.employeeNumber !== 'admin')?.employeeNumber ?? '社員番号';
    const csv = `タスク名,ドメイン,担当者(社員番号)\nタスク例1,${domainSample},${assigneeSample}\nタスク例2,${domainSample},${assigneeSample}`;
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasks_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [settings.domains, settings.members]);

  const statusStyle = (s: string) => statusBadgeClass(s);

  const isReq = type === 'Requirement';
  const themeColor = {
    accent:      isReq ? 'text-teal-600'         : 'text-indigo-600',
    badgeBg:     isReq ? 'bg-teal-50'            : 'bg-indigo-50',
    badgeBorder: isReq ? 'border-teal-200'        : 'border-indigo-200',
    badgeText:   isReq ? 'text-teal-600'          : 'text-indigo-600',
    btnPrimary:  isReq ? 'bg-teal-600 hover:bg-teal-700'   : 'bg-indigo-600 hover:bg-indigo-700',
    btnSecBorder:isReq ? 'border-teal-300 text-teal-700 hover:bg-teal-50' : 'border-indigo-300 text-indigo-700 hover:bg-indigo-50',
    inputRing:   isReq ? 'focus:ring-teal-500'    : 'focus:ring-indigo-500',
    checkColor:  isReq ? 'text-teal-600 focus:ring-teal-500' : 'text-indigo-600 focus:ring-indigo-500',
    tableBorder: isReq ? 'border-teal-200'        : 'border-indigo-200',
    theadBg:     isReq ? 'bg-teal-50 border-teal-200 text-teal-800' : 'bg-indigo-50 border-indigo-200 text-indigo-800',
    thHover:     isReq ? 'hover:bg-teal-100'      : 'hover:bg-indigo-100',
  };

  return (
    <div className="flex flex-col h-full">
      {/* アクション行 */}
      <div className="mb-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-baseline gap-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
            <span className={`text-xl font-bold ${themeColor.accent}`}>{filteredTasks.length}</span>
            <span className="text-xs text-gray-500">件</span>
            {isFilterActive && (
              <span className="text-xs text-gray-400 ml-1">/ {tasks.filter(t => t.type === type).length}</span>
            )}
          </div>
          {isFilterActive && (
            <span className={`text-xs font-semibold ${themeColor.badgeText} ${themeColor.badgeBg} border ${themeColor.badgeBorder} rounded-full px-2.5 py-1`}>
              絞込中
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className={`${themeColor.btnPrimary} text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5`}
            onClick={handleOpenAddModal}
          >
            <Plus size={16} />
            タスク追加
          </button>
          <button
            className={`bg-white border ${themeColor.btnSecBorder} px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5`}
            onClick={() => setShowCsvMenuModal(true)}
          >
            <FileDown size={16} />
            CSV
          </button>
        </div>
      </div>

      {/* フィルタパネル */}
      {/* フィルタパネル */}
      <div className="mb-4 bg-white rounded-xl border border-gray-300 shadow-sm shrink-0">
        {/* ヘッダー（トグル） */}
        <button
          onClick={() => setFilterOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">絞り込み</span>
            {isFilterActive && (
              <span className={`text-xs font-semibold ${themeColor.badgeText} ${themeColor.badgeBg} border ${themeColor.badgeBorder} rounded-full px-2 py-0.5`}>
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
                  className={`px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 ${themeColor.inputRing}`}
                >
                  <option value="">すべて</option>
                  {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select>
              </div>
              {/* キーワード */}
              <div className="min-w-[180px] flex-1">
                <label className="block text-xs font-semibold text-gray-600 mb-1">キーワード</label>
                <input
                  type="text"
                  value={filterKeyword}
                  onChange={e => setFilterKeyword(e.target.value)}
                  placeholder="タスク名・タスクID"
                  className={`w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 ${themeColor.inputRing}`}
                />
              </div>
              {/* ドメイン */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">ドメイン</label>
                <select
                  value={filterDomainId}
                  onChange={e => setFilterDomainId(e.target.value)}
                  className={`px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 ${themeColor.inputRing}`}
                >
                  <option value="">すべて</option>
                  {settings.domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              {/* 担当者 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">担当者</label>
                <select
                  value={filterAssignee}
                  onChange={e => setFilterAssignee(e.target.value)}
                  className={`px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 ${themeColor.inputRing}`}
                >
                  <option value="">すべて</option>
                  {settings.members.filter(m => m.employeeNumber !== 'admin').map(m => (
                    <option key={m.id} value={m.employeeNumber}>{m.name}</option>
                  ))}
                </select>
              </div>
              {/* ステータス */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">ステータス</label>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className={`px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 ${themeColor.inputRing}`}
                >
                  <option value="">すべて</option>
                  {settings.taskStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {/* 優先度 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">優先度</label>
                <select
                  value={filterPriority}
                  onChange={e => setFilterPriority(e.target.value)}
                  className={`px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 ${themeColor.inputRing}`}
                >
                  <option value="">すべて</option>
                  {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  <option value="NONE">未設定</option>
                </select>
              </div>
              {/* タグ */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">タグ</label>
                <select
                  value={filterTag}
                  onChange={e => setFilterTag(e.target.value)}
                  className={`px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 ${themeColor.inputRing}`}
                >
                  <option value="">すべて</option>
                  {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {/* 現在工程 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">現在工程</label>
                <select
                  value={filterPhase}
                  onChange={e => setFilterPhase(e.target.value)}
                  className={`px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 ${themeColor.inputRing}`}
                >
                  <option value="">すべて</option>
                  {activePhases
                    .filter(p => p.target === type)
                    .map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
              </div>
              {/* アラートのみ */}
              <div className="flex items-center gap-2 pb-[9px]">
                <input
                  type="checkbox"
                  id="filterAlertOnly"
                  checked={filterAlertOnly}
                  onChange={e => setFilterAlertOnly(e.target.checked)}
                  className={`w-4 h-4 rounded border-gray-300 ${themeColor.checkColor} cursor-pointer`}
                />
                <label htmlFor="filterAlertOnly" className="text-sm text-gray-700 cursor-pointer whitespace-nowrap select-none">
                  アラートのみ
                </label>
              </div>
              {/* クリア */}
              {isFilterActive && (
                <button
                  onClick={handleClearFilters}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors pb-[9px]"
                >
                  <X size={14} />
                  クリア
                </button>
              )}
            </div>
          </div>
        </div>
      </div>


      {/* モバイル用カードリスト */}
      <div className="md:hidden flex-1 min-h-0 overflow-y-auto space-y-2">
        {sortedTasks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">タスクがありません</div>
        ) : sortedTasks.map((task) => {
          const { phase, workStep } = getCurrentState(task);
          const progress = workStep.progress;
          const hasAlert = getAlertState(task);
          return (
            <div
              key={task.id}
              onClick={() => setSelectedTaskId(task.id)}
              className={`bg-white border-2 ${themeColor.tableBorder} rounded-lg px-4 py-3 cursor-pointer active:bg-gray-50`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className={`text-xs font-mono ${themeColor.accent} font-semibold`}>{displayTaskId(task)}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {hasAlert && <AlertCircle size={13} className="text-amber-500" />}
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusStyle(task.status)}`}>{task.status}</span>
                </div>
              </div>
              <p className="text-sm font-bold text-gray-900 mb-2 leading-snug">{task.name}</p>
              {(task.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {task.tags!.map(t => <span key={t} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tagBadge(t)}`}>{t}</span>)}
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-2">
                <span>{getDomainName(task.domainId)}</span>
                <span>{getAssigneeName(task.assignee)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${themeColor.badgeBg} ${themeColor.badgeText} border ${themeColor.badgeBorder}`}>{phase.code}</span>
                <span className="font-mono text-xs text-gray-600">{workStep.code}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden ml-1">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs text-gray-500 tabular-nums">{progress}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* デスクトップ用テーブル */}
      <div className={`hidden md:block flex-1 min-h-0 bg-white border-2 ${themeColor.tableBorder} rounded-lg shadow-sm overflow-hidden`}>
        <div className="overflow-y-auto h-full">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className={`${themeColor.theadBg} border-b-2 text-xs font-semibold uppercase tracking-wider`}>
              <th className="px-3 py-4 w-10">
                <input
                  type="checkbox"
                  checked={sortedTasks.length > 0 && checkedIds.size === sortedTasks.length}
                  onChange={() => toggleAll(sortedTasks.map(t => t.id))}
                  className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('taskId')}
              >
                タスクID <TaskListSortIconBase columnKey="taskId" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('project')}
              >
                プロジェクト <TaskListSortIconBase columnKey="project" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('domain')}
              >
                ドメイン <TaskListSortIconBase columnKey="domain" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('name')}
              >
                タスク名 <TaskListSortIconBase columnKey="name" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('assignee')}
              >
                担当者 <TaskListSortIconBase columnKey="assignee" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('priority')}
              >
                優先度 <TaskListSortIconBase columnKey="priority" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('status')}
              >
                ステータス <TaskListSortIconBase columnKey="status" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('phase')}
              >
                現在工程 <TaskListSortIconBase columnKey="phase" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('workStep')}
              >
                作業工程 <TaskListSortIconBase columnKey="workStep" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className="px-6 py-4 w-48 cursor-pointer hover:bg-indigo-100 group select-none"
                onClick={() => handleSort('progress')}
              >
                進捗 <TaskListSortIconBase columnKey="progress" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
              <th
                className={`px-6 py-4 cursor-pointer ${themeColor.thHover} group select-none`}
                onClick={() => handleSort('alert')}
              >
                アラート <TaskListSortIconBase columnKey="alert" sortKey={sortConfig.key} direction={sortConfig.direction} accentClass={themeColor.accent} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-300">
            {sortedTasks.map((task) => {
              const { phase, workStep } = getCurrentState(task);
              const progress = workStep.progress;
              const hasAlert = getAlertState(task);
              const isChecked = checkedIds.has(task.id);

              return (
                <tr
                  key={task.id}
                  className={`transition-colors cursor-pointer ${
                    hasAlert ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'
                  } ${isChecked ? 'ring-1 ring-inset ring-indigo-400' : ''}`}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <td className="px-3 py-4" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCheck(task.id)}
                      className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                    />
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-gray-500 whitespace-nowrap">
                    {displayTaskId(task)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                    {projectNameById.get(task.projectId) ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 font-medium">
                    {getDomainName(task.domainId)}
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-gray-900">
                    {task.name}
                    {(task.tags ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {task.tags!.map(t => <span key={t} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tagBadge(t)}`}>{t}</span>)}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {getAssigneeName(task.assignee)}
                  </td>
                  <td className="px-6 py-4 text-sm whitespace-nowrap">
                    {task.priority
                      ? <span className={`px-2 py-1 rounded-md text-xs font-medium ${PRIORITY_BADGE[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`px-2 py-1 rounded-md text-xs font-medium ${statusStyle(task.status)}`}>
                      {task.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className="px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 font-medium text-xs border border-indigo-200">
                      {phase.code}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">
                    {workStep.code}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-green-500 rounded-full" 
                          style={{ width: `${progress}%` }} 
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-600 w-8 text-right">{progress}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {hasAlert && (
                      <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                        <AlertCircle size={14} />
                        <span>遅延</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* 一括操作バー */}
      {checkedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 text-white px-5 py-3 rounded-2xl shadow-2xl">
          <span className="text-sm font-medium">{checkedIds.size} 件選択中</span>
          <div className="w-px h-5 bg-gray-600" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">ステータス</span>
            <select
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
              className="text-sm bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">選択...</option>
              {settings.taskStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={applyBulkStatus}
              disabled={!bulkStatus}
              className="px-3 py-1 text-xs bg-indigo-600 rounded-lg hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              適用
            </button>
          </div>
          <div className="w-px h-5 bg-gray-600" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">担当者</span>
            <select
              value={bulkAssignee}
              onChange={e => setBulkAssignee(e.target.value)}
              className="text-sm bg-gray-800 border border-gray-600 rounded-lg px-2 py-1 text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">選択...</option>
              {settings.members.filter(m => m.employeeNumber !== 'admin').map(m => (
                <option key={m.id} value={m.employeeNumber}>{m.name}</option>
              ))}
            </select>
            <button
              onClick={applyBulkAssignee}
              disabled={!bulkAssignee}
              className="px-3 py-1 text-xs bg-indigo-600 rounded-lg hover:bg-indigo-500 disabled:opacity-40 transition-colors"
            >
              適用
            </button>
          </div>
          <div className="w-px h-5 bg-gray-600" />
          <button
            onClick={() => setCheckedIds(new Set())}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => { setSelectedTaskId(null); setOpenComments(false); }}
          initialMainTab={openComments ? 'comments' : 'phases'}
        />
      )}

      {/* Add Task Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-gray-300 animate-in fade-in zoom-in duration-200">

            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-300 flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900">
                {type === 'Requirement' ? '要件タスク' : '開発タスク'}を追加
              </h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">

              {/* Project */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  プロジェクト <span className="text-red-500">*</span>
                </label>
                <select
                  value={addProjectId}
                  onChange={e => {
                    setAddProjectId(Number(e.target.value));
                    setAddForm(f => ({ ...f, domainId: '' }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}（{p.code}）</option>
                  ))}
                </select>
              </div>

              {/* Task Name */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  タスク名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={addForm.name}
                  onChange={e => {
                    setAddForm(f => ({ ...f, name: e.target.value }));
                    setAddErrors(err => ({ ...err, name: undefined }));
                  }}
                  placeholder="タスク名を入力"
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    addErrors.name ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  }`}
                />
                {addErrors.name && (
                  <p className="text-xs text-red-500 mt-1">{addErrors.name}</p>
                )}
              </div>

              {/* Domain */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ドメイン <span className="text-red-500">*</span>
                </label>
                <select
                  value={addForm.domainId}
                  onChange={e => {
                    setAddForm(f => ({ ...f, domainId: e.target.value }));
                    setAddErrors(err => ({ ...err, domainId: undefined }));
                  }}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white ${
                    addErrors.domainId ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  }`}
                >
                  <option value="" disabled>選択してください</option>
                  {addSettings.domains.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {addErrors.domainId && (
                  <p className="text-xs text-red-500 mt-1">{addErrors.domainId}</p>
                )}
              </div>

              {/* Assignee */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  担当者 <span className="text-red-500">*</span>
                </label>
                <select
                  value={addForm.assignee}
                  onChange={e => {
                    setAddForm(f => ({ ...f, assignee: e.target.value }));
                    setAddErrors(err => ({ ...err, assignee: undefined }));
                  }}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white ${
                    addErrors.assignee ? 'border-red-400 bg-red-50' : 'border-gray-300'
                  }`}
                >
                  <option value="" disabled>選択してください</option>
                  {addSettings.members
                    .filter(m => m.employeeNumber !== 'admin')
                    .map(m => (
                      <option key={m.id} value={m.employeeNumber}>{m.name}</option>
                    ))}
                </select>
                {addErrors.assignee && (
                  <p className="text-xs text-red-500 mt-1">{addErrors.assignee}</p>
                )}
              </div>

              {/* チケットURL（任意） */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  チケットURL <span className="text-gray-400 font-normal">（任意）</span>
                </label>
                <input
                  type="url"
                  value={addForm.ticketUrl}
                  onChange={e => { setAddForm(f => ({ ...f, ticketUrl: e.target.value })); setAddErrors(err => ({ ...err, ticketUrl: undefined })); }}
                  placeholder="https://tracker.example.com/browse/PROJ-123"
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${addErrors.ticketUrl ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                />
                {addErrors.ticketUrl ? (
                  <p className="text-xs text-red-500 mt-1">{addErrors.ticketUrl}</p>
                ) : addForm.ticketUrl.trim() && (
                  extractTicketKey(addForm.ticketUrl) ? (
                    <p className="text-xs text-gray-500 mt-1">
                      チケットID: <span className="font-mono font-semibold text-indigo-600">{extractTicketKey(addForm.ticketUrl)}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 mt-1">URLからチケットIDを抽出できませんでした（URLはそのまま保存されます）</p>
                  )
                )}
              </div>


            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-300 flex justify-end gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleAddTask}
                className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
              >
                <Plus size={16} />
                追加
              </button>
            </div>
          </div>
        </div>
      )}
      {/* CSV Menu Modal */}
      {showCsvMenuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-gray-300 animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900">CSVインポート/エクスポート</h2>
              <button onClick={() => setShowCsvMenuModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 transition-colors">
                <X size={20} />
              </button>
            </div>
            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* タスク frame */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-indigo-50 px-4 py-2 border-b border-gray-200">
                  <span className="text-xs font-semibold text-indigo-700">タスク</span>
                </div>
                <div className="px-4 py-3 flex gap-2">
                  <button
                    className="flex-1 bg-white border border-indigo-300 text-indigo-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1.5"
                    onClick={() => { setShowCsvMenuModal(false); resetCsvImport(); setShowCsvModal(true); }}
                  >
                    <Upload size={15} />
                    CSVインポート
                  </button>
                  <button
                    className="flex-1 bg-white border border-indigo-300 text-indigo-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1.5"
                    onClick={() => { setShowCsvMenuModal(false); handleExportCsv(); }}
                  >
                    <Download size={15} />
                    CSVエクスポート
                  </button>
                </div>
              </div>
              {/* 工数 frame */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-indigo-50 px-4 py-2 border-b border-gray-200">
                  <span className="text-xs font-semibold text-indigo-700">工数</span>
                </div>
                <div className="px-4 py-3 flex gap-2">
                  <button
                    className="flex-1 bg-white border border-indigo-300 text-indigo-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1.5"
                    onClick={() => { setShowCsvMenuModal(false); setManHoursImportRows([]); setManHoursImported(false); setShowManHoursImportModal(true); }}
                  >
                    <Upload size={15} />
                    CSVインポート
                  </button>
                  <button
                    className="flex-1 bg-white border border-indigo-300 text-indigo-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1.5"
                    onClick={() => { setShowCsvMenuModal(false); handleExportManHoursCsv(); }}
                  >
                    <Download size={15} />
                    CSVエクスポート
                  </button>
                </div>
              </div>
              {/* コメント frame */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-indigo-50 px-4 py-2 border-b border-gray-200">
                  <span className="text-xs font-semibold text-indigo-700">コメント</span>
                </div>
                <div className="px-4 py-3">
                  <button
                    className="w-full bg-white border border-indigo-300 text-indigo-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1.5"
                    onClick={() => { setShowCsvMenuModal(false); handleExportCommentsCsv(); }}
                  >
                    <Download size={15} />
                    CSVエクスポート
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* 工数 CSV Import Modal */}
      {showManHoursImportModal && (() => {
        const validCount = manHoursImportRows.filter(r => r.errors.length === 0).length;
        const hasData = manHoursImportRows.length > 0;
        const plannedCount = manHoursImportRows.filter(r => r.kind === 'planned').length;
        const actualCount = manHoursImportRows.filter(r => r.kind === 'actual').length;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-gray-300 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-300 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-900">工数CSVインポート</h2>
                  {hasData && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                      予定 {plannedCount} / 実績 {actualCount}
                    </span>
                  )}
                </div>
                <button onClick={() => setShowManHoursImportModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 transition-colors">
                  <X size={20} />
                </button>
              </div>
              {/* Body */}
              <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1 min-h-0">
                {!hasData && (
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <p className="font-semibold text-gray-700 mb-1">対応フォーマット</p>
                    <p>・工数CSV（予定・実績が種別列で1ファイルに統合）: エクスポートしたCSVをそのまま取り込めます。</p>
                    <p className="text-gray-400">各行の「種別」（予定/実績）で取込先を判別します。チケットID・担当者名・予定行の担当者は取り込みません。</p>
                  </div>
                )}
                {/* Drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setManHoursDragOver(true); }}
                  onDragLeave={() => setManHoursDragOver(false)}
                  onDrop={e => { e.preventDefault(); setManHoursDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleManHoursCsvFile(f); }}
                  onClick={() => manHoursInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${manHoursDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'}`}
                >
                  <Upload size={22} className="mx-auto mb-2 text-gray-400" />
                  <p className="text-sm font-medium text-gray-600">{hasData ? '別のファイルを選択' : 'CSVファイルをドロップ、またはクリックして選択'}</p>
                  <p className="text-xs text-gray-400 mt-1">.csv ファイルのみ対応</p>
                  <input ref={manHoursInputRef} type="file" accept=".csv,text/csv" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleManHoursCsvFile(f); e.target.value = ''; }} />
                </div>
                {/* Preview table */}
                {hasData && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-indigo-50 text-indigo-700">
                          <th className="px-3 py-2 text-left border border-indigo-200">種別</th>
                          <th className="px-3 py-2 text-left border border-indigo-200">タスクID</th>
                          <th className="px-3 py-2 text-left border border-indigo-200">工程</th>
                          <th className="px-3 py-2 text-left border border-indigo-200">作業工程</th>
                          <th className="px-3 py-2 text-left border border-indigo-200">担当者</th>
                          <th className="px-3 py-2 text-left border border-indigo-200">日付</th>
                          <th className="px-3 py-2 text-left border border-indigo-200">予定工数</th>
                          <th className="px-3 py-2 text-left border border-indigo-200">実績工数</th>
                          <th className="px-3 py-2 text-left border border-indigo-200">作業内容</th>
                          <th className="px-3 py-2 text-left border border-indigo-200">状態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manHoursImportRows.map(row => {
                          const hhmm = (v?: number) => v === undefined ? '' : (() => { const h = Math.floor(v); const m = Math.round((v - h) * 60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; })();
                          return (
                          <tr key={row.rowIndex} className={row.errors.length > 0 ? 'bg-red-50' : 'bg-white hover:bg-gray-50'}>
                            <td className="px-3 py-1.5 border border-gray-200 whitespace-nowrap">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${row.kind === 'planned' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{row.kind === 'planned' ? '予定' : '実績'}</span>
                            </td>
                            <td className="px-3 py-1.5 border border-gray-200 font-mono">{row.taskId}</td>
                            <td className="px-3 py-1.5 border border-gray-200">{row.phaseCode}</td>
                            <td className="px-3 py-1.5 border border-gray-200">{row.wsCode}</td>
                            <td className="px-3 py-1.5 border border-gray-200">{row.kind === 'actual' ? `${row.empNo}${row.memberName ? `（${row.memberName}）` : ''}` : ''}</td>
                            <td className="px-3 py-1.5 border border-gray-200 font-mono whitespace-nowrap">{row.date ?? ''}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-right font-mono">{hhmm(row.plannedManHours)}</td>
                            <td className="px-3 py-1.5 border border-gray-200 text-right font-mono">{hhmm(row.actualManHours)}</td>
                            <td className="px-3 py-1.5 border border-gray-200 max-w-[200px] truncate" title={row.workContent}>{row.workContent ?? ''}</td>
                            <td className="px-3 py-1.5 border border-gray-200">
                              {row.errors.length > 0
                                ? <span className="text-red-600">{row.errors.join(' / ')}</span>
                                : <span className="text-green-600">OK</span>}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center shrink-0">
                <p className="text-sm text-gray-500">
                  {hasData && !manHoursImported && `${validCount} 件をインポートします`}
                  {manHoursImported && <span className="text-green-600 font-medium">インポートしました</span>}
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setShowManHoursImportModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                    閉じる
                  </button>
                  <button
                    onClick={handleManHoursCsvImport}
                    disabled={validCount === 0 || manHoursImported}
                    className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Upload size={15} />
                    インポート
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {/* CSV Import Modal */}
      {showCsvModal && (() => {
        const validCount =
          csvFormat === 'schedule'     ? csvScheduleTasks.filter(t => t.errors.length === 0).length :
          csvFormat === 'deliverables' ? csvDeliverableTasks.filter(t => t.errors.length === 0 && t.existingTask).length :
          csvRows.filter(r => r.errors.length === 0).length;

        const hasData =
          csvFormat === 'schedule'     ? csvScheduleTasks.length > 0 :
          csvFormat === 'deliverables' ? csvDeliverableTasks.length > 0 :
          csvRows.length > 0;

        const newCount    = csvFormat === 'schedule' ? csvScheduleTasks.filter(t => t.errors.length === 0 && !t.existingTask).length : 0;
        const updateCount = csvFormat === 'schedule' ? csvScheduleTasks.filter(t => t.errors.length === 0 && t.existingTask).length  : 0;

        const footerLabel =
          csvFormat === 'schedule'
            ? [newCount > 0 && `${newCount}件追加`, updateCount > 0 && `${updateCount}件更新`].filter(Boolean).join('、') + 'します'
            : csvFormat === 'deliverables'
            ? validCount > 0 ? `${validCount}件のタスクの成果物を更新します` : ''
            : validCount > 0 ? `${validCount}件のタスクを追加します` : '';

        const formatLabel =
          csvFormat === 'schedule'     ? { text: 'タスクCSV', color: 'bg-blue-100 text-blue-700' } :
          csvFormat === 'deliverables' ? { text: '成果物CSV', color: 'bg-emerald-100 text-emerald-700' } :
          null;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-gray-300 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">

              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-300 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-900">CSVインポート</h2>
                  {formatLabel && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${formatLabel.color}`}>
                      {formatLabel.text}
                    </span>
                  )}
                </div>
                <button onClick={closeCsvModal} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 transition-colors">
                  <X size={20} />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1 min-h-0">

                {/* Format hint + sample DL */}
                {!hasData && (
                  <div className="flex items-start justify-between gap-4">
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p className="font-semibold text-gray-700 mb-1">対応フォーマット</p>
                      <p>・シンプル形式: <span className="font-mono bg-gray-100 px-1 rounded">タスク名, ドメイン, 担当者</span></p>
                      <p>・タスクCSV / 成果物CSV: エクスポートしたCSVをそのまま取り込めます。</p>
                      <p className="text-gray-400">フォーマットはヘッダー行から自動判別されます。</p>
                    </div>
                    <button onClick={handleDownloadSample} className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-400 px-3 py-1.5 rounded-lg transition-colors">
                      <Download size={13} />
                      サンプルDL
                    </button>
                  </div>
                )}

                {/* Drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setCsvDragOver(true); }}
                  onDragLeave={() => setCsvDragOver(false)}
                  onDrop={e => { e.preventDefault(); setCsvDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleCsvFile(f); }}
                  onClick={() => csvInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${csvDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'}`}
                >
                  <Upload size={22} className="mx-auto mb-2 text-gray-400" />
                  <p className="text-sm font-medium text-gray-600">{hasData ? '別のファイルを選択' : 'CSVファイルをドロップ、またはクリックして選択'}</p>
                  <p className="text-xs text-gray-400 mt-1">.csv ファイルのみ対応</p>
                  <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ''; }} />
                </div>

                {/* ── シンプル形式プレビュー ─────────────────────────── */}
                {csvFormat === 'simple' && csvRows.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-700">プレビュー ({csvRows.filter(r => r.errors.length === 0).length} / {csvRows.length} 行が有効)</p>
                      {csvImported && <span className="flex items-center gap-1 text-xs font-semibold text-green-600"><CheckCircle size={13} />インポート完了</span>}
                    </div>
                    <div className="border border-gray-300 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead><tr className="bg-gray-50 border-b border-gray-300">
                          <th className="px-3 py-2 text-left font-semibold text-gray-600 w-10">行</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">タスク名</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600 w-28">ドメイン</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600 w-28">担当者</th>
                          <th className="px-3 py-2 w-8"></th>
                        </tr></thead>
                        <tbody className="divide-y divide-gray-100">
                          {csvRows.map(row => (
                            <tr key={row.rowIndex} className={row.errors.length > 0 ? 'bg-red-50' : 'bg-white'}>
                              <td className="px-3 py-2 text-gray-400 font-mono">{row.rowIndex}</td>
                              <td className="px-3 py-2 text-gray-900">{row.name || <span className="text-gray-300">—</span>}</td>
                              <td className="px-3 py-2 text-gray-700">{row.domainName || <span className="text-gray-300">—</span>}</td>
                              <td className="px-3 py-2 text-gray-700">{row.assigneeName || <span className="text-gray-300">—</span>}</td>
                              <td className="px-3 py-2">{row.errors.length > 0 ? <ErrIcon errors={row.errors} /> : <CheckCircle size={14} className="text-green-500" />}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {csvRows.some(r => r.errors.length > 0) && <p className="text-xs text-red-500">エラー行はスキップされます。アイコンにカーソルを合わせると詳細が確認できます。</p>}
                  </div>
                )}

                {/* ── タスクCSV (スケジュール) プレビュー ──────────────── */}
                {csvFormat === 'schedule' && csvScheduleTasks.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-700">プレビュー ({validCount} / {csvScheduleTasks.length} 件が有効)</p>
                      {csvImported && <span className="flex items-center gap-1 text-xs font-semibold text-green-600"><CheckCircle size={13} />インポート完了</span>}
                    </div>
                    <div className="border border-gray-300 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead><tr className="bg-gray-50 border-b border-gray-300">
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">タスクID</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">タスク名</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600 w-24">ドメイン</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600 w-20">担当者</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600 w-20">操作</th>
                          <th className="px-3 py-2 w-8"></th>
                        </tr></thead>
                        <tbody className="divide-y divide-gray-100">
                          {csvScheduleTasks.map(t => (
                            <tr key={t.taskId} className={t.errors.length > 0 ? 'bg-red-50' : 'bg-white'}>
                              <td className="px-3 py-2 font-mono text-gray-500">{t.taskId}</td>
                              <td className="px-3 py-2 text-gray-900">{t.name}</td>
                              <td className="px-3 py-2 text-gray-700">{t.domainName}</td>
                              <td className="px-3 py-2 text-gray-700">{t.assignee}</td>
                              <td className="px-3 py-2">
                                {t.errors.length === 0 && (
                                  t.existingTask
                                    ? <span className="text-blue-600 font-semibold">更新</span>
                                    : <span className="text-green-600 font-semibold">新規追加</span>
                                )}
                              </td>
                              <td className="px-3 py-2">{t.errors.length > 0 ? <ErrIcon errors={t.errors} /> : <CheckCircle size={14} className="text-green-500" />}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {csvScheduleTasks.some(t => t.errors.length > 0) && <p className="text-xs text-red-500">エラー行はスキップされます。</p>}
                  </div>
                )}

                {/* ── 成果物CSV プレビュー ──────────────────────────── */}
                {csvFormat === 'deliverables' && csvDeliverableTasks.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-700">プレビュー ({validCount} / {csvDeliverableTasks.length} 件が有効)</p>
                      {csvImported && <span className="flex items-center gap-1 text-xs font-semibold text-green-600"><CheckCircle size={13} />インポート完了</span>}
                    </div>
                    <div className="border border-gray-300 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead><tr className="bg-gray-50 border-b border-gray-300">
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">タスクID</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">タスク名</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600 w-16">成果物数</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600 w-24">操作</th>
                          <th className="px-3 py-2 w-8"></th>
                        </tr></thead>
                        <tbody className="divide-y divide-gray-100">
                          {csvDeliverableTasks.map(t => (
                            <tr key={t.taskId} className={t.errors.length > 0 ? 'bg-red-50' : 'bg-white'}>
                              <td className="px-3 py-2 font-mono text-gray-500">{t.taskId}</td>
                              <td className="px-3 py-2 text-gray-900">{t.name}</td>
                              <td className="px-3 py-2 text-center text-gray-600">
                                {Object.values(t.deliverablesByPhase).reduce((s, a) => s + a.length, 0)}
                              </td>
                              <td className="px-3 py-2">
                                {t.errors.length === 0 && t.existingTask && <span className="text-blue-600 font-semibold">成果物更新</span>}
                              </td>
                              <td className="px-3 py-2">{t.errors.length > 0 ? <ErrIcon errors={t.errors} /> : <CheckCircle size={14} className="text-green-500" />}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {csvDeliverableTasks.some(t => t.errors.length > 0) && <p className="text-xs text-red-500">エラー行はスキップされます。タスクIDが一致する既存タスクのみ更新されます。</p>}
                  </div>
                )}

              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-300 flex justify-between items-center shrink-0">
                <p className="text-xs text-gray-400">{footerLabel}</p>
                <div className="flex gap-3">
                  <button onClick={closeCsvModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                    {csvImported ? '閉じる' : 'キャンセル'}
                  </button>
                  <button
                    onClick={handleCsvImport}
                    disabled={validCount === 0 || csvImported}
                    className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Upload size={15} />
                    インポート
                  </button>
                </div>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
};
