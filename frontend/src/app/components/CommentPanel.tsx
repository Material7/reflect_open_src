import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useProject } from '@/context/ProjectContext';
import { commentsApi, TaskComment, mentionsApi } from '@/lib/api';
import { MENTION_TOKEN } from '@/lib/mentions';
import { Send, Trash2, Reply } from 'lucide-react';

/** コメント本文中の <@社員番号> をメンションチップに変換して描画 */
function renderCommentContent(content: string, empNoToName: Record<string, string>, mine: boolean): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of content.matchAll(MENTION_TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(content.slice(last, idx));
    const empNo = m[1];
    const name = empNoToName[empNo] ?? empNo;
    nodes.push(
      <span
        key={`mention-${key++}`}
        className={`inline-flex items-center rounded px-1 font-medium ${
          mine ? 'bg-emerald-200 text-emerald-800' : 'bg-emerald-100 text-emerald-800'
        }`}
      >
        @{name}
      </span>
    );
    last = idx + m[0].length;
  }
  if (last < content.length) nodes.push(content.slice(last));
  return nodes;
}

interface CommentPanelProps {
  taskId: string;
  /** タスクの所属プロジェクトID（メンション候補の絞り込みに使用） */
  projectId: number;
  /** コメント件数が変化したら親へ通知（タブのバッジ用） */
  onCountChange?: (count: number) => void;
  className?: string;
}

