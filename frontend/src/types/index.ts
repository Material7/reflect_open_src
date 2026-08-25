import { PhaseCode } from '@/lib/constants';

export interface DomainGroup {
  id: string;
  name: string;
  leaderId: number; // Member.id
}

export interface Domain {
  id: string;
  name: string;
  groups: DomainGroup[];
}

export interface Member {
  id: number;
  employeeNumber: string;
  name: string;
  role: string;
  password?: string;      // 送信用（平文）。APIレスポンスには含まれない
  passwordSet?: boolean;  // APIレスポンスで返るフラグ
  domainGroupIds?: string[]; // DomainGroup.id[]
}

export interface Holiday {
  id: string;
  date: string;   // YYYY-MM-DD
  name: string;   // 例: "元日", "休業日"
}

export interface WorkflowSetting {
  workflowName: string;
  allowedRoles: string[]; // subset of ['Admin','PM','PL','DL','SL','Member']
}

export interface DeliverableType {
  id: string;
  name: string;
  phaseCode: string; // PhaseCode (e.g. 'RA', 'AD', 'DD')
  required: boolean; // true = 必須, false = 任意
  workflowSettings: WorkflowSetting[];
  vcsType?: 'svn' | 'git' | 'none'; // VCSリビジョンリスト取得に使うVCS種別
}

export interface Project {
  id: number;
  code: string;
  name: string;
  status: 'active' | 'archived';
  createdAt: string;
}

/** プロジェクト所属（メンバー × プロジェクト、プロジェクト別ロール） */
export interface ProjectMember {
  id?: number;
  projectId: number;
  memberId: number;
  employeeNumber: string;
  name: string;
  role: string;
  domainGroupIds: string[];
}

export interface ProjectSettings {
  /** 所属プロジェクトID（バックエンドのレスポンスに含まれる。ユニオンビューでは未設定） */
  projectId?: number;
  taskIdPrefix: string;
  taskIdCounterR: number;
  taskIdCounterD: number;
  taskStatuses: string[];
  skippedPhases: PhaseCode[];
  domains: Domain[];
  members: Member[];
  holidays: Holiday[];
  deliverableTypes: DeliverableType[];
  workflows: string[];
  /** アクションアイテムのカテゴリ（種別）一覧 */
  actionItemCategories: string[];
  /** プロジェクト共通のタグ一覧（タスク・アクションアイテムで共有、複数選択可） */
  tags: string[];
  /** アクションアイテムを削除できるロール一覧 */
  actionItemDeleteRoles: string[];
  taskDeleteRoles: string[];
  /** 除外扱いの作業工程（WORK_STEPS の role: "excluded"）を選択できるロール一覧 */
  excludeStepSelectRoles: string[];
  changeLogViewRoles: string[];
}

export interface WorkStepSchedule {
  workStepCode: string;
  plannedStartDate?: string; // YYYY-MM-DD
  actualStartDate?: string;
  plannedEndDate?: string;
  actualEndDate?: string;
  plannedManHours?: number;
  actualManHours?: number;
  plannedManHoursLog?: Record<string, number>;
  actualManHoursLog?: Record<string, number>;
  /** メンバー別実績工数ログ: employeeNumber -> date -> hours */
  actualManHoursPerMember?: Record<string, Record<string, number>>;
  /** メンバー別実績作業内容ログ: employeeNumber -> date -> 作業内容テキスト */
  actualWorkContentPerMember?: Record<string, Record<string, string>>;
  statusDetail?: string;
  /** 工程外タスクの実績作業記録ログ（実績工数 = この合計） */
  actualLog?: ActualLogEntry[];
}

export interface TaskPhaseData {
  currentWorkStepCode: string; // The code of the current step (e.g., 'MPC')
  schedule: Record<string, WorkStepSchedule>; // Keyed by workStepCode
  /** 週報向けの報告内容（工程単位。作業工程ごとの statusDetail とは別） */
  reportContent?: string;
}

