import workStepsJson from "../../../shared/work-steps.json";
import phasesJson from "../../../shared/phases.json";
import taskStatusesJson from "../../../shared/task-statuses.json";
import actionItemStatusesJson from "../../../shared/action-item-statuses.json";

/** フェーズコード。定義元は shared/phases.json のため固定のユニオン型にはしない */
export type PhaseCode = string;

/** そのフェーズを実施するタスク種別 */
export type PhaseTarget = "Requirement" | "Development";

export type Priority = "HIGH" | "MEDIUM" | "LOW";
export const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
    { value: "HIGH", label: "高" },
    { value: "MEDIUM", label: "中" },
    { value: "LOW", label: "低" },
];
export const PRIORITY_LABEL: Record<Priority, string> = { HIGH: "高", MEDIUM: "中", LOW: "低" };
export const PRIORITY_BADGE: Record<Priority, string> = {
    HIGH: "bg-red-100 text-red-700",
    MEDIUM: "bg-amber-100 text-amber-700",
    LOW: "bg-gray-100 text-gray-500",
};
/** ソート順（高→中→低→未設定）。未設定は末尾 */
export const PRIORITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, "": 3 };

/** 工程外タスク用の擬似工程コード・名称（PHASES には含めない＝開発/要件のフローには影響しない） */
export const INDIRECT_PHASE_CODE = "EX" as const;
export const INDIRECT_PHASE_NAME = "工程外";

export interface PhaseMaster {
    code: PhaseCode;
    name: string;
    description: string;
    target: PhaseTarget;
}

/**
 * 作業工程が持つ特別な意味。アプリのロジックはコード名ではなくこの役割で分岐する。
 * - notStarted: 着手前。新規タスクの初期値になる（ちょうど1件必要）
 * - completed:  その工程の作業が完了した状態（複数可）
 * - excluded:   その工程を実施しない（集計から除外。ちょうど1件必要）
 * 役割を持たない工程はすべて「進行中」として扱われる。
 */
export type WorkStepRole = "notStarted" | "completed" | "excluded";

export interface WorkStepMaster {
    code: string;
    name: string;
    progress: number;
    role?: WorkStepRole;
    /** この工程を選ぶのに必要な最低ロール。未指定なら誰でも選択できる */
    selectRole?: string;
    /** この工程「から」の遷移制限。{ 遷移先コード: 最低ロール }。"any" は制限なし */
    transitionRoles?: Record<string, string>;
}

/**
 * フェーズマスタ。定義元は shared/phases.json（バックエンドも同じファイルを読む）。
 * フェーズのコード・名称・順序を変えるときはそのファイルだけを編集すればよい。
 * コンポーネントはフェーズコードを直接比較せず、必ず下のヘルパーを経由すること。
 */
export const PHASES: PhaseMaster[] = phasesJson.phases as PhaseMaster[];

const phaseCodesForTarget = (target: PhaseTarget): PhaseCode[] =>
    PHASES.filter(p => p.target === target).map(p => p.code);

/** 要件タスクのフェーズコード（target: "Requirement" はちょうど1件） */
export const REQUIREMENT_PHASE_CODE: PhaseCode = (() => {
    const codes = phaseCodesForTarget("Requirement");
    if (codes.length !== 1) {
        throw new Error(
            `PHASES の定義エラー: target="Requirement" のフェーズはちょうど1件必要です（現在 ${codes.length} 件）`,
        );
    }
    return codes[0];
})();

/** 開発タスクのフェーズコード（target: "Development"） */
export const DEVELOPMENT_PHASE_CODES: PhaseCode[] = (() => {
    const codes = phaseCodesForTarget("Development");
    if (codes.length === 0) {
        throw new Error('PHASES の定義エラー: target="Development" のフェーズが1件以上必要です');
    }
    return codes;
})();

/** 要件タスクのフェーズか */
export const isRequirementPhase = (code?: string | null): boolean => code === REQUIREMENT_PHASE_CODE;

