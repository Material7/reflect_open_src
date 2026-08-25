import React, { useState, useEffect, useCallback } from 'react';
import { X, UserCircle, KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, Trash2, Copy, Check, ShieldCheck, GitBranch } from 'lucide-react';
import { useProject } from '@/context/ProjectContext';
import { authApi, apiKeyApi, vcsCredentialsApi, VcsCredential } from '@/lib/api';
import { ROLE_HIERARCHY, systemRoleLabel } from '@/lib/constants';
import type { ApiKey, ApiKeyCreated, Project } from '@/types';

interface ProjectRoleEntry { project: Project; role: string; }

const projectRoleBadgeClass = (role: string): string => {
  switch (role) {
    case 'Admin': return 'bg-red-100 text-red-700';
    case 'PM': return 'bg-purple-100 text-purple-700';
    case 'PL': return 'bg-indigo-100 text-indigo-700';
    case 'DL': return 'bg-blue-100 text-blue-700';
    case 'SL': return 'bg-cyan-100 text-cyan-700';
    default: return 'bg-gray-100 text-gray-600';
  }
};

interface MyPageSlideOverProps {
  open: boolean;
  onClose: () => void;
}

export const MyPageSlideOver: React.FC<MyPageSlideOverProps> = ({ open, onClose }) => {
  const { currentUser, settings, projects, getProjectMembers } = useProject();

  const myProjectRoles: ProjectRoleEntry[] = projects
    .map((p: Project): ProjectRoleEntry | null => {
      const pm = getProjectMembers(p.id).find(m => m.employeeNumber === currentUser?.employeeNumber);
      return pm ? { project: p, role: pm.role } : null;
    })
    .filter((x): x is ProjectRoleEntry => x !== null)
    .sort((a, b) => (ROLE_HIERARCHY[a.role] ?? 99) - (ROLE_HIERARCHY[b.role] ?? 99));

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [vcsCreds, setVcsCreds] = useState<VcsCredential[]>([]);
  const [vcsMsg, setVcsMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [vcsSaving, setVcsSaving] = useState(false);
  const [vcsShowPass, setVcsShowPass] = useState(false);
  const emptyVcsForm = { id: undefined as string | undefined, type: 'SVN' as 'SVN' | 'GIT', host: '', username: '', password: '' };
  const [vcsForm, setVcsForm] = useState(emptyVcsForm);

  const [apiKey, setApiKey] = useState<ApiKey | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');

  const loadApiKey = useCallback(async () => {
    setApiKeyLoading(true);
    try {
      const keys = await apiKeyApi.list();
      setApiKey(keys[0] ?? null);
    } catch {
    } finally {
      setApiKeyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrent(false);
      setShowNew(false);
      setShowConfirm(false);
      setSuccessMsg('');
      setErrorMsg('');
      setNewlyCreated(null);
      setCopied(false);
      setApiKeyError('');
      setVcsMsg(null);
      setVcsShowPass(false);
      setVcsForm(emptyVcsForm);
    } else {
      loadApiKey();
      loadVcs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadApiKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const domainGroupNames = (() => {
    const memberRecord = settings.members.find(m => m.employeeNumber === currentUser?.employeeNumber);
    const groupIds = memberRecord?.domainGroupIds ?? [];
    if (!groupIds.length) return '未所属';
    const names: string[] = [];
    settings.domains.forEach(domain => {
      domain.groups.forEach(group => {
        if (groupIds.includes(group.id)) {
          names.push(`${domain.name} / ${group.name}`);
        }
      });
    });
    return names.length > 0 ? names.join('、') : '未所属';
  })();

  const handleGenerate = async () => {
    setGenerating(true);
    setApiKeyError('');
    try {
      const created = await apiKeyApi.generate();
      setNewlyCreated(created);
      setApiKey(created);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'APIキーの発行に失敗しました');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async () => {
    if (!apiKey) return;
    if (!window.confirm('APIキーを削除しますか？削除後は使用できなくなります。')) return;
    try {
      await apiKeyApi.revoke(apiKey.id);
      setApiKey(null);
      setNewlyCreated(null);
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'APIキーの削除に失敗しました');
    }
  };

  const handleCopy = async () => {
    if (!newlyCreated) return;
    await navigator.clipboard.writeText(newlyCreated.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');

    if (newPassword !== confirmPassword) {
      setErrorMsg('新しいパスワードが一致しません');
      return;
    }
    if (newPassword.length < 5) {
      setErrorMsg('パスワードは5文字以上で入力してください');
      return;
    }

    setIsSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setSuccessMsg('パスワードを変更しました');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'パスワードの変更に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = currentPassword.trim() && newPassword.trim() && confirmPassword.trim() && !isSubmitting;

  const loadVcs = useCallback(async () => {
    try { setVcsCreds(await vcsCredentialsApi.list()); } catch { /* 認証エラーは api.ts 側で処理 */ }
  }, []);

  const startEditVcs = (c: VcsCredential) => {
    setVcsForm({ id: c.id, type: c.type, host: c.host, username: c.username, password: '' });
    setVcsMsg(null);
    setVcsShowPass(false);
  };

  const saveVcs = useCallback(async () => {
    if (!vcsForm.username.trim()) { setVcsMsg({ type: 'error', text: 'ユーザー名は必須です' }); return; }
    setVcsSaving(true);
    setVcsMsg(null);
    try {
      await vcsCredentialsApi.save({
        id: vcsForm.id,
        type: vcsForm.type,
        host: vcsForm.host.trim(),
        username: vcsForm.username.trim(),
        password: vcsForm.password || undefined,
      });
      setVcsMsg({ type: 'success', text: '保存しました' });
      setVcsForm(emptyVcsForm);
      setVcsShowPass(false);
      await loadVcs();
    } catch (e) {
      setVcsMsg({ type: 'error', text: e instanceof Error ? e.message : '保存に失敗しました' });
    } finally {
      setVcsSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vcsForm, loadVcs]);

  const deleteVcs = useCallback(async (id: string) => {
    if (!window.confirm('この認証情報を削除しますか？')) return;
    try {
      await vcsCredentialsApi.delete(id);
      if (vcsForm.id === id) setVcsForm(emptyVcsForm);
      await loadVcs();
    } catch (e) {
      setVcsMsg({ type: 'error', text: e instanceof Error ? e.message : '削除に失敗しました' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vcsForm.id, loadVcs]);

  return (
    <>
      {/* オーバーレイ */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* スライドオーバーパネル */}
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-96 bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">マイページ</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ── プロフィール ─────────────────────────────────── */}
          <section className="px-6 py-6 border-b border-gray-100">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center">
                <UserCircle size={36} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-gray-800">{currentUser?.name}</p>
                <span className="inline-block mt-0.5 text-xs text-gray-500">
                  システムロール:{' '}
                  <span className={`px-2 py-0.5 rounded-full font-medium ${currentUser?.role === 'Admin' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                    {systemRoleLabel(currentUser?.role)}
                  </span>
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <ProfileRow label="社員番号" value={currentUser?.employeeNumber ?? '-'} mono />
              <ProfileRow label="氏名" value={currentUser?.name ?? '-'} />
              <ProfileRow label="所属グループ" value={domainGroupNames} />
            </div>

            {/* プロジェクト別ロール */}
            <div className="mt-5">
              <p className="text-xs text-gray-400 mb-2">プロジェクト別ロール</p>
              {myProjectRoles.length === 0 ? (
                <p className="text-sm text-gray-400 italic">所属プロジェクトなし</p>
              ) : (
                <div className="space-y-1.5">
                  {myProjectRoles.map(({ project, role }) => (
                    <div key={project.id} className="flex items-center justify-between gap-3">
                      <span className={`text-sm truncate ${project.status === 'archived' ? 'text-gray-400' : 'text-gray-700'}`}>
                        {project.name}{project.status === 'archived' ? '（アーカイブ）' : ''}
                      </span>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${projectRoleBadgeClass(role)}`}>{role}</span>
                    </div>
                  ))}
                </div>
              )}
              {currentUser?.role === 'Admin' && (
                <p className="text-[11px] text-gray-400 mt-2">※ システム管理者は全プロジェクトにアクセスできます</p>
              )}
            </div>
          </section>

          {/* ── API キー ────────────────────────────────────── */}
          <section className="px-6 py-6 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">API キー</h3>
            </div>

            {apiKeyLoading ? (
              <p className="text-xs text-gray-400 text-center py-2">読み込み中...</p>
            ) : apiKey ? (
              <div className="space-y-3">
                {/* 発行直後のみ平文表示 */}
                {newlyCreated && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                    <p className="text-xs font-medium text-amber-700 flex items-center gap-1">
                      <AlertCircle size={12} />
                      このキーは一度しか表示されません
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono bg-white border border-amber-200 rounded px-2 py-1.5 break-all text-gray-800">
                        {newlyCreated.key}
                      </code>
                      <button
                        onClick={handleCopy}
                        className="shrink-0 p-1.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors"
                        title="コピー"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                )}

                {/* キー情報 */}
                <div className="flex items-center justify-between p-2.5 rounded-lg border border-gray-200 bg-gray-50">
                  <div>
                    <p className="font-mono text-xs text-gray-700">{apiKey.keyPrefix}••••••••</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      作成: {new Date(apiKey.createdAt).toLocaleDateString('ja-JP')}
                      {apiKey.lastUsedAt && (
                        <span className="ml-2">最終使用: {new Date(apiKey.lastUsedAt).toLocaleDateString('ja-JP')}</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={handleRevoke}
                    className="shrink-0 p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="削除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full py-2 rounded-lg border border-dashed border-indigo-300 text-indigo-600 text-xs font-medium hover:bg-indigo-50 transition-colors disabled:opacity-40"
              >
                {generating ? '発行中...' : '+ API キーを発行'}
              </button>
            )}

            {apiKeyError && (
              <div className="mt-3 flex items-center gap-2 text-red-600 text-xs bg-red-50 px-3 py-2 rounded-lg">
                <AlertCircle size={13} />
                {apiKeyError}
              </div>
            )}
          </section>

          {/* ── VCS 認証情報（サーバー単位で複数登録） ───────── */}
          <section className="px-6 py-6 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <GitBranch size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">VCS 認証情報（SVN / Git）</h3>
            </div>
            <p className="text-xs text-gray-400 mb-4">サーバー（ホスト）ごとに登録できます。リビジョン取得時はリポジトリURLのホストで自動選択されます。ホスト空欄は「既定」（ホスト未一致時に使用）です。</p>

            {/* 登録済み一覧 */}
            <div className="space-y-2 mb-4">
              {vcsCreds.length === 0 ? (
                <p className="text-xs text-gray-400 italic">認証情報が登録されていません。</p>
              ) : vcsCreds.map(c => (
                <div key={c.id} className={`flex items-center gap-2 px-3 py-2 border rounded-lg ${vcsForm.id === c.id ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200'}`}>
                  <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${c.type === 'SVN' ? 'bg-orange-100 text-orange-700' : 'bg-sky-100 text-sky-700'}`}>{c.type}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-800 truncate">{c.host || '（既定）'}</div>
                    <div className="text-[11px] text-gray-500 truncate">{c.username}{c.passwordSet ? ' ・ パスワード設定済み' : ' ・ パスワード未設定'}</div>
                  </div>
                  <button onClick={() => startEditVcs(c)} className="shrink-0 text-xs text-indigo-600 hover:text-indigo-800">編集</button>
                  <button onClick={() => deleteVcs(c.id)} className="shrink-0 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>

            {/* 追加・編集フォーム */}
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-600">{vcsForm.id ? '認証情報を編集' : '認証情報を追加'}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">種別</label>
                  <select value={vcsForm.type} onChange={e => setVcsForm(f => ({ ...f, type: e.target.value as 'SVN' | 'GIT' }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                    <option value="SVN">SVN</option>
                    <option value="GIT">Git</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ホスト</label>
                  <input type="text" value={vcsForm.host} onChange={e => setVcsForm(f => ({ ...f, host: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ユーザー名</label>
                <input type="text" value={vcsForm.username} onChange={e => setVcsForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="ユーザー名"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
              </div>
              <PasswordField
                label={vcsForm.id ? 'パスワード（変更する場合のみ入力）' : 'パスワード'}
                value={vcsForm.password}
                onChange={v => setVcsForm(f => ({ ...f, password: v }))}
                show={vcsShowPass}
                onToggleShow={() => setVcsShowPass(v => !v)}
              />
              {vcsMsg && (
                <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${vcsMsg.type === 'success' ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                  {vcsMsg.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                  {vcsMsg.text}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={saveVcs} disabled={vcsSaving || !vcsForm.username.trim()}
                  className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {vcsSaving ? '保存中...' : vcsForm.id ? '更新' : '追加'}
                </button>
                {vcsForm.id && (
                  <button onClick={() => { setVcsForm(emptyVcsForm); setVcsMsg(null); }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">取消</button>
                )}
              </div>
            </div>
          </section>

          {/* ── パスワード変更 ──────────────────────────────── */}
          <section className="px-6 py-6">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound size={16} className="text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">パスワード変更</h3>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-3">
              <PasswordField
                label="現在のパスワード"
                value={currentPassword}
                onChange={setCurrentPassword}
                show={showCurrent}
                onToggleShow={() => setShowCurrent(v => !v)}
              />
              <PasswordField
                label="新しいパスワード"
                value={newPassword}
                onChange={setNewPassword}
                show={showNew}
                onToggleShow={() => setShowNew(v => !v)}
              />
              <PasswordField
                label="新しいパスワード（確認）"
                value={confirmPassword}
                onChange={setConfirmPassword}
                show={showConfirm}
                onToggleShow={() => setShowConfirm(v => !v)}
              />

              {errorMsg && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 px-3 py-2 rounded-lg">
                  <AlertCircle size={13} />
                  {errorMsg}
                </div>
              )}
              {successMsg && (
                <div className="flex items-center gap-2 text-green-700 text-xs bg-green-50 px-3 py-2 rounded-lg">
                  <CheckCircle2 size={13} />
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full mt-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? '変更中...' : '変更する'}
              </button>
            </form>
          </section>

        </div>
      </div>
    </>
  );
};

const ProfileRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex items-start justify-between gap-4">
    <span className="text-xs text-gray-400 w-24 shrink-0 pt-0.5">{label}</span>
    <span className={`text-sm text-gray-700 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);

const PasswordField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
}> = ({ label, value, onChange, show, onToggleShow }) => (
  <div>
    <label className="block text-xs text-gray-500 mb-1">{label}</label>
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 pr-9 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  </div>
);