export type TaskType = 'Requirement' | 'Development' | 'Indirect';

/** タスク優先度（未設定=null） */
export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';

/** 工程外タスクの実績作業記録（何を行って何時間使ったか） */
export interface ActualLogEntry {
  id: string;
  date: string;      // YYYY-MM-DD
  content: string;   // 作業内容
  hours: number;     // 工数（時間）
}

export type TaskStatus = string;

export interface Deliverable {
  type: string;
  name: string;
  workflow: string;
  revision: string;
  url: string;
  branch?: string;
}

/** 参照リソースの種別 */
export type TaskReferenceKind = 'web' | 'file' | 'svn' | 'git';

/** タスクが参照するリソース（サイトURL / ファイルパス / SVN・Git リポジトリ）。タスク単位で管理 */
export interface TaskReference {
  id: string;
  kind: TaskReferenceKind;
  label: string;
  value: string;
  /** リビジョン（svn / git。任意） */
  revision?: string;
  /** ブランチ（git。任意） */
  branch?: string;
  note?: string;
}

export interface Task {
  id: string;
  /** 所属プロジェクトID */
  projectId: number;
  taskId: string;
  type: TaskType;
  status: TaskStatus;
  priority?: TaskPriority | null;
  domainId: string;
  name: string;
  assignee: string;
  /** 紐づくチケットID（例: PROJ-123）。URLから自動抽出。未連携なら未設定 */
  ticketKey?: string;
  /** 紐づくチケットのURL。未連携なら未設定 */
  ticketUrl?: string;
  phases: Record<PhaseCode, TaskPhaseData>;
  deliverablesByPhase?: Record<string, Deliverable[]>;
  /** 参照リソース（サイトURL / ファイルパス / VCS）。タスク単位 */
  references?: TaskReference[];
  /** タグ（プロジェクト設定で定義したタグ名。複数選択可） */
  tags?: string[];
}

export interface TaskAlert {
  type: 'DELAY' | 'NO_UPDATE' | 'INCOMPLETE' | 'OTHER';
  message: string;
}

export interface TaskChangeLog {
  id: string;
  projectId: number | null;
  taskId: string | null;
  taskDisplayId: string | null;
  taskName: string | null;
  taskType: string | null;
  operation: string;
  changedBy: string;
  changedAt: string;        // ISO datetime
  phaseCode: string | null;
  workStepCode: string | null;
  deliverableName: string | null;
  oldValue: string | null;
  newValue: string | null;
}

export interface TaskChangeLogPage {
  content: TaskChangeLog[];
  totalElements: number;
  totalPages: number;
  number: number;           // 現在ページ (0-based)
}

export interface ScheduleEvent {
  id: string;
  projectId: number;
  type: 'milestone' | 'event';
  title: string;
  date: string;       // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD（イベントの終了日）
  description?: string;
  color?: string;     // "indigo" | "red" | "orange" | "green" | "purple" | "gray"
  createdBy: string;
  createdAt: string;  // ISO datetime
}

/** タスク発行前のアクションアイテム・開発工程外タスク */
export interface ActionItem {
  id: string;
  projectId: number;
  /** 表示用ID（例: TASK-A0001）。サーバ側で採番、不変 */
  itemId?: string;
  /** 種別: プロジェクト設定で定義したカテゴリ名 */
  category: string;
  title: string;
  assignee?: string | null;     // employeeNumber
  status: string;
  dueDate?: string | null;      // YYYY-MM-DD
  priority?: TaskPriority | null;
  /** タグ（プロジェクト設定で定義したタグ名。複数選択可） */
  tags?: string[];
  memo?: string | null;
  /** 紐づくチケットのURL（未連携なら null） */
  ticketUrl?: string | null;
  /** 紐づくチケットID（URLから抽出。未連携なら null） */
  ticketKey?: string | null;
  /** 発行先の正式タスク内部ID（未発行なら null） */
  issuedTaskId?: string | null;
  createdBy?: string;
  createdAt?: string;           // ISO datetime
}

