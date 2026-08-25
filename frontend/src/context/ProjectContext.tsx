import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { ProjectSettings, Task, Member, Project, ProjectMember, Holiday, Domain, DeliverableType, Survey, SurveyDto, SurveyAnswerValue } from '@/types';
import {
  authApi, settingsApi, tasksApi, projectsApi, membersApi, holidaysApi, globalSettingsApi,
  surveysApi, tokenStorage, LoginResponse,
} from '@/lib/api';

/** アンケート作成/更新のペイロード（id/createdBy/createdAt はサーバ採番） */
type SurveyInput = Omit<Survey, 'id' | 'createdBy' | 'createdAt'> & { id?: string };
import { PHASES, PhaseCode, INITIAL_WORK_STEP_CODE, TASK_STATUS_NAMES } from '@/lib/constants';

export const SETTINGS_ALLOWED_ROLES = ['Admin', 'PM', 'PL'] as const;

interface ProjectContextType {
  projects: Project[];
  /** 後方互換: 全プロジェクトのユニオンビュー（ドメイン/ステータス/メンバー等の名前解決用） */
  settings: ProjectSettings;
  settingsByProject: Record<number, ProjectSettings>;
  getSettings: (projectId: number) => ProjectSettings;
  /**
   * 当該プロジェクトでスキップ設定された工程。
   * タスク単位の判定はユニオンビューの settings.skippedPhases ではなく必ずこれを使う
   * （ユニオンだと他プロジェクトでスキップした工程まで除外されてしまう）。
   */
  skippedPhasesOf: (projectId: number) => PhaseCode[];
  getProjectMembers: (projectId: number) => ProjectMember[];
  isSystemAdmin: boolean;
  /**
   * 現在ユーザーの当該プロジェクトでのロールを解決する。
   * - システム Admin は全プロジェクトで 'Admin'（全権）
   * - それ以外は ProjectMember.role。未所属なら null
   */
  resolveProjectRole: (projectId: number) => string | null;
  /** 全プロジェクト横断のタスク（各タスクに projectId 付） */
  tasks: Task[];
  members: Member[];
  holidays: Holiday[];
  globalSettings: GlobalSettings;
  currentUser: Member | null;
  isLoading: boolean;
  /** プロジェクト別設定の保存（members/holidays/changeLogViewRoles は対象外） */
  updateSettings: (projectId: number, settings: ProjectSettings) => Promise<void>;
  createProject: (code: string, name: string) => Promise<Project>;
  addTask: (projectId: number, task: Omit<Task, 'taskId' | 'id' | 'projectId'>) => Promise<Task>;
  updateTask: (task: Task) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  reloadProjectMembers: (projectId: number) => Promise<void>;
  surveys: SurveyDto[];
  reloadSurveys: () => Promise<void>;
  createSurvey: (input: SurveyInput) => Promise<SurveyDto>;
  updateSurvey: (id: string, input: SurveyInput) => Promise<SurveyDto>;
  deleteSurvey: (id: string) => Promise<void>;
  submitSurveyResponse: (id: string, answers: Record<string, SurveyAnswerValue>) => Promise<void>;
  updateGlobalSettings: (patch: Partial<GlobalSettings>) => Promise<void>;
  createAccount: (data: { employeeNumber: string; name: string; role: string; password: string }) => Promise<void>;
  updateAccount: (id: number, data: { name?: string; role?: string; password?: string }) => Promise<void>;
  deleteAccount: (id: number) => Promise<void>;
  upsertProjectMember: (projectId: number, body: { employeeNumber?: string; memberId?: number; role: string; domainGroupIds?: string[] }) => Promise<void>;
  removeProjectMember: (projectId: number, memberId: number) => Promise<void>;
  addHoliday: (holiday: Holiday) => Promise<void>;
  addHolidays: (holidays: Holiday[]) => Promise<void>;
  deleteHoliday: (id: string) => Promise<void>;
  login: (employeeNumber: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

interface GlobalSettings {
  changeLogViewRoles: string[];
  taskStatuses: string[];
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const EMPTY_SETTINGS: ProjectSettings = {
  taskIdPrefix: 'TASK',
  taskIdCounterR: 1,
  taskIdCounterD: 1,
  taskStatuses: TASK_STATUS_NAMES,
  skippedPhases: [],
  domains: [],
  members: [],
  holidays: [],
  deliverableTypes: [],
  workflows: [],
  actionItemCategories: [],
  tags: [],
  actionItemDeleteRoles: [],
  taskDeleteRoles: [],
  excludeStepSelectRoles: [],
  changeLogViewRoles: [],
};

const buildInitialPhases = () => {
  const phases: Task['phases'] = {} as Task['phases'];
  PHASES.forEach(p => {
    phases[p.code as PhaseCode] = { currentWorkStepCode: INITIAL_WORK_STEP_CODE, schedule: {} };
  });
  return phases;
};

/** 全プロジェクトの設定をユニオンして1つの ProjectSettings ビューを作る（名前解決の後方互換用） */
const buildUnionSettings = (
  byProject: Record<number, ProjectSettings>,
  members: Member[],
  holidays: Holiday[],
): ProjectSettings => {
  const list = Object.values(byProject);
  if (list.length === 0) {
    return { ...EMPTY_SETTINGS, members, holidays };
  }
  const domains: Domain[] = [];
  const deliverableTypes: DeliverableType[] = [];
  const skipped = new Set<PhaseCode>();
  const workflows = new Set<string>();
  const actionItemCategories = new Set<string>();
  const tags = new Set<string>();
  for (const s of list) {
    (s.domains ?? []).forEach(d => domains.push(d));
    (s.deliverableTypes ?? []).forEach(dt => deliverableTypes.push(dt));
    (s.skippedPhases ?? []).forEach(p => skipped.add(p));
    (s.workflows ?? []).forEach(w => workflows.add(w));
    (s.actionItemCategories ?? []).forEach(c => actionItemCategories.add(c));
    (s.tags ?? []).forEach(t => tags.add(t));
  }
  const first = list[0];
  return {
    taskIdPrefix: first.taskIdPrefix,
    taskIdCounterR: first.taskIdCounterR,
    taskIdCounterD: first.taskIdCounterD,
    taskStatuses: EMPTY_SETTINGS.taskStatuses, // 呼び出し側で全社共通設定に差し替える
    skippedPhases: Array.from(skipped),
    domains,
    members,
    holidays,
    deliverableTypes,
    workflows: Array.from(workflows),
    actionItemCategories: Array.from(actionItemCategories),
    tags: Array.from(tags),
    actionItemDeleteRoles: first.actionItemDeleteRoles ?? [],
    taskDeleteRoles: first.taskDeleteRoles ?? [],
    excludeStepSelectRoles: first.excludeStepSelectRoles ?? [],
    changeLogViewRoles: first.changeLogViewRoles ?? [],
  };
};

export const ProjectProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<Member | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [settingsByProject, setSettingsByProject] = useState<Record<number, ProjectSettings>>({});
  const [membersByProject, setMembersByProject] = useState<Record<number, ProjectMember[]>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>({ changeLogViewRoles: [], taskStatuses: [] });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [surveys, setSurveys] = useState<SurveyDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const settingsByProjectRef = useRef(settingsByProject);
  settingsByProjectRef.current = settingsByProject;
  const membersByProjectRef = useRef(membersByProject);
  membersByProjectRef.current = membersByProject;
  const membersRef = useRef(members);
  membersRef.current = members;
  const holidaysRef = useRef(holidays);
  holidaysRef.current = holidays;

  // ユニオンビュー（taskStatuses はプロジェクト別ではなく全社共通設定を採用）
  const settings = (() => {
    const union = buildUnionSettings(settingsByProject, members, holidays);
    return { ...union, taskStatuses: globalSettings.taskStatuses.length ? globalSettings.taskStatuses : TASK_STATUS_NAMES };
  })();

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [projectList, rawTasks, meRes, rawMembers, rawHolidays, rawGlobal, rawSurveys] = await Promise.all([
        projectsApi.list(),
        tasksApi.getAll(),
        authApi.me(),
        membersApi.getAll().catch(() => []),
        holidaysApi.list().catch(() => []),
        globalSettingsApi.get().catch(() => ({ changeLogViewRoles: [], taskStatuses: [] })),
        surveysApi.getAll().catch(() => []),
      ]);
      const projs = projectList as Project[];
      setProjects(projs);
      setTasks(rawTasks as Task[]);
      setSurveys(rawSurveys as SurveyDto[]);
      setMembers(rawMembers as Member[]);
      setHolidays(rawHolidays as Holiday[]);
      setGlobalSettings(rawGlobal as GlobalSettings);
      setCurrentUser({
        id: 0,
        employeeNumber: meRes.employeeNumber,
        name: meRes.name,
        role: meRes.role,
      });

      // 各プロジェクトの設定・所属を並列ロード
      const settingsEntries = await Promise.all(
        projs.map(async p => {
          const [s, ms] = await Promise.all([
            settingsApi.get(p.id).catch(() => null),
            projectsApi.members(p.id).catch(() => []),
          ]);
          return { id: p.id, settings: s, members: ms as ProjectMember[] };
        }),
      );
      const sBy: Record<number, ProjectSettings> = {};
      const mBy: Record<number, ProjectMember[]> = {};
      for (const e of settingsEntries) {
        if (e.settings) sBy[e.id] = e.settings as unknown as ProjectSettings;
        mBy[e.id] = e.members;
      }
      setSettingsByProject(sBy);
      setMembersByProject(mBy);
    } catch {
      // 認証エラーは api.ts 側でリダイレクト処理
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tokenStorage.get()) {
      loadAll();
    } else {
      setIsLoading(false);
    }
  }, [loadAll]);

  const login = useCallback(async (employeeNumber: string, password: string): Promise<boolean> => {
    try {
      const res: LoginResponse = await authApi.login(employeeNumber, password);
      tokenStorage.set(res.token);
      setCurrentUser({ id: 0, employeeNumber: res.employeeNumber, name: res.name, role: res.role });
      await loadAll();
      return true;
    } catch {
      return false;
    }
  }, [loadAll]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    tokenStorage.remove();
    setCurrentUser(null);
    setProjects([]);
    setSettingsByProject({});
    setMembersByProject({});
    setMembers([]);
    setHolidays([]);
    setTasks([]);
    setSurveys([]);
  }, []);

  /** プロジェクト所属を Member 形式に変換（設定画面のメンバータブ後方互換用） */
  const projectMembersAsMembers = useCallback((projectId: number): Member[] => {
    return (membersByProject[projectId] ?? []).map(pm => ({
      id: pm.memberId,
      employeeNumber: pm.employeeNumber,
      name: pm.name,
      role: pm.role,
      domainGroupIds: pm.domainGroupIds ?? [],
      passwordSet: true,
    }));
  }, [membersByProject]);

  const getSettings = useCallback((projectId: number): ProjectSettings => {
    const base = settingsByProject[projectId] ?? EMPTY_SETTINGS;
    // メンバーはプロジェクト所属、祝日・ステータスは全社共通を注入（後方互換ビュー）
    return {
      ...base,
      members: projectMembersAsMembers(projectId),
      holidays,
      taskStatuses: globalSettings.taskStatuses.length ? globalSettings.taskStatuses : TASK_STATUS_NAMES,
    };
  }, [settingsByProject, projectMembersAsMembers, holidays, globalSettings.taskStatuses]);

  const getProjectMembers = useCallback((projectId: number): ProjectMember[] => {
    return membersByProject[projectId] ?? [];
  }, [membersByProject]);

  const skippedPhasesOf = useCallback((projectId: number): PhaseCode[] => {
    return settingsByProject[projectId]?.skippedPhases ?? [];
  }, [settingsByProject]);

  const isSystemAdmin = currentUser?.role === 'Admin';

  const resolveProjectRole = useCallback((projectId: number): string | null => {
    if (currentUser?.role === 'Admin') return 'Admin';
    if (!currentUser) return null;
    const pm = (membersByProject[projectId] ?? []).find(m => m.employeeNumber === currentUser.employeeNumber);
    return pm?.role ?? null;
  }, [currentUser, membersByProject]);

  const reloadProjectMembers = useCallback(async (projectId: number) => {
    const ms = await projectsApi.members(projectId).catch(() => []);
    setMembersByProject(prev => ({ ...prev, [projectId]: ms as ProjectMember[] }));
  }, []);

  const updateSettings = useCallback(async (projectId: number, newSettings: ProjectSettings) => {
    const payload = { ...newSettings } as Record<string, unknown>;
    delete payload.members;
    delete payload.holidays;
    delete payload.changeLogViewRoles;
    const updated = await settingsApi.update(projectId, payload);
    setSettingsByProject(prev => ({ ...prev, [projectId]: updated as unknown as ProjectSettings }));
  }, []);

  const updateGlobalSettings = useCallback(async (patch: Partial<GlobalSettings>) => {
    const updated = await globalSettingsApi.update(patch);
    setGlobalSettings(updated as GlobalSettings);
  }, []);

  const reloadAccounts = useCallback(async () => {
    const accts = await membersApi.getAll().catch(() => []);
    setMembers(accts as Member[]);
  }, []);

  const createAccount = useCallback(async (data: { employeeNumber: string; name: string; role: string; password: string }) => {
    await membersApi.create({ ...data, domainGroupIds: [] });
    await reloadAccounts();
  }, [reloadAccounts]);

  const updateAccount = useCallback(async (id: number, data: { name?: string; role?: string; password?: string }) => {
    const acct = membersRef.current.find(a => a.id === id);
    await membersApi.update(id, {
      employeeNumber: acct?.employeeNumber,
      name: data.name ?? acct?.name,
      role: data.role ?? acct?.role,
      password: data.password,
      domainGroupIds: acct?.domainGroupIds ?? [],
    });
    await reloadAccounts();
  }, [reloadAccounts]);

  const deleteAccount = useCallback(async (id: number) => {
    await membersApi.delete(id);
    await reloadAccounts();
  }, [reloadAccounts]);

  const upsertProjectMember = useCallback(async (projectId: number, body: { employeeNumber?: string; memberId?: number; role: string; domainGroupIds?: string[] }) => {
    await projectsApi.upsertMember(projectId, body as unknown as Record<string, unknown>);
    const ms = await projectsApi.members(projectId).catch(() => []);
    setMembersByProject(prev => ({ ...prev, [projectId]: ms as ProjectMember[] }));
  }, []);

  const removeProjectMember = useCallback(async (projectId: number, memberId: number) => {
    await projectsApi.removeMember(projectId, memberId);
    const ms = await projectsApi.members(projectId).catch(() => []);
    setMembersByProject(prev => ({ ...prev, [projectId]: ms as ProjectMember[] }));
  }, []);

  const addHoliday = useCallback(async (holiday: Holiday) => {
    const created = await holidaysApi.create(holiday);
    setHolidays(prev => [...prev, created as Holiday]);
  }, []);

  const addHolidays = useCallback(async (list: Holiday[]) => {
    await holidaysApi.batchCreate(list);
    const hols = await holidaysApi.list().catch(() => []);
    setHolidays(hols as Holiday[]);
  }, []);

  const deleteHoliday = useCallback(async (id: string) => {
    await holidaysApi.delete(id);
    setHolidays(prev => prev.filter(h => h.id !== id));
  }, []);

  const createProject = useCallback(async (code: string, name: string): Promise<Project> => {
    const created = await projectsApi.create(code, name);
    setProjects(prev => [...prev, created]);
    const [s, ms] = await Promise.all([
      settingsApi.get(created.id).catch(() => null),
      projectsApi.members(created.id).catch(() => []),
    ]);
    if (s) setSettingsByProject(prev => ({ ...prev, [created.id]: s as unknown as ProjectSettings }));
    setMembersByProject(prev => ({ ...prev, [created.id]: ms as ProjectMember[] }));
    return created;
  }, []);

  const reloadSurveys = useCallback(async () => {
    const list = await surveysApi.getAll().catch(() => []);
    setSurveys(list as SurveyDto[]);
  }, []);

  const upsertSurveyInList = useCallback((dto: SurveyDto) => {
    setSurveys(prev => {
      const idx = prev.findIndex(s => s.survey.id === dto.survey.id);
      if (idx === -1) return [dto, ...prev];
      const next = [...prev];
      next[idx] = dto;
      return next;
    });
  }, []);

  const createSurvey = useCallback(async (input: SurveyInput): Promise<SurveyDto> => {
    const created = await surveysApi.create(input);
    upsertSurveyInList(created);
    return created;
  }, [upsertSurveyInList]);

  const updateSurvey = useCallback(async (id: string, input: SurveyInput): Promise<SurveyDto> => {
    const updated = await surveysApi.update(id, input);
    upsertSurveyInList(updated);
    return updated;
  }, [upsertSurveyInList]);

  const deleteSurvey = useCallback(async (id: string) => {
    await surveysApi.delete(id);
    setSurveys(prev => prev.filter(s => s.survey.id !== id));
  }, []);

  const submitSurveyResponse = useCallback(async (id: string, answers: Record<string, SurveyAnswerValue>) => {
    await surveysApi.submitResponse(id, answers);
    // 回答数・自分の回答有無を反映するため当該アンケートを再取得
    const refreshed = await surveysApi.get(id).catch(() => null);
    if (refreshed) upsertSurveyInList(refreshed);
  }, [upsertSurveyInList]);

  const addTask = useCallback(async (projectId: number, task: Omit<Task, 'taskId' | 'id' | 'projectId'>): Promise<Task> => {
    // taskId はサーバ側でプロジェクト別カウンタから採番される
    const payload = {
      ...task,
      projectId,
      phases: task.phases ?? buildInitialPhases(),
    };
    const created = await tasksApi.create(payload) as Task;
    setTasks(prev => [...prev, created]);
    return created;
  }, []);

  const updateTask = useCallback(async (task: Task) => {
    const updated = await tasksApi.update(task.id, task);
    setTasks(prev => prev.map(t => t.id === task.id ? updated as Task : t));
  }, []);

  const deleteTask = useCallback(async (id: string) => {
    await tasksApi.delete(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ProjectContext.Provider value={{
      projects, settings, settingsByProject, getSettings, getProjectMembers, skippedPhasesOf,
      isSystemAdmin, resolveProjectRole,
      tasks, members, holidays, globalSettings, currentUser, isLoading,
      updateSettings, createProject, addTask, updateTask, deleteTask, reloadProjectMembers,
      surveys, reloadSurveys, createSurvey, updateSurvey, deleteSurvey, submitSurveyResponse,
      updateGlobalSettings, createAccount, updateAccount, deleteAccount,
      upsertProjectMember, removeProjectMember, addHoliday, addHolidays, deleteHoliday,
      login, logout,
    }}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject must be used within a ProjectProvider');
  return context;
};
