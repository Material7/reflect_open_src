/** 課題管理システムのチケットID（プロジェクトキー: 英字始まりの英数字 + "-" + 数字） */
const KEY_RE = /[A-Z][A-Z0-9]+-\d+/g;
const KEY_CI = /[A-Za-z][A-Za-z0-9]+-\d+/;

/** 連番のみのトラッカー（Redmine / GitHub / GitLab）は "#123" 形式に正規化する */
const NUMERIC_ONLY_RE = /^#?(\d+)$/;

/**
 * チケットのURL（または文字列）からチケットIDを抽出する。
 * 抽出できない場合は null を返す。
 *
 * 対応例:
 *   https://xxx.atlassian.net/browse/PROJ-123                                  -> PROJ-123
 *   https://xxx.atlassian.net/.../boards/1?selectedIssue=PROJ-123
 *   https://xxx.backlog.com/view/PROJ-123                                      -> PROJ-123
 *   https://redmine.example.com/issues/123                                     -> #123
 *   https://github.com/org/repo/issues/123                                     -> #123
 *   https://gitlab.com/group/repo/-/issues/123                                 -> #123
 *   PROJ-123 / #123 / 123（IDそのもの）
 */
export function extractTicketKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const str = input.trim();
  if (!str) return null;

  const selected = str.match(new RegExp(`[?&]selectedIssue=(${KEY_CI.source})`));
  if (selected) return selected[1].toUpperCase();

  const browse = str.match(new RegExp(`/browse/(${KEY_CI.source})`));
  if (browse) return browse[1].toUpperCase();

  const view = str.match(new RegExp(`/view/(${KEY_CI.source})`));
  if (view) return view[1].toUpperCase();

  const numbered = str.match(/\/issues\/(\d+)/);
  if (numbered) return `#${numbered[1]}`;

  const bare = str.match(NUMERIC_ONLY_RE);
  if (bare) return `#${bare[1]}`;

  const all = str.toUpperCase().match(KEY_RE);
  if (all && all.length) return all[all.length - 1];

  return null;
}

/**
 * 画面表示用のタスクIDを返す。
 * チケット連携済み（ticketKey あり）ならチケットID、未連携なら「◆ReflectタスクID」。
 */
export function displayTaskIdFrom(reflectTaskId: string, ticketKey?: string | null): string {
  return ticketKey ? ticketKey : `◆${reflectTaskId}`;
}

/** Task（taskId / ticketKey を持つ）から表示用タスクIDを返す。 */
export function displayTaskId(task: { taskId: string; ticketKey?: string | null }): string {
  return displayTaskIdFrom(task.taskId, task.ticketKey);
}

type TicketTaskLike = { id: string; projectId: number; taskId?: string; ticketKey?: string | null };

/**
 * 同一プロジェクト内で同じチケットIDを持つ既存タスクを返す（なければ undefined）。
 * excludeTaskId は自身（編集対象）を除外するために使う。
 */
export function findTicketKeyConflict<T extends TicketTaskLike>(
  tasks: T[],
  projectId: number,
  ticketKey: string | null | undefined,
  excludeTaskId?: string,
): T | undefined {
  if (!ticketKey) return undefined;
  return tasks.find(t => t.projectId === projectId && t.ticketKey === ticketKey && t.id !== excludeTaskId);
}
