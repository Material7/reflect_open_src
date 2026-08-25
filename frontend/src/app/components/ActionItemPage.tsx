import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useProject } from '@/context/ProjectContext';
import { actionItemsApi } from '@/lib/api';
import { ActionItem, TaskType, TaskPriority } from '@/types';
import { PRIORITY_OPTIONS, PRIORITY_LABEL, PRIORITY_BADGE, PRIORITY_ORDER, ACTION_ITEM_STATUS_NAMES, ACTION_ITEM_NOT_STARTED_STATUS, isCompletedActionItemStatus, actionItemStatusBadge, NOT_STARTED_STATUS, ACTION_ITEM_COMPLETED_STATUS } from '@/lib/constants';
import { extractTicketKey, findTicketKeyConflict, displayTaskId } from '@/lib/ticket';
import { DatePickerWithHolidays } from './DatePickerWithHolidays';
import { tagBadge, TagMultiSelect } from './shared/tags';
import { Plus, X, Trash, Rocket, AlertCircle, Upload, Download, CheckCircle, FileDown, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown } from 'lucide-react';
import { TabKey } from '../App';

type SortKey = 'itemId' | 'category' | 'title' | 'project' | 'assignee' | 'status' | 'dueDate' | 'priority';
type SortDir = 'asc' | 'desc';

const SortIcon: React.FC<{ col: SortKey; sortKey: SortKey; dir: SortDir }> = ({ col, sortKey, dir }) => {
  if (sortKey !== col) return <ArrowUpDown size={13} className="text-purple-400 opacity-0 group-hover:opacity-60 ml-1 inline-block" />;
  return dir === 'asc'
    ? <ArrowUp size={13} className="text-purple-500 ml-1 inline-block" />
    : <ArrowDown size={13} className="text-purple-500 ml-1 inline-block" />;
};

const CATEGORY_PALETTE = [
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-indigo-100 text-indigo-700',
];
export const categoryBadge = (cat: string) => {
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
};

const TAG_CSV_SEP = ';';
const parseTags = (raw: string): string[] =>
  raw.split(TAG_CSV_SEP).map(t => t.trim()).filter(Boolean);

const CSV_LINE_RE = /\r?\n/;
const CSV_HEADERS = ['ID', 'チケットID', '種別', 'タイトル', '担当者', '担当者名', 'ステータス', '期限', '優先度', 'タグ', 'メモ'];
/** CSV取り込み時の優先度ラベル→コード変換（高/中/低 と HIGH/MEDIUM/LOW を許容） */
const LABEL_TO_PRIORITY: Record<string, TaskPriority> = {
  '高': 'HIGH', '中': 'MEDIUM', '低': 'LOW', 'HIGH': 'HIGH', 'MEDIUM': 'MEDIUM', 'LOW': 'LOW',
};

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

const toCsvRow = (cells: (string | number | null | undefined)[]) =>
  cells.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');

