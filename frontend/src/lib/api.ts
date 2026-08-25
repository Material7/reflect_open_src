const BASE_URL = '/api';

const TOKEN_KEY = 'reflect_jwt';

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  remove: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStorage.get();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    tokenStorage.remove();
    window.location.href = '/';
    throw new Error('認証が必要です');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface LoginResponse {
  token: string;
  employeeNumber: string;
  name: string;
  role: string;
  svnUsername?: string;
  svnPasswordSet?: boolean;
  gitUsername?: string;
  gitPasswordSet?: boolean;
}

export const authApi = {
  login: (employeeNumber: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ employeeNumber, password }),
    }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<LoginResponse>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

export const credentialsApi = {
  update: (data: {
    svnUsername?: string;
    svnPassword?: string;
    gitUsername?: string;
    gitPassword?: string;
  }) =>
    request<void>('/auth/me/credentials', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};

export interface VcsCredential {
  id: string;
  type: 'SVN' | 'GIT';
  host: string;        // "" = 既定（ホスト未一致時のフォールバック）
  username: string;
  passwordSet: boolean;
}

/** サーバー（ホスト）単位の VCS 認証情報。マイページで複数登録可能 */
export const vcsCredentialsApi = {
  list: () => request<VcsCredential[]>('/auth/me/vcs-credentials'),
  save: (data: { id?: string; type: 'SVN' | 'GIT'; host: string; username: string; password?: string }) =>
    request<VcsCredential>('/auth/me/vcs-credentials', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<void>(`/auth/me/vcs-credentials/${id}`, { method: 'DELETE' }),
};

import type { Project } from '@/types';

export const projectsApi = {
  list: () => request<Project[]>('/projects'),
  create: (code: string, name: string) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ code, name }),
    }),
  update: (id: number, patch: { name?: string; status?: string }) =>
    request<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  members: (id: number) => request<unknown[]>(`/projects/${id}/members`),
  upsertMember: (id: number, body: Record<string, unknown>) =>
    request<unknown>(`/projects/${id}/members`, { method: 'POST', body: JSON.stringify(body) }),
  removeMember: (id: number, memberId: number) =>
    request<void>(`/projects/${id}/members/${memberId}`, { method: 'DELETE' }),
};

