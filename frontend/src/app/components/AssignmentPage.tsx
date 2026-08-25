import React, { useState, useMemo } from 'react';
import { useProject } from '@/context/ProjectContext';
import { PHASES, WORK_STEPS, isTerminalStep, workStepByCode, INITIAL_WORK_STEP, isRequirementPhase, statusColor, isClosedStatus, isCompletedStatus, isInProgressStatus, isOnHoldStatus } from '@/lib/constants';
import { displayTaskId } from '@/lib/ticket';
import { Task } from '@/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { TaskDetailModal } from './TaskDetailModal';

function getCurrentState(task: Task, skippedPhases: string[]) {
  let currentPhase;
  if (task.type === 'Requirement') {
    currentPhase = PHASES.find(p => isRequirementPhase(p.code))!;
  } else {
    const activePhases = PHASES.filter(p => !isRequirementPhase(p.code) && !skippedPhases.includes(p.code));
    currentPhase =
      activePhases.find(p => {
        const code = task.phases?.[p.code]?.currentWorkStepCode;
        return !isTerminalStep(code);
      }) ??
      activePhases[activePhases.length - 1] ??
      PHASES[PHASES.length - 1];
  }
  const phaseData = task.phases?.[currentPhase.code];
  const workStep = workStepByCode(phaseData?.currentWorkStepCode) ?? INITIAL_WORK_STEP;
  return { phase: currentPhase, workStep };
}

