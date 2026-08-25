import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useProject } from '@/context/ProjectContext';
import { Task, WorkStepSchedule, TaskPriority } from '@/types';
import { INDIRECT_PHASE_CODE, PRIORITY_OPTIONS, PRIORITY_LABEL, PRIORITY_BADGE, PRIORITY_ORDER, statusBadgeClass, isClosedStatus, NOT_STARTED_STATUS } from '@/lib/constants';
import { Plus, X, ChevronDown, FileDown, Upload, Download, CheckCircle, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { IndirectTaskDetailModal, getIndirectSchedule, sumActualHours, formatHHMM, parseHHMM } from './IndirectTaskDetailModal';
import { tagBadge } from './shared/tags';

type SortKey = 'taskId' | 'project' | 'domain' | 'name' | 'assignee' | 'priority' | 'status' | 'planned' | 'actual' | 'alert';
type SortDir = 'asc' | 'desc';

const SortIcon: React.FC<{ col: SortKey; sortKey: SortKey; dir: SortDir }> = ({ col, sortKey, dir }) => {
  if (sortKey !== col) return <ArrowUpDown size={13} className="text-amber-400 opacity-0 group-hover:opacity-60 ml-1 inline-block" />;
  return dir === 'asc'
    ? <ArrowUp size={13} className="text-amber-600 ml-1 inline-block" />
    : <ArrowDown size={13} className="text-amber-600 ml-1 inline-block" />;
};

interface AddForm { name: string; domainId: string; assignee: string; }

const emptyPhases = () => ({ [INDIRECT_PHASE_CODE]: { currentWorkStepCode: INDIRECT_PHASE_CODE, schedule: {} } }) as Task['phases'];

const CSV_LINE_RE = /\r?\n/;
const CSV_HEADERS = ['タスクID', 'チケットID', 'ドメイン', 'タスク名', '担当者', '担当者名', 'ステータス', '優先度', '開始予定日', '完了予定日', '開始日(実績)', '完了日(実績)', '予定工数', '実績工数(合計)', '状況詳細'];
const LOG_HEADERS = ['記録日付', '作業内容', '工数'];
/** CSV取り込み時の優先度ラベル→コード変換（高/中/低 と HIGH/MEDIUM/LOW を許容） */
const LABEL_TO_PRIORITY: Record<string, TaskPriority> = {
  '高': 'HIGH', '中': 'MEDIUM', '低': 'LOW', 'HIGH': 'HIGH', 'MEDIUM': 'MEDIUM', 'LOW': 'LOW',
};

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

const toCsvRow = (cells: (string | number | null | undefined)[]) =>
  cells.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');

const downloadCsv = (content: string, filename: string) => {
  const blob = new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

const csvTimestamp = () => {
  const n = new Date();
  return n.getFullYear().toString()
    + String(n.getMonth() + 1).padStart(2, '0') + String(n.getDate()).padStart(2, '0')
    + String(n.getHours()).padStart(2, '0') + String(n.getMinutes()).padStart(2, '0') + String(n.getSeconds()).padStart(2, '0');
};

const normDate = (s: string) => s.replace(/\//g, '-');
const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

interface CsvRow {
  rowIndex: number;
  taskId: string;
  domainName: string;
  domainId: string | null;
  name: string;
  assignee: string;
  status: string;
  priority: '' | TaskPriority;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate: string;
  actualEndDate: string;
  plannedManHours?: number;
  statusDetail: string;
  existing: Task | null;
  errors: string[];
}

export const IndirectTaskListPage: React.FC = () => {
  const { tasks, settings, projects, getSettings, addTask, updateTask, currentUser } = useProject();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = selectedTaskId ? tasks.find(t => t.id === selectedTaskId) ?? null : null;

  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const domainNameById = useMemo(() => new Map(settings.domains.map(d => [d.id, d.name])), [settings.domains]);
  const memberNameByEmpNo = useMemo(() => new Map(settings.members.map(m => [m.employeeNumber, m.name])), [settings.members]);
  const getAssigneeName = (e: string) => memberNameByEmpNo.get(e) ?? e;

  // アラート（遅延）: 完了予定日を過ぎても未完了（要件/開発タスク一覧と同様の仕様）
  const todayStr = new Date().toISOString().split('T')[0];
  const getAlertState = (t: Task): boolean => {
    if (isClosedStatus(t.status)) return false;
    const pe = getIndirectSchedule(t).plannedEndDate;
    return !!pe && pe < todayStr;
  };

  // 工程外タスクのテーマ色（要件=teal / 開発=indigo と区別して amber）
  const theme = {
    accent: 'text-amber-600',
    tableBorder: 'border-amber-200',
    theadBg: 'bg-amber-50 border-amber-200 text-amber-800',
  };

  const [filterOpen, setFilterOpen] = useState(true);
  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterDomainId, setFilterDomainId] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterAlertOnly, setFilterAlertOnly] = useState(false);

  const indirectTasks = useMemo(() => tasks.filter(t => t.type === 'Indirect'), [tasks]);

  const filtered = useMemo(() => indirectTasks.filter(t => {
    if (filterProjectId && String(t.projectId) !== filterProjectId) return false;
    if (filterDomainId && t.domainId !== filterDomainId) return false;
    if (filterAssignee && t.assignee !== filterAssignee) return false;
    if (filterStatus && t.status !== filterStatus) return false;
    if (filterPriority && (t.priority ?? '') !== (filterPriority === 'NONE' ? '' : filterPriority)) return false;
    if (filterTag && !(t.tags ?? []).includes(filterTag)) return false;
    if (filterAlertOnly && !getAlertState(t)) return false;
    if (filterKeyword) {
      const kw = filterKeyword.toLowerCase();
      if (!t.name.toLowerCase().includes(kw) && !(t.taskId ?? '').toLowerCase().includes(kw)) return false;
    }
    return true;
  }), [indirectTasks, filterProjectId, filterDomainId, filterAssignee, filterStatus, filterPriority, filterTag, filterKeyword, filterAlertOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTags = useMemo(() => {
    const set = new Set<string>(settings.tags ?? []);
    indirectTasks.forEach(t => (t.tags ?? []).forEach(tag => set.add(tag)));
    return Array.from(set);
  }, [settings.tags, indirectTasks]);

  const [sortConfig, setSortConfig] = useState<{ key: SortKey; dir: SortDir }>({ key: 'taskId', dir: 'asc' });
  const handleSort = (key: SortKey) => setSortConfig(c => ({ key, dir: c.key === key && c.dir === 'asc' ? 'desc' : 'asc' }));

  const sorted = useMemo(() => {
    const val = (t: Task): string | number => {
      switch (sortConfig.key) {
        case 'taskId': return t.taskId ?? '';
        case 'project': return projectNameById.get(t.projectId) ?? '';
        case 'domain': return domainNameById.get(t.domainId) ?? '';
        case 'name': return t.name;
        case 'assignee': return getAssigneeName(t.assignee);
        case 'priority': return PRIORITY_ORDER[t.priority ?? ''] ?? 3;
        case 'status': { const i = settings.taskStatuses.indexOf(t.status); return i < 0 ? 999 : i; }
        case 'planned': return getIndirectSchedule(t).plannedManHours ?? 0;
        case 'actual': return sumActualHours(getIndirectSchedule(t));
        case 'alert': return getAlertState(t) ? 1 : 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortConfig, projectNameById, domainNameById, memberNameByEmpNo, settings.taskStatuses]);

  const isFilterActive = !!(filterProjectId || filterKeyword || filterDomainId || filterAssignee || filterStatus || filterPriority || filterTag || filterAlertOnly);
  const clearFilters = () => { setFilterProjectId(''); setFilterKeyword(''); setFilterDomainId(''); setFilterAssignee(''); setFilterStatus(''); setFilterPriority(''); setFilterTag(''); setFilterAlertOnly(false); };

  const [showAdd, setShowAdd] = useState(false);
  const [addProjectId, setAddProjectId] = useState<number>(projects[0]?.id ?? 0);
  const [addForm, setAddForm] = useState<AddForm>({ name: '', domainId: '', assignee: '' });
  const [addErrors, setAddErrors] = useState<Partial<AddForm>>({});
  const addSettings = useMemo(() => getSettings(addProjectId), [getSettings, addProjectId]);

  const openAdd = () => {
    setAddProjectId(filterProjectId ? Number(filterProjectId) : (projects[0]?.id ?? 0));
    setAddForm({ name: '', domainId: '', assignee: currentUser && currentUser.employeeNumber !== 'admin' ? currentUser.employeeNumber : '' });
    setAddErrors({});
    setShowAdd(true);
  };

  const submitAdd = useCallback(() => {
    const errors: Partial<AddForm> = {};
    if (!addForm.name.trim()) errors.name = 'タスク名は必須です';
    if (!addForm.domainId) errors.domainId = 'ドメインを選択してください';
    if (!addForm.assignee) errors.assignee = '担当者を選択してください';
    if (!addProjectId) errors.name = 'プロジェクトを選択してください';
    if (Object.keys(errors).length > 0) { setAddErrors(errors); return; }
    addTask(addProjectId, {
      type: 'Indirect',
      status: NOT_STARTED_STATUS,
      domainId: addForm.domainId,
      name: addForm.name.trim(),
      assignee: addForm.assignee,
      phases: emptyPhases(),
    });
    setShowAdd(false);
  }, [addForm, addProjectId, addTask]);

  const [showCsvMenu, setShowCsvMenu] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importProjectId, setImportProjectId] = useState<number>(projects[0]?.id ?? 0);
  const [importRaw, setImportRaw] = useState<string[][] | null>(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback((includeLog: boolean) => {
    const headers = includeLog ? [...CSV_HEADERS, ...LOG_HEADERS] : CSV_HEADERS;
    const rows: string[] = [toCsvRow(headers)];
    for (const t of filtered) {
      const s = getIndirectSchedule(t);
      const actual = sumActualHours(s);
      const base = [
        t.taskId ?? '', t.ticketKey ?? '', domainNameById.get(t.domainId) ?? '', t.name,
        t.assignee ?? '', getAssigneeName(t.assignee ?? ''), t.status,
        t.priority ? PRIORITY_LABEL[t.priority] : '',
        s.plannedStartDate ?? '', s.plannedEndDate ?? '', s.actualStartDate ?? '', s.actualEndDate ?? '',
        s.plannedManHours && s.plannedManHours > 0 ? formatHHMM(s.plannedManHours) : '',
        actual > 0 ? formatHHMM(actual) : '',
        s.statusDetail ?? '',
      ];
      if (!includeLog) {
        rows.push(toCsvRow(base));
      } else {
        const log = s.actualLog ?? [];
        if (log.length === 0) {
          rows.push(toCsvRow([...base, '', '', '']));
        } else {
          for (const e of log) rows.push(toCsvRow([...base, e.date, e.content, formatHHMM(e.hours)]));
        }
      }
    }
    const suffix = includeLog ? '_実績作業記録付き' : '';
    downloadCsv(rows.join('\r\n'), `Reflect_工程外タスク${suffix}_${csvTimestamp()}.csv`);
  }, [filtered, domainNameById, memberNameByEmpNo]);

  const openImport = () => {
    setImportProjectId(filterProjectId ? Number(filterProjectId) : (projects[0]?.id ?? 0));
    setImportRaw(null);
    setImportDone(false);
    setShowImport(true);
  };

  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target?.result as string).replace(/^\uFEFF/, '');
      const lines = text.split(CSV_LINE_RE).filter(l => l.trim());
      if (lines.length === 0) { setImportRaw([]); return; }
      const first = parseCsvLine(lines[0]);
      const isHeader = first.includes('タスク名') || first[0] === 'タスクID';
      setImportRaw((isHeader ? lines.slice(1) : lines).map(l => parseCsvLine(l)));
      setImportDone(false);
    };
    reader.readAsText(file);
  }, []);

  const importRows = useMemo<CsvRow[]>(() => {
    if (!importRaw) return [];
    const s = getSettings(importProjectId);
    const empNoSet = new Set(s.members.filter(m => m.employeeNumber !== 'admin').map(m => m.employeeNumber));
    const domainByName = new Map(s.domains.map(d => [d.name, d.id]));
    const existingByTaskId = new Map(
      tasks.filter(t => t.type === 'Indirect' && t.projectId === importProjectId).map(t => [t.taskId, t])
    );
    // 列: タスクID, チケットID, ドメイン, タスク名, 担当者, 担当者名, ステータス, 優先度,
    //     開始予定日, 完了予定日, 開始日(実績), 完了日(実績), 予定工数, 実績工数(合計), 状況詳細
    // ※ チケットID・担当者名は出力専用（取込時は無視）。
    return importRaw.map((c, idx) => {
      const taskId = c[0] ?? '';
      const domainName = c[2] ?? '';
      const name = c[3] ?? '';
      const assignee = c[4] ?? '';
      const status = c[6] ?? '';
      const prioRaw = c[7] ?? '';
      const errors: string[] = [];
      if (!name) errors.push('タスク名が空です');
      const domainId = domainName ? (domainByName.get(domainName) ?? null) : null;
      if (!domainName) errors.push('ドメインが空です');
      else if (!domainId) errors.push(`ドメイン「${domainName}」が見つかりません`);
      if (!assignee) errors.push('担当者が空です');
      else if (!empNoSet.has(assignee)) errors.push(`担当者「${assignee}」が見つかりません`);
      let priority: '' | TaskPriority = '';
      if (prioRaw) {
        const mapped = LABEL_TO_PRIORITY[prioRaw.trim()];
        if (mapped) priority = mapped;
        else errors.push(`優先度「${prioRaw}」は高/中/低のいずれかにしてください`);
      }
      const dates: Record<string, string> = {};
      ([['plannedStartDate', c[8]], ['plannedEndDate', c[9]], ['actualStartDate', c[10]], ['actualEndDate', c[11]]] as [string, string][]).forEach(([k, raw]) => {
        const v = (raw ?? '').trim();
        if (!v) { dates[k] = ''; return; }
        const nv = normDate(v);
        if (isValidDate(nv)) dates[k] = nv;
        else { errors.push(`${k}「${v}」はYYYY-MM-DD形式ではありません`); dates[k] = ''; }
      });
      let plannedManHours: number | undefined;
      const phRaw = (c[12] ?? '').trim();
      if (phRaw) {
        // HH:MM 優先、数値（小数時間）も許容
        const parsed = phRaw.includes(':') ? parseHHMM(phRaw) : (isNaN(Number(phRaw)) ? undefined : Number(phRaw));
        if (parsed !== undefined) plannedManHours = parsed;
        else errors.push(`予定工数「${phRaw}」はhh:mm形式ではありません`);
      }
      const statusDetail = c[14] ?? '';
      const existing = taskId ? (existingByTaskId.get(taskId) ?? null) : null;
      if (taskId && !existing) errors.push(`タスクID「${taskId}」に一致するタスクがありません（新規はID空欄で追加します）`);
      return {
        rowIndex: idx + 1, taskId, domainName, domainId, name, assignee, status: status || NOT_STARTED_STATUS, priority,
        plannedStartDate: dates.plannedStartDate, plannedEndDate: dates.plannedEndDate,
        actualStartDate: dates.actualStartDate, actualEndDate: dates.actualEndDate,
        plannedManHours, statusDetail, existing, errors,
      };
    });
  }, [importRaw, importProjectId, getSettings, tasks]);

  const runImport = useCallback(async () => {
    const valid = importRows.filter(r => r.errors.length === 0);
    if (valid.length === 0) return;
    setImporting(true);
    try {
      for (const r of valid) {
        const base: WorkStepSchedule = r.existing ? getIndirectSchedule(r.existing) : { workStepCode: INDIRECT_PHASE_CODE };
        const sch: WorkStepSchedule = {
          ...base,
          workStepCode: INDIRECT_PHASE_CODE,
          plannedStartDate: r.plannedStartDate || undefined,
          plannedEndDate: r.plannedEndDate || undefined,
          actualStartDate: r.actualStartDate || undefined,
          actualEndDate: r.actualEndDate || undefined,
          plannedManHours: r.plannedManHours,
          statusDetail: r.statusDetail || undefined,
        };
        sch.actualManHours = sumActualHours(sch); // 既存の実績作業記録は保持
        const phases = { [INDIRECT_PHASE_CODE]: { currentWorkStepCode: INDIRECT_PHASE_CODE, schedule: { [INDIRECT_PHASE_CODE]: sch } } } as unknown as Task['phases'];
        if (r.existing) {
          await updateTask({ ...r.existing, domainId: r.domainId!, name: r.name, assignee: r.assignee, status: r.status, priority: r.priority || null, phases });
        } else {
          await addTask(importProjectId, { type: 'Indirect', status: r.status, priority: r.priority || null, domainId: r.domainId!, name: r.name, assignee: r.assignee, phases });
        }
      }
      setImportDone(true);
    } finally {
      setImporting(false);
    }
  }, [importRows, importProjectId, addTask, updateTask]);

  const importValidCount = importRows.filter(r => r.errors.length === 0).length;
  const importNewCount = importRows.filter(r => r.errors.length === 0 && !r.existing).length;
  const importUpdateCount = importRows.filter(r => r.errors.length === 0 && r.existing).length;

  return (
    <div className="h-full flex flex-col gap-3">
      {/* アクション行 */}
      <div className="flex justify-between items-center gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-baseline gap-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
            <span className={`text-xl font-bold ${theme.accent}`}>{filtered.length}</span>
            <span className="text-xs text-gray-500">件</span>
            {isFilterActive && <span className="text-xs text-gray-400 ml-1">/ {indirectTasks.length}</span>}
          </div>
          {isFilterActive && (
            <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
              絞込中
            </span>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={openAdd} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1.5">
            <Plus size={16} /> 追加
          </button>
          <button onClick={() => setShowCsvMenu(true)} className="bg-white border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-1.5">
            <FileDown size={16} /> CSV
          </button>
        </div>
      </div>

      {/* フィルタパネル（開発タスク一覧と同じ構成） */}
      <div className="bg-white rounded-xl border border-gray-300 shadow-sm shrink-0">
        <button onClick={() => setFilterOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">絞り込み</span>
            {isFilterActive && (
              <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">適用中</span>
            )}
          </span>
          <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${filterOpen ? 'rotate-180' : ''}`} />
        </button>
        <div className={`grid transition-all duration-200 ease-in-out ${filterOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="px-4 pb-4 pt-1 flex flex-wrap gap-3 items-end border-t border-gray-100">
              {/* プロジェクト */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">プロジェクト</label>
                <select value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">すべて</option>
                  {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select>
              </div>
              {/* キーワード */}
              <div className="min-w-[180px] flex-1">
                <label className="block text-xs font-semibold text-gray-600 mb-1">キーワード</label>
                <input type="text" value={filterKeyword} onChange={e => setFilterKeyword(e.target.value)} placeholder="タスク名・タスクID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {/* ドメイン */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">ドメイン</label>
                <select value={filterDomainId} onChange={e => setFilterDomainId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">すべて</option>
                  {settings.domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              {/* 担当者 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">担当者</label>
                <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">すべて</option>
                  {settings.members.filter(m => m.employeeNumber !== 'admin').map(m => <option key={m.id} value={m.employeeNumber}>{m.name}</option>)}
                </select>
              </div>
              {/* ステータス */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">ステータス</label>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">すべて</option>
                  {settings.taskStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {/* 優先度 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">優先度</label>
                <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">すべて</option>
                  {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  <option value="NONE">未設定</option>
                </select>
              </div>
              {/* タグ */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">タグ</label>
                <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">すべて</option>
                  {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {/* アラートのみ */}
              <div className="flex items-center gap-2 pb-[9px]">
                <input
                  type="checkbox"
                  id="indirectFilterAlertOnly"
                  checked={filterAlertOnly}
                  onChange={e => setFilterAlertOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
                <label htmlFor="indirectFilterAlertOnly" className="text-sm text-gray-700 cursor-pointer whitespace-nowrap select-none">
                  アラートのみ
                </label>
              </div>
              {/* クリア */}
              {isFilterActive && (
                <button onClick={clearFilters} className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-600 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors">
                  <X size={14} /> クリア
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 一覧 */}
      <div className={`flex-1 min-h-0 bg-white border-2 ${theme.tableBorder} rounded-lg shadow-sm overflow-hidden`}>
        <div className="overflow-auto h-full">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className={`${theme.theadBg} border-b-2 text-xs font-semibold uppercase tracking-wider`}>
                <th className="px-4 py-3 cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('taskId')}>タスクID <SortIcon col="taskId" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('project')}>プロジェクト <SortIcon col="project" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('domain')}>ドメイン <SortIcon col="domain" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('name')}>タスク名 <SortIcon col="name" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('assignee')}>担当者 <SortIcon col="assignee" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('priority')}>優先度 <SortIcon col="priority" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('status')}>ステータス <SortIcon col="status" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 text-right cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('planned')}>予定工数 <SortIcon col="planned" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 text-right cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('actual')}>実績工数 <SortIcon col="actual" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3">状況詳細</th>
                <th className="px-4 py-3 cursor-pointer hover:bg-amber-100 group select-none" onClick={() => handleSort('alert')}>アラート <SortIcon col="alert" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sorted.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">工程外タスクがありません</td></tr>
              ) : sorted.map(t => {
                const sch = getIndirectSchedule(t);
                const actual = sumActualHours(sch);
                const hasAlert = getAlertState(t);
                return (
                  <tr key={t.id} className={`cursor-pointer ${hasAlert ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`} onClick={() => setSelectedTaskId(t.id)}>
                    <td className="px-4 py-3 text-sm font-mono text-gray-500 whitespace-nowrap">{t.taskId}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{projectNameById.get(t.projectId) ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{domainNameById.get(t.domainId) ?? '—'}</td>
                    <td className="px-4 py-3 text-sm font-bold text-gray-900">
                      {t.name}
                      {(t.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {t.tags!.map(tag => <span key={tag} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${tagBadge(tag)}`}>{tag}</span>)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{getAssigneeName(t.assignee)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {t.priority
                        ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_BADGE[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap"><span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(t.status)}`}>{t.status}</span></td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-700">{formatHHMM(sch.plannedManHours)}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-700">{formatHHMM(actual)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-[240px]">{sch.statusDetail ? <span className="block truncate" title={sch.statusDetail}>{sch.statusDetail}</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {hasAlert && (
                        <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                          <AlertCircle size={14} /><span>遅延</span>
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

      {/* 追加モーダル */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-gray-300">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900">工程外タスクを追加</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"><X size={20} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">プロジェクト <span className="text-red-500">*</span></label>
                <select value={addProjectId} onChange={e => { setAddProjectId(Number(e.target.value)); setAddForm(f => ({ ...f, domainId: '' })); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.code}）</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">タスク名 <span className="text-red-500">*</span></label>
                <input autoFocus value={addForm.name} onChange={e => { setAddForm(f => ({ ...f, name: e.target.value })); setAddErrors(er => ({ ...er, name: undefined })); }}
                  placeholder="例：定例会議、日報記載"
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${addErrors.name ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
                {addErrors.name && <p className="text-xs text-red-500 mt-1">{addErrors.name}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">ドメイン <span className="text-red-500">*</span></label>
                <select value={addForm.domainId} onChange={e => { setAddForm(f => ({ ...f, domainId: e.target.value })); setAddErrors(er => ({ ...er, domainId: undefined })); }}
                  className={`w-full px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 ${addErrors.domainId ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}>
                  <option value="" disabled>選択してください</option>
                  {addSettings.domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {addErrors.domainId && <p className="text-xs text-red-500 mt-1">{addErrors.domainId}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">担当者 <span className="text-red-500">*</span></label>
                <select value={addForm.assignee} onChange={e => { setAddForm(f => ({ ...f, assignee: e.target.value })); setAddErrors(er => ({ ...er, assignee: undefined })); }}
                  className={`w-full px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 ${addErrors.assignee ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}>
                  <option value="" disabled>選択してください</option>
                  {addSettings.members.filter(m => m.employeeNumber !== 'admin').map(m => <option key={m.id} value={m.employeeNumber}>{m.name}</option>)}
                </select>
                {addErrors.assignee && <p className="text-xs text-red-500 mt-1">{addErrors.assignee}</p>}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">キャンセル</button>
              <button onClick={submitAdd} className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 flex items-center gap-1.5"><Plus size={16} /> 追加</button>
            </div>
          </div>
        </div>
      )}

      {/* CSV メニューモーダル */}
      {showCsvMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-gray-300">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900">CSVインポート/エクスポート</h2>
              <button onClick={() => setShowCsvMenu(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100 transition-colors"><X size={20} /></button>
            </div>
            <div className="px-6 py-5">
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-amber-50 px-4 py-2 border-b border-gray-200">
                  <span className="text-xs font-semibold text-amber-700">工程外タスク</span>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1">インポート</p>
                    <button className="w-full bg-white border border-amber-300 text-amber-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-amber-50 transition-colors flex items-center justify-center gap-1.5"
                      onClick={() => { setShowCsvMenu(false); openImport(); }}>
                      <Upload size={15} /> CSVインポート
                    </button>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1">エクスポート</p>
                    <div className="space-y-2">
                      <button className="w-full bg-white border border-amber-300 text-amber-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-amber-50 transition-colors flex items-center justify-center gap-1.5"
                        onClick={() => { setShowCsvMenu(false); handleExport(false); }}>
                        <Download size={15} /> CSVエクスポート
                      </button>
                      <button className="w-full bg-white border border-amber-300 text-amber-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-amber-50 transition-colors flex items-center justify-center gap-1.5"
                        onClick={() => { setShowCsvMenu(false); handleExport(true); }}>
                        <Download size={15} /> CSVエクスポート(作業実績記録を含む)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSV インポートモーダル */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-gray-300 flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-300 flex justify-between items-center shrink-0">
              <h2 className="text-base font-bold text-gray-900">CSVインポート</h2>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"><X size={20} /></button>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">インポート先プロジェクト</label>
                  <select value={importProjectId} onChange={e => setImportProjectId(Number(e.target.value))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.code}）</option>)}
                  </select>
                </div>
                <div className="text-xs text-gray-500 flex-1 min-w-[12rem]">
                  <p className="font-semibold text-gray-700 mb-0.5">列順</p>
                  <p className="font-mono bg-gray-100 px-1 rounded inline-block">タスクID, チケットID, ドメイン, タスク名, 担当者, 担当者名, ステータス, 優先度, 開始予定日, 完了予定日, 開始日(実績), 完了日(実績), 予定工数, 実績工数(合計), 状況詳細</p>
                  <p className="text-gray-400 mt-0.5">タスクIDが既存と一致すれば更新（実績作業記録は保持）、空または未一致なら新規追加。「チケットID」「担当者名」「実績工数(合計)」は参照用で取り込みません。</p>
                </div>
              </div>

              <div
                onDragOver={e => { e.preventDefault(); setImportDragOver(true); }}
                onDragLeave={() => setImportDragOver(false)}
                onDrop={e => { e.preventDefault(); setImportDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleImportFile(f); }}
                onClick={() => importInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${importDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300 hover:bg-gray-50'}`}
              >
                <Upload size={22} className="mx-auto mb-2 text-gray-400" />
                <p className="text-sm font-medium text-gray-600">{importRaw ? '別のファイルを選択' : 'CSVファイルをドロップ、またはクリックして選択'}</p>
                <p className="text-xs text-gray-400 mt-1">.csv ファイルのみ対応</p>
                <input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />
              </div>

              {importRaw && importRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-700">プレビュー（{importValidCount} / {importRows.length} 行が有効）</p>
                    {importDone && <span className="flex items-center gap-1 text-xs font-semibold text-green-600"><CheckCircle size={13} />インポート完了</span>}
                  </div>
                  <div className="border border-gray-300 rounded-lg overflow-auto max-h-72">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0"><tr className="bg-gray-50 border-b border-gray-300">
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 w-10">行</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 w-16">区分</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 w-24">ドメイン</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600">タスク名</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 w-24">担当者</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 w-14">優先度</th>
                        <th className="px-2 py-2 w-8"></th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {importRows.map(r => (
                          <tr key={r.rowIndex} className={r.errors.length > 0 ? 'bg-red-50' : 'bg-white'}>
                            <td className="px-2 py-1.5 text-gray-400 font-mono">{r.rowIndex}</td>
                            <td className="px-2 py-1.5">
                              {r.errors.length > 0
                                ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">スキップ</span>
                                : <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${r.existing ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{r.existing ? '更新' : '新規'}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-gray-700">{r.domainName || <span className="text-gray-300">—</span>}</td>
                            <td className="px-2 py-1.5 text-gray-900">{r.name || <span className="text-gray-300">—</span>}</td>
                            <td className="px-2 py-1.5 text-gray-700">{getAssigneeName(r.assignee) || <span className="text-gray-300">—</span>}</td>
                            <td className="px-2 py-1.5 text-gray-700">{r.priority ? PRIORITY_LABEL[r.priority] : '—'}</td>
                            <td className="px-2 py-1.5">{r.errors.length > 0 ? <span title={r.errors.join(' / ')}><AlertCircle size={14} className="text-red-500" /></span> : <CheckCircle size={14} className="text-green-500" />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importRows.some(r => r.errors.length > 0) && <p className="text-xs text-red-500">エラー行はスキップされます。アイコンにカーソルを合わせると詳細が確認できます。</p>}
                </div>
              )}
              {importRaw && importRows.length === 0 && <p className="text-xs text-gray-400">取り込めるデータ行がありません。</p>}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center shrink-0">
              <span className="text-xs text-gray-500">
                {importValidCount > 0 && !importDone && `${[importNewCount > 0 && `${importNewCount}件追加`, importUpdateCount > 0 && `${importUpdateCount}件更新`].filter(Boolean).join('、')}します`}
                {importDone && <span className="text-green-600 font-medium">インポートしました</span>}
              </span>
              <div className="flex gap-3">
                <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">閉じる</button>
                <button onClick={runImport} disabled={importValidCount === 0 || importing || importDone}
                  className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                  <Upload size={15} /> {importing ? 'インポート中...' : 'インポート'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedTask && <IndirectTaskDetailModal task={selectedTask} onClose={() => setSelectedTaskId(null)} />}
    </div>
  );
};
