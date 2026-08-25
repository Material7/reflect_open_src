import React, { useState, useMemo } from "react";
import { useProject, SETTINGS_ALLOWED_ROLES } from "@/context/ProjectContext";
import { PHASES, PhaseCode, WORK_STEPS, MEMBER_ROLES, ROLE_HIERARCHY, systemRoleLabel, workStepByCode, EXCLUDED_WORK_STEP_CODE } from "@/lib/constants";
import { DeliverableType, WorkflowSetting } from "@/types";
import { Plus, X, AlertTriangle, TableProperties, Users, ChevronUp, ChevronDown, Settings, Globe, CalendarOff, Download, Loader2, Tag, KeyRound, FileText, ChevronRight, ClipboardList } from "lucide-react";
import { DatePickerWithHolidays } from "./DatePickerWithHolidays";

type MemberSortKey = "id" | "employeeNumber" | "name" | "role";
type SortDirection = "asc" | "desc";
type SettingsScope = "global" | "project";
type SettingsTab =
  | "changeLog" | "workSteps" | "holidays" | "accounts"            // 全社共通
  | "phases" | "domains" | "statuses" | "deliverableTypes" | "projectMembers" | "actionItemCategories" | "tags"; // プロジェクト個別

/** currentUser が他メンバーに付与できるロール一覧 */
function getAssignableRoles(currentUserRole: string): string[] {
    const myLevel = ROLE_HIERARCHY[currentUserRole] ?? 99;
    return MEMBER_ROLES.filter((r) => r !== "Admin" && (ROLE_HIERARCHY[r] ?? 99) >= myLevel);
}

/** currentUser が対象メンバーのロールを編集できるか */
function canEditMemberRole(currentUserRole: string, memberRole: string, isSystemAdmin: boolean): boolean {
    if (isSystemAdmin) return false;
    const myLevel = ROLE_HIERARCHY[currentUserRole] ?? 99;
    const memberLevel = ROLE_HIERARCHY[memberRole] ?? 99;
    return memberLevel >= myLevel;
}

const GLOBAL_TABS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: "accounts", label: "アカウント管理", icon: <Users size={16} /> },
    { key: "statuses", label: "ステータス設定", icon: <Tag size={16} /> },
    { key: "workSteps", label: "作業工程マスタ", icon: <TableProperties size={16} /> },
    { key: "changeLog", label: "変更ログ閲覧設定", icon: <KeyRound size={16} /> },
    { key: "holidays", label: "休日設定", icon: <CalendarOff size={16} /> },
];
const PROJECT_TABS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: "phases", label: "工程設定", icon: <Settings size={16} /> },
    { key: "domains", label: "ドメイン設定", icon: <Globe size={16} /> },
    { key: "deliverableTypes", label: "成果物設定", icon: <FileText size={16} /> },
    { key: "actionItemCategories", label: "アクションアイテム", icon: <ClipboardList size={16} /> },
    { key: "tags", label: "タグ設定", icon: <Tag size={16} /> },
    { key: "projectMembers", label: "プロジェクトメンバー", icon: <Users size={16} /> },
];

/** 除外扱いの作業工程の表示ラベル。例: 個別除外(EXC) */
const excludedStepLabel = `${workStepByCode(EXCLUDED_WORK_STEP_CODE)?.name ?? ""}(${EXCLUDED_WORK_STEP_CODE})`;