/** そのタスク種別で実施するフェーズ一覧（定義順） */
export const phasesForTaskType = (taskType?: string | null): PhaseMaster[] =>
    PHASES.filter(p => p.target === taskType);

export const MEMBER_ROLES = ["Admin", "PM", "PL", "DL", "SL", "Member"] as const;

/** システムロール（全社権限）: Admin=システム管理者 / Member=一般。アカウントごとに1つ */
export const SYSTEM_ROLES = ["Admin", "Member"] as const;
export const systemRoleLabel = (role?: string | null): string => (role === "Admin" ? "管理者" : "一般");

/** プロジェクトロール（実務ロール）。システムロールの Admin は含めない */
export const PROJECT_ROLES = ["PM", "PL", "DL", "SL", "Member"] as const;

/** アンケート: 期限まで何日以内を「期限間近」とみなすか */
export const SURVEY_DUE_SOON_DAYS = 3;

export type SurveyDueState = "none" | "normal" | "due_soon" | "overdue";

/**
 * 回答期限の状態を算出する（未回答者視点。回答済みなら呼び出し側で扱いを分ける）。
 * dueDate は YYYY-MM-DD。基準日 today も同形式（省略時は当日）。
 */
export const surveyDueState = (dueDate?: string | null, today?: string): SurveyDueState => {
    if (!dueDate) return "none";
    const base = today ?? new Date().toISOString().slice(0, 10);
    const diffDays = Math.round(
        (new Date(dueDate + "T00:00:00").getTime() - new Date(base + "T00:00:00").getTime())
        / 86400000,
    );
    if (diffDays < 0) return "overdue";
    if (diffDays <= SURVEY_DUE_SOON_DAYS) return "due_soon";
    return "normal";
};

export const ROLE_HIERARCHY: Record<string, number> = {
    Admin: 0,
    PM: 1,
    PL: 2,
    DL: 3,
    SL: 4,
    Member: 5,
};

/**
 * 作業工程マスタ。定義元は shared/work-steps.json（バックエンドも同じファイルを読む）。
 * 工程のコード・名称・進捗率・個数を変えるときはそのファイルだけを編集すればよい。
 */
export const WORK_STEPS: WorkStepMaster[] = workStepsJson.workSteps as WorkStepMaster[];

// ── 作業工程の役割ヘルパー ────────────────────────────────────
// コンポーネントは工程コードを直接比較せず、必ずここを経由すること。
// これにより WORK_STEPS の編集だけでコード・名称・個数を変更できる。

const WORK_STEP_BY_CODE = new Map(WORK_STEPS.map(ws => [ws.code, ws]));

const codesWithRole = (role: WorkStepRole): string[] =>
    WORK_STEPS.filter(ws => ws.role === role).map(ws => ws.code);

const requireSingle = (role: WorkStepRole): string => {
    const codes = codesWithRole(role);
    if (codes.length !== 1) {
        throw new Error(
            `WORK_STEPS の定義エラー: role="${role}" の工程はちょうど1件必要です（現在 ${codes.length} 件）`,
        );
    }
    return codes[0];
};

/** 新規タスクの初期作業工程コード（role: "notStarted"） */
export const INITIAL_WORK_STEP_CODE = requireSingle("notStarted");

/**
 * 初期作業工程そのもの。工程が特定できないときの表示フォールバックに使う。
 * WORK_STEPS[0] を使うと定義順を入れ替えたときに壊れるため、必ずこちらを使うこと。
 */
export const INITIAL_WORK_STEP: WorkStepMaster =
    WORK_STEP_BY_CODE.get(INITIAL_WORK_STEP_CODE) as WorkStepMaster;

/** 「個別除外」に相当する作業工程コード（role: "excluded"） */
export const EXCLUDED_WORK_STEP_CODE = requireSingle("excluded");

