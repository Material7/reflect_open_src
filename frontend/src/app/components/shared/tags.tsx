import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

// タグ表示色（名前から決定的に選ぶ。カテゴリとは別パレット）
const TAG_PALETTE = [
  'bg-purple-100 text-purple-700',
  'bg-teal-100 text-teal-700',
  'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
  'bg-lime-100 text-lime-700',
];

export const tagBadge = (tag: string) => {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
};

/** プロジェクト設定のタグ候補から複数選択するドロップダウン */
export const TagMultiSelect: React.FC<{ options: string[]; value: string[]; onChange: (next: string[]) => void }> = ({ options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const updatePos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onDoc = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // capture フェーズでモーダル内スクロールも拾って追従させる
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  const toggle = (t: string) => onChange(value.includes(t) ? value.filter(x => x !== t) : [...value, t]);

  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500">
        {value.length === 0
          ? <span className="text-gray-400">選択してください</span>
          : <span className="flex flex-wrap gap-1">
              {value.map(t => <span key={t} className={`px-2 py-0.5 rounded text-xs font-medium ${tagBadge(t)}`}>{t}</span>)}
            </span>}
        <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width }}
          className="z-[60] bg-white border border-gray-300 rounded-lg shadow-lg max-h-56 overflow-auto py-1">
          {options.length === 0
            ? <div className="px-3 py-2 text-sm text-gray-400">タグが登録されていません</div>
            : options.map(t => (
              <label key={t} className="px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={value.includes(t)} onChange={() => toggle(t)}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-gray-700">{t}</span>
              </label>
            ))}
        </div>,
        document.body
      )}
    </div>
  );
};