export type SurveyStatus = 'draft' | 'open' | 'closed';
export type SurveyQuestionType = 'single' | 'multi' | 'text' | 'rating';
export type SurveyTargetType = 'members' | 'all';
/** 集計結果を見られる追加対象（作成者・PM・Admin は常時可のため含めない） */
export type SurveyResultAudience = 'pl' | 'dl' | 'sl' | 'respondents' | 'all';
/** 個別回答を特定できる追加対象（作成者・PM・Admin は常時可のため含めない） */
export type SurveyIdentityAudience = 'pl' | 'dl' | 'sl' | 'viewers';
export type SurveyResultTiming = 'after_close' | 'after_answer' | 'always';

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  title: string;
  required: boolean;
  /** single/multi の選択肢 */
  options?: string[];
  /** rating の段階数（既定5） */
  ratingMax?: number;
}

export interface Survey {
  id: string;
  /** 所属プロジェクトID。null = 全プロジェクト（全社アンケート） */
  projectId: number | null;
  title: string;
  description?: string;
  status: SurveyStatus;
  targetType: SurveyTargetType;
  /** 対象メンバーの employeeNumber 一覧（targetType='members' のとき） */
  targetMemberIds: string[];
  /** 回答期限 YYYY-MM-DD（任意） */
  dueDate?: string | null;
  questions: SurveyQuestion[];
  /** 集計結果を見られる追加対象（作成者・PM・Admin は常時可） */
  resultVisibleTo: SurveyResultAudience[];
  /** 個別回答を特定できる追加対象（作成者・PM・Admin は常時可） */
  identityVisibleTo: SurveyIdentityAudience[];
  resultTiming: SurveyResultTiming;
  createdBy?: string;
  createdAt?: string;
}

/** 回答値: 単一選択=string / 複数選択=string[] / 記述=string / 評価=number */
export type SurveyAnswerValue = string | string[] | number;

/** 一覧・作成・更新で返るDTO（survey本体＋バッジ用集計） */
export interface SurveyDto {
  survey: Survey;
  targetCount: number;
  respondentCount: number;
  targetedToMe: boolean;
  respondedByMe: boolean;
}

export interface SurveyResponse {
  id: string;
  surveyId: string;
  respondentEmployeeNumber: string;
  answers: Record<string, SurveyAnswerValue>;
  submittedAt?: string;
}

export interface SurveyQuestionAggregate {
  questionId: string;
  type: SurveyQuestionType;
  /** single/multi/rating: 選択肢ごとの件数（rating はキーが段階値） */
  optionCounts?: Record<string, number>;
  average?: number;
  /** text: 匿名化した回答テキスト一覧 */
  textAnswers?: string[];
}

export interface SurveyMemberRef {
  employeeNumber: string;
  name: string;
}

export interface SurveyNamedResponse {
  employeeNumber: string;
  name: string;
  submittedAt?: string;
  answers: Record<string, SurveyAnswerValue>;
}

export interface SurveyResults {
  surveyId: string;
  status: SurveyStatus;
  canSeeIdentity: boolean;
  targetCount: number;
  respondentCount: number;
  aggregates: SurveyQuestionAggregate[];
  /** canSeeIdentity 時のみ中身が入る */
  respondents: SurveyNamedResponse[];
  /** canSeeIdentity 時のみ中身が入る */
  unanswered: SurveyMemberRef[];
}

export interface ApiKey {
  id: string;
  keyPrefix: string;   // 例: "rfl_a3f2b1c4"
  name: string | null;
  createdAt: string;   // ISO datetime
  lastUsedAt: string | null;
}

/** 発行直後のみ key（平文）が含まれる */
export interface ApiKeyCreated extends ApiKey {
  key: string;
}