/** 完了扱いの作業工程コード一覧（role: "completed"） */
export const COMPLETED_WORK_STEP_CODES = codesWithRole("completed");

export const workStepByCode = (code?: string | null): WorkStepMaster | undefined =>
    code ? WORK_STEP_BY_CODE.get(code) : undefined;

/**
 * 未設定（null / undefined / 空文字）は「未着手」として扱う。
 * マスタに無いコード（旧マスタの残骸など）は未着手ではなく進行中として扱う。
 */
export const isNotStartedStep = (code?: string | null): boolean =>
    !code || workStepByCode(code)?.role === "notStarted";

export const isCompletedStep = (code?: string | null): boolean =>
    workStepByCode(code)?.role === "completed";

export const isExcludedStep = (code?: string | null): boolean =>
    workStepByCode(code)?.role === "excluded";

/** 完了または除外。これ以上作業が発生しない状態 */
export const isTerminalStep = (code?: string | null): boolean =>
    isCompletedStep(code) || isExcludedStep(code);

/** 着手済みかつ未完了。遅延判定や進行中カウントの対象 */
export const isInProgressStep = (code?: string | null): boolean =>
    !isNotStartedStep(code) && !isTerminalStep(code);

// ── 作業工程のロール制限 ──────────────────────────────────────
// 制限そのものも shared/work-steps.json 側に持たせ、工程コードをここに直書きしない。
// これにより工程を差し替えても制限が追従する。

/** ロール名を ROLE_HIERARCHY のレベルに変換する。"any" は制限なし */
const roleLimitLevel = (code: string, role: string): number => {
    if (role === "any") return Infinity;
    const level = ROLE_HIERARCHY[role];
    if (level === undefined) {
        throw new Error(
            `WORK_STEPS の定義エラー: 工程 "${code}" に指定されたロール "${role}" は不明です`
            + `（使用できるのは ${Object.keys(ROLE_HIERARCHY).join(" / ")} または "any"）`,
        );
    }
    return level;
};

/** 作業工程自体の選択に必要な最大 ROLE_HIERARCHY レベル（遷移元に関係なく常に適用） */
export const WORK_STEP_ROLE_LIMIT: Record<string, number> = Object.fromEntries(
    WORK_STEPS
        .filter(ws => ws.selectRole !== undefined)
        .map(ws => [ws.code, roleLimitLevel(ws.code, ws.selectRole as string)]),
);

/**
 * 作業工程の遷移制限: from → to に必要な最大 ROLE_HIERARCHY レベル。
 * WORK_STEP_ROLE_LIMIT より優先される（緩和・強化どちらも可）。
 * 値が Infinity の遷移はどのロールでも可能（WORK_STEP_ROLE_LIMIT を無効化する）。
 */
export const WORK_STEP_TRANSITION_ROLE_LIMIT: Record<string, Record<string, number>> = Object.fromEntries(
    WORK_STEPS
        .filter(ws => ws.transitionRoles !== undefined)
        .map(ws => [
            ws.code,
            Object.fromEntries(
                Object.entries(ws.transitionRoles as Record<string, string>)
                    .map(([to, role]) => [to, roleLimitLevel(ws.code, role)]),
            ),
        ]),
);


// ── タスクステータス ──────────────────────────────────────────
// 定義元は shared/task-statuses.json（バックエンドも同じファイルを読む）。
// コンポーネントはステータス名を直接比較せず、必ずここのヘルパーを経由すること。
// これにより設定画面でステータスを入れ替えても判定と配色が追従する。

/**
 * ステータスが持つ特別な意味。アプリのロジックは名称ではなくこの役割で分岐する。
 * 管理者が設定画面で追加したステータスは役割を持たず、「その他」として扱われる。
 */
export type TaskStatusRole = "notStarted" | "inProgress" | "onHold" | "stopped" | "completed";

export interface TaskStatusMaster {
    name: string;
    role?: TaskStatusRole;
}