export const ProjectSettingsPage: React.FC = () => {
    const {
        projects, getSettings, updateSettings, createProject, tasks: allTasks,
        members: accounts, getProjectMembers, globalSettings, isSystemAdmin, resolveProjectRole,
        updateGlobalSettings, createAccount, updateAccount, deleteAccount,
        upsertProjectMember, removeProjectMember, addHoliday, addHolidays, deleteHoliday,
    } = useProject();
    const [scope, setScope] = useState<SettingsScope>("global");
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projects[0]?.id ?? null);

    // 個別設定を編集できるプロジェクト（システムAdminは全件、それ以外は当該PJで PM/PL）
    const selectableProjects = isSystemAdmin
        ? projects
        : projects.filter((p) => { const r = resolveProjectRole(p.id); return r === "PM" || r === "PL"; });

    // プロジェクト未選択時は編集可能な先頭を選択（無ければ先頭）
    React.useEffect(() => {
        if (selectedProjectId === null && projects.length > 0) {
            setSelectedProjectId(selectableProjects[0]?.id ?? projects[0].id);
        }
    }, [projects, selectedProjectId, selectableProjects]);

    const effectiveProjectId = selectedProjectId ?? selectableProjects[0]?.id ?? projects[0]?.id ?? 0;
    const settings = getSettings(effectiveProjectId);
    const saveSettings = (s: typeof settings) => updateSettings(effectiveProjectId, s);
    const tasks = useMemo(() => allTasks.filter(t => t.projectId === effectiveProjectId), [allTasks, effectiveProjectId]);

    const [newProjectCode, setNewProjectCode] = useState("");
    const [newProjectName, setNewProjectName] = useState("");
    const [creatingProject, setCreatingProject] = useState(false);
    const handleCreateProject = async () => {
        if (!newProjectCode.trim() || !newProjectName.trim()) return;
        setCreatingProject(true);
        try {
            const p = await createProject(newProjectCode.trim(), newProjectName.trim());
            setSelectedProjectId(p.id);
            setNewProjectCode("");
            setNewProjectName("");
        } catch (e) {
            alert("プロジェクトの作成に失敗しました: " + (e instanceof Error ? e.message : String(e)));
        } finally {
            setCreatingProject(false);
        }
    };

    const [activeTab, setActiveTab] = useState<SettingsTab>("phases");
    const [prefixInput, setPrefixInput] = useState(settings.taskIdPrefix);
    const isPrefixLocked = tasks.length > 0;

    // プロジェクト切替時にプレフィックス入力を同期
    React.useEffect(() => {
        setPrefixInput(getSettings(effectiveProjectId).taskIdPrefix);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveProjectId]);
    const [newStatusName, setNewStatusName] = useState("");
    const [deliverableTypeInputs, setDeliverableTypeInputs] = useState<Record<string, string>>({});
    const [deliverableTypeRequiredFlags, setDeliverableTypeRequiredFlags] = useState<Record<string, boolean>>({});
    const [deliverableTypeVcsFlags, setDeliverableTypeVcsFlags] = useState<Record<string, 'svn' | 'git'>>({});
    const [newWorkflowName, setNewWorkflowName] = useState("");
    const [newActionCategory, setNewActionCategory] = useState("");
    const [newActionTag, setNewActionTag] = useState("");
    const [expandedDeliverableIds, setExpandedDeliverableIds] = useState<Set<string>>(new Set());
    const [draggingWorkflowIndex, setDraggingWorkflowIndex] = useState<number | null>(null);
    const [dragOverWorkflowIndex, setDragOverWorkflowIndex] = useState<number | null>(null);
    const [draggingStatusIndex, setDraggingStatusIndex] = useState<number | null>(null);
    const [dragOverStatusIndex, setDragOverStatusIndex] = useState<number | null>(null);
    const [newDomainName, setNewDomainName] = useState("");
    const [domainError, setDomainError] = useState("");
    // groupForms: domainId → { name, leaderId }
    const [groupForms, setGroupForms] = useState<Record<string, { name: string; leaderId: string }>>({});
    const [groupErrors, setGroupErrors] = useState<Record<string, string>>({});

    const getGroupForm = (domainId: string) => groupForms[domainId] ?? { name: "", leaderId: "" };
    const setGroupForm = (domainId: string, form: { name: string; leaderId: string }) => setGroupForms((prev) => ({ ...prev, [domainId]: form }));
    const [newEmployeeNumber, setNewEmployeeNumber] = useState("");
    const [newMemberName, setNewMemberName] = useState("");
    const [newMemberRole, setNewMemberRole] = useState("Member");
    const [newMemberPassword, setNewMemberPassword] = useState("");
    const [memberSortKey, setMemberSortKey] = useState<MemberSortKey>("id");
    const [memberSortDir, setMemberSortDir] = useState<SortDirection>("asc");
    const [editingPasswordId, setEditingPasswordId] = useState<number | null>(null);
    const [editingPasswordValue, setEditingPasswordValue] = useState("");

    const sortMembers = <T extends { id: number; employeeNumber: string; name: string; role: string }>(list: T[]): T[] =>
        [...list].sort((a, b) => {
            let cmp: number;
            if (memberSortKey === "id") cmp = a.id - b.id;
            else cmp = (a[memberSortKey] ?? "").localeCompare(b[memberSortKey] ?? "", "ja");
            return memberSortDir === "asc" ? cmp : -cmp;
        });
    const sortedMembers = useMemo(() => sortMembers(settings.members), [settings.members, memberSortKey, memberSortDir]);
    const sortedAccounts = useMemo(() => sortMembers(accounts), [accounts, memberSortKey, memberSortDir]);

    const handleMemberSort = (key: MemberSortKey) => {
        if (memberSortKey === key) {
            setMemberSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setMemberSortKey(key);
            setMemberSortDir("asc");
        }
    };

    const [newHolidayDate, setNewHolidayDate] = useState("");
    const [newHolidayName, setNewHolidayName] = useState("");
    const [holidayApiUrl, setHolidayApiUrl] = useState("https://api.national-holidays.jp/");
    const [fetchYear, setFetchYear] = useState(String(new Date().getFullYear()));
    const [isFetching, setIsFetching] = useState(false);
    const [fetchError, setFetchError] = useState("");

    const sortedHolidays = useMemo(() => {
        return [...(settings.holidays || [])].sort((a, b) => a.date.localeCompare(b.date));
    }, [settings.holidays]);

    const handleAddHoliday = () => {
        if (!newHolidayDate || !newHolidayName.trim()) return;
        addHoliday({ id: `h${Date.now()}`, date: newHolidayDate, name: newHolidayName.trim() });
        setNewHolidayDate("");
        setNewHolidayName("");
    };

    const handleDeleteHoliday = (id: string) => {
        deleteHoliday(id);
    };

    const handleFetchHolidays = async () => {
        if (!fetchYear.match(/^\d{4}$/)) {
            setFetchError("年を4桁で入力してください");
            return;
        }
        setIsFetching(true);
        setFetchError("");
        const controller = new AbortController();
        try {
            const url = holidayApiUrl.replace(/\/+$/, "") + "/" + fetchYear;
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            const data: { date: string; name: string }[] = await res.json();
            if (!Array.isArray(data) || data.length === 0) {
                setFetchError("祝日データが見つかりませんでした");
                return;
            }
            const existingDates = new Set((settings.holidays || []).map((h) => h.date));
            const newHolidays = data.filter((d) => d.date && d.name && !existingDates.has(d.date)).map((d) => ({ id: `h${Date.now()}-${d.date}`, date: d.date, name: d.name }));
            if (newHolidays.length === 0) {
                setFetchError("新しい祝日はありませんでした（すべて登録済み）");
                return;
            }
            await addHolidays(newHolidays);
        } catch (e: unknown) {
            if (e instanceof Error && e.name === 'AbortError') return;
            setFetchError(e instanceof Error ? e.message : "取得に失敗しました");
        } finally {
            setIsFetching(false);
            controller.abort();
        }
    };

    const handleToggleSkipPhase = (phaseCode: PhaseCode) => {
        const isSkipped = settings.skippedPhases.includes(phaseCode);
        const message = isSkipped
            ? `${phaseCode}工程を必須に変更してもよろしいですか？`
            : `${phaseCode}工程をスキップしてもよろしいですか？`;
        if (!window.confirm(message)) return;
        const newSkipped = isSkipped
            ? settings.skippedPhases.filter((p) => p !== phaseCode)
            : [...settings.skippedPhases, phaseCode];
        saveSettings({ ...settings, skippedPhases: newSkipped });
    };

    const handleAddDomain = () => {
        const name = newDomainName.trim();
        if (!name) return;
        if (settings.domains.some((d) => d.name === name)) {
            setDomainError(`ドメイン「${name}」はすでに登録されています`);
            return;
        }
        setDomainError("");
        saveSettings({
            ...settings,
            domains: [...settings.domains, { id: `d${Date.now()}`, name, groups: [] }],
        });
        setNewDomainName("");
    };

    const handleDeleteDomain = (id: string) => {
        const domain = settings.domains.find((d) => d.id === id);
        if (!domain) return;
        if (!window.confirm(`ドメイン「${domain.name}」を削除してもよろしいですか？`)) return;
        saveSettings({ ...settings, domains: settings.domains.filter((d) => d.id !== id) });
    };

    const handleAddGroup = (domainId: string) => {
        const form = getGroupForm(domainId);
        const groupName = form.name.trim();
        const leaderId = Number(form.leaderId);
        if (!groupName || !form.leaderId) return;
        const domain = settings.domains.find((d) => d.id === domainId);
        if (!domain) return;
        if (domain.groups.some((g) => g.name === groupName)) {
            setGroupErrors((prev) => ({ ...prev, [domainId]: `グループ「${groupName}」はこのドメインにすでに登録されています` }));
            return;
        }
        setGroupErrors((prev) => ({ ...prev, [domainId]: "" }));
        const newGroup = { id: `g${Date.now()}`, name: groupName, leaderId };
        saveSettings({
            ...settings,
            domains: settings.domains.map((d) => (d.id === domainId ? { ...d, groups: [...d.groups, newGroup] } : d)),
        });
        // リーダーを所属グループに自動追加（プロジェクトメンバーとして）
        const leaderPm = getProjectMembers(effectiveProjectId).find((pm) => pm.memberId === leaderId);
        if (leaderPm) {
            upsertProjectMember(effectiveProjectId, {
                memberId: leaderId,
                role: leaderPm.role,
                domainGroupIds: [...(leaderPm.domainGroupIds ?? []), newGroup.id],
            });
        }
        setGroupForm(domainId, { name: "", leaderId: "" });
    };

    const handleDeleteGroup = (domainId: string, groupId: string) => {
        const domain = settings.domains.find((d) => d.id === domainId);
        const group = domain?.groups.find((g) => g.id === groupId);
        if (!window.confirm(`グループ「${group?.name ?? groupId}」を削除しますか？`)) return;
        saveSettings({
            ...settings,
            domains: settings.domains.map((d) => (d.id === domainId ? { ...d, groups: d.groups.filter((g) => g.id !== groupId) } : d)),
        });
        // 当該グループに所属しているプロジェクトメンバーから除去
        getProjectMembers(effectiveProjectId)
            .filter((pm) => (pm.domainGroupIds ?? []).includes(groupId))
            .forEach((pm) => upsertProjectMember(effectiveProjectId, {
                memberId: pm.memberId,
                role: pm.role,
                domainGroupIds: (pm.domainGroupIds ?? []).filter((id) => id !== groupId),
            }));
    };

    const handleAddAccount = () => {
        if (!newEmployeeNumber.trim() || !newMemberName.trim() || !newMemberPassword.trim()) return;
        if (newMemberPassword.length < 5) return;
        // 全社アカウントの基準ロールは Member 固定（プロジェクト別ロールは所属側で設定）
        createAccount({
            employeeNumber: newEmployeeNumber.trim(),
            name: newMemberName.trim(),
            role: "Member",
            password: newMemberPassword,
        }).catch((e) => alert("アカウント作成に失敗しました: " + (e instanceof Error ? e.message : String(e))));
        setNewEmployeeNumber("");
        setNewMemberName("");
        setNewMemberPassword("");
    };

    const handleToggleSystemAdmin = (id: number, makeAdmin: boolean) => {
        const acct = accounts.find((m) => m.id === id);
        if (!acct) return;
        if (acct.employeeNumber === "admin") { alert("システム管理者ユーザーの権限は変更できません"); return; }
        const label = acct.name;
        if (!window.confirm(makeAdmin
            ? `「${label}」にシステム管理者権限を付与しますか？（全社機能・全プロジェクトにアクセス可能になります）`
            : `「${label}」のシステム管理者権限を解除しますか？`)) return;
        updateAccount(id, { role: makeAdmin ? "Admin" : "Member" })
            .catch((e) => alert("更新に失敗しました: " + (e instanceof Error ? e.message : String(e))));
    };

    const handleDeleteAccount = (id: number) => {
        const acct = accounts.find((m) => m.id === id);
        if (!acct) return;
        if (acct.employeeNumber === "admin") { alert("システム管理者ユーザーは削除できません"); return; }
        if (!window.confirm(`アカウント「${acct.name}」を削除してもよろしいですか？（所属するプロジェクトからも外れます）`)) return;
        deleteAccount(id).catch((e) => alert("削除に失敗しました: " + (e instanceof Error ? e.message : String(e))));
    };

    const handleStartEditPassword = (id: number, currentPassword: string) => {
        setEditingPasswordId(id);
        setEditingPasswordValue(currentPassword || "");
    };

    const handleSavePassword = (id: number) => {
        if (!editingPasswordValue.trim() || editingPasswordValue.length < 5) return;
        updateAccount(id, { password: editingPasswordValue.trim() })
            .catch((e) => alert("更新に失敗しました: " + (e instanceof Error ? e.message : String(e))));
        setEditingPasswordId(null);
        setEditingPasswordValue("");
    };

    const projectMembers = getProjectMembers(effectiveProjectId);
    const [addMemberEmpNo, setAddMemberEmpNo] = useState("");
    const [addMemberRole, setAddMemberRole] = useState("Member");
    const availableAccounts = useMemo(() => {
        const joined = new Set(projectMembers.map((pm) => pm.employeeNumber));
        return accounts.filter((a) => a.employeeNumber !== "admin" && !joined.has(a.employeeNumber));
    }, [accounts, projectMembers]);

    const handleAddProjectMember = () => {
        if (!addMemberEmpNo) return;
        upsertProjectMember(effectiveProjectId, { employeeNumber: addMemberEmpNo, role: addMemberRole, domainGroupIds: [] })
            .catch((e) => alert("追加に失敗しました: " + (e instanceof Error ? e.message : String(e))));
        setAddMemberEmpNo("");
        setAddMemberRole("Member");
    };

    const handleRemoveProjectMember = (memberId: number) => {
        const pm = projectMembers.find((m) => m.memberId === memberId);
        if (!pm) return;
        if (!window.confirm(`「${pm.name}」をこのプロジェクトから外しますか？（アカウントは削除されません）`)) return;
        removeProjectMember(effectiveProjectId, memberId)
            .catch((e) => alert("削除に失敗しました: " + (e instanceof Error ? e.message : String(e))));
    };

    const handleChangeProjectMemberRole = (memberId: number, role: string) => {
        const pm = projectMembers.find((m) => m.memberId === memberId);
        upsertProjectMember(effectiveProjectId, { memberId, role, domainGroupIds: pm?.domainGroupIds ?? [] });
    };

    const allDomainGroups = useMemo(() => settings.domains.flatMap((d) => d.groups.map((g) => ({ ...g, domainName: d.name }))), [settings.domains]);

    const getDomainGroupLabel = (groupId: string) => {
        const found = allDomainGroups.find((g) => g.id === groupId);
        return found ? `${found.domainName} / ${found.name}` : groupId;
    };

    const handleAddMemberGroup = (memberId: number, groupId: string) => {
        const pm = projectMembers.find((m) => m.memberId === memberId);
        upsertProjectMember(effectiveProjectId, { memberId, role: pm?.role ?? "Member", domainGroupIds: [...(pm?.domainGroupIds ?? []), groupId] });
    };

    const handleRemoveMemberGroup = (memberId: number, groupId: string) => {
        const pm = projectMembers.find((m) => m.memberId === memberId);
        upsertProjectMember(effectiveProjectId, { memberId, role: pm?.role ?? "Member", domainGroupIds: (pm?.domainGroupIds ?? []).filter((id) => id !== groupId) });
    };

    // 設定タブの可視性（バックエンドの認可に合わせる）
    // - システム Admin: 共通設定・個別設定の全タブ
    // - 当該プロジェクトの PM/PL: 個別設定＋作業工程マスタ（共通設定の他タブ＝全社機能は Admin 専用）
    // - それ以外(DL/SL/Member/未所属): 作業工程マスタ（参照）のみ
    // ※作業工程マスタはロール問わず誰でも参照可
    const workStepsTab = GLOBAL_TABS.filter(t => t.key === "workSteps");
    const selectedProjectRole = resolveProjectRole(effectiveProjectId);
    const canManageSelectedProject = isSystemAdmin || selectedProjectRole === "PM" || selectedProjectRole === "PL";
    const visibleTabs = isSystemAdmin
        ? (scope === "global" ? GLOBAL_TABS : PROJECT_TABS)
        : (canManageSelectedProject ? [...PROJECT_TABS, ...workStepsTab] : workStepsTab);
    const effectiveTab: SettingsTab = visibleTabs.some(t => t.key === activeTab) ? activeTab : (visibleTabs[0]?.key ?? "workSteps");
    // プロジェクトセレクタは個別設定タブ表示中のみ出す
    const isProjectScopeTab = PROJECT_TABS.some(t => t.key === effectiveTab);
    const effectiveScope: SettingsScope = isSystemAdmin ? scope : (isProjectScopeTab ? "project" : "global");

    // ステータスは全社共通設定。編集はシステム管理者のみ
    const saveTaskStatuses = (next: string[]) => {
        if (!isSystemAdmin) { alert("ステータス設定の変更はシステム管理者のみ可能です"); return; }
        updateGlobalSettings({ taskStatuses: next });
    };

    return (
        <div className="pb-12">
            {/* スコープ切替（全社共通 / プロジェクト）※共通設定はシステムAdmin専用 */}
            {isSystemAdmin && (
                <div className="inline-flex rounded-lg border border-gray-300 bg-gray-100 p-1 mb-6">
                    {([["global", "共通設定"], ["project", "個別設定"]] as const).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setScope(key)}
                            className={`px-5 py-1.5 text-sm font-medium rounded-md transition-colors ${scope === key ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}

            {/* Project Selector（プロジェクト設定スコープのみ） */}
            {effectiveScope === "project" && (
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-300 mb-6 flex flex-wrap items-end gap-4">
                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">設定対象プロジェクト</label>
                    <select
                        value={effectiveProjectId}
                        onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                        className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none min-w-[16rem]"
                    >
                        {selectableProjects.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}（{p.code}）{p.status === "archived" ? " [アーカイブ]" : ""}
                            </option>
                        ))}
                    </select>
                </div>
                {isSystemAdmin && (
                    <div className="flex items-end gap-2 ml-auto">
                        <div>
                            <label
                                className="block text-xs font-medium text-gray-500 mb-1 cursor-help"
                                title="プロジェクトを識別する一意のキーです。半角の大文字英字・数字で入力してください（最大20文字、例: SAMPLE / ALPHA）。スケジュールやダッシュボードで [識別子] として表示されます。作成後は変更できません。"
                            >
                                プロジェクト識別子
                            </label>
                            <input
                                type="text"
                                value={newProjectCode}
                                onChange={(e) => setNewProjectCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                                placeholder="例: ALPHA"
                                maxLength={20}
                                title="プロジェクトを識別する一意のキーです。半角の大文字英字・数字で入力してください（最大20文字、例: SAMPLE / ALPHA）。スケジュールやダッシュボードで [識別子] として表示されます。作成後は変更できません。"
                                className="w-52 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">プロジェクト名</label>
                            <input
                                type="text"
                                value={newProjectName}
                                onChange={(e) => setNewProjectName(e.target.value)}
                                placeholder="新規プロジェクト名"
                                className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                        </div>
                        <button
                            onClick={handleCreateProject}
                            disabled={creatingProject || !newProjectCode.trim() || !newProjectName.trim()}
                            className="flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Plus size={16} /> プロジェクト作成
                        </button>
                    </div>
                )}
            </div>
            )}

            {/* Tab Bar */}
            <div className="flex overflow-x-auto border-b border-gray-300 mb-8 -mx-4 md:mx-0 px-4 md:px-0">
                {visibleTabs.map((tab) => (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex items-center gap-2 px-4 md:px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap shrink-0 ${effectiveTab === tab.key ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}>
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Phases Configuration */}
            {effectiveTab === "phases" && (
                <section className="space-y-6">
                    {/* Task ID Prefix */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                        <div className="mb-4">
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">タスクIDプレフィックス</h3>
                            <p className="text-sm text-gray-500 mt-1">
                                タスク発行時に付与するIDのプレフィックスを設定します。形式: <span className="font-mono text-indigo-600">{prefixInput || "PRJ"}-R0001</span> / <span className="font-mono text-indigo-600">{prefixInput || "PRJ"}-D0001</span>
                                <br />
                                <span className="text-red-500 text-xs flex items-center gap-1 mt-1">
                                    <AlertTriangle size={12} />
                                    プロジェクト開始前（タスク作成前）のみ設定可能です
                                </span>
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <input
                                type="text"
                                value={prefixInput}
                                onChange={(e) => setPrefixInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                                disabled={isPrefixLocked}
                                maxLength={10}
                                placeholder="例: PRJ, TASK"
                                className={`w-48 px-4 py-2 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none ${isPrefixLocked ? "bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed" : "border-gray-300"}`}
                            />
                            {!isPrefixLocked && (
                                <button
                                    onClick={() => {
                                        if (prefixInput.trim()) {
                                            saveSettings({ ...settings, taskIdPrefix: prefixInput.trim() });
                                        }
                                    }}
                                    disabled={!prefixInput.trim() || prefixInput === settings.taskIdPrefix}
                                    className="bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    保存
                                </button>
                            )}
                            {isPrefixLocked && (
                                <span className="text-xs text-gray-400 flex items-center gap-1">
                                    <AlertTriangle size={12} className="text-amber-500" />
                                    タスクが存在するため変更不可
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Phases */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-300" id="phase-settings">
                        <div className="mb-6">
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">工程設定</h3>
                            <p className="text-sm text-gray-500 mt-1">
                                プロジェクトで使用しない工程を選択してください（スキップ設定）。
                                <br />
                                <span className="text-red-500 text-xs flex items-center gap-1 mt-1">
                                    <AlertTriangle size={12} />
                                    注意：プロジェクト開始後の変更は推奨されません
                                </span>
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {PHASES.map((phase) => {
                                const isSkipped = settings.skippedPhases.includes(phase.code);
                                return (
                                    <div key={phase.code} className={`flex items-start p-4 rounded-lg border-2 cursor-pointer transition-all ${isSkipped ? "border-gray-300 bg-gray-50 opacity-60" : "border-indigo-200 bg-indigo-50"}`} onClick={() => handleToggleSkipPhase(phase.code)}>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between">
                                                <span className={`font-bold ${isSkipped ? "text-gray-500" : "text-indigo-800"}`}>{phase.code}</span>
                                                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${isSkipped ? "bg-gray-200 text-gray-600" : "bg-indigo-200 text-indigo-800"}`}>{isSkipped ? "スキップ" : "必須"}</span>
                                            </div>
                                            <div className={`text-sm font-medium mt-1 ${isSkipped ? "text-gray-500" : "text-indigo-700"}`}>{phase.name}</div>
                                            <div className="text-xs text-gray-500 mt-1">{phase.description}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Task Delete Roles */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                        <div className="mb-6">
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">タスク削除設定</h3>
                            <p className="text-sm text-gray-500 mt-1">タスクを削除できるロールを選択してください。</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {MEMBER_ROLES.filter(r => r !== 'Admin').map(role => {
                                const enabled = (settings.taskDeleteRoles ?? []).includes(role);
                                return (
                                    <div
                                        key={role}
                                        className={`flex items-center justify-between w-64 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all ${enabled ? "border-indigo-200 bg-indigo-50" : "border-gray-300 bg-gray-50 opacity-60"}`}
                                        onClick={() => {
                                            const current = settings.taskDeleteRoles ?? [];
                                            const updated = enabled
                                                ? current.filter(r => r !== role)
                                                : [...current, role];
                                            saveSettings({ ...settings, taskDeleteRoles: updated });
                                        }}
                                    >
                                        <span className={`font-bold ${enabled ? "text-indigo-800" : "text-gray-500"}`}>{role}</span>
                                        <span className={`text-xs px-2 py-1 rounded-full font-semibold ${enabled ? "bg-indigo-200 text-indigo-800" : "bg-gray-200 text-gray-600"}`}>{enabled ? "許可" : "不可"}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 除外工程の選択可能ロール */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                        <div className="mb-6">
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">作業工程「{excludedStepLabel}」選択設定</h3>
                            <p className="text-sm text-gray-500 mt-1">作業工程で「{excludedStepLabel}」を選択できるロールを選択してください。Admin は常に選択可能です。</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {MEMBER_ROLES.filter(r => r !== 'Admin').map(role => {
                                const enabled = (settings.excludeStepSelectRoles ?? []).includes(role);
                                return (
                                    <div
                                        key={role}
                                        className={`flex items-center justify-between w-64 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all ${enabled ? "border-indigo-200 bg-indigo-50" : "border-gray-300 bg-gray-50 opacity-60"}`}
                                        onClick={() => {
                                            const current = settings.excludeStepSelectRoles ?? [];
                                            const updated = enabled
                                                ? current.filter(r => r !== role)
                                                : [...current, role];
                                            saveSettings({ ...settings, excludeStepSelectRoles: updated });
                                        }}
                                    >
                                        <span className={`font-bold ${enabled ? "text-indigo-800" : "text-gray-500"}`}>{role}</span>
                                        <span className={`text-xs px-2 py-1 rounded-full font-semibold ${enabled ? "bg-indigo-200 text-indigo-800" : "bg-gray-200 text-gray-600"}`}>{enabled ? "許可" : "不可"}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                </section>
            )}

            {/* 変更ログ閲覧設定（全社共通） */}
            {effectiveTab === "changeLog" && (
                <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><KeyRound size={20} className="text-gray-500" />変更ログ閲覧設定</h3>
                        <p className="text-sm text-gray-500 mt-1">変更ログを閲覧できるロールを選択してください。全プロジェクト共通の設定です。Admin は常に閲覧可能です。</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        {MEMBER_ROLES.filter(r => r !== 'Admin').map(role => {
                            const enabled = (globalSettings.changeLogViewRoles ?? []).includes(role);
                            return (
                                <div
                                    key={role}
                                    className={`flex items-center justify-between w-64 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all ${enabled ? "border-indigo-200 bg-indigo-50" : "border-gray-300 bg-gray-50 opacity-60"}`}
                                    onClick={() => {
                                        if (!isSystemAdmin) { alert("変更ログ閲覧設定の変更はシステム管理者のみ可能です"); return; }
                                        const current = globalSettings.changeLogViewRoles ?? [];
                                        const updated = enabled ? current.filter(r => r !== role) : [...current, role];
                                        updateGlobalSettings({ changeLogViewRoles: updated });
                                    }}
                                >
                                    <span className={`font-bold ${enabled ? "text-indigo-800" : "text-gray-500"}`}>{role}</span>
                                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${enabled ? "bg-indigo-200 text-indigo-800" : "bg-gray-200 text-gray-600"}`}>{enabled ? "許可" : "不可"}</span>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Work Step Master Table (Read Only) */}
            {effectiveTab === "workSteps" && (
                <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <TableProperties size={20} className="text-gray-500" />
                            作業工程マスタ (参照のみ)
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">タスク管理で使用される作業工程の定義一覧です。</p>
                    </div>

                    <div className="overflow-x-auto border-2 border-indigo-200 rounded-lg">
                        <table className="min-w-full divide-y divide-indigo-200">
                            <thead className="bg-indigo-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider">
                                        コード
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider">
                                        工程名称
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider">
                                        進捗率設定
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-300">
                                {WORK_STEPS.map((step) => (
                                    <tr key={step.code} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{step.code}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{step.name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            <div className="flex items-center gap-2">
                                                <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                    <div className="h-full bg-indigo-500" style={{ width: `${step.progress}%` }} />
                                                </div>
                                                <span>{step.progress}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Domains Configuration */}
            {effectiveTab === "domains" && (
                <section className="space-y-4">
                    {/* Add Domain */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-4">
                            <Globe size={20} className="text-gray-500" />
                            ドメイン設定
                        </h3>
                        <p className="text-sm text-gray-500 mb-4">ドメインを追加し、各ドメインにグループとリーダーを設定します。</p>
                        <div className="flex gap-2 pr-6">
                            <input
                                type="text"
                                value={newDomainName}
                                onChange={(e) => {
                                    setNewDomainName(e.target.value);
                                    setDomainError("");
                                }}
                                placeholder="ドメイン名"
                                className="w-96 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
                            />
                            <button onClick={handleAddDomain} disabled={!newDomainName.trim()} className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                                <Plus size={18} />
                                ドメイン追加
                            </button>
                        </div>
                        {domainError && (
                            <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
                                <AlertTriangle size={12} />
                                {domainError}
                            </p>
                        )}
                    </div>

                    {/* Domain List */}
                    {settings.domains.length === 0 && <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-300 text-center text-gray-400 italic">ドメインが登録されていません</div>}

                    {settings.domains.map((domain) => {
                        const form = getGroupForm(domain.id);
                        const groupError = groupErrors[domain.id] ?? "";
                        return (
                            <div key={domain.id} className="bg-white rounded-xl shadow-sm border-2 border-indigo-200 overflow-hidden">
                                {/* Domain Header */}
                                <div className="flex items-center justify-between px-6 py-3 bg-indigo-50 border-b-2 border-indigo-200">
                                    <span className="font-semibold text-indigo-800">{domain.name}</span>
                                    <button onClick={() => handleDeleteDomain(domain.id)} className="text-gray-400 hover:text-red-500 transition-colors" title="ドメインを削除">
                                        <X size={16} />
                                    </button>
                                </div>

                                {/* Groups Table */}
                                <div className="px-6 pt-3 pb-4">
                                    {domain.groups.length > 0 && (
                                        <table className="min-w-full mb-3 table-fixed">
                                            <thead>
                                                <tr className="border-b border-gray-300">
                                                    <th className="pb-2 text-left text-xs font-medium text-gray-500 w-[11.5rem]">リーダー</th>
                                                    <th className="pb-2 text-left text-xs font-medium text-gray-500">グループ名</th>
                                                    <th className="pb-2 w-8" />
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {domain.groups.map((group) => {
                                                    const leader = settings.members.find((m) => m.id === group.leaderId);
                                                    return (
                                                        <tr key={group.id} className="group">
                                                            <td className="py-2 pr-4 text-sm text-gray-600">{leader ? leader.name : <span className="text-gray-300 italic">未設定</span>}</td>
                                                            <td className="py-2 pr-4 text-sm text-gray-800">{group.name}</td>
                                                            <td className="py-2 text-right">
                                                                <button onClick={() => handleDeleteGroup(domain.id, group.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    <X size={14} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}

                                    {/* Add Group Form */}
                                    <div className="flex gap-2 items-center">
                                        <select value={form.leaderId} onChange={(e) => setGroupForm(domain.id, { ...form, leaderId: e.target.value })} className="w-44 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white">
                                            <option value="">リーダーを選択</option>
                                            {settings.members
                                                .filter((m) => m.employeeNumber !== "admin" && (ROLE_HIERARCHY[m.role] ?? 99) <= ROLE_HIERARCHY["SL"])
                                                .map((m) => (
                                                    <option key={m.id} value={m.id}>
                                                        {m.name}（{m.role}）
                                                    </option>
                                                ))}
                                        </select>
                                        <input
                                            type="text"
                                            value={form.name}
                                            onChange={(e) => {
                                                setGroupForm(domain.id, { ...form, name: e.target.value });
                                                setGroupErrors((prev) => ({ ...prev, [domain.id]: "" }));
                                            }}
                                            placeholder="グループ名"
                                            className="w-[26rem] px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                            onKeyDown={(e) => e.key === "Enter" && handleAddGroup(domain.id)}
                                        />
                                        <button onClick={() => handleAddGroup(domain.id)} disabled={!form.name.trim() || !form.leaderId} className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                                            <Plus size={15} />
                                            グループ追加
                                        </button>
                                    </div>
                                    {groupError && (
                                        <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                                            <AlertTriangle size={12} />
                                            {groupError}
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </section>
            )}

            {/* アカウント管理（全社共通） */}
            {effectiveTab === "accounts" && (
                <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Users size={20} className="text-gray-500" />アカウント管理</h3>
                        <p className="text-sm text-gray-500 mt-1">メンバーアカウント（社員番号・氏名・パスワード）を登録します。プロジェクトへの参加・ロールは「プロジェクトメンバー」で設定します。</p>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-6">
                        <input type="text" value={newEmployeeNumber} onChange={(e) => setNewEmployeeNumber(e.target.value)} placeholder="社員番号" className="w-40 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" onKeyDown={(e) => e.key === "Enter" && handleAddAccount()} />
                        <input type="text" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} placeholder="氏名" className="flex-1 min-w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" onKeyDown={(e) => e.key === "Enter" && handleAddAccount()} />
                        <input type="password" value={newMemberPassword} onChange={(e) => setNewMemberPassword(e.target.value)} placeholder="パスワード(5文字以上)" className="w-44 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" onKeyDown={(e) => e.key === "Enter" && handleAddAccount()} />
                        <button onClick={handleAddAccount} disabled={!newEmployeeNumber.trim() || !newMemberName.trim() || newMemberPassword.length < 5} className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                            <Plus size={18} /> 追加
                        </button>
                    </div>

                    <div className="overflow-x-auto border-2 border-indigo-200 rounded-lg">
                        <table className="min-w-full divide-y divide-indigo-200">
                            <thead className="bg-indigo-50">
                                <tr>
                                    {([["id", "メンバーID"], ["employeeNumber", "社員番号"], ["name", "氏名"]] as const).map(([key, label]) => (
                                        <th key={key} scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider cursor-pointer select-none hover:bg-indigo-100 transition-colors" onClick={() => handleMemberSort(key)}>
                                            <div className="flex items-center gap-1">{label}{memberSortKey === key ? memberSortDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} /> : <span className="w-[14px]" />}</div>
                                        </th>
                                    ))}
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider">パスワード</th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider">システム権限</th>
                                    <th scope="col" className="px-6 py-3 w-12" />
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-300">
                                {sortedAccounts.map((member) => {
                                    const isEditing = editingPasswordId === member.id;
                                    const isAdmin = member.employeeNumber === "admin";
                                    return (
                                        <tr key={member.id} className="group hover:bg-gray-50">
                                            <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">{member.id}</td>
                                            <td className="px-6 py-3 whitespace-nowrap text-sm font-mono text-gray-700">{member.employeeNumber}</td>
                                            <td className="px-6 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{member.name}</td>
                                            <td className="px-6 py-3 whitespace-nowrap text-sm">
                                                {isEditing ? (
                                                    <div className="flex items-center gap-1">
                                                        <input type="text" value={editingPasswordValue} onChange={(e) => setEditingPasswordValue(e.target.value)} autoFocus className="w-28 px-2 py-1 border border-indigo-300 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                                                            onKeyDown={(e) => { if (e.key === "Enter") handleSavePassword(member.id); if (e.key === "Escape") setEditingPasswordId(null); }} />
                                                        <button onClick={() => handleSavePassword(member.id)} className="text-indigo-600 hover:text-indigo-800 text-xs font-medium">保存</button>
                                                        <button onClick={() => setEditingPasswordId(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        <span className="font-mono text-gray-600 text-xs w-20">{member.passwordSet ? "●●●●●●●●" : <span className="text-gray-300 italic">未設定</span>}</span>
                                                        {!isAdmin && (
                                                            <button onClick={() => handleStartEditPassword(member.id, "")} className="text-gray-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity" title="パスワード変更"><KeyRound size={14} /></button>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-3 whitespace-nowrap text-sm">
                                                {isAdmin ? (
                                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">管理者（固定）</span>
                                                ) : (
                                                    <label className="inline-flex items-center gap-2 cursor-pointer">
                                                        <input type="checkbox" checked={member.role === "Admin"} onChange={(e) => handleToggleSystemAdmin(member.id, e.target.checked)} className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${member.role === "Admin" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>{systemRoleLabel(member.role)}</span>
                                                    </label>
                                                )}
                                            </td>
                                            <td className="px-6 py-3 whitespace-nowrap text-right">
                                                {!isAdmin && (
                                                    <button onClick={() => handleDeleteAccount(member.id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><X size={16} /></button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {sortedAccounts.length === 0 && (
                                    <tr><td colSpan={6} className="text-center py-8 text-gray-400 italic">アカウントが登録されていません</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* プロジェクトメンバー（個別） */}
            {effectiveTab === "projectMembers" && (
                <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Users size={20} className="text-gray-500" />プロジェクトメンバー</h3>
                        <p className="text-sm text-gray-500 mt-1">このプロジェクトに参加するメンバーのロール・所属ドメイングループを管理します。アカウント自体の登録は「共通設定 &gt; アカウント管理」で行います。</p>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-6 items-center">
                        <select value={addMemberEmpNo} onChange={(e) => setAddMemberEmpNo(e.target.value)} className="min-w-48 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white">
                            <option value="">参加させるアカウントを選択</option>
                            {availableAccounts.map((a) => (<option key={a.id} value={a.employeeNumber}>{a.name}（{a.employeeNumber}）</option>))}
                        </select>
                        <select value={addMemberRole} onChange={(e) => setAddMemberRole(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white">
                            {MEMBER_ROLES.filter((r) => r !== "Admin").map((role) => (<option key={role} value={role}>{role}</option>))}
                        </select>
                        <button onClick={handleAddProjectMember} disabled={!addMemberEmpNo} className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                            <Plus size={18} /> 参加
                        </button>
                    </div>

                    <div className="overflow-x-auto border-2 border-indigo-200 rounded-lg">
                        <table className="min-w-full divide-y divide-indigo-200">
                            <thead className="bg-indigo-50">
                                <tr>
                                    {([["employeeNumber", "社員番号"], ["name", "氏名"], ["role", "ロール"]] as const).map(([key, label]) => (
                                        <th key={key} scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider cursor-pointer select-none hover:bg-indigo-100 transition-colors" onClick={() => handleMemberSort(key)}>
                                            <div className="flex items-center gap-1">{label}{memberSortKey === key ? memberSortDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} /> : <span className="w-[14px]" />}</div>
                                        </th>
                                    ))}
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider">所属ドメイングループ</th>
                                    <th scope="col" className="px-6 py-3 w-12" />
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-300">
                                {sortedMembers.map((member) => {
                                    const isAdmin = member.employeeNumber === "admin";
                                    const roleColor = member.role === "Admin" ? "bg-red-100 text-red-700" : SETTINGS_ALLOWED_ROLES.includes(member.role as (typeof SETTINGS_ALLOWED_ROLES)[number]) ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600";
                                    // 付与判定は操作者の「このプロジェクトでのロール」で行う（システムAdminは全ロール付与可）
                                    const myProjectRole = resolveProjectRole(effectiveProjectId) ?? '';
                                    const editable = !isAdmin && (isSystemAdmin || canEditMemberRole(myProjectRole, member.role, false));
                                    const assignableRoles = getAssignableRoles(isSystemAdmin ? 'Admin' : myProjectRole);
                                    return (
                                        <tr key={member.id} className="group hover:bg-gray-50">
                                            <td className="px-6 py-3 whitespace-nowrap text-sm font-mono text-gray-700">{member.employeeNumber}</td>
                                            <td className="px-6 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{member.name}</td>
                                            <td className="px-6 py-3 whitespace-nowrap text-sm">
                                                {!editable ? (
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleColor}`}>{member.role}</span>
                                                ) : (
                                                    <select value={member.role} onChange={(e) => handleChangeProjectMemberRole(member.id, e.target.value)} className={`px-2 py-0.5 rounded-full text-xs font-medium border-0 cursor-pointer focus:ring-2 focus:ring-indigo-500 focus:outline-none ${roleColor}`}>
                                                        {assignableRoles.map((r) => (<option key={r} value={r}>{r}</option>))}
                                                    </select>
                                                )}
                                            </td>
                                            <td className="px-6 py-3 text-sm min-w-[220px]">
                                                {isAdmin ? null : (
                                                    <div className="flex flex-wrap gap-1 items-center">
                                                        {(member.domainGroupIds ?? []).map((gid) => (
                                                            <span key={gid} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full text-xs">
                                                                {getDomainGroupLabel(gid)}
                                                                <button onClick={() => handleRemoveMemberGroup(member.id, gid)} className="hover:text-red-500 transition-colors ml-0.5"><X size={10} /></button>
                                                            </span>
                                                        ))}
                                                        {allDomainGroups.filter((g) => !(member.domainGroupIds ?? []).includes(g.id)).length > 0 && (
                                                            <select value="" onChange={(e) => { if (e.target.value) handleAddMemberGroup(member.id, e.target.value); }} className="text-xs text-gray-400 border border-dashed border-gray-300 rounded-full px-2 py-0.5 bg-white cursor-pointer hover:border-indigo-400 focus:outline-none">
                                                                <option value="">+ グループ追加</option>
                                                                {allDomainGroups.filter((g) => !(member.domainGroupIds ?? []).includes(g.id)).map((g) => (<option key={g.id} value={g.id}>{g.domainName} / {g.name}</option>))}
                                                            </select>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-3 whitespace-nowrap text-right">
                                                {!isAdmin && (<button onClick={() => handleRemoveProjectMember(member.id)} title="プロジェクトから外す" className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><X size={16} /></button>)}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {sortedMembers.length === 0 && (
                                    <tr><td colSpan={5} className="text-center py-8 text-gray-400 italic">参加メンバーがいません</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Holidays Configuration */}
            {effectiveTab === "holidays" && (
                <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <CalendarOff size={20} className="text-gray-500" />
                            休日設定
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">全プロジェクト共通の祝日・休業日を管理します。登録した休日はカレンダー上で赤文字で表示されます。</p>
                    </div>

                    {/* External Fetch Section */}
                    <div className="mb-6 p-4 bg-indigo-50 rounded-lg border-2 border-indigo-200">
                        <h4 className="text-sm font-bold text-indigo-800 mb-3 flex items-center gap-2">
                            <Download size={16} className="text-indigo-600" />
                            外部サイトから祝日を取得
                        </h4>
                        <div className="flex gap-2 mb-2">
                            <input type="text" value={holidayApiUrl} onChange={(e) => setHolidayApiUrl(e.target.value)} placeholder="API URL" className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                            <input type="text" value={fetchYear} onChange={(e) => setFetchYear(e.target.value)} placeholder="年（例：2026）" className="w-24 px-4 py-2 border border-gray-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                            <button onClick={handleFetchHolidays} disabled={isFetching} className="bg-emerald-600 text-white px-5 py-2 rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                                {isFetching ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                取得
                            </button>
                        </div>
                        <p className="text-xs text-gray-400">デフォルト: https://api.national-holidays.jp/ — 指定した年の祝日を一括取得します</p>
                        {fetchError && (
                            <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                                <AlertTriangle size={12} />
                                {fetchError}
                            </p>
                        )}
                    </div>

                    <div className="flex gap-2 mb-6 items-stretch">
                        <div className="w-48 shrink-0">
                            <DatePickerWithHolidays value={newHolidayDate} onChange={setNewHolidayDate} className="h-full py-2.5 text-sm" />
                        </div>
                        <input type="text" value={newHolidayName} onChange={(e) => setNewHolidayName(e.target.value)} placeholder="休日名（例：元日、休業日）" className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none" onKeyDown={(e) => e.key === "Enter" && handleAddHoliday()} />
                        <button onClick={handleAddHoliday} className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-medium">
                            <Plus size={18} />
                            追加
                        </button>
                    </div>

                    <div className="overflow-x-auto border-2 border-indigo-200 rounded-lg">
                        <table className="min-w-full divide-y divide-indigo-200">
                            <thead className="bg-indigo-50">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider">
                                        日付
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-indigo-800 uppercase tracking-wider">
                                        名称
                                    </th>
                                    <th scope="col" className="px-6 py-3 w-12" />
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-300">
                                {sortedHolidays.map((holiday) => (
                                    <tr key={holiday.id} className="group hover:bg-gray-50">
                                        <td className="px-6 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{holiday.date}</td>
                                        <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-700">{holiday.name}</td>
                                        <td className="px-6 py-3 whitespace-nowrap text-right">
                                            <button onClick={() => handleDeleteHoliday(holiday.id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <X size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {sortedHolidays.length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="text-center py-8 text-gray-400 italic">
                                            休日が登録されていません
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Deliverable Settings (Types + Workflows combined) */}
            {effectiveTab === "deliverableTypes" && (() => {
                const allTypes: DeliverableType[] = settings.deliverableTypes || [];
                const workflows: string[] = settings.workflows || [];
                const activePhaseCodes = PHASES.filter((p: { code: PhaseCode; name: string }) => !settings.skippedPhases.includes(p.code));

                const handleAddWorkflow = () => {
                    const name = newWorkflowName.trim();
                    if (!name || workflows.includes(name)) return;
                    saveSettings({ ...settings, workflows: [...workflows, name] });
                    setNewWorkflowName("");
                };
                const handleWorkflowDragStart = (index: number) => setDraggingWorkflowIndex(index);
                const handleWorkflowDragOver = (e: React.DragEvent, index: number) => {
                    e.preventDefault();
                    setDragOverWorkflowIndex(index);
                };
                const handleWorkflowDrop = (dropIndex: number) => {
                    if (draggingWorkflowIndex === null || draggingWorkflowIndex === dropIndex) return;
                    const reordered = [...workflows];
                    const [moved] = reordered.splice(draggingWorkflowIndex, 1);
                    reordered.splice(dropIndex, 0, moved);
                    if (!window.confirm(`ワークフローの順番を変更してもよろしいですか？\n\n${reordered.map((w, i) => `${i + 1}. ${w}`).join("\n")}`)) return;
                    saveSettings({ ...settings, workflows: reordered });
                    setDraggingWorkflowIndex(null);
                    setDragOverWorkflowIndex(null);
                };
                const handleWorkflowDragEnd = () => {
                    setDraggingWorkflowIndex(null);
                    setDragOverWorkflowIndex(null);
                };
                const handleDeleteWorkflow = (wf: string) => {
                    if (!window.confirm(`ワークフロー「${wf}」を削除してもよろしいですか？\n各成果物種別のワークフロー設定からも削除されます。`)) return;
                    saveSettings({
                        ...settings,
                        workflows: workflows.filter(w => w !== wf),
                        deliverableTypes: allTypes.map(t => ({
                            ...t,
                            workflowSettings: t.workflowSettings.filter((ws: WorkflowSetting) => ws.workflowName !== wf),
                        })),
                    });
                };

                const handleAddDeliverableType = (phaseCode: string, required: boolean, vcsType: 'svn' | 'git') => {
                    const name = (deliverableTypeInputs[phaseCode] || "").trim();
                    if (!name) return;
                    if (allTypes.some(t => t.name === name && t.phaseCode === phaseCode)) return;
                    const newType: DeliverableType = { id: `dt${Date.now()}`, name, phaseCode, required, vcsType, workflowSettings: [] };
                    saveSettings({ ...settings, deliverableTypes: [...allTypes, newType] });
                    setDeliverableTypeInputs(prev => ({ ...prev, [phaseCode]: "" }));
                };
                const handleToggleRequired = (id: string, name: string, currentRequired: boolean) => {
                    if (!window.confirm(`種別「${name}」を${currentRequired ? "任意" : "必須"}に変更してもよろしいですか？`)) return;
                    saveSettings({ ...settings, deliverableTypes: allTypes.map(t => t.id === id ? { ...t, required: !t.required } : t) });
                };
                const handleDeleteDeliverableType = (id: string, name: string) => {
                    if (!window.confirm(`種別「${name}」を削除してもよろしいですか？`)) return;
                    saveSettings({ ...settings, deliverableTypes: allTypes.filter(t => t.id !== id) });
                    setExpandedDeliverableIds(prev => { const s = new Set(prev); s.delete(id); return s; });
                };
                const handleToggleVcsType = (id: string, name: string, current: 'svn' | 'git') => {
                    const next = current === 'git' ? 'SVN' : 'Git';
                    if (!window.confirm(`種別「${name}」の VCS を ${next} に変更してもよろしいですか？`)) return;
                    saveSettings({
                        ...settings,
                        deliverableTypes: allTypes.map(t =>
                            t.id === id ? { ...t, vcsType: current === 'git' ? 'svn' : 'git' } : t
                        ),
                    });
                };

                const handleToggleWorkflowEnabled = (deliverableId: string, wfName: string) => {
                    saveSettings({
                        ...settings,
                        deliverableTypes: allTypes.map(t => {
                            if (t.id !== deliverableId) return t;
                            const has = t.workflowSettings.some((ws: WorkflowSetting) => ws.workflowName === wfName);
                            return {
                                ...t,
                                workflowSettings: has
                                    ? t.workflowSettings.filter((ws: WorkflowSetting) => ws.workflowName !== wfName)
                                    : [...t.workflowSettings, { workflowName: wfName, allowedRoles: [...MEMBER_ROLES] } as WorkflowSetting],
                            };
                        }),
                    });
                };
                const handleToggleRoleForWorkflow = (deliverableId: string, wfName: string, role: string) => {
                    saveSettings({
                        ...settings,
                        deliverableTypes: allTypes.map(t => {
                            if (t.id !== deliverableId) return t;
                            return {
                                ...t,
                                workflowSettings: t.workflowSettings.map((ws: WorkflowSetting) => {
                                    if (ws.workflowName !== wfName) return ws;
                                    const has = ws.allowedRoles.includes(role);
                                    return { ...ws, allowedRoles: has ? ws.allowedRoles.filter((r: string) => r !== role) : [...ws.allowedRoles, role] };
                                }),
                            };
                        }),
                    });
                };

                const toggleExpand = (id: string) => {
                    setExpandedDeliverableIds(prev => {
                        const s = new Set(prev);
                        s.has(id) ? s.delete(id) : s.add(id);
                        return s;
                    });
                };

                const getNewRequired = (phaseCode: string) => deliverableTypeRequiredFlags[phaseCode] ?? true;
                const getNewVcs = (phaseCode: string): 'svn' | 'git' => deliverableTypeVcsFlags[phaseCode] ?? 'svn';

                const renderPhaseSection = (phaseCode: string, label: string) => {
                    const items = allTypes.filter(t => t.phaseCode === phaseCode);
                    const inputVal = deliverableTypeInputs[phaseCode] || "";
                    const isRequired = getNewRequired(phaseCode);
                    const newVcs = getNewVcs(phaseCode);
                    return (
                        <div key={phaseCode} className="border-2 border-indigo-200 rounded-xl overflow-hidden shadow-sm">
                            <div className="px-4 py-3 flex items-center gap-2 bg-indigo-50 border-b-2 border-indigo-200">
                                <span className="text-sm font-bold text-indigo-800">{label}</span>
                                <span className="text-xs text-indigo-400 font-normal">({items.length}件)</span>
                            </div>
                            <div className="p-4 bg-white space-y-2">
                                {items.length === 0 && <p className="text-xs text-gray-500 italic">登録なし</p>}
                                {items.map(item => {
                                    const isExpanded = expandedDeliverableIds.has(item.id);
                                    const wfCount = item.workflowSettings.length;
                                    return (
                                        <div key={item.id} className="border border-gray-300 rounded-lg overflow-hidden">
                                            {/* 種別行 */}
                                            <div className="flex items-center gap-2 px-3 py-2 bg-white group">
                                                <span className="flex-1 text-sm font-medium text-gray-800">{item.name}</span>
                                                <button
                                                    onClick={() => handleToggleRequired(item.id, item.name, item.required)}
                                                    className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors ${item.required ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                                                >
                                                    {item.required ? "必須" : "任意"}
                                                </button>
                                                <button
                                                    onClick={() => handleToggleVcsType(item.id, item.name, item.vcsType === 'git' ? 'git' : 'svn')}
                                                    title="クリックで SVN / Git を切り替え"
                                                    className={`shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold transition-colors ${
                                                        item.vcsType === 'git'
                                                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                                    }`}
                                                >
                                                    {item.vcsType === 'git' ? 'Git' : 'SVN'}
                                                </button>
                                                <button
                                                    onClick={() => toggleExpand(item.id)}
                                                    className={`shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors ${wfCount > 0 ? "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100" : "bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100"}`}
                                                >
                                                    WF {wfCount}件
                                                    <ChevronRight size={12} className={`transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteDeliverableType(item.id, item.name)}
                                                    className="shrink-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X size={15} />
                                                </button>
                                            </div>
                                            {/* ワークフロー設定パネル */}
                                            {isExpanded && (
                                                <div className="border-t border-gray-300 px-3 py-3 bg-gray-50">
                                                    {workflows.length === 0 ? (
                                                        <p className="text-xs text-gray-400 italic">ワークフローマスタにワークフローが登録されていません</p>
                                                    ) : (
                                                        <table className="w-full text-xs">
                                                            <thead>
                                                                <tr className="border-b-2 border-indigo-200 bg-indigo-50">
                                                                    <th className="px-2 py-1.5 text-left font-bold text-indigo-800 w-32">ワークフロー</th>
                                                                    {MEMBER_ROLES.map(role => (
                                                                        <th key={role} className="px-1 py-1.5 text-center font-bold text-indigo-800 w-14">{role}</th>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-gray-200">
                                                                {workflows.map(wf => {
                                                                    const wsSetting = item.workflowSettings.find((ws: WorkflowSetting) => ws.workflowName === wf);
                                                                    const isEnabled = !!wsSetting;
                                                                    return (
                                                                        <tr key={wf} className={`${!isEnabled ? "opacity-40" : "bg-white"}`}>
                                                                            <td className="px-2 py-1.5">
                                                                                <label className="flex items-center gap-1.5 cursor-pointer">
                                                                                    <input type="checkbox" checked={isEnabled} onChange={() => handleToggleWorkflowEnabled(item.id, wf)} className="accent-indigo-600" />
                                                                                    <span className="font-medium text-gray-800">{wf}</span>
                                                                                </label>
                                                                            </td>
                                                                            {MEMBER_ROLES.map(role => (
                                                                                <td key={role} className="px-1 py-1.5 text-center">
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={isEnabled && (wsSetting?.allowedRoles.includes(role) ?? false)}
                                                                                        disabled={!isEnabled}
                                                                                        onChange={() => isEnabled && handleToggleRoleForWorkflow(item.id, wf, role)}
                                                                                        className="accent-indigo-600 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                                                                                    />
                                                                                </td>
                                                                            ))}
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {/* 追加フォーム */}
                                <div className="flex gap-2 items-center pt-1">
                                    <input
                                        type="text"
                                        value={inputVal}
                                        onChange={(e) => setDeliverableTypeInputs(prev => ({ ...prev, [phaseCode]: e.target.value }))}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleAddDeliverableType(phaseCode, isRequired, newVcs); }}
                                        placeholder="種別名を入力"
                                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    />
                                    <button
                                        onClick={() => setDeliverableTypeRequiredFlags(prev => ({ ...prev, [phaseCode]: !isRequired }))}
                                        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${isRequired ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" : "bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100"}`}
                                    >
                                        {isRequired ? "必須" : "任意"}
                                    </button>
                                    <button
                                        onClick={() => setDeliverableTypeVcsFlags(prev => ({ ...prev, [phaseCode]: newVcs === 'svn' ? 'git' : 'svn' }))}
                                        className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${newVcs === 'git' ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100" : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"}`}
                                    >
                                        {newVcs === 'git' ? 'Git' : 'SVN'}
                                    </button>
                                    <button
                                        onClick={() => handleAddDeliverableType(phaseCode, isRequired, newVcs)}
                                        disabled={!inputVal.trim()}
                                        className="shrink-0 bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <Plus size={15} />
                                        追加
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                };

                return (
                    <section className="space-y-4">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-1">
                                <FileText size={20} className="text-gray-500" />
                                成果物設定
                            </h3>
                            <p className="text-sm text-gray-500">ワークフローマスタの管理と、工程ごとの成果物種別・ワークフロー設定を行います。</p>
                        </div>

                        {/* ワークフローマスタ */}
                        <div className="bg-white rounded-xl shadow-sm border-2 border-indigo-200 overflow-hidden">
                            <div className="px-4 py-3 bg-indigo-50 border-b-2 border-indigo-200 flex items-center gap-2">
                                <span className="text-sm font-bold text-indigo-800">ワークフローマスタ</span>
                                <span className="text-xs text-indigo-400">({workflows.length}件)</span>
                            </div>
                            <div className="p-4">
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {workflows.map((wf: string, index: number) => (
                                        <div
                                            key={wf}
                                            draggable
                                            onDragStart={() => handleWorkflowDragStart(index)}
                                            onDragOver={(e) => handleWorkflowDragOver(e, index)}
                                            onDrop={() => handleWorkflowDrop(index)}
                                            onDragEnd={handleWorkflowDragEnd}
                                            className={[
                                                "flex items-center gap-1 px-3 py-1 border rounded-full group cursor-grab active:cursor-grabbing select-none transition-all",
                                                draggingWorkflowIndex === index
                                                    ? "opacity-40 border-indigo-300 bg-indigo-50"
                                                    : dragOverWorkflowIndex === index
                                                    ? "border-indigo-400 bg-indigo-50 scale-105"
                                                    : "border-gray-300 hover:bg-gray-50",
                                            ].join(" ")}
                                        >
                                            <span className="text-xs text-gray-400 mr-0.5">{index + 1}.</span>
                                            <span className="text-sm font-medium text-gray-800">{wf}</span>
                                            <button
                                                onClick={() => handleDeleteWorkflow(wf)}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                                            >
                                                <X size={13} />
                                            </button>
                                        </div>
                                    ))}
                                    {workflows.length === 0 && <p className="text-xs text-gray-400 italic py-1">ワークフローが登録されていません</p>}
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={newWorkflowName}
                                        onChange={(e) => setNewWorkflowName(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleAddWorkflow(); }}
                                        placeholder="ワークフロー名を入力"
                                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    />
                                    <button onClick={handleAddWorkflow} disabled={!newWorkflowName.trim()} className="shrink-0 bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                                        <Plus size={15} />
                                        追加
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* 工程別成果物種別 */}
                        {activePhaseCodes.map((p: { code: PhaseCode; name: string }) =>
                            renderPhaseSection(p.code, `${p.code}：${p.name}`)
                        )}
                    </section>
                );
            })()}

            {/* Action Item Categories Configuration */}
            {effectiveTab === "actionItemCategories" && (() => {
                const categories: string[] = settings.actionItemCategories || [];
                const addCategory = () => {
                    const name = newActionCategory.trim();
                    if (!name || categories.includes(name)) return;
                    saveSettings({ ...settings, actionItemCategories: [...categories, name] });
                    setNewActionCategory("");
                };
                const deleteCategory = (cat: string) => {
                    saveSettings({ ...settings, actionItemCategories: categories.filter(c => c !== cat) });
                };
                const deleteRoles: string[] = settings.actionItemDeleteRoles || [];
                const toggleDeleteRole = (role: string) => {
                    const enabled = deleteRoles.includes(role);
                    const updated = enabled ? deleteRoles.filter(r => r !== role) : [...deleteRoles, role];
                    saveSettings({ ...settings, actionItemDeleteRoles: updated });
                };
                return (
                    <section className="space-y-4">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                            <div className="mb-6">
                                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <ClipboardList size={20} className="text-gray-500" />
                                    カテゴリ設定
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">アクションアイテム追加時に選択できる種別（カテゴリ）を管理します。</p>
                            </div>

                            <div className="flex gap-2 mb-6">
                                <input
                                    type="text"
                                    value={newActionCategory}
                                    onChange={(e) => setNewActionCategory(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
                                    placeholder="カテゴリ名（例：事前準備、調査、その他タスク）"
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                />
                                <button onClick={addCategory} disabled={!newActionCategory.trim()} className="shrink-0 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                                    <Plus size={15} />
                                    追加
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {categories.length === 0 ? (
                                    <p className="text-sm text-gray-400 italic py-1">カテゴリが登録されていません。追加するとアクションアイテムの種別として選択できます。</p>
                                ) : categories.map((cat) => (
                                    <div key={cat} className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-full group hover:bg-gray-50">
                                        <span className="text-sm font-medium text-gray-800">{cat}</span>
                                        <button
                                            onClick={() => deleteCategory(cat)}
                                            className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                                        >
                                            <X size={13} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                            <div className="mb-6">
                                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <KeyRound size={20} className="text-gray-500" />
                                    削除権限
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">アクションアイテムを削除できるロールを選択してください。Admin は常に削除可能です。</p>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                {MEMBER_ROLES.filter(r => r !== 'Admin').map(role => {
                                    const enabled = deleteRoles.includes(role);
                                    return (
                                        <div
                                            key={role}
                                            className={`flex items-center justify-between w-64 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all ${enabled ? "border-indigo-200 bg-indigo-50" : "border-gray-300 bg-gray-50 opacity-60"}`}
                                            onClick={() => toggleDeleteRole(role)}
                                        >
                                            <span className={`font-bold ${enabled ? "text-indigo-800" : "text-gray-500"}`}>{role}</span>
                                            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${enabled ? "bg-indigo-200 text-indigo-800" : "bg-gray-200 text-gray-600"}`}>{enabled ? "許可" : "不可"}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>
                );
            })()}

            {/* Tags Configuration（タスク・アクションアイテム共通） */}
            {effectiveTab === "tags" && (() => {
                const tags: string[] = settings.tags || [];
                const addTag = () => {
                    const name = newActionTag.trim();
                    if (!name || tags.includes(name)) return;
                    saveSettings({ ...settings, tags: [...tags, name] });
                    setNewActionTag("");
                };
                const deleteTag = (tag: string) => {
                    saveSettings({ ...settings, tags: tags.filter(t => t !== tag) });
                };
                return (
                    <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                        <div className="mb-6">
                            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                <Tag size={20} className="text-gray-500" />
                                タグ設定
                            </h3>
                            <p className="text-sm text-gray-500 mt-1">タスク・アクションアイテムに付けられるタグを管理します。要件・開発・工程外タスクとアクションアイテムで共通のタグを使用します（複数選択可）。</p>
                        </div>

                        <div className="flex gap-2 mb-6">
                            <input
                                type="text"
                                value={newActionTag}
                                onChange={(e) => setNewActionTag(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") addTag(); }}
                                placeholder="タグ名（例：至急、要相談、外部依頼）"
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                            <button onClick={addTag} disabled={!newActionTag.trim()} className="shrink-0 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                                <Plus size={15} />
                                追加
                            </button>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {tags.length === 0 ? (
                                <p className="text-sm text-gray-400 italic py-1">タグが登録されていません。追加するとタスク・アクションアイテムに付けられます。</p>
                            ) : tags.map((tag) => (
                                <div key={tag} className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-full group hover:bg-gray-50">
                                    <span className="text-sm font-medium text-gray-800">{tag}</span>
                                    <button
                                        onClick={() => deleteTag(tag)}
                                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                                    >
                                        <X size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                );
            })()}

            {/* Statuses Configuration */}
            {effectiveTab === "statuses" && (
                <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-300">
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <Tag size={20} className="text-gray-500" />
                            ステータス設定
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">タスクに設定できるステータスを管理します。</p>
                    </div>

                    <div className="flex gap-2 mb-6">
                        <input
                            type="text"
                            value={newStatusName}
                            onChange={(e) => setNewStatusName(e.target.value)}
                            placeholder="ステータス名（例：確認待ち）"
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    const name = newStatusName.trim();
                                    if (name && !globalSettings.taskStatuses.includes(name)) {
                                        saveTaskStatuses([...globalSettings.taskStatuses, name]);
                                        setNewStatusName("");
                                    }
                                }
                            }}
                        />
                        <button
                            onClick={() => {
                                const name = newStatusName.trim();
                                if (name && !globalSettings.taskStatuses.includes(name)) {
                                    saveTaskStatuses([...globalSettings.taskStatuses, name]);
                                    setNewStatusName("");
                                }
                            }}
                            className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-medium"
                        >
                            <Plus size={18} />
                            追加
                        </button>
                    </div>

                    <div className="space-y-2">
                        {globalSettings.taskStatuses.map((status: string, index: number) => (
                            <div
                                key={status}
                                draggable
                                onDragStart={() => setDraggingStatusIndex(index)}
                                onDragOver={(e) => { e.preventDefault(); setDragOverStatusIndex(index); }}
                                onDrop={() => {
                                    if (draggingStatusIndex === null || draggingStatusIndex === index) return;
                                    const reordered = [...globalSettings.taskStatuses];
                                    const [moved] = reordered.splice(draggingStatusIndex, 1);
                                    reordered.splice(index, 0, moved);
                                    if (!window.confirm(`ステータスの順番を変更してもよろしいですか？\n\n${reordered.map((s, i) => `${i + 1}. ${s}`).join("\n")}`)) return;
                                    saveTaskStatuses(reordered);
                                    setDraggingStatusIndex(null);
                                    setDragOverStatusIndex(null);
                                }}
                                onDragEnd={() => { setDraggingStatusIndex(null); setDragOverStatusIndex(null); }}
                                className={[
                                    "flex items-center justify-between px-4 py-2.5 border rounded-lg group cursor-grab active:cursor-grabbing select-none transition-all",
                                    draggingStatusIndex === index
                                        ? "opacity-40 border-indigo-300 bg-indigo-50"
                                        : dragOverStatusIndex === index
                                        ? "border-indigo-400 bg-indigo-50 scale-[1.02]"
                                        : "border-gray-300 hover:bg-gray-50",
                                ].join(" ")}
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-400 w-5 text-right">{index + 1}</span>
                                    <span className="text-sm font-medium text-gray-800">{status}</span>
                                </div>
                                <button
                                    onClick={() => {
                                        if (!window.confirm(`ステータス「${status}」を削除してもよろしいですか？`)) return;
                                        saveTaskStatuses(globalSettings.taskStatuses.filter((s: string) => s !== status));
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        ))}
                        {globalSettings.taskStatuses.length === 0 && <p className="text-center py-8 text-gray-400 italic">ステータスが登録されていません</p>}
                    </div>
                </section>
            )}
        </div>
    );
};
