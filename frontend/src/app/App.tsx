import React, { useState, useEffect, Suspense, lazy } from 'react';
import { ProjectProvider, useProject } from '@/context/ProjectContext';
import { Layout } from './components/Layout';
import { TaskListPage } from './components/TaskListPage';
import { ProjectSettingsPage } from './components/ProjectSettingsPage';
import { ChangeLogPage } from './components/ChangeLogPage';
import { SchedulePage } from './components/SchedulePage';
import { AssignmentPage } from './components/AssignmentPage';
import { ActionItemPage } from './components/ActionItemPage';
import { SurveyListPage } from './components/SurveyListPage';
import { IndirectTaskListPage } from './components/IndirectTaskListPage';
import { LoginPage } from './components/LoginPage';
import { PhaseCode, REQUIREMENT_PHASE_CODE, DEVELOPMENT_PHASE_CODES } from '@/lib/constants';

const DashboardPage = lazy(() =>
  import('./components/DashboardPage').then(m => ({ default: m.DashboardPage }))
);

export type TabKey = 'dashboard' | 'requirement' | 'development' | 'indirect' | 'actionItems' | 'surveys' | 'schedule' | 'assignment' | 'changelog' | 'settings';

const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openTaskComments, setOpenTaskComments] = useState(false);
  const [openActionItemId, setOpenActionItemId] = useState<string | null>(null);
  const { projects, currentUser, isLoading, skippedPhasesOf } = useProject();

  useEffect(() => {
    // 全プロジェクトでスキップされている場合だけタブを閉じる。
    // ユニオンビューだと 1 プロジェクトのスキップ設定で他プロジェクトのタブまで消える
    const skippedEverywhere = (phase: PhaseCode) =>
      projects.length > 0 && projects.every(p => skippedPhasesOf(p.id).includes(phase));
    const isRequirementSkipped = skippedEverywhere(REQUIREMENT_PHASE_CODE);
    const isDevelopmentSkipped = DEVELOPMENT_PHASE_CODES.every(skippedEverywhere);

    setActiveTab(current => {
      if (current === 'requirement' && isRequirementSkipped) {
        return !isDevelopmentSkipped ? 'development' : 'settings';
      }
      if (current === 'development' && isDevelopmentSkipped) {
        return !isRequirementSkipped ? 'requirement' : 'settings';
      }
      return current;
    });
  }, [projects, skippedPhasesOf]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500 text-sm">読み込み中...</div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400 text-sm">読み込み中...</div>}>
            <DashboardPage
              onNavigate={(tab, taskId, openComments) => {
                setOpenTaskId(taskId ?? null);
                setOpenTaskComments(!!openComments);
                setActiveTab(tab);
              }}
              onOpenActionItem={(itemId) => {
                setOpenActionItemId(itemId);
                setActiveTab('actionItems');
              }}
            />
          </Suspense>
        );
      case 'schedule':
        return (
          <SchedulePage
            onOpenActionItem={(itemId) => {
              setOpenActionItemId(itemId);
              setActiveTab('actionItems');
            }}
          />
        );
      case 'surveys':
        return <SurveyListPage />;
      case 'assignment':
        return <AssignmentPage />;
      case 'indirect':
        return <IndirectTaskListPage />;
      case 'actionItems':
        return (
          <ActionItemPage
            onNavigate={(tab, taskId) => {
              setOpenTaskId(taskId ?? null);
              setActiveTab(tab);
            }}
            initialOpenItemId={openActionItemId}
            onInitialOpenHandled={() => setOpenActionItemId(null)}
          />
        );
      case 'settings':
        return <ProjectSettingsPage />;
      case 'changelog':
        return (
          <ChangeLogPage
            onNavigate={(tab, taskId) => {
              setOpenTaskId(taskId ?? null);
              setActiveTab(tab);
            }}
          />
        );
      default:
        return (
          <TaskListPage
            type={activeTab === 'development' ? 'Development' : 'Requirement'}
            initialOpenTaskId={openTaskId}
            initialOpenComments={openTaskComments}
            onInitialOpenHandled={() => { setOpenTaskId(null); setOpenTaskComments(false); }}
          />
        );
    }
  };

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderContent()}
    </Layout>
  );
};

export default function App() {
  return (
    <ProjectProvider>
      <AppContent />
    </ProjectProvider>
  );
}