export const TASK_STATUSES: TaskStatusMaster[] = taskStatusesJson.taskStatuses as TaskStatusMaster[];

/** マスタ定義順のステータス名。新規プロジェクトの既定値になる */
export const TASK_STATUS_NAMES: string[] = TASK_STATUSES.map(s => s.name);

const TASK_STATUS_ROLE_BY_NAME = new Map(TASK_STATUSES.map(s => [s.name, s.role]));

const requireSingleStatus = (role: TaskStatusRole): string => {
    const names = TASK_STATUSES.filter(s => s.role === role).map(s => s.name);
    if (names.length !== 1) {
        throw new Error(
            `TASK_STATUSES の定義エラー: role="${role}" のステータスはちょうど1件必要です（現在 ${names.length} 件）`,
        );
    }
    return names[0];
};

/** 全工程が未着手のときのステータス（role: "notStarted"） */
export const NOT_STARTED_STATUS = requireSingleStatus("notStarted");
/** いずれかの工程に着手したときのステータス（role: "inProgress"） */
export const IN_PROGRESS_STATUS = requireSingleStatus("inProgress");
/** 全工程が完了/除外になったときのステータス（role: "completed"） */
export const COMPLETED_STATUS = requireSingleStatus("completed");

export const taskStatusRole = (status?: string | null): TaskStatusRole | undefined =>
    status ? TASK_STATUS_ROLE_BY_NAME.get(status) : undefined;

export const isNotStartedStatus = (status?: string | null): boolean => taskStatusRole(status) === "notStarted";
export const isInProgressStatus = (status?: string | null): boolean => taskStatusRole(status) === "inProgress";
export const isCompletedStatus  = (status?: string | null): boolean => taskStatusRole(status) === "completed";
export const isOnHoldStatus     = (status?: string | null): boolean => taskStatusRole(status) === "onHold";
export const isStoppedStatus    = (status?: string | null): boolean => taskStatusRole(status) === "stopped";

/** 保留・中止のように、選択に SL 以上のロールを要するステータスか */
export const isRestrictedStatus = (status?: string | null): boolean =>
    isOnHoldStatus(status) || isStoppedStatus(status);

/** 保留のステータス名（未定義なら undefined） */
export const ON_HOLD_STATUS: string | undefined = TASK_STATUSES.find(s => s.role === "onHold")?.name;
/** 中止のステータス名（未定義なら undefined） */
export const STOPPED_STATUS: string | undefined = TASK_STATUSES.find(s => s.role === "stopped")?.name;

/** 選択に SL 以上のロールを要するステータス名（表示用） */
export const RESTRICTED_STATUS_NAMES: string[] =
    TASK_STATUSES.filter(s => s.role === "onHold" || s.role === "stopped").map(s => s.name);

/** これ以上作業が発生しないステータス（完了・中止） */
export const isClosedStatus = (status?: string | null): boolean =>
    isCompletedStatus(status) || isStoppedStatus(status);

interface StatusColor { bg: string; text: string }

const STATUS_COLOR_BY_ROLE: Record<TaskStatusRole, StatusColor> = {
    notStarted: { bg: "#e0e7ff", text: "#4f46e5" },
    inProgress: { bg: "#eef2ff", text: "#4338ca" },
    onHold:     { bg: "#fef3c7", text: "#b45309" },
    stopped:    { bg: "#fee2e2", text: "#b91c1c" },
    completed:  { bg: "#dcfce7", text: "#15803d" },
};
const DEFAULT_STATUS_COLOR: StatusColor = { bg: "#f3f4f6", text: "#374151" };

/** ステータスの表示色（役割を持たないステータスはグレー） */
export const statusColor = (status?: string | null): StatusColor => {
    const role = taskStatusRole(status);
    return role ? STATUS_COLOR_BY_ROLE[role] : DEFAULT_STATUS_COLOR;
};

interface StatusBadge { bg: string; text: string; ring: string }

