import React, { ReactNode, useState, useEffect, useCallback } from "react";
import { LayoutDashboard, AppWindow, ListTodo, Settings, LogOut, UserCircle, History, CalendarDays, Users, Menu, X, ClipboardList, ClipboardCheck } from "lucide-react";
import { useProject } from "@/context/ProjectContext";
import { PhaseCode, systemRoleLabel, REQUIREMENT_PHASE_CODE, DEVELOPMENT_PHASE_CODES } from "@/lib/constants";
import { TabKey } from "../App";
import { MyPageSlideOver } from "./MyPageSlideOver";
import { mentionsApi } from "@/lib/api";

interface LayoutProps {
    children: ReactNode;
    activeTab: TabKey;
    onTabChange: (tab: TabKey) => void;
}

const PAGE_TITLES: Record<TabKey, string> = {
    dashboard: 'ダッシュボード',
    requirement: '要件タスク管理',
    development: '開発タスク管理',
    indirect: '工程外タスク管理',
    actionItems: 'アクションアイテム',
    surveys: 'アンケート',
    schedule: 'スケジュール',
    assignment: 'タスク割り当て',
    changelog: '変更ログ',
    settings: 'プロジェクト設定',
};

export const Layout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange }) => {
    const { globalSettings, currentUser, logout, projects, isSystemAdmin, resolveProjectRole, skippedPhasesOf } = useProject();
    const [myPageOpen, setMyPageOpen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const [mentionUnread, setMentionUnread] = useState(0);
    const loadUnread = useCallback(() => {
        mentionsApi.unreadCount().then(r => setMentionUnread(r.count)).catch(() => {});
    }, []);
    useEffect(() => {
        loadUnread();
        window.addEventListener('mentions-updated', loadUnread);
        const iv = window.setInterval(loadUnread, 60000);
        return () => { window.removeEventListener('mentions-updated', loadUnread); window.clearInterval(iv); };
    }, [loadUnread]);

    // 全プロジェクトでスキップされている場合だけメニューから外す。
    // ユニオンビューだと 1 プロジェクトのスキップ設定で他プロジェクトのメニューまで消える
    const skippedEverywhere = (phase: PhaseCode) =>
        projects.length > 0 && projects.every((p) => skippedPhasesOf(p.id).includes(phase));
    const isRequirementSkipped = skippedEverywhere(REQUIREMENT_PHASE_CODE);
    const isDevelopmentSkipped = DEVELOPMENT_PHASE_CODES.every(skippedEverywhere);
    // 変更ログは横断ビュー。いずれかの所属プロジェクトで閲覧ロールを持てば表示（全社設定のロールをPJロールに適用）
    const canViewChangeLogs = !!currentUser && (
        isSystemAdmin ||
        projects.some(p => (globalSettings.changeLogViewRoles ?? []).includes(resolveProjectRole(p.id) ?? ''))
    );

    const handleTabChange = (tab: TabKey) => {
        onTabChange(tab);
        setSidebarOpen(false);
    };

    const navItem = (tab: TabKey, icon: React.ReactNode, label: string, badge?: number) => (
        <button
            onClick={() => handleTabChange(tab)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50"
            }`}
        >
            {icon}
            {label}
            {badge != null && badge > 0 && (
                <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold text-white bg-red-500 rounded-full">
                    {badge > 99 ? '99+' : badge}
                </span>
            )}
        </button>
    );

    const sidebarContent = (
        <>
            <div className="h-16 px-6 border-b border-gray-300 flex items-center justify-between">
                <button
                    onClick={() => handleTabChange('dashboard')}
                    className="text-xl font-bold flex items-center gap-2 text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                    <LayoutDashboard size={24} />
                    Reflect
                </button>
                {/* モバイル時の閉じるボタン */}
                <button
                    onClick={() => setSidebarOpen(false)}
                    className="md:hidden text-gray-400 hover:text-gray-600 p-1"
                >
                    <X size={20} />
                </button>
            </div>
            <nav className="flex-1 p-4 space-y-2">
                {navItem("dashboard", <AppWindow size={20} />, "ダッシュボード", mentionUnread)}
                {navItem("schedule", <CalendarDays size={20} />, "スケジュール")}
                {!isRequirementSkipped && navItem("requirement", <ListTodo size={20} />, "要件タスク一覧")}
                {!isDevelopmentSkipped && navItem("development", <ListTodo size={20} />, "開発タスク一覧")}
                {navItem("indirect", <ListTodo size={20} />, "工程外タスク一覧")}
                {navItem("actionItems", <ClipboardList size={20} />, "アクションアイテム")}
                {navItem("surveys", <ClipboardCheck size={20} />, "アンケート")}
                {navItem("assignment", <Users size={20} />, "タスク割り当て")}
                {canViewChangeLogs && navItem("changelog", <History size={20} />, "変更ログ")}
                {navItem("settings", <Settings size={20} />, "プロジェクト設定")}
            </nav>
            <div className="p-4 border-t border-gray-300">
                <div className="text-xs text-gray-400 text-center">&copy; 2026 Material7</div>
            </div>
        </>
    );

    return (
        <>
            <div className="flex h-screen bg-gray-100 font-sans text-gray-900">

                {/* モバイル用オーバーレイ背景 */}
                {sidebarOpen && (
                    <div
                        className="fixed inset-0 bg-black/40 z-30 md:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                {/* Sidebar - デスクトップ: 常時表示 / モバイル: ドロワー */}
                <aside className={`
                    fixed inset-y-0 left-0 z-40 w-56 bg-white border-r border-gray-300 flex flex-col
                    transform transition-transform duration-200
                    ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                    md:relative md:translate-x-0 md:z-auto
                `}>
                    {sidebarContent}
                </aside>

                {/* Main Content */}
                <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <header className="bg-white border-b border-gray-300 h-16 px-4 md:px-8 shrink-0 z-10 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {/* モバイル用ハンバーガーボタン */}
                            <button
                                onClick={() => setSidebarOpen(true)}
                                className="md:hidden text-gray-500 hover:text-gray-700 p-1"
                                aria-label="メニューを開く"
                            >
                                <Menu size={22} />
                            </button>
                            <h2 className="text-base md:text-xl font-semibold text-gray-800">{PAGE_TITLES[activeTab]}</h2>
                        </div>
                        {currentUser && (
                            <div className="flex items-center gap-2 md:gap-3">
                                <button
                                    onClick={() => setMyPageOpen(true)}
                                    className="flex items-center gap-2 md:gap-3 hover:bg-gray-50 rounded-lg px-2 py-1 transition-colors"
                                    title="マイページ"
                                >
                                    <UserCircle size={20} className="text-gray-400" />
                                    <div className="text-right hidden sm:block">
                                        <p className="text-sm font-medium text-gray-800 leading-none">{currentUser.name}</p>
                                        <p className="text-xs text-gray-400 mt-0.5">{systemRoleLabel(currentUser.role)}</p>
                                    </div>
                                </button>
                                <button
                                    onClick={() => {
                                        if (window.confirm("ログアウトしてもよろしいですか？")) logout();
                                    }}
                                    title="ログアウト"
                                    className="ml-1 text-gray-400 hover:text-red-500 transition-colors"
                                >
                                    <LogOut size={18} />
                                </button>
                            </div>
                        )}
                    </header>
                    <div className="p-4 md:p-8 flex-1 min-h-0 overflow-auto">{children}</div>
                </main>
            </div>

            <MyPageSlideOver open={myPageOpen} onClose={() => setMyPageOpen(false)} />
        </>
    );
};