export const globalSettingsApi = {
  get: () => request<{ changeLogViewRoles: string[]; taskStatuses: string[] }>('/global-settings'),
  update: (body: { changeLogViewRoles?: string[]; taskStatuses?: string[] }) =>
    request<{ changeLogViewRoles: string[]; taskStatuses: string[] }>('/global-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

export const settingsApi = {
  get: (projectId: number) =>
    request<Record<string, unknown>>(`/projects/${projectId}/settings`),
  update: (projectId: number, settings: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/projects/${projectId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};

export const tasksApi = {
  getAll: (projectId?: number, type?: string) => {
    const qs = new URLSearchParams();
    if (projectId !== undefined) qs.set('projectId', String(projectId));
    if (type) qs.set('type', type);
    const q = qs.toString();
    return request<unknown[]>(`/tasks${q ? `?${q}` : ''}`);
  },
  create: (task: unknown) =>
    request<unknown>('/tasks', { method: 'POST', body: JSON.stringify(task) }),
  update: (id: string, task: unknown) =>
    request<unknown>(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(task) }),
  delete: (id: string) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE' }),
};

import type { Holiday } from '@/types';

export const holidaysApi = {
  list: () => request<Holiday[]>('/holidays'),
  create: (holiday: Omit<Holiday, 'id'> & { id?: string }) =>
    request<Holiday>('/holidays', { method: 'POST', body: JSON.stringify(holiday) }),
  batchCreate: (holidays: Holiday[]) =>
    request<Holiday[]>('/holidays/batch', { method: 'POST', body: JSON.stringify(holidays) }),
  delete: (id: string) =>
    request<void>(`/holidays/${id}`, { method: 'DELETE' }),
};

import type { TaskChangeLogPage, TaskChangeLog } from '@/types';

export const changeLogApi = {
  list: (params: {
    projectId?: number;
    page?: number;
    size?: number;
    operation?: string;
    taskDisplayId?: string;
    changedBy?: string;
    fromDate?: string;
    toDate?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.projectId !== undefined) qs.set('projectId', String(params.projectId));
    if (params.page !== undefined) qs.set('page', String(params.page));
    if (params.size !== undefined) qs.set('size', String(params.size));
    if (params.operation) qs.set('operation', params.operation);
    if (params.taskDisplayId) qs.set('taskDisplayId', params.taskDisplayId);
    if (params.changedBy) qs.set('changedBy', params.changedBy);
    if (params.fromDate) qs.set('fromDate', params.fromDate);
    if (params.toDate) qs.set('toDate', params.toDate);
    return request<TaskChangeLogPage>(`/change-logs?${qs.toString()}`);
  },
  byTask: (taskId: string) =>
    request<TaskChangeLog[]>(`/change-logs/task/${taskId}`),
};

import type { ApiKey, ApiKeyCreated } from '@/types';

export const apiKeyApi = {
  list: () => request<ApiKey[]>('/auth/api-keys'),
  generate: () =>
    request<ApiKeyCreated>('/auth/api-keys', { method: 'POST' }),
  revoke: (id: string) =>
    request<void>(`/auth/api-keys/${id}`, { method: 'DELETE' }),
};

export const gitApi = {
  getLogs: (url: string, branch?: string) => {
    const qs = new URLSearchParams({ url });
    if (branch && branch.trim()) qs.set('branch', branch.trim());
    return request<SvnLogEntry[]>(`/git/logs?${qs.toString()}`);
  },
  /** リポジトリURLからブランチ名一覧を取得 */
  listBranches: (url: string) =>
    request<string[]>(`/git/branches?url=${encodeURIComponent(url)}`),
};

export interface MentionView {
  id: string;
  taskId: string;
  taskDisplayId: string | null;
  taskName: string | null;
  taskType: string | null;        // "Requirement" | "Development" など
  projectId: number;
  commentId: string;
  snippet: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  read: boolean;
}

export const mentionsApi = {
  list: () => request<MentionView[]>('/me/mentions'),
  unreadCount: () => request<{ count: number }>('/me/mentions/unread-count'),
  markReadByTask: (taskId: string) =>
    request<void>('/me/mentions/read', { method: 'POST', body: JSON.stringify({ taskId }) }),
};

import type { ScheduleEvent, ActionItem } from '@/types';

export const actionItemsApi = {
  getAll: (projectId?: number) =>
    request<ActionItem[]>(`/action-items${projectId !== undefined ? `?projectId=${projectId}` : ''}`),
  create: (item: Omit<ActionItem, 'id' | 'createdBy' | 'createdAt'>) =>
    request<ActionItem>('/action-items', { method: 'POST', body: JSON.stringify(item) }),
  update: (id: string, item: Omit<ActionItem, 'id' | 'createdBy' | 'createdAt'>) =>
    request<ActionItem>(`/action-items/${id}`, { method: 'PUT', body: JSON.stringify(item) }),
  delete: (id: string) =>
    request<void>(`/action-items/${id}`, { method: 'DELETE' }),
};

import type { Survey, SurveyDto, SurveyResponse, SurveyResults, SurveyAnswerValue } from '@/types';

/** 作成/更新時に送る survey ペイロード（id/createdBy/createdAt はサーバ採番） */
type SurveyInput = Omit<Survey, 'id' | 'createdBy' | 'createdAt'> & { id?: string };

export const surveysApi = {
  getAll: (projectId?: number) =>
    request<SurveyDto[]>(`/surveys${projectId !== undefined ? `?projectId=${projectId}` : ''}`),
  get: (id: string) => request<SurveyDto>(`/surveys/${id}`),
  create: (survey: SurveyInput) =>
    request<SurveyDto>('/surveys', { method: 'POST', body: JSON.stringify(survey) }),
  update: (id: string, survey: SurveyInput) =>
    request<SurveyDto>(`/surveys/${id}`, { method: 'PUT', body: JSON.stringify(survey) }),
  delete: (id: string) =>
    request<void>(`/surveys/${id}`, { method: 'DELETE' }),
  submitResponse: (id: string, answers: Record<string, SurveyAnswerValue>) =>
    request<SurveyResponse>(`/surveys/${id}/responses`, { method: 'POST', body: JSON.stringify(answers) }),
  myResponse: (id: string) =>
    request<SurveyResponse | null>(`/surveys/${id}/responses/me`),
  results: (id: string) =>
    request<SurveyResults>(`/surveys/${id}/results`),
};

export const scheduleApi = {
  getAll: (projectId?: number) =>
    request<ScheduleEvent[]>(`/schedule-events${projectId !== undefined ? `?projectId=${projectId}` : ''}`),
  create: (event: Omit<ScheduleEvent, 'id' | 'createdBy' | 'createdAt'>) =>
    request<ScheduleEvent>('/schedule-events', { method: 'POST', body: JSON.stringify(event) }),
  update: (id: string, event: Omit<ScheduleEvent, 'id' | 'createdBy' | 'createdAt'>) =>
    request<ScheduleEvent>(`/schedule-events/${id}`, { method: 'PUT', body: JSON.stringify(event) }),
  delete: (id: string) =>
    request<void>(`/schedule-events/${id}`, { method: 'DELETE' }),
};

export const membersApi = {
  getAll: () => request<unknown[]>('/members'),
  create: (member: unknown) =>
    request<unknown>('/members', { method: 'POST', body: JSON.stringify(member) }),
  update: (id: number, member: unknown) =>
    request<unknown>(`/members/${id}`, { method: 'PUT', body: JSON.stringify(member) }),
  delete: (id: number) =>
    request<void>(`/members/${id}`, { method: 'DELETE' }),
};

const pq = (projectId?: number) => (projectId !== undefined ? `?projectId=${projectId}` : '');

export const statsApi = {
  summary:       (projectId?: number) => request<Record<string, number>>(`/stats/summary${pq(projectId)}`),
  alerts:        (projectId?: number) => request<Record<string, unknown>[]>(`/stats/alerts${pq(projectId)}`),
  phaseProgress: (projectId?: number) => request<Record<string, unknown>[]>(`/stats/phase-progress${pq(projectId)}`),
  byMember:      (projectId?: number) => request<Record<string, unknown>[]>(`/stats/by-member${pq(projectId)}`),
};

export interface TaskComment {
  id: string;
  taskId: string;
  content: string;
  createdBy: string;
  createdAt: string; // ISO datetime
}

export const commentsApi = {
  listAll: (projectId?: number) =>
    request<TaskComment[]>(`/tasks/comments${projectId !== undefined ? `?projectId=${projectId}` : ''}`),
  list: (taskId: string) => request<TaskComment[]>(`/tasks/${taskId}/comments`),
  create: (taskId: string, content: string) =>
    request<TaskComment>(`/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  delete: (taskId: string, commentId: string) =>
    request<void>(`/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' }),
};

export interface SvnLogEntry {
  revision: string;
  author: string;
  date: string;
  message: string;
}

export const svnApi = {
  getLogs: (url: string) =>
    request<SvnLogEntry[]>(`/svn/logs?url=${encodeURIComponent(url)}`),
};