const STATUS_BADGE_BY_ROLE: Record<TaskStatusRole, StatusBadge> = {
    notStarted: { bg: "bg-gray-100",  text: "text-gray-600",  ring: "ring-gray-300" },
    inProgress: { bg: "bg-blue-100",  text: "text-blue-700",  ring: "ring-blue-300" },
    onHold:     { bg: "bg-amber-100", text: "text-amber-700", ring: "ring-amber-300" },
    stopped:    { bg: "bg-red-100",   text: "text-red-600",   ring: "ring-red-300" },
    completed:  { bg: "bg-green-100", text: "text-green-700", ring: "ring-green-300" },
};
const DEFAULT_STATUS_BADGE: StatusBadge = { bg: "bg-gray-100", text: "text-gray-600", ring: "ring-gray-300" };

/** ステータスの Tailwind バッジ配色（役割を持たないステータスはグレー） */
export const statusBadge = (status?: string | null): StatusBadge => {
    const role = taskStatusRole(status);
    return role ? STATUS_BADGE_BY_ROLE[role] : DEFAULT_STATUS_BADGE;
};

/** ステータスの Tailwind バッジ配色（背景＋文字色のクラス文字列） */
export const statusBadgeClass = (status?: string | null): string => {
    const badge = statusBadge(status);
    return `${badge.bg} ${badge.text}`;
};

// ── アクションアイテムのステータス ────────────────────────────
// 定義元は shared/action-item-statuses.json。タスクのステータスとは別体系で、
// こちらは設定画面から編集できない固定マスタ。

export type ActionItemStatusRole = "notStarted" | "inProgress" | "onHold" | "completed";

export interface ActionItemStatusMaster {
    name: string;
    role?: ActionItemStatusRole;
}

export const ACTION_ITEM_STATUSES: ActionItemStatusMaster[] =
    actionItemStatusesJson.actionItemStatuses as ActionItemStatusMaster[];

/** マスタ定義順のステータス名。画面の並び順・ソート順になる */
export const ACTION_ITEM_STATUS_NAMES: string[] = ACTION_ITEM_STATUSES.map(s => s.name);

const requireSingleActionItemStatus = (role: ActionItemStatusRole): string => {
    const names = ACTION_ITEM_STATUSES.filter(s => s.role === role).map(s => s.name);
    if (names.length !== 1) {
        throw new Error(
            `ACTION_ITEM_STATUSES の定義エラー: role="${role}" のステータスはちょうど1件必要です（現在 ${names.length} 件）`,
        );
    }
    return names[0];
};

/** 新規アクションアイテムの初期ステータス */
export const ACTION_ITEM_NOT_STARTED_STATUS = requireSingleActionItemStatus("notStarted");
/** 完了扱いのアクションアイテムのステータス */
export const ACTION_ITEM_COMPLETED_STATUS = requireSingleActionItemStatus("completed");

export const isCompletedActionItemStatus = (status?: string | null): boolean =>
    status === ACTION_ITEM_COMPLETED_STATUS;

const ACTION_ITEM_BADGE_BY_ROLE: Record<ActionItemStatusRole, string> = {
    notStarted: "bg-gray-100 text-gray-600",
    inProgress: "bg-blue-100 text-blue-700",
    onHold:     "bg-amber-100 text-amber-700",
    completed:  "bg-green-100 text-green-700",
};
const ACTION_ITEM_ROLE_BY_NAME = new Map(ACTION_ITEM_STATUSES.map(s => [s.name, s.role]));

/** アクションアイテムのステータスバッジ配色（役割を持たないステータスはグレー） */
export const actionItemStatusBadge = (status?: string | null): string => {
    const role = status ? ACTION_ITEM_ROLE_BY_NAME.get(status) : undefined;
    return role ? ACTION_ITEM_BADGE_BY_ROLE[role] : "bg-gray-100 text-gray-600";
};
