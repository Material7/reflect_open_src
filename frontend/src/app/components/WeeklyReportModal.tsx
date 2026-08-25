import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useProject } from '@/context/ProjectContext';
import { PHASES, PhaseCode, isNotStartedStep, isTerminalStep, isCompletedStatus, isInProgressStatus, isOnHoldStatus, isStoppedStatus, ON_HOLD_STATUS } from '@/lib/constants';
import { changeLogApi, statsApi } from '@/lib/api';
import { displayTaskId, displayTaskIdFrom } from '@/lib/ticket';
import { Task, TaskChangeLog, TaskChangeLogPage } from '@/types';
import { X, Download, Loader2 } from 'lucide-react';

interface SummaryData {
  total: number; requirement: number; development: number;
  completed: number; inProgress: number; onHold: number;
  stopped: number; newTasks: number; completionRate: number;
}
interface AlertItem {
  taskId: string; name: string; type: string; message: string;
  status: string; assignee: string;
}
interface PhaseProgressItem {
  phase: string; total: number; notStarted: number;
  inProgress: number; completed: number; excluded: number;
}
interface MemberItem {
  employeeNumber: string; name: string; role: string;
  totalTasks: number; completedTasks: number; actualManHours: number;
}
interface ReportData {
  period: { from: string; to: string; generatedAt: string };
  projectName: string;
  /** 全プロジェクト横断レポートか（タスク等にプロジェクト名を併記する） */
  crossProject: boolean;
  /** 表示用タスクID → プロジェクト名（アラート等の解決用） */
  projectNameByTaskDisplayId: Record<string, string>;
  /** ReflectタスクID → チケットID（アラート等の表示解決用） */
  ticketKeyByTaskDisplayId: Record<string, string>;
  summary: SummaryData;
  alerts: AlertItem[];
  phaseProgress: PhaseProgressItem[];
  byMember: MemberItem[];
  changeLogs: TaskChangeLog[];
  tasks: Task[];
}

const PH = Object.fromEntries(PHASES.map(p => [p.code, p]));

function fmt(d?: string) { return d ? d.replace(/-/g, '/') : '—'; }

/**
 * そのタスクで実施される工程。スキップ設定はタスクの所属プロジェクトのものを使う。
 * 週報は複数プロジェクトを横断しうるため、全プロジェクトのユニオンで判定すると
 * 他プロジェクトがスキップした工程まで報告から抜け落ちる。
 */