export const CommentPanel: React.FC<CommentPanelProps> = ({ taskId, projectId, onCountChange, className }) => {
  const { currentUser, getProjectMembers, members } = useProject();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const commentEndRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const activeMentionRef = useRef<HTMLButtonElement>(null);

  const mentionMembers = useMemo(() => {
    const pm = getProjectMembers(projectId);
    const list = pm.length > 0
      ? pm.map(m => ({ employeeNumber: m.employeeNumber, name: m.name }))
      : members.map(m => ({ employeeNumber: m.employeeNumber, name: m.name }));
    // タスク種別・取得元によらず表示順を一意に固定（名前→社員番号の昇順）
    return list.slice().sort((a, b) =>
      a.name.localeCompare(b.name, 'ja') || a.employeeNumber.localeCompare(b.employeeNumber));
  }, [getProjectMembers, projectId, members]);
  const empNoToName = useMemo(() => {
    const m: Record<string, string> = {};
    mentionMembers.forEach(pm => { m[pm.employeeNumber] = pm.name; });
    return m;
  }, [mentionMembers]);

  // 選択済みメンション（送信時に @表示名 → <@社員番号> へ変換するための対応表）
  const pendingMentionsRef = useRef<{ empNo: string; name: string }[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  // ドロップダウンは fixed 配置で overflow 親のクリップを回避（テキストエリア上に表示）
  const [mentionPos, setMentionPos] = useState<{ left: number; bottom: number; width: number } | null>(null);

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return mentionMembers
      .filter(pm => pm.employeeNumber !== currentUser?.employeeNumber)
      .filter(pm => !q || pm.name.toLowerCase().includes(q) || pm.employeeNumber.toLowerCase().includes(q))
      .slice(0, 50);
  }, [mentionMembers, mentionQuery, currentUser]);

  const updateMentionPos = useCallback(() => {
    const el = commentInputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMentionPos({ left: r.left, bottom: window.innerHeight - r.top + 6, width: r.width });
  }, []);

  useEffect(() => {
    if (!mentionOpen) return;
    updateMentionPos();
    window.addEventListener('resize', updateMentionPos);
    return () => window.removeEventListener('resize', updateMentionPos);
  }, [mentionOpen, mentionCandidates.length, updateMentionPos]);

  useEffect(() => {
    if (mentionOpen) activeMentionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [mentionIndex, mentionOpen]);

  useEffect(() => {
    commentsApi.list(taskId).then(setComments).catch(() => {});
  }, [taskId]);

  useEffect(() => {
    commentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  useEffect(() => { onCountChange?.(comments.length); }, [comments, onCountChange]);

  // パネルを開いた（マウントした）時点で、このタスク宛の自分のメンションを既読化
  useEffect(() => {
    mentionsApi.markReadByTask(taskId)
      .then(() => window.dispatchEvent(new Event('mentions-updated')))
      .catch(() => {});
  }, [taskId]);

  // 入力変更時に「@クエリ」を検出してメンション候補ドロップダウンを制御
  const handleCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setCommentInput(value);
    const caret = e.target.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at >= 0) {
      const query = before.slice(at + 1);
      // @ の直後からカーソルまでに空白・改行・別の@が無ければメンション入力中とみなす
      if (!/[\s@]/.test(query)) {
        // 位置はこの場で同期計算（effect 遅延による非表示を回避）
        const rect = e.currentTarget.getBoundingClientRect();
        setMentionPos({ left: rect.left, bottom: window.innerHeight - rect.top + 6, width: rect.width });
        setMentionStart(at);
        setMentionQuery(query);
        setMentionIndex(0);
        setMentionOpen(true);
        return;
      }
    }
    setMentionOpen(false);
  }, []);

  const insertMention = useCallback((pm: { employeeNumber: string; name: string }) => {
    setCommentInput(prev => {
      const caret = commentInputRef.current?.selectionStart ?? prev.length;
      const start = mentionStart >= 0 ? mentionStart : caret;
      const next = prev.slice(0, start) + `@${pm.name} ` + prev.slice(caret);
      const pos = start + pm.name.length + 2;
      requestAnimationFrame(() => {
        commentInputRef.current?.focus();
        commentInputRef.current?.setSelectionRange(pos, pos);
      });
      return next;
    });
    if (!pendingMentionsRef.current.some(m => m.empNo === pm.employeeNumber)) {
      pendingMentionsRef.current.push({ empNo: pm.employeeNumber, name: pm.name });
    }
    setMentionOpen(false);
  }, [mentionStart]);

  // 表示テキスト（@表示名）を保存用トークン（<@社員番号>）へ変換
  const toStoredContent = useCallback((text: string) => {
    let out = text;
    const sorted = [...pendingMentionsRef.current].sort((a, b) => b.name.length - a.name.length);
    for (const m of sorted) {
      out = out.split(`@${m.name}`).join(`<@${m.empNo}>`);
    }
    return out;
  }, []);

  const handleAddComment = useCallback(async () => {
    const text = commentInput.trim();
    if (!text || commentLoading) return;
    setCommentLoading(true);
    try {
      const created = await commentsApi.create(taskId, toStoredContent(text));
      setComments(prev => [...prev, created]);
      setCommentInput('');
      pendingMentionsRef.current = [];
      setMentionOpen(false);
    } finally {
      setCommentLoading(false);
    }
  }, [commentInput, commentLoading, taskId, toStoredContent]);

  // 「返信」: そのコメントの投稿者をメンションした状態で入力欄にフォーカス
  const handleReply = useCallback((c: TaskComment) => {
    const name = empNoToName[c.createdBy] ?? c.createdBy;
    if (!pendingMentionsRef.current.some(m => m.empNo === c.createdBy)) {
      pendingMentionsRef.current.push({ empNo: c.createdBy, name });
    }
    const token = `@${name} `;
    setCommentInput(prev => (prev.startsWith(token) ? prev : token + prev));
    requestAnimationFrame(() => {
      const el = commentInputRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  }, [empNoToName]);

  const handleDeleteComment = useCallback(async (commentId: string) => {
    if (!window.confirm('このコメントを削除しますか？')) return;
    await commentsApi.delete(taskId, commentId);
    setComments(prev => prev.filter(c => c.id !== commentId));
  }, [taskId]);

  return (
    <div className={`flex flex-col h-full ${className ?? 'w-[720px] max-w-full'}`}>
      <div className="flex-1 space-y-3 overflow-y-auto mb-3">
        {comments.length === 0 && (
          <p className="text-center text-gray-300 text-sm py-8">まだコメントはありません</p>
        )}
        {comments.map(c => {
          const isMine = c.createdBy === currentUser?.employeeNumber;
          return (
            <div key={c.id} className={`flex gap-2 min-w-0 ${isMine ? 'flex-row-reverse' : ''}`}>
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                {c.createdBy.charAt(0).toUpperCase()}
              </div>
              <div className={`max-w-[80%] min-w-0 ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">{c.createdBy}</span>
                  <span className="text-[10px] text-gray-500">
                    {new Date(c.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {!isMine && (
                    <button
                      onClick={() => handleReply(c)}
                      className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-indigo-600 transition-colors"
                      title="この投稿者にメンションして返信"
                    >
                      <Reply size={11} />返信
                    </button>
                  )}
                  {isMine && (
                    <button onClick={() => handleDeleteComment(c.id)} className="text-gray-300 hover:text-red-400 transition-colors">
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                <div className={`px-3 py-2 rounded-xl text-sm whitespace-pre-wrap break-words ${
                  isMine ? 'bg-indigo-100 text-gray-800 ring-1 ring-indigo-200 rounded-tr-none' : 'bg-gray-100 text-gray-800 rounded-tl-none'
                }`}>
                  {renderCommentContent(c.content, empNoToName, isMine)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={commentEndRef} />
      </div>
      {/* 入力エリア */}
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        {/* メンション候補ドロップダウン（fixed 配置で overflow 親にクリップされない） */}
        {mentionOpen && mentionCandidates.length > 0 && mentionPos && (
          <div
            className="fixed max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-[80]"
            style={{ left: mentionPos.left, bottom: mentionPos.bottom, width: Math.min(mentionPos.width, 288) }}
          >
            {mentionCandidates.map((pm, i) => (
              <button
                key={pm.employeeNumber}
                type="button"
                ref={i === mentionIndex ? activeMentionRef : null}
                onMouseDown={(e) => { e.preventDefault(); insertMention(pm); }}
                onMouseEnter={() => setMentionIndex(i)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
                  i === mentionIndex ? 'bg-indigo-50' : 'hover:bg-gray-50'
                }`}
              >
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                  {pm.name.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm text-gray-800">{pm.name}</span>
                <span className="text-[10px] text-gray-400 ml-auto">{pm.employeeNumber}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={commentInputRef}
          value={commentInput}
          onChange={handleCommentChange}
          onKeyDown={e => {
            if (mentionOpen && mentionCandidates.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % mentionCandidates.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionCandidates[mentionIndex]); return; }
              if (e.key === 'Escape') { e.preventDefault(); setMentionOpen(false); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); }
          }}
          placeholder="コメントを入力… (@ でメンション、Enter で送信、Shift+Enter で改行)"
          rows={2}
          className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          onClick={handleAddComment}
          disabled={!commentInput.trim() || commentLoading}
          className="self-end px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
};