export const AssignmentPage: React.FC = () => {
  const { tasks, settings, skippedPhasesOf } = useProject();
  const [filterOpen, setFilterOpen] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTask = useMemo(() => tasks.find(t => t.id === detailTaskId) ?? null, [tasks, detailTaskId]);

  const filteredTasks = useMemo(() => {
    const base = tasks.filter(t => t.type !== 'Indirect'); // 工程外タスクは別管理
    return filter === 'active'
      ? base.filter(t => !isClosedStatus(t.status))
      : base;
  }, [tasks, filter]);

  const empNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    settings.members.forEach(mem => { m[mem.employeeNumber] = mem.name; });
    return m;
  }, [settings.members]);

  const domainNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    settings.domains.forEach(d => { m[d.id] = d.name; });
    return m;
  }, [settings.domains]);

  const memberData = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    filteredTasks.forEach(t => {
      const key = t.assignee || '__unassigned__';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(t);
    });
    return Object.entries(grouped)
      .map(([empNo, memberTasks]) => {
        const completed  = memberTasks.filter(t => isCompletedStatus(t.status)).length;
        const inProgress = memberTasks.filter(t => isInProgressStatus(t.status)).length;
        const onHold     = memberTasks.filter(t => isOnHoldStatus(t.status)).length;
        const total = memberTasks.length;
        return {
          empNo,
          name: empNo === '__unassigned__' ? '未割当' : (empNameMap[empNo] ?? empNo),
          total, completed, inProgress, onHold,
          rate: total > 0 ? Math.round((completed / total) * 100) : 0,
          tasks: [...memberTasks].sort((a, b) => a.taskId.localeCompare(b.taskId, 'ja')),
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [filteredTasks, empNameMap]);

  const summary = useMemo(() => {
    const total      = filteredTasks.length;
    const completed  = filteredTasks.filter(t => isCompletedStatus(t.status)).length;
    const unassigned = filteredTasks.filter(t => !t.assignee).length;
    const activeMembers = memberData.filter(m => m.empNo !== '__unassigned__').length;
    return { total, completed, unassigned, activeMembers };
  }, [filteredTasks, memberData]);

  const toggleExpand = (empNo: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(empNo) ? next.delete(empNo) : next.add(empNo);
      return next;
    });
  };

  return (
    <>
      <div className="space-y-6">
        {/* フィルター */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <button
            onClick={() => setFilterOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-gray-700">絞り込み</span>
            <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${filterOpen ? 'rotate-180' : ''}`} />
          </button>
          <div className={`grid transition-all duration-200 ease-in-out ${filterOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="overflow-hidden">
              <div className="px-4 pb-3 pt-1 flex gap-2 border-t border-gray-100">
                {(['active', 'all'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {f === 'active' ? '進行中のみ' : 'すべて'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* サマリーカード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {[
            { label: '対象タスク数',  value: summary.total,         color: 'text-gray-800'   },
            { label: '担当者数',       value: summary.activeMembers, color: 'text-indigo-600' },
            { label: '完了タスク',     value: summary.completed,     color: 'text-green-600'  },
            { label: '未割当タスク',   value: summary.unassigned,    color: 'text-amber-500'  },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <p className="text-sm text-gray-500 mb-1">{card.label}</p>
              <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* 担当者別テーブル */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {memberData.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-300 text-sm">データなし</div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="w-10" />
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 w-36">担当者</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">合計</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">進行中</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">保留</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">完了</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">完了率</th>
                  <th className="px-5 py-3 w-44" />
                </tr>
              </thead>
              <tbody>
                {memberData.map(m => (
                  <React.Fragment key={m.empNo}>
                    <tr
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer select-none"
                      onClick={() => toggleExpand(m.empNo)}
                    >
                      <td className="pl-4 py-3 text-gray-400">
                        {expanded.has(m.empNo)
                          ? <ChevronDown size={14} />
                          : <ChevronRight size={14} />}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800 w-36 truncate">{m.name}</td>
                      <td className="px-4 py-3 text-center tabular-nums font-bold text-gray-600">{m.total}</td>
                      <td className="px-4 py-3 text-center tabular-nums font-bold text-indigo-600">{m.inProgress || <span className="font-normal text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-center tabular-nums font-bold text-amber-500">{m.onHold || <span className="font-normal text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-center tabular-nums font-bold text-green-600">{m.completed || <span className="font-normal text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-center tabular-nums font-bold text-indigo-600">{m.rate}%</td>
                      <td className="px-5 py-3">
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${m.rate}%` }} />
                        </div>
                      </td>
                    </tr>
                    {expanded.has(m.empNo) && (
                      <tr>
                        <td colSpan={8} className="bg-slate-50 border-b border-gray-100 p-0">
                          <div className="px-14 py-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-gray-400 border-b border-gray-200">
                                  <th className="text-left pb-2 font-medium pr-4 ">タスクID</th>
                                  <th className="text-left pb-2 font-medium pr-4">タスク名</th>
                                  <th className="text-left pb-2 font-medium pr-4">種別</th>
                                  <th className="text-left pb-2 font-medium pr-4">ドメイン</th>
                                  <th className="text-left pb-2 font-medium pr-4">現在工程</th>
                                  <th className="text-left pb-2 font-medium">ステータス</th>
                                </tr>
                              </thead>
                              <tbody>
                                {m.tasks.map(task => {
                                  const { phase, workStep } = getCurrentState(task, skippedPhasesOf(task.projectId));
                                  return (
                                    <tr key={task.id} className="border-b border-gray-100 hover:bg-white">
                                      <td className="py-1.5 pr-4 ">
                                        <button
                                          onClick={e => { e.stopPropagation(); setDetailTaskId(task.id); }}
                                          className="font-mono text-indigo-600 hover:underline font-semibold"
                                        >
                                          {displayTaskId(task)}
                                        </button>
                                      </td>
                                      <td className="py-1.5 pr-4 text-gray-800 max-w-[200px] truncate">{task.name}</td>
                                      <td className="py-1.5 pr-4 text-gray-500">{task.type === 'Requirement' ? '要件' : '開発'}</td>
                                      <td className="py-1.5 pr-4 text-gray-500">{domainNameMap[task.domainId] ?? task.domainId}</td>
                                      <td className="py-1.5 pr-4">
                                        <div className="flex items-center gap-1.5">
                                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium border border-indigo-200">
                                            {phase.code}
                                          </span>
                                          <span className="font-mono text-gray-700">{workStep.code}</span>
                                        </div>
                                      </td>
                                      <td className="py-1.5">
                                        <span
                                          className="px-1.5 py-0.5 rounded-full font-medium"
                                          style={{ backgroundColor: statusColor(task.status).bg, color: statusColor(task.status).text }}
                                        >
                                          {task.status}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>

      {detailTask && (
        <TaskDetailModal task={detailTask} onClose={() => setDetailTaskId(null)} />
      )}
    </>
  );
};