function relevantPhases(task: Task, skippedPhasesOf: (projectId: number) => string[]) {
  const skipped = skippedPhasesOf(task.projectId);
  return PHASES.filter(p => p.target === task.type && !skipped.includes(p.code));
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateHtml(
  r: ReportData,
  domainNameMap: Record<string, string>,
  skippedPhasesOf: (projectId: number) => string[],
  projectNameById: Record<number, string>,
  author: string,
  includeTeam: boolean,
): string {
  const { period, projectName, summary: S, alerts, phaseProgress, byMember, changeLogs, tasks, ticketKeyByTaskDisplayId } = r;
  const esc = escHtml;

  const md = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(5).replace('-', '/') : '');
  const hhmm = (h?: number) => {
    if (!h || h <= 0) return '0:00';
    const hh = Math.floor(h); const mm = Math.round((h - hh) * 60);
    return `${hh}:${String(mm).padStart(2, '0')}`;
  };
  const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  const completedLogs  = changeLogs.filter(l => l.operation === 'STATUS_CHANGED' && isCompletedStatus(l.newValue));
  const createdLogs    = changeLogs.filter(l => l.operation === 'TASK_CREATED');
  const wsAdvancedLogs = changeLogs.filter(l => l.operation === 'WORK_STEP_CHANGED');
  const delayed = alerts.filter(a => a.type === 'DELAYED');
  const held    = alerts.filter(a => a.type === 'HOLD');
  const stopped = alerts.filter(a => a.type === 'STOPPED');

  const taskByDisplay = new Map(tasks.map(t => [t.taskId, t]));
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const overdueDays = (task?: Task): number => {
    if (!task) return 0;
    let maxD = 0;
    for (const ph of relevantPhases(task, skippedPhasesOf)) {
      const pd = task.phases?.[ph.code as PhaseCode];
      const ws = pd?.currentWorkStepCode;
      if (!pd || !ws || isNotStartedStep(ws) || isTerminalStep(ws)) continue;
      const pe = pd.schedule?.[ws]?.plannedEndDate;
      if (pe && /^\d{4}-\d{2}-\d{2}/.test(pe)) {
        const d = Math.floor((today.getTime() - new Date(pe).getTime()) / 86400000);
        if (d > maxD) maxD = d;
      }
    }
    return maxD;
  };

  const nDelayed = delayed.length;
  const rag = (nDelayed >= 10 || (S.total > 0 && nDelayed / S.total >= 0.1))
    ? { cls: 'red',   label: '要警戒（Red）' }
    : nDelayed > 0
    ? { cls: 'amber', label: '注意（Amber）' }
    : { cls: 'green', label: '良好（Green）' };

  const statusSegs: [number, string][] = [
    [S.completed, 'var(--good)'], [S.inProgress, 'var(--s-blue)'],
    [S.onHold, 'var(--warn)'], [S.stopped, 'var(--crit)'], [S.newTasks, 'var(--s-gray)'],
  ];
  const barTotal = statusSegs.reduce((a, [n]) => a + n, 0) || 1;
  let sx = 0;
  const statusRects = statusSegs.map(([n, color]) => {
    const w = (n / barTotal) * 400;
    const rect = n > 0 ? `<rect x="${sx.toFixed(1)}" y="4" width="${Math.max(0, w - 1.5).toFixed(1)}" height="18" rx="3" fill="${color}"/>` : '';
    sx += w;
    return rect;
  }).join('');
  const gaugeDash = (219.9 * (1 - S.completionRate / 100)).toFixed(1);

  const phaseBars = [...phaseProgress]
    .sort((a, b) => PHASES.findIndex(p => p.code === a.phase) - PHASES.findIndex(p => p.code === b.phase))
    .filter(p => p.total > 0)
    .map(p => {
      const doneW = pctOf(p.completed, p.total);
      const progW = pctOf(p.inProgress, p.total);
      const restW = Math.max(0, 100 - doneW - progW);
      const name = PH[p.phase]?.name ?? '';
      return `<div class="pbar"><div class="pl">${esc(p.phase)}<small>${esc(name)}</small></div>
        <div class="track"><span class="seg" style="width:${doneW}%;background:var(--good)"></span><span class="seg" style="width:${progW}%;background:var(--s-blue)"></span><span class="seg" style="width:${restW}%;background:var(--s-gray)"></span></div>
        <div class="pct">${doneW}%</div></div>`;
    }).join('');

  type Ranked = { a: AlertItem; days: number; sev: 'crit' | 'warn'; sevLabel: string };
  const delayedRanked: Ranked[] = delayed
    .map(a => ({ a, days: overdueDays(taskByDisplay.get(a.taskId)), sev: 'crit' as const, sevLabel: '遅延' }))
    .sort((x, y) => y.days - x.days);
  const heldRanked: Ranked[] = held.map(a => ({ a, days: 0, sev: 'warn' as const, sevLabel: ON_HOLD_STATUS ?? '保留' }));
  const ranked = [...delayedRanked, ...heldRanked];
  const TOPN = 8;
  const topRisks = ranked.slice(0, TOPN);
  const shownDelayed = topRisks.filter(x => x.sev === 'crit').length;
  const shownHeld = topRisks.filter(x => x.sev === 'warn').length;
  const restDelayed = delayed.length - shownDelayed;
  const restHeld = held.length - shownHeld;
  const restTotal = restDelayed + restHeld;
  const riskRows = topRisks.map(x => {
    const id = displayTaskIdFrom(x.a.taskId, ticketKeyByTaskDisplayId[x.a.taskId]);
    const days = x.sev === 'crit' && x.days > 0 ? `+${x.days}日` : '';
    return `<div class="rrow ${x.sev}"><span class="sev">${x.sevLabel}</span><span class="rid">${esc(id)}</span><span class="rn">${esc(x.a.name)}</span><span class="rdays">${days}</span></div>`;
  }).join('');
  const riskListHtml = ranked.length === 0
    ? '<p class="rmore">要対応（遅延・保留）のタスクはありません。</p>'
    : `<div class="risk-list">${riskRows}</div>` +
      (restTotal > 0
        ? `<div class="rmore">ほか ${restTotal} 件（遅延 ${restDelayed}・保留 ${restHeld}）。中止 ${stopped.length} 件を含む全件はアプリのタスク一覧を参照。</div>`
        : `<div class="rmore">中止 ${stopped.length} 件。全件はアプリのタスク一覧を参照。</div>`);

  const plannedBy: Record<string, number> = {};
  for (const t of tasks) {
    const emp = t.assignee; if (!emp) continue;
    let sum = 0;
    for (const ph of relevantPhases(t, skippedPhasesOf)) {
      const pd = t.phases?.[ph.code as PhaseCode]; if (!pd) continue;
      for (const sc of Object.values(pd.schedule ?? {})) sum += sc.plannedManHours || 0;
    }
    plannedBy[emp] = (plannedBy[emp] || 0) + sum;
  }
  const riskBy: Record<string, { d: number; h: number }> = {};
  for (const a of alerts) {
    if (!a.assignee) continue;
    const rb = riskBy[a.assignee] || (riskBy[a.assignee] = { d: 0, h: 0 });
    if (a.type === 'DELAYED') rb.d++; else if (a.type === 'HOLD') rb.h++;
  }
  const teamRows = byMember.map(m => {
    const prog = pctOf(m.completedTasks, m.totalTasks);
    const planned = plannedBy[m.employeeNumber] || 0;
    const actual = m.actualManHours || 0;
    const cons = planned > 0 ? Math.round((actual / planned) * 100) : null;
    const consCls = cons == null ? 'ok' : cons > 110 ? 'over' : cons >= 95 ? 'warn' : 'ok';
    const barW = cons == null ? 0 : Math.min(cons, 100);
    const consTxt = cons == null
      ? `予 — ／ 実 ${hhmm(actual)}`
      : `予 ${hhmm(planned)} ／ 実 ${hhmm(actual)} ・ <b class="${cons > 110 ? 'over' : ''}">${cons}%</b>`;
    const rb = riskBy[m.employeeNumber];
    const rk = rb && (rb.d || rb.h)
      ? `${rb.d ? `<span class="k d">遅延 ${rb.d}</span>` : ''}${rb.h ? `<span class="k h">保留 ${rb.h}</span>` : ''}`
      : '<span class="none">—</span>';
    return `<tr>
      <td><div class="tm-name">${esc(m.name || m.employeeNumber)}</div><div class="tm-role">${esc(m.role || '')}</div></td>
      <td><div class="prog"><div class="bar"><i style="width:${prog}%"></i></div><span class="pv">${m.completedTasks} / ${m.totalTasks} ・ ${prog}%</span></div></td>
      <td><div class="mh"><div class="mh-bar"><i class="${consCls}" style="width:${barW}%"></i></div><div class="mh-txt">${consTxt}</div></div></td>
      <td><div class="rk">${rk}</div></td>
    </tr>`;
  }).join('');
  const teamSection = includeTeam ? `
    <section>
      <div class="sect-h"><span class="n">06</span><h2>担当者別 タスク進捗</h2><span class="sub">進捗・工数予実・リスク</span></div>
      <div style="overflow-x:auto">
        <table class="team">
          <thead><tr><th>担当者</th><th style="min-width:160px">タスク進捗（完了 / 担当）</th><th style="min-width:180px">工数 予実（消化率）</th><th>リスク</th></tr></thead>
          <tbody>${teamRows || '<tr><td colspan="4" style="color:var(--ink-3)">担当者データがありません</td></tr>'}</tbody>
        </table>
      </div>
      <p class="rmore">工数予実＝予定工数に対する実績工数の消化率（100%超は赤）。リスクは担当タスクのうち遅延／保留の件数。</p>
    </section>` : '';

  // ステータス名ではなくマスタの役割で配色クラスを決める
  const spillClass = (status: string): string =>
    isInProgressStatus(status) ? 'p-prog'
    : isCompletedStatus(status) ? 'p-done'
    : isOnHoldStatus(status) ? 'p-hold'
    : isStoppedStatus(status) ? 'p-stop'
    : 'p-new';
  const reportRows: string[] = [];
  for (const t of [...tasks].sort((a, b) => a.taskId.localeCompare(b.taskId, 'ja'))) {
    for (const ph of relevantPhases(t, skippedPhasesOf)) {
      const pd = t.phases?.[ph.code as PhaseCode];
      const rc = pd?.reportContent?.trim();
      if (!pd || !rc) continue;
      const scheds = Object.values(pd.schedule ?? {});
      const pick = (key: 'plannedStartDate' | 'actualStartDate' | 'plannedEndDate' | 'actualEndDate', mode: 'min' | 'max') => {
        const ds = scheds.map(s => s[key]).filter((v): v is string => !!v && /^\d{4}-\d{2}-\d{2}/.test(v));
        if (ds.length === 0) return '';
        return ds.reduce((a, b) => (mode === 'min' ? (a < b ? a : b) : (a > b ? a : b)));
      };
      const dt = (v: string) => v ? `<td class="dt">${md(v)}</td>` : '<td class="dt none">—</td>';
      const cls = spillClass(t.status);
      reportRows.push(`<tr>
        <td class="idc">${esc(displayTaskId(t))}</td><td>${esc(t.name)}</td><td class="ph2">${esc(ph.code)}</td>
        ${dt(pick('plannedStartDate', 'min'))}${dt(pick('actualStartDate', 'min'))}${dt(pick('plannedEndDate', 'max'))}${dt(pick('actualEndDate', 'max'))}
        <td><span class="spill ${cls}">${esc(t.status)}</span></td>
        <td class="rc">${esc(rc)}</td>
      </tr>`);
    }
  }
  const reportBody = reportRows.length > 0
    ? `<div style="overflow-x:auto"><table class="tbl rtbl">
        <thead><tr><th>タスクID</th><th>タスク名</th><th>工程</th>
          <th style="text-align:center">開始予定</th><th style="text-align:center">開始日</th>
          <th style="text-align:center">完了予定</th><th style="text-align:center">完了日</th>
          <th>ステータス</th><th>詳細</th></tr></thead>
        <tbody>${reportRows.join('')}</tbody></table></div>`
    : '<p class="rmore">報告内容が入力されたタスクはありません。</p>';

  const narrative = `完了率 <b>${S.completionRate}%</b>（${S.completed}/${S.total}）。今週は完了 <b>${completedLogs.length}</b> 件・新規作成 <b>${createdLogs.length}</b> 件・工程前進 <b>${wsAdvancedLogs.length}</b> 件。要対応は <b>${delayed.length + held.length}</b> 件（遅延 ${delayed.length}・保留 ${held.length}）、中止 ${stopped.length} 件。`;

  const genAt = new Date(period.generatedAt).toLocaleString('ja-JP');

  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>週報 ${esc(projectName)} ${esc(fmt(period.from))}-${esc(fmt(period.to))}</title>
<style>
  :root{--ink:#0b0b0b;--ink-2:#52514e;--ink-3:#8a8880;--paper:#fff;--paper-2:#f7f7f5;--line:#e7e6e2;
    --brand:#4f46e5;--good:#0ca30c;--warn:#eda100;--crit:#d03b3b;--s-blue:#2a78d6;--s-violet:#4a3aa7;--s-gray:#b9b7b0;
    --mono:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Segoe UI","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:#e9e9ee;font-family:var(--sans);color:var(--ink);line-height:1.55;
    font-variant-numeric:tabular-nums;padding:24px 14px 50px;-webkit-font-smoothing:antialiased}
  .paper{max-width:860px;margin:0 auto;background:var(--paper);border-radius:14px;overflow:hidden;
    box-shadow:0 1px 2px rgba(0,0,0,.06),0 12px 40px rgba(20,20,40,.14)}
  .band{padding:26px 34px 22px;background:linear-gradient(180deg,#f3f4ff 0%,#fff 100%);border-bottom:1px solid var(--line)}
  .band .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--brand);font-weight:700}
  .band h1{margin:6px 0 2px;font-size:23px;font-weight:800;letter-spacing:-.01em}
  .band .period{color:var(--ink-2);font-size:14px}
  .band .top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap}
  .meta{font-size:12px;color:var(--ink-3);margin-top:2px}
  .rag{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;font-weight:700;font-size:13px;border:1px solid}
  .rag .dot{width:9px;height:9px;border-radius:50%}
  .rag.green{background:#eaf7ea;border-color:#bfe4bf;color:#1b6b1b}.rag.green .dot{background:var(--good)}
  .rag.amber{background:#fff8e8;border-color:#f2dfa6;color:#8a6400}.rag.amber .dot{background:var(--warn)}
  .rag.red{background:#fdf1f1;border-color:#f2d0d0;color:#a12727}.rag.red .dot{background:var(--crit)}
  main{padding:26px 34px 34px;display:flex;flex-direction:column;gap:30px}
  section{display:flex;flex-direction:column;gap:12px}
  .sect-h{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid var(--line);padding-bottom:7px}
  .sect-h .n{font-family:var(--mono);font-size:11px;color:var(--brand);font-weight:700}
  .sect-h h2{margin:0;font-size:14px;font-weight:800}
  .sect-h .sub{margin-left:auto;font-size:12px;color:var(--ink-3)}
  .exec{display:grid;grid-template-columns:1.35fr 1fr;gap:18px}
  @media(max-width:640px){.exec{grid-template-columns:1fr}}
  .narrative{font-size:13.5px;color:var(--ink-2)}.narrative b{color:var(--ink)}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .kpi{background:var(--paper-2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
  .kpi .k{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
  .kpi .v{font-size:22px;font-weight:800;margin-top:2px}
  .kpi .v.g{color:var(--good)}.kpi .v.b{color:var(--s-blue)}.kpi .v.a{color:var(--warn)}.kpi .v.r{color:var(--crit)}
  .prow{display:grid;grid-template-columns:200px 1fr;gap:22px;align-items:center}
  @media(max-width:640px){.prow{grid-template-columns:1fr}}
  .gauge{display:flex;flex-direction:column;align-items:center;gap:4px}.gauge .cap{font-size:12px;color:var(--ink-3)}
  .legend{display:flex;flex-wrap:wrap;gap:10px 16px;margin-top:6px}
  .lg{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2)}
  .lg .sw{width:11px;height:11px;border-radius:3px}.lg b{color:var(--ink)}
  .phase{display:flex;flex-direction:column;gap:9px}
  .pbar{display:grid;grid-template-columns:74px 1fr 44px;gap:10px;align-items:center}
  .pbar .pl{font-size:12px;color:var(--ink-2);font-weight:600}.pbar .pl small{display:block;color:var(--ink-3);font-weight:400;font-size:10px}
  .track{display:flex;height:16px;border-radius:5px;overflow:hidden;background:var(--paper-2);gap:2px}
  .seg{height:100%}.pbar .pct{font-size:12px;color:var(--ink-2);text-align:right;font-weight:600}
  .acts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  @media(max-width:640px){.acts{grid-template-columns:1fr}}
  .actchip{display:flex;align-items:center;gap:12px;background:var(--paper-2);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .actchip .cnt{font-family:var(--mono);font-size:26px;font-weight:800;line-height:1}
  .actchip .cnt.g{color:var(--good)}.actchip .cnt.b{color:var(--s-blue)}.actchip .cnt.v{color:var(--s-violet)}
  .actchip b{font-size:13px}.actchip small{display:block;color:var(--ink-3);font-size:11px}
  .risk-sum{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
  .rc-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid}
  .rc-chip b{font-family:var(--mono);font-size:15px;font-weight:800}
  .rc-chip.crit{background:#fdf1f1;border-color:#f2d0d0;color:#a12727}
  .rc-chip.warn{background:#fff8e8;border-color:#f2dfa6;color:#846200}
  .rc-chip.stop{background:#f3f3f1;border-color:#e2e1dc;color:#5b5a55}
  .rc-tot{margin-left:auto;font-size:12px;color:var(--ink-3)}
  .risk-list{display:flex;flex-direction:column;gap:6px}
  .rrow{display:grid;grid-template-columns:46px 104px 1fr auto;gap:10px;align-items:center;padding:8px 12px;border:1px solid var(--line);border-left-width:3px;border-radius:8px}
  .rrow.crit{border-left-color:var(--crit)}.rrow.warn{border-left-color:var(--warn)}
  .rrow .sev{font-size:11px;font-weight:700}.rrow.crit .sev{color:#a12727}.rrow.warn .sev{color:#846200}
  .rrow .rid{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--brand);white-space:nowrap}
  .rrow .rn{font-size:12.5px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rrow .rdays{font-family:var(--mono);font-size:11.5px;font-weight:700;white-space:nowrap;color:var(--ink-2)}
  .rrow.crit .rdays{color:var(--crit)}
  .rmore{font-size:11.5px;color:var(--ink-3);padding:5px 2px 0}
  .team,.tbl{width:100%;border-collapse:collapse;font-size:12.5px}
  .team{min-width:660px}.rtbl{min-width:820px}
  .team th,.tbl th{text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);font-weight:700;padding:0 10px 8px;border-bottom:1px solid var(--line)}
  .team td,.tbl td{padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}
  .tm-name{font-weight:600}.tm-role{font-family:var(--mono);font-size:10px;color:var(--ink-3)}
  .prog{display:flex;align-items:center;gap:9px}
  .prog .bar{flex:1;height:8px;border-radius:4px;background:var(--paper-2);overflow:hidden;min-width:56px}
  .prog .bar>i{display:block;height:100%;background:var(--good);border-radius:4px}
  .prog .pv{color:var(--ink-2);white-space:nowrap;min-width:64px;text-align:right}
  .mh{display:flex;flex-direction:column;gap:3px;min-width:150px}
  .mh-bar{height:8px;border-radius:4px;background:var(--paper-2);overflow:hidden}
  .mh-bar>i{display:block;height:100%;border-radius:4px}
  .mh-bar>i.ok{background:var(--good)}.mh-bar>i.warn{background:var(--warn)}.mh-bar>i.over{background:var(--crit)}
  .mh-txt{font-size:11px;color:var(--ink-3)}.mh-txt b{color:var(--ink-2)}.mh-txt b.over{color:var(--crit)}
  .rk{display:flex;gap:5px;flex-wrap:wrap}
  .rk .k{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}
  .rk .k.d{background:#fdf1f1;color:#a12727}.rk .k.h{background:#fff8e8;color:#846200}.rk .none{color:var(--ink-3);font-size:11px}
  .rtbl .idc{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--brand);white-space:nowrap}
  .rtbl .ph2{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--ink-2);white-space:nowrap}
  .rtbl .dt{font-family:var(--mono);font-size:11px;color:var(--ink-2);white-space:nowrap;text-align:center}
  .rtbl .dt.none{color:var(--ink-3)}.rtbl .rc{color:var(--ink-2);min-width:220px}
  .spill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap}
  .spill.p-prog{background:#eaf2fc;color:#1a5cab}.spill.p-done{background:#e7f6e7;color:#0a7a0a}
  .spill.p-hold{background:#fff6e2;color:#846200}.spill.p-new{background:#f0f0ee;color:#5b5a55}.spill.p-stop{background:#fdeeee;color:#a12727}
  .foot{padding:16px 34px 24px;border-top:1px solid var(--line);color:var(--ink-3);font-size:11px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
  @media print{body{background:#fff;padding:0}.paper{box-shadow:none;max-width:none;border-radius:0}}
</style></head>
<body>
<div class="paper">
  <header class="band"><div class="top">
    <div>
      <div class="eyebrow">Weekly Status Report</div>
      <h1>${esc(projectName)}</h1>
      <div class="period">報告期間　${esc(fmt(period.from))} 〜 ${esc(fmt(period.to))}</div>
      <div class="meta">${author ? `作成: ${esc(author)}／ ` : ''}生成 ${esc(genAt)}</div>
    </div>
    <div class="rag ${rag.cls}"><span class="dot"></span>健全度: ${rag.label}</div>
  </div></header>
  <main>
    <section>
      <div class="sect-h"><span class="n">01</span><h2>エグゼクティブサマリー</h2></div>
      <div class="exec">
        <div class="narrative"><p style="margin:0">${narrative}</p></div>
        <div class="kpis">
          <div class="kpi"><div class="k">総タスク</div><div class="v">${S.total}</div></div>
          <div class="kpi"><div class="k">完了</div><div class="v g">${S.completed}</div></div>
          <div class="kpi"><div class="k">進行中</div><div class="v b">${S.inProgress}</div></div>
          <div class="kpi"><div class="k">保留</div><div class="v a">${S.onHold}</div></div>
          <div class="kpi"><div class="k">中止</div><div class="v r">${S.stopped}</div></div>
          <div class="kpi"><div class="k">完了率</div><div class="v">${S.completionRate}%</div></div>
        </div>
      </div>
    </section>
    <section>
      <div class="sect-h"><span class="n">02</span><h2>進捗スナップショット</h2></div>
      <div class="prow">
        <div class="gauge">
          <svg width="168" height="100" viewBox="0 0 168 100" role="img" aria-label="完了率 ${S.completionRate}%">
            <path d="M14 92 A70 70 0 0 1 154 92" fill="none" stroke="#ecebe7" stroke-width="15" stroke-linecap="round"/>
            <path d="M14 92 A70 70 0 0 1 154 92" fill="none" stroke="var(--brand)" stroke-width="15" stroke-linecap="round" stroke-dasharray="219.9" stroke-dashoffset="${gaugeDash}"/>
            <text x="84" y="80" text-anchor="middle" font-size="30" font-weight="800" fill="var(--ink)">${S.completionRate}%</text>
            <text x="84" y="95" text-anchor="middle" font-size="11" fill="var(--ink-3)">完了率</text>
          </svg>
          <div class="cap">${S.completed} / ${S.total} タスク</div>
        </div>
        <div>
          <svg width="100%" height="26" viewBox="0 0 400 26" preserveAspectRatio="none" role="img" aria-label="ステータス構成">${statusRects}</svg>
          <div class="legend">
            <span class="lg"><span class="sw" style="background:var(--good)"></span>完了 <b>${S.completed}</b></span>
            <span class="lg"><span class="sw" style="background:var(--s-blue)"></span>進行中 <b>${S.inProgress}</b></span>
            <span class="lg"><span class="sw" style="background:var(--warn)"></span>保留 <b>${S.onHold}</b></span>
            <span class="lg"><span class="sw" style="background:var(--crit)"></span>中止 <b>${S.stopped}</b></span>
            <span class="lg"><span class="sw" style="background:var(--s-gray)"></span>新規 <b>${S.newTasks}</b></span>
          </div>
        </div>
      </div>
    </section>
    <section>
      <div class="sect-h"><span class="n">03</span><h2>フェーズ別進捗</h2><span class="sub">完了 ／ 進行中 ／ 未着手</span></div>
      <div class="phase">${phaseBars || '<p class="rmore">フェーズデータがありません。</p>'}</div>
    </section>
    <section>
      <div class="sect-h"><span class="n">04</span><h2>今週の活動</h2><span class="sub">${esc(fmt(period.from))}〜${esc(fmt(period.to))}</span></div>
      <div class="acts">
        <div class="actchip"><span class="cnt g">${completedLogs.length}</span><div><b>完了</b><small>ステータスが完了に</small></div></div>
        <div class="actchip"><span class="cnt b">${createdLogs.length}</span><div><b>新規作成</b><small>今週追加されたタスク</small></div></div>
        <div class="actchip"><span class="cnt v">${wsAdvancedLogs.length}</span><div><b>工程前進</b><small>作業工程が進んだ</small></div></div>
      </div>
    </section>
    <section>
      <div class="sect-h"><span class="n">05</span><h2>要対応タスク</h2><span class="sub">超過日数の多い順・上位${TOPN}件</span></div>
      <div class="risk-sum">
        <span class="rc-chip crit"><b>${delayed.length}</b>遅延</span>
        <span class="rc-chip warn"><b>${held.length}</b>保留</span>
        <span class="rc-chip stop"><b>${stopped.length}</b>中止</span>
        <span class="rc-tot">要対応 ${delayed.length + held.length}件（遅延＋保留）／ 中止 ${stopped.length}件</span>
      </div>
      ${riskListHtml}
    </section>
    ${teamSection}
    <section>
      <div class="sect-h"><span class="n">${includeTeam ? '07' : '06'}</span><h2>工程別 報告内容</h2><span class="sub">タスク詳細の「報告内容」より</span></div>
      ${reportBody}
    </section>
  </main>
  <div class="foot"><span>${esc(projectName)} ・ 週次報告</span><span>Reflect で生成 ・ ${esc(fmt(period.to))}</span></div>
</div>
</body></html>`;
}

interface Props {
  onClose: () => void;
  initialProjectId?: number;
}

export const WeeklyReportModal: React.FC<Props> = ({ onClose, initialProjectId }) => {
  const { tasks, settings, projects, isSystemAdmin, currentUser, skippedPhasesOf } = useProject();

  const todayStr       = new Date().toISOString().split('T')[0];
  const sevenDaysAgo   = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [from, setFrom]       = useState(sevenDaysAgo);
  const [to, setTo]           = useState(todayStr);
  // 報告対象プロジェクト（ダッシュボードの選択を初期値に）
  const [projectId, setProjectId] = useState<string>(initialProjectId ? String(initialProjectId) : '');
  const [loading, setLoading] = useState(false);
  const [report, setReport]   = useState<ReportData | null>(null);
  const [error, setError]     = useState('');
  const [includeTeam, setIncludeTeam] = useState(true);

  // 非管理者は全プロジェクト横断の変更ログを取得できないため、既定でプロジェクトを選択する
  // （未選択のままだと生成時に 403 で失敗する）
  useEffect(() => {
    if (!isSystemAdmin && !projectId && projects.length > 0) {
      setProjectId(String(projects[0].id));
    }
  }, [isSystemAdmin, projectId, projects]);

  const domainNameMap = Object.fromEntries(settings.domains.map(d => [d.id, d.name]));
  const projectNameById = Object.fromEntries(projects.map(p => [p.id, p.name])) as Record<number, string>;

  const generate = useCallback(async () => {
    setLoading(true);
    setReport(null);
    setError('');
    const pid = projectId ? Number(projectId) : undefined;
    const projectName = pid ? (projects.find(p => p.id === pid)?.name ?? '') : '全プロジェクト';
    const scopedTasks = (pid ? tasks.filter(t => t.projectId === pid) : tasks).filter(t => t.type !== 'Indirect'); // 工程外タスクは別管理
    const projNameById = new Map(projects.map(p => [p.id, p.name]));
    const projectNameByTaskDisplayId: Record<string, string> = {};
    const ticketKeyByTaskDisplayId: Record<string, string> = {};
    scopedTasks.forEach(t => {
      projectNameByTaskDisplayId[t.taskId] = projNameById.get(t.projectId) ?? '';
      if (t.ticketKey) ticketKeyByTaskDisplayId[t.taskId] = t.ticketKey;
    });
    try {
      // 変更ログは権限（クロスPJは管理者のみ 等）で失敗しうるため、単体で失敗しても
      // 週報全体は生成できるよう空ページにフォールバックする
      const emptyLogPage: TaskChangeLogPage = { content: [], totalElements: 0, totalPages: 0, number: 0 };
      const [summary, alerts, phaseProgress, byMember, logPage] = await Promise.all([
        statsApi.summary(pid),
        statsApi.alerts(pid),
        statsApi.phaseProgress(pid),
        statsApi.byMember(pid),
        changeLogApi.list({ projectId: pid, fromDate: from, toDate: to, size: 1000, page: 0 }).catch(() => emptyLogPage),
      ]);
      setReport({
        period: { from, to, generatedAt: new Date().toISOString() },
        projectName,
        crossProject: pid === undefined,
        projectNameByTaskDisplayId,
        ticketKeyByTaskDisplayId,
        summary: summary as unknown as SummaryData,
        alerts: alerts as unknown as AlertItem[],
        phaseProgress: phaseProgress as unknown as PhaseProgressItem[],
        byMember: byMember as unknown as MemberItem[],
        changeLogs: logPage.content,
        tasks: scopedTasks,
      });
    } catch {
      setError('週報の生成に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setLoading(false);
    }
  }, [from, to, projectId, tasks, projects]);

  // 週報HTML（プレビュー・ダウンロード共通の単一ソース）
  const reportHtml = useMemo(
    () => report ? generateHtml(report, domainNameMap, skippedPhasesOf, projectNameById, currentUser?.name ?? '', includeTeam) : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report, includeTeam, skippedPhasesOf],
  );

  const handleDownloadHtml = useCallback(() => {
    if (!report || !reportHtml) return;
    const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `週報_${report.projectName}_${report.period.from}_${report.period.to}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, reportHtml]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/50">
      <div className="w-full max-w-[1600px] h-[95dvh] md:w-[95vw] md:h-[92vh] bg-white rounded-t-2xl md:rounded-xl flex flex-col shadow-2xl">

        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-bold text-gray-800">週報作成</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        {/* 期間選択 */}
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 shrink-0 flex flex-wrap items-center gap-3">
          {projects.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-medium">プロジェクト</span>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 max-w-[12rem]"
              >
                {isSystemAdmin && <option value="">全プロジェクト</option>}
                {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
              </select>
            </div>
          )}
          <span className="text-sm text-gray-600 font-medium">報告期間</span>
          <div className="flex items-center gap-2">
            <input
              type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <span className="text-gray-400 text-sm">〜</span>
            <input
              type="date" value={to} onChange={e => setTo(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeTeam}
              onChange={e => setIncludeTeam(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            担当者別を含める
          </label>
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : null}
            {loading ? '生成中...' : '生成'}
          </button>
        </div>

        {/* レポート本体 */}
        <div className="flex-1 min-h-0 overflow-auto">
          {!report && !loading && (
            <div className="flex items-center justify-center h-full text-sm px-6 text-center">
              {error
                ? <span className="text-red-600 font-medium">{error}</span>
                : <span className="text-gray-300">期間を選択して「生成」ボタンをクリックしてください</span>}
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center h-full gap-2 text-gray-400 text-sm">
              <Loader2 size={18} className="animate-spin" />
              データを収集しています...
            </div>
          )}

          {report && (
            <iframe
              title="週報プレビュー"
              srcDoc={reportHtml}
              className="w-full h-full border-0 bg-white"
            />
          )}
        </div>

        {/* フッター（アクションバー） */}
        {report && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50 shrink-0">
            <button
              onClick={handleDownloadHtml}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
            >
              <Download size={14} />
              HTMLダウンロード
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