const downloadCsv = (content: string, filename: string) => {
  const blob = new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const csvTimestamp = () => {
  const n = new Date();
  return n.getFullYear().toString()
    + String(n.getMonth() + 1).padStart(2, '0')
    + String(n.getDate()).padStart(2, '0')
    + String(n.getHours()).padStart(2, '0')
    + String(n.getMinutes()).padStart(2, '0')
    + String(n.getSeconds()).padStart(2, '0');
};

interface CsvImportRow {
  rowIndex: number;
  itemId: string;
  category: string;
  title: string;
  assignee: string;
  status: string;
  dueDate: string;
  priority: '' | TaskPriority;
  tags: string[];
  memo: string;
  ticketUrl: string;
  existing: ActionItem | null;
  errors: string[];
}

interface ItemForm {
  category: string;
  title: string;
  assignee: string;
  status: string;
  dueDate: string;
  priority: '' | TaskPriority;
  tags: string[];
  memo: string;
  ticketUrl: string;
}

const emptyForm = (): ItemForm => ({
  category: '', title: '', assignee: '', status: ACTION_ITEM_NOT_STARTED_STATUS, dueDate: '', priority: '', tags: [], memo: '', ticketUrl: '',
});


interface ActionItemPageProps {
  onNavigate?: (tab: TabKey, taskId?: string) => void;
  initialOpenItemId?: string | null;
  onInitialOpenHandled?: () => void;
}

export const ActionItemPage: React.FC<ActionItemPageProps> = ({ onNavigate, initialOpenItemId, onInitialOpenHandled }) => {
  const { projects, getSettings, settings, tasks, addTask, currentUser, resolveProjectRole } = useProject();
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const goToTask = useCallback((taskInternalId: string) => {
    const t = taskById.get(taskInternalId);
    if (!t || !onNavigate) return;
    const tab: TabKey = t.type === 'Requirement' ? 'requirement' : t.type === 'Indirect' ? 'indirect' : 'development';
    onNavigate(tab, t.id);
  }, [taskById, onNavigate]);

  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await actionItemsApi.getAll()); }
    catch { /* 認証エラーは api.ts 側で処理 */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const [filterProjectId, setFilterProjectId] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [filterDueFrom, setFilterDueFrom] = useState('');
  const [filterDueTo, setFilterDueTo] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];
  const isOverdue = (it: ActionItem) => !!it.dueDate && !isCompletedActionItemStatus(it.status) && it.dueDate < todayStr;
  const projectNameById = useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects]);
  const memberNameByEmpNo = useMemo(
    () => new Map(settings.members.map(m => [m.employeeNumber, m.name])),
    [settings.members]
  );
  const getAssigneeName = (empNo?: string | null) => (empNo ? (memberNameByEmpNo.get(empNo) ?? empNo) : '—');

  // 削除権限: Admin は常に可。それ以外はプロジェクト設定の削除可能ロールに含まれる場合のみ
  const canDeleteItem = (it: ActionItem) => {
    const role = resolveProjectRole(it.projectId) ?? '';
    return role === 'Admin' || (getSettings(it.projectId).actionItemDeleteRoles ?? []).includes(role);
  };

  const allCategories = useMemo(() => {
    const set = new Set<string>(settings.actionItemCategories ?? []);
    items.forEach(it => { if (it.category) set.add(it.category); });
    return Array.from(set);
  }, [settings.actionItemCategories, items]);

  const allTags = useMemo(() => {
    const set = new Set<string>(settings.tags ?? []);
    items.forEach(it => (it.tags ?? []).forEach(t => set.add(t)));
    return Array.from(set);
  }, [settings.tags, items]);

  const filtered = useMemo(() => {
    return items.filter(it => {
      if (filterProjectId && String(it.projectId) !== filterProjectId) return false;
      if (filterCategory && it.category !== filterCategory) return false;
      if (filterTag && !(it.tags ?? []).includes(filterTag)) return false;
      if (filterPriority && (it.priority ?? '') !== (filterPriority === 'NONE' ? '' : filterPriority)) return false;
      if (hideCompleted && isCompletedActionItemStatus(it.status)) return false;
      if (overdueOnly && !isOverdue(it)) return false;
      if (filterDueFrom || filterDueTo) {
        if (!it.dueDate) return false; // 期限なしは範囲指定時に除外
        if (filterDueFrom && it.dueDate < filterDueFrom) return false;
        if (filterDueTo && it.dueDate > filterDueTo) return false;
      }
      if (filterKeyword) {
        const kw = filterKeyword.toLowerCase();
        if (!it.title.toLowerCase().includes(kw) && !(it.memo ?? '').toLowerCase().includes(kw) && !(it.itemId ?? '').toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [items, filterProjectId, filterCategory, filterTag, filterPriority, filterKeyword, hideCompleted, overdueOnly, filterDueFrom, filterDueTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sortConfig, setSortConfig] = useState<{ key: SortKey; dir: SortDir }>({ key: 'dueDate', dir: 'asc' });
  const handleSort = (key: SortKey) => setSortConfig(c => ({ key, dir: c.key === key && c.dir === 'asc' ? 'desc' : 'asc' }));

  const sorted = useMemo(() => {
    const val = (it: ActionItem): string | number => {
      switch (sortConfig.key) {
        case 'itemId': return it.itemId ?? '';
        case 'category': return it.category;
        case 'title': return it.title;
        case 'project': return projectNameById.get(it.projectId) ?? '';
        case 'assignee': return getAssigneeName(it.assignee);
        case 'status': { const i = ACTION_ITEM_STATUS_NAMES.indexOf(it.status); return i < 0 ? 999 : i; }
        case 'dueDate': return it.dueDate || '9999-99-99';
        case 'priority': return PRIORITY_ORDER[it.priority ?? ''] ?? 3;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
  }, [filtered, sortConfig, projectNameById, memberNameByEmpNo]);

  const isFilterActive = !!(filterProjectId || filterCategory || filterTag || filterPriority || filterKeyword || hideCompleted || overdueOnly || filterDueFrom || filterDueTo);
  const clearFilters = () => { setFilterProjectId(''); setFilterCategory(''); setFilterTag(''); setFilterPriority(''); setFilterKeyword(''); setHideCompleted(false); setOverdueOnly(false); setFilterDueFrom(''); setFilterDueTo(''); };

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formProjectId, setFormProjectId] = useState<number>(projects[0]?.id ?? 0);
  const [form, setForm] = useState<ItemForm>(emptyForm());
  const [formError, setFormError] = useState('');
  const formSettings = useMemo(() => getSettings(formProjectId), [getSettings, formProjectId]);

  const openAdd = () => {
    const targetPid = filterProjectId ? Number(filterProjectId) : (projects[0]?.id ?? 0);
    const cats = getSettings(targetPid).actionItemCategories ?? [];
    setEditId(null);
    setForm({
      ...emptyForm(),
      category: cats[0] ?? '',
      assignee: currentUser && currentUser.employeeNumber !== 'admin' ? currentUser.employeeNumber : '',
    });
    setFormProjectId(targetPid);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (it: ActionItem) => {
    setEditId(it.id);
    setForm({
      category: it.category,
      title: it.title,
      assignee: it.assignee ?? '',
      status: it.status,
      dueDate: it.dueDate ?? '',
      priority: it.priority ?? '',
      tags: it.tags ?? [],
      memo: it.memo ?? '',
      ticketUrl: it.ticketUrl ?? '',
    });
    setFormProjectId(it.projectId);
    setFormError('');
    setShowForm(true);
  };

  useEffect(() => {
    if (!initialOpenItemId) return;
    const it = items.find(i => i.id === initialOpenItemId);
    if (it) { openEdit(it); onInitialOpenHandled?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenItemId, items]);

  const submitForm = useCallback(async () => {
    if (!form.title.trim()) { setFormError('タイトルは必須です'); return; }
    if (!formProjectId) { setFormError('プロジェクトを選択してください'); return; }
    if (!form.category) { setFormError('種別を選択してください（プロジェクト設定で追加できます）'); return; }
    const editing = editId ? items.find(i => i.id === editId) : null;
    const ticketUrl = form.ticketUrl.trim();
    const ticketKey = ticketUrl ? extractTicketKey(ticketUrl) : null;
    if (ticketKey && findTicketKeyConflict(items, formProjectId, ticketKey, editId ?? undefined)) {
      setFormError(`チケットID「${ticketKey}」は同一プロジェクト内で既に使われています`);
      return;
    }
    const payload = {
      projectId: formProjectId,
      category: form.category,
      title: form.title.trim(),
      assignee: form.assignee || null,
      status: form.status,
      dueDate: form.dueDate || null,
      priority: form.priority || null,
      tags: form.tags,
      memo: form.memo.trim() || null,
      ticketUrl: ticketUrl || null,
      ticketKey,
      issuedTaskId: editing?.issuedTaskId ?? null,
    };
    try {
      if (editId) {
        const updated = await actionItemsApi.update(editId, payload);
        setItems(prev => prev.map(i => i.id === editId ? updated : i));
      } else {
        const created = await actionItemsApi.create(payload);
        setItems(prev => [created, ...prev]);
      }
      setShowForm(false);
    } catch (e) {
      // サーバ側の検証メッセージ（チケットID重複など）をそのまま表示する
      setFormError(e instanceof Error ? e.message : '保存に失敗しました');
    }
  }, [form, formProjectId, editId, items]);

  const handleDelete = useCallback(async (it: ActionItem) => {
    if (!window.confirm(`「${it.title}」を削除しますか？\nこの操作は取り消せません。`)) return;
    await actionItemsApi.delete(it.id);
    setItems(prev => prev.filter(i => i.id !== it.id));
  }, []);

  const [issueTarget, setIssueTarget] = useState<ActionItem | null>(null);
  const [issueType, setIssueType] = useState<TaskType>('Development');
  const [issueDomainId, setIssueDomainId] = useState('');
  const [issueAssignee, setIssueAssignee] = useState('');
  const [issueName, setIssueName] = useState('');
  const [issueTicketUrl, setIssueTicketUrl] = useState('');
  const [issueError, setIssueError] = useState('');
  const issueSettings = useMemo(
    () => issueTarget ? getSettings(issueTarget.projectId) : null,
    [getSettings, issueTarget]
  );

  const openIssue = (it: ActionItem) => {
    setIssueTarget(it);
    setIssueType('Development');
    setIssueDomainId('');
    setIssueAssignee(it.assignee ?? '');
    setIssueName(it.title);
    setIssueTicketUrl(it.ticketUrl ?? '');
    setIssueError('');
  };

  const submitIssue = useCallback(async () => {
    if (!issueTarget) return;
    if (!issueName.trim()) { setIssueError('タスク名は必須です'); return; }
    if (!issueDomainId) { setIssueError('ドメインを選択してください'); return; }
    if (!issueAssignee) { setIssueError('担当者を選択してください'); return; }
    const ticketUrl = issueTicketUrl.trim();
    const ticketKey = ticketUrl ? extractTicketKey(ticketUrl) : null;
    if (ticketKey && findTicketKeyConflict(tasks, issueTarget.projectId, ticketKey)) {
      setIssueError(`チケットID「${ticketKey}」は同一プロジェクト内で既に使われています`);
      return;
    }
    try {
      const created = await addTask(issueTarget.projectId, {
        type: issueType,
        status: NOT_STARTED_STATUS,
        domainId: issueDomainId,
        name: issueName.trim(),
        assignee: issueAssignee,
        ...(issueTarget.priority ? { priority: issueTarget.priority } : {}),
        ...(ticketUrl ? { ticketUrl, ticketKey: ticketKey ?? undefined } : {}),
      } as Parameters<typeof addTask>[1]);
      const updated = await actionItemsApi.update(issueTarget.id, {
        projectId: issueTarget.projectId,
        category: issueTarget.category,
        title: issueTarget.title,
        assignee: issueTarget.assignee ?? null,
        status: ACTION_ITEM_COMPLETED_STATUS,
        dueDate: issueTarget.dueDate ?? null,
        priority: issueTarget.priority ?? null,
        tags: issueTarget.tags ?? [],
        memo: issueTarget.memo ?? null,
        issuedTaskId: created.id,
      });
      setItems(prev => prev.map(i => i.id === issueTarget.id ? updated : i));
      setIssueTarget(null);
    } catch (e) {
      setIssueError(e instanceof Error ? e.message : '発行に失敗しました');
    }
  }, [issueTarget, issueName, issueDomainId, issueAssignee, issueType, issueTicketUrl, addTask, tasks]);

  const fmtDate = (d?: string | null) => d ? d.replace(/-/g, '/') : '—';

  const handleExport = useCallback(() => {
    const rows: string[] = [toCsvRow(CSV_HEADERS)];
    for (const it of filtered) {
      rows.push(toCsvRow([
        it.itemId ?? '',
        it.ticketKey ?? '',
        it.category,
        it.title,
        it.assignee ?? '',
        it.assignee ? (memberNameByEmpNo.get(it.assignee) ?? it.assignee) : '',
        it.status,
        it.dueDate ?? '',
        it.priority ? PRIORITY_LABEL[it.priority] : '',
        (it.tags ?? []).join(TAG_CSV_SEP),
        it.memo ?? '',
      ]));
    }
    downloadCsv(rows.join('\r\n'), `Reflect_アクションアイテム_${csvTimestamp()}.csv`);
  }, [filtered, memberNameByEmpNo]);

  const [showCsvMenu, setShowCsvMenu] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importProjectId, setImportProjectId] = useState<number>(projects[0]?.id ?? 0);
  const [importRaw, setImportRaw] = useState<string[][] | null>(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

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
      const isHeader = first.includes('タイトル') || first[0] === 'ID';
      const dataLines = isHeader ? lines.slice(1) : lines;
      setImportRaw(dataLines.map(l => parseCsvLine(l)));
      setImportDone(false);
    };
    reader.readAsText(file);
  }, []);

  // インポート対象プロジェクトの設定でバリデーション
  const importRows = useMemo<CsvImportRow[]>(() => {
    if (!importRaw) return [];
    const s = getSettings(importProjectId);
    const empNoSet = new Set(s.members.filter(m => m.employeeNumber !== 'admin').map(m => m.employeeNumber));
    const cats = s.actionItemCategories ?? [];
    const knownTags = s.tags ?? [];
    const existingByItemId = new Map(
      items.filter(i => i.projectId === importProjectId && i.itemId).map(i => [i.itemId as string, i])
    );
    // 列: ID, チケットID, 種別, タイトル, 担当者, 担当者名, ステータス, 期限, 優先度, タグ, メモ
    // ※ チケットID・担当者名は出力専用（取込時は無視。チケット連携はUIで設定）。
    return importRaw.map((c, idx) => {
      const itemId = c[0] ?? '';
      const category = c[2] ?? '';
      const title = c[3] ?? '';
      const assignee = c[4] ?? '';
      const status = c[6] ?? '';
      const dueRaw = c[7] ?? '';
      const prioRaw = c[8] ?? '';
      const tagsRaw = c[9] ?? '';
      const memo = c[10] ?? '';
      const errors: string[] = [];
      if (!title) errors.push('タイトルが空です');
      if (!category) errors.push('種別が空です');
      else if (cats.length > 0 && !cats.includes(category)) errors.push(`種別「${category}」は未登録です`);
      if (assignee && !empNoSet.has(assignee)) errors.push(`担当者「${assignee}」が見つかりません`);
      let dueDate = '';
      if (dueRaw) {
        const norm = dueRaw.replace(/\//g, '-');
        if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) dueDate = norm;
        else errors.push(`期限「${dueRaw}」はYYYY-MM-DD形式ではありません`);
      }
      let priority: '' | TaskPriority = '';
      if (prioRaw) {
        const mapped = LABEL_TO_PRIORITY[prioRaw.trim()];
        if (mapped) priority = mapped;
        else errors.push(`優先度「${prioRaw}」は高/中/低のいずれかにしてください`);
      }
      const tags = parseTags(tagsRaw);
      if (knownTags.length > 0) {
        const unknown = tags.filter(t => !knownTags.includes(t));
        if (unknown.length > 0) errors.push(`タグ「${unknown.join('、')}」は未登録です`);
      }
      const existing = itemId ? (existingByItemId.get(itemId) ?? null) : null;
      if (itemId && !existing) errors.push(`ID「${itemId}」に一致するアイテムがありません（新規はID空欄で追加します）`);
      // チケット連携はCSVからは変更せず、既存アイテムの値を保持する（新規は未連携）
      const ticketUrl = existing?.ticketUrl ?? '';
      return { rowIndex: idx + 1, itemId, category, title, assignee, status: status || ACTION_ITEM_NOT_STARTED_STATUS, dueDate, priority, tags, memo, ticketUrl, existing, errors };
    });
  }, [importRaw, importProjectId, getSettings, items]);

  const runImport = useCallback(async () => {
    const valid = importRows.filter(r => r.errors.length === 0);
    if (valid.length === 0) return;
    setImporting(true);
    try {
      for (const r of valid) {
        const payload = {
          projectId: importProjectId,
          category: r.category,
          title: r.title,
          assignee: r.assignee || null,
          status: r.status,
          dueDate: r.dueDate || null,
          priority: r.priority || null,
          tags: r.tags,
          memo: r.memo || null,
          ticketUrl: r.ticketUrl || null,
          ticketKey: r.ticketUrl ? (extractTicketKey(r.ticketUrl) ?? null) : null,
          issuedTaskId: r.existing?.issuedTaskId ?? null,
        };
        if (r.existing) await actionItemsApi.update(r.existing.id, payload);
        else await actionItemsApi.create(payload);
      }
      await load();
      setImportDone(true);
    } finally {
      setImporting(false);
    }
  }, [importRows, importProjectId, load]);

  const importValidCount = importRows.filter(r => r.errors.length === 0).length;
  const importNewCount = importRows.filter(r => r.errors.length === 0 && !r.existing).length;
  const importUpdateCount = importRows.filter(r => r.errors.length === 0 && r.existing).length;

  return (
    <div className="h-full flex flex-col gap-3">
      {/* ヘッダー（アクション行） */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex items-baseline gap-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
            <span className="text-xl font-bold text-purple-600">{filtered.length}</span>
            <span className="text-xs text-gray-500">件</span>
            {isFilterActive && <span className="text-xs text-gray-400 ml-1">/ {items.length}</span>}
          </div>
          {isFilterActive && (
            <span className="text-xs font-semibold text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2.5 py-1">
              絞込中
            </span>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={openAdd}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
          >
            <Plus size={16} /> 追加
          </button>
          <button
            onClick={() => setShowCsvMenu(true)}
            className="bg-white border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
          >
            <FileDown size={16} /> CSV
          </button>
        </div>
      </div>

      {/* フィルタ */}
      <div className="bg-white border border-gray-300 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">プロジェクト</label>
          <select value={filterProjectId} onChange={e => setFilterProjectId(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">すべて</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">種別</label>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">すべて</option>
            {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">タグ</label>
          <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">すべて</option>
            {allTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">優先度</label>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">すべて</option>
            {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            <option value="NONE">未設定</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">期限（範囲）</label>
          <div className="flex items-center gap-1">
            <div className="w-36"><DatePickerWithHolidays value={filterDueFrom} onChange={setFilterDueFrom} clearable /></div>
            <span className="text-gray-400 text-sm">〜</span>
            <div className="w-36"><DatePickerWithHolidays value={filterDueTo} onChange={setFilterDueTo} min={filterDueFrom || undefined} clearable /></div>
          </div>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">キーワード</label>
          <input value={filterKeyword} onChange={e => setFilterKeyword(e.target.value)} placeholder="ID・タイトル・メモ"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer pb-1.5">
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500" />
          期限切れのみ
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer pb-1.5">
          <input type="checkbox" checked={hideCompleted} onChange={e => setHideCompleted(e.target.checked)} className="w-4 h-4 rounded border-gray-300" />
          完了を非表示
        </label>
        {isFilterActive && (
          <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 pb-2">クリア</button>
        )}
      </div>

      {/* 一覧 */}
      <div className="flex-1 min-h-0 bg-white border-2 border-purple-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-auto h-full">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-purple-50 border-b-2 border-purple-200 text-xs font-semibold text-purple-700 uppercase tracking-wider">
                <th className="px-4 py-3 cursor-pointer hover:bg-purple-100 group select-none" onClick={() => handleSort('itemId')}>ID <SortIcon col="itemId" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-purple-100 group select-none" onClick={() => handleSort('category')}>種別 <SortIcon col="category" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-purple-100 group select-none" onClick={() => handleSort('title')}>タイトル <SortIcon col="title" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-purple-100 group select-none" onClick={() => handleSort('project')}>プロジェクト <SortIcon col="project" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-purple-100 group select-none" onClick={() => handleSort('assignee')}>担当者 <SortIcon col="assignee" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-purple-100 group select-none" onClick={() => handleSort('status')}>ステータス <SortIcon col="status" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-purple-100 group select-none" onClick={() => handleSort('dueDate')}>期限 <SortIcon col="dueDate" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3 cursor-pointer hover:bg-purple-100 group select-none" onClick={() => handleSort('priority')}>優先度 <SortIcon col="priority" sortKey={sortConfig.key} dir={sortConfig.dir} /></th>
                <th className="px-4 py-3">タグ</th>
                <th className="px-4 py-3">メモ</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">読み込み中...</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400 text-sm">アクションアイテムがありません</td></tr>
              ) : sorted.map(it => {
                const overdue = isOverdue(it);
                return (
                  <tr key={it.id} onClick={() => openEdit(it)} className={`cursor-pointer ${overdue ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'} ${isCompletedActionItemStatus(it.status) ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-500">
                      {it.itemId ?? '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryBadge(it.category)}`}>{it.category}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 flex items-center gap-1.5">
                        {it.title}
                        {it.issuedTaskId && <Rocket size={13} className="text-indigo-500" aria-label="発行済み" />}
                      </div>
                      {it.issuedTaskId && taskById.get(it.issuedTaskId) && (
                        <button
                          onClick={e => { e.stopPropagation(); goToTask(it.issuedTaskId!); }}
                          className="mt-0.5 inline-flex items-center gap-1 text-xs font-mono text-indigo-600 hover:text-indigo-800 hover:underline"
                          title="発行先タスクを開く"
                        >
                          タスク: {displayTaskId(taskById.get(it.issuedTaskId)!)}<ExternalLink size={11} />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{projectNameById.get(it.projectId) ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{getAssigneeName(it.assignee)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionItemStatusBadge(it.status)}`}>{it.status}</span>
                    </td>
                    <td className={`px-4 py-3 text-sm whitespace-nowrap ${overdue ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                      <span className="inline-flex items-center gap-1">
                        {overdue && <AlertCircle size={12} />}{fmtDate(it.dueDate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {it.priority
                        ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_BADGE[it.priority]}`}>{PRIORITY_LABEL[it.priority]}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {(it.tags ?? []).length > 0
                        ? <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {it.tags!.map(t => <span key={t} className={`px-2 py-0.5 rounded text-xs font-medium ${tagBadge(t)}`}>{t}</span>)}
                          </div>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[280px]">
                      {it.memo
                        ? <span className="block truncate" title={it.memo}>{it.memo}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {!it.issuedTaskId && (
                          <button onClick={() => openIssue(it)} title="タスク発行"
                            className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50">
                            <Rocket size={15} />
                          </button>
                        )}
                        {canDeleteItem(it) && (
                          <button onClick={() => handleDelete(it)} title="削除" className="p-1.5 rounded text-red-500 hover:bg-red-50">
                            <Trash size={15} />
                          </button>
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

      {/* 追加 / 編集モーダル */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl border border-gray-300 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900">{editId ? 'アイテムを編集' : 'アイテムを追加'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"><X size={20} /></button>
            </div>
            <div className="px-6 py-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">プロジェクト <span className="text-red-500">*</span></label>
                <select value={formProjectId} disabled={!!editId}
                  onChange={e => {
                    const pid = Number(e.target.value);
                    const pidSettings = getSettings(pid);
                    const cats = pidSettings.actionItemCategories ?? [];
                    const pidTags = pidSettings.tags ?? [];
                    setFormProjectId(pid);
                    setForm(f => ({ ...f, assignee: '', category: cats.includes(f.category) ? f.category : (cats[0] ?? ''), tags: f.tags.filter(t => pidTags.includes(t)) }));
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white disabled:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.code}）</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">種別 <span className="text-red-500">*</span></label>
                {(formSettings.actionItemCategories ?? []).length === 0 ? (
                  <p className="text-xs text-amber-600 px-1 py-2">
                    このプロジェクトには種別が未登録です。「プロジェクト設定 &gt; アクションアイテム」でカテゴリを追加してください。
                  </p>
                ) : (
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="" disabled>選択してください</option>
                    {(formSettings.actionItemCategories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">タイトル <span className="text-red-500">*</span></label>
                <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="やること・項目を入力"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">担当者</label>
                  <select value={form.assignee} onChange={e => setForm(f => ({ ...f, assignee: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">未割当</option>
                    {formSettings.members.filter(m => m.employeeNumber !== 'admin').map(m => (
                      <option key={m.id} value={m.employeeNumber}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">ステータス</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {ACTION_ITEM_STATUS_NAMES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">期限</label>
                  <DatePickerWithHolidays value={form.dueDate} onChange={v => setForm(f => ({ ...f, dueDate: v }))} clearable />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">優先度</label>
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as '' | TaskPriority }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">未設定</option>
                    {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">タグ <span className="text-gray-400 font-normal">（複数選択可）</span></label>
                {(formSettings.tags ?? []).length === 0 ? (
                  <p className="text-xs text-amber-600 px-1 py-2">
                    このプロジェクトにはタグが未登録です。「プロジェクト設定 &gt; アクションアイテム」で追加できます。
                  </p>
                ) : (
                  <TagMultiSelect
                    options={formSettings.tags ?? []}
                    value={form.tags}
                    onChange={next => setForm(f => ({ ...f, tags: next }))}
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">チケットURL <span className="text-gray-400 font-normal">（任意）</span></label>
                <input type="url" value={form.ticketUrl} onChange={e => setForm(f => ({ ...f, ticketUrl: e.target.value }))}
                  placeholder="https://tracker.example.com/browse/PROJ-123"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                {form.ticketUrl.trim() && (
                  extractTicketKey(form.ticketUrl)
                    ? <p className="text-xs text-gray-500 mt-1">チケットID: <span className="font-mono font-semibold text-indigo-600">{extractTicketKey(form.ticketUrl)}</span></p>
                    : <p className="text-xs text-amber-600 mt-1">URLからチケットIDを抽出できませんでした（URLはそのまま保存されます）</p>
                )}
              </div>
              </div>

              {/* 右カラム: メモ */}
              <div className="flex flex-col">
                <label className="block text-xs font-semibold text-gray-700 mb-1">メモ</label>
                <textarea value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                  placeholder="補足・詳細"
                  className="flex-1 min-h-[16rem] w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
              </div>

              {formError && <p className="text-xs text-red-500 mt-3">{formError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">キャンセル</button>
              <button onClick={submitForm} className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">{editId ? '更新' : '追加'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 発行モーダル */}
      {issueTarget && issueSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-gray-300">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2"><Rocket size={18} className="text-indigo-600" /> タスク発行</h2>
              <button onClick={() => setIssueTarget(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"><X size={20} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-xs text-gray-500">
                プロジェクト「{projectNameById.get(issueTarget.projectId)}」にタスクを作成し、このアイテムを「完了」にして紐づけます。
              </p>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">タスク種別 <span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  {([['Requirement', '要件タスク'], ['Development', '開発タスク']] as [TaskType, string][]).map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setIssueType(val)}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        issueType === val ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">タスク名 <span className="text-red-500">*</span></label>
                <input value={issueName} onChange={e => setIssueName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">ドメイン <span className="text-red-500">*</span></label>
                  <select value={issueDomainId} onChange={e => setIssueDomainId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="" disabled>選択してください</option>
                    {issueSettings.domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">担当者 <span className="text-red-500">*</span></label>
                  <select value={issueAssignee} onChange={e => setIssueAssignee(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="" disabled>選択してください</option>
                    {issueSettings.members.filter(m => m.employeeNumber !== 'admin').map(m => (
                      <option key={m.id} value={m.employeeNumber}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  チケットURL <span className="text-gray-400 font-normal">（任意）</span>
                </label>
                <input
                  type="url"
                  value={issueTicketUrl}
                  onChange={e => setIssueTicketUrl(e.target.value)}
                  placeholder="https://tracker.example.com/browse/PROJ-123"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {issueTicketUrl.trim() && (
                  extractTicketKey(issueTicketUrl) ? (
                    <p className="text-xs text-gray-500 mt-1">
                      チケットID: <span className="font-mono font-semibold text-indigo-600">{extractTicketKey(issueTicketUrl)}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 mt-1">URLからチケットIDを抽出できませんでした（URLはそのまま保存されます）</p>
                  )
                )}
              </div>
              {issueError && <p className="text-xs text-red-500">{issueError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setIssueTarget(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">キャンセル</button>
              <button onClick={submitIssue} className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 flex items-center gap-1.5">
                <Rocket size={15} /> 発行
              </button>
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
                <div className="bg-indigo-50 px-4 py-2 border-b border-gray-200">
                  <span className="text-xs font-semibold text-indigo-700">アクションアイテム</span>
                </div>
                <div className="px-4 py-3 flex gap-2">
                  <button
                    className="flex-1 bg-white border border-indigo-300 text-indigo-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1.5"
                    onClick={() => { setShowCsvMenu(false); openImport(); }}
                  >
                    <Upload size={15} /> CSVインポート
                  </button>
                  <button
                    className="flex-1 bg-white border border-indigo-300 text-indigo-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-1.5"
                    onClick={() => { setShowCsvMenu(false); handleExport(); }}
                  >
                    <Download size={15} /> CSVエクスポート
                  </button>
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
              {/* インポート先プロジェクト */}
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
                  <p className="font-mono bg-gray-100 px-1 rounded inline-block">ID, チケットID, 種別, タイトル, 担当者, 担当者名, ステータス, 期限, 優先度, タグ, メモ</p>
                  <p className="text-gray-400 mt-0.5">タグは <span className="font-mono">;</span> 区切りで複数指定できます（例: 至急;要相談）。</p>
                  <p className="text-gray-400 mt-0.5">IDが既存アイテムと一致すれば更新、空または未一致なら新規追加します。「チケットID」「担当者名」は参照用で取り込みません（チケット連携はアイテム画面で設定）。</p>
                </div>
              </div>

              {/* ドロップゾーン */}
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

              {/* プレビュー */}
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
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 w-20">種別</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600">タイトル</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 w-20">担当者</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 w-14">優先度</th>
                        <th className="px-2 py-2 text-left font-semibold text-gray-600 w-24">タグ</th>
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
                            <td className="px-2 py-1.5 text-gray-700">{r.category || <span className="text-gray-300">—</span>}</td>
                            <td className="px-2 py-1.5 text-gray-900">{r.title || <span className="text-gray-300">—</span>}</td>
                            <td className="px-2 py-1.5 text-gray-700">{getAssigneeName(r.assignee)}</td>
                            <td className="px-2 py-1.5 text-gray-700">{r.priority ? PRIORITY_LABEL[r.priority] : '—'}</td>
                            <td className="px-2 py-1.5 text-gray-700">{r.tags.length > 0 ? r.tags.join('、') : '—'}</td>
                            <td className="px-2 py-1.5">{r.errors.length > 0 ? <span title={r.errors.join(' / ')}><AlertCircle size={14} className="text-red-500" /></span> : <CheckCircle size={14} className="text-green-500" />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importRows.some(r => r.errors.length > 0) && <p className="text-xs text-red-500">エラー行はスキップされます。アイコンにカーソルを合わせると詳細が確認できます。</p>}
                </div>
              )}
              {importRaw && importRows.length === 0 && (
                <p className="text-xs text-gray-400">取り込めるデータ行がありません。</p>
              )}
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
    </div>
  );
};
