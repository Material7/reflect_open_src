import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DayPicker, DayContentProps } from 'react-day-picker';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { X, Clock, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProject } from '@/context/ProjectContext';

interface TimeTrackingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (totalHours: number, log: Record<string, number>, contentLog?: Record<string, string>) => void;
  initialLog?: Record<string, number>;
  initialDate?: Date;
  title: string;
  /** 実績工数モード: ログインユーザー名 */
  currentUserName?: string;
  /** 実績工数モード: 他メンバーのログ (表示のみ) */
  otherMemberLogs?: { name: string; log: Record<string, number>; contentLog?: Record<string, string> }[];
  /** 作業内容テキストの入力欄を表示する（実績工数モード） */
  withContent?: boolean;
  /** 日付 -> 作業内容テキスト（初期値） */
  initialContentLog?: Record<string, string>;
}

export const TimeTrackingModal: React.FC<TimeTrackingModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialLog,
  initialDate,
  title,
  currentUserName,
  otherMemberLogs,
  withContent = false,
  initialContentLog,
}) => {
  const { settings } = useProject();
  const holidaySet = useMemo(() => new Set((settings.holidays || []).map(h => h.date)), [settings.holidays]);

  const [selectedDate, setSelectedDate] = useState<Date>(initialDate || new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(initialDate || new Date());
  const [log, setLog] = useState<Record<string, number>>({});
  const [contentLog, setContentLog] = useState<Record<string, string>>({});
  const [inputValue, setInputValue] = useState<string>('');

  // Track previous isOpen to detect open transitions without depending on object refs
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    // Only initialize state when modal transitions from closed → open
    if (isOpen && !wasOpen) {
      const currentLog = initialLog || {};
      setLog(currentLog);
      setContentLog(initialContentLog || {});

      const dateToUse = initialDate || new Date();
      setSelectedDate(dateToUse);
      setCurrentMonth(dateToUse);

      const dateKey = format(dateToUse, 'yyyy-MM-dd');
      const hours = currentLog[dateKey];
      setInputValue(hours !== undefined ? formatTimeFromHours(hours) : '00:00');
    }
  }); // intentionally no deps — runs on every render, gated by ref comparison

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);

    const dateKey = format(date, 'yyyy-MM-dd');
    const hours = log[dateKey];
    setInputValue(hours !== undefined ? formatTimeFromHours(hours) : '00:00');
  };

  const formatTimeFromHours = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const parseHoursFromTime = (time: string): number | null => {
    if (!time) return null;
    const [hStr, mStr] = time.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h + m / 60;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setInputValue(newVal);

    if (/^\d{0,2}:\d{0,2}$/.test(newVal) && newVal.length === 5) {
      const hours = parseHoursFromTime(newVal);
      if (hours !== null) {
        const dateKey = format(selectedDate, 'yyyy-MM-dd');
        setLog(prev => {
          if (hours === 0) {
            const next = { ...prev };
            delete next[dateKey];
            return next;
          }
          return { ...prev, [dateKey]: hours };
        });
      }
    } else if (newVal === '') {
      const dateKey = format(selectedDate, 'yyyy-MM-dd');
      setLog(prev => {
        const next = { ...prev };
        delete next[dateKey];
        return next;
      });
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    const dateKey = format(selectedDate, 'yyyy-MM-dd');
    setContentLog(prev => {
      if (!v) { const next = { ...prev }; delete next[dateKey]; return next; }
      return { ...prev, [dateKey]: v };
    });
  };

  const handleSave = () => {
    const total = Object.values(log).reduce((sum, h) => sum + h, 0);
    // 工数のある日付の作業内容のみ残す
    const prunedContent = withContent
      ? Object.fromEntries(Object.entries(contentLog).filter(([d, v]) => v && (log[d] ?? 0) > 0))
      : undefined;
    onSave(total, log, prunedContent);
    onClose();
  };

  // 他メンバー合計工数マップ (日付 → 合計)
  const othersTotalByDate = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const member of (otherMemberLogs || [])) {
      for (const [date, h] of Object.entries(member.log)) {
        merged[date] = (merged[date] || 0) + h;
      }
    }
    return merged;
  }, [otherMemberLogs]);

  const CustomDayContent = (props: DayContentProps) => {
    const { date } = props;
    const dateKey = format(date, 'yyyy-MM-dd');
    const selfHours = log[dateKey];
    const othersHours = othersTotalByDate[dateKey];
    const dayOfWeek = date.getDay();

    let textColorClass = 'text-gray-900';
    if (dayOfWeek === 0 || holidaySet.has(dateKey)) {
      textColorClass = 'text-red-500 font-bold';
    } else if (dayOfWeek === 6) {
      textColorClass = 'text-blue-500 font-bold';
    }

    return (
      <div className="flex flex-col items-center w-full h-full pt-0.5 gap-px">
        <span className={`text-sm leading-none font-bold ${textColorClass}`}>{format(date, 'd')}</span>
        {currentUserName && selfHours !== undefined && selfHours > 0 && (
          <span className="text-[11px] leading-none font-semibold text-blue-600 bg-blue-50 rounded px-0.5">
            自 {formatTimeFromHours(selfHours)}
          </span>
        )}
        {!currentUserName && selfHours !== undefined && selfHours > 0 && (
          <span className="text-[11px] leading-none font-medium text-blue-600">
            {formatTimeFromHours(selfHours)}
          </span>
        )}
        {othersHours !== undefined && othersHours > 0 && (
          <span className="text-[11px] leading-none font-semibold text-amber-500 bg-amber-50 rounded px-0.5">
            他 {formatTimeFromHours(othersHours)}
          </span>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-xl shadow-2xl w-full md:max-w-[640px] max-h-[95dvh] md:max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200 border border-gray-300">
        
        {/* Header */}
        <div className="px-6 py-4 flex justify-between items-center bg-white border-b border-gray-300">
          <h3 className="text-lg font-bold text-gray-800">{title}</h3>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 space-y-4 bg-white overflow-y-auto flex-1">
          
          {/* Calendar Card */}
          <div className="border border-gray-300 rounded-xl p-4 bg-white shadow-sm">
            <style>{`
              .rdp {
                margin: 0;
                --rdp-cell-size: 60px;
                width: 100%;
              }
              .rdp-month { width: 100%; }
              .rdp-table { width: 100%; max-width: 100%; }
              
              .rdp-caption {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 0.5rem;
                margin-bottom: 1.5rem;
              }
              .rdp-caption_label {
                font-size: 1.3rem;
                font-weight: 600;
                color: #111827;
              }
              
              .rdp-nav { display: flex; gap: 0.5rem; }
              .rdp-nav_button {
                color: #374151;
                border-radius: 6px;
                padding: 4px;
              }
              .rdp-nav_button:hover {
                background-color: #f3f4f6;
              }
              
              .rdp-head_cell {
                font-size: 0.8rem;
                font-weight: 700;
                color: #4b5563;
                padding-bottom: 0.5rem;
                width: var(--rdp-cell-size);
                text-align: center;
              }
              .rdp-cell {
                width: var(--rdp-cell-size);
                text-align: center;
              }

              .rdp-button {
                width: var(--rdp-cell-size);
                height: 48px;
                border-radius: 6px !important;
                border: 2px solid transparent !important;
                padding: 0;
              }
              
              .rdp-day_selected { 
                background-color: transparent !important; 
                border-color: #2563eb !important;
                font-weight: bold;
              }
                 but typically selection keeps it readable. 
                 If we want the number to be specific color on selection, we can target it.
                 Current design: transparent bg, blue border. Text color inherits from CustomDayContent.
              
              .rdp-button:hover:not([disabled]):not(.rdp-day_selected) {
                background-color: #f9fafb !important;
                border-color: transparent !important;
              }
              @media (max-width: 640px) {
                .rdp { --rdp-cell-size: 44px; }
                .rdp-button { height: 40px; }
                .rdp-caption_label { font-size: 1rem; }
              }
            `}</style>
            <DayPicker
              mode="single"
              required={true}
              selected={selectedDate}
              onSelect={handleDateSelect}
              month={currentMonth}
              onMonthChange={setCurrentMonth}
              locale={ja}
              formatters={{
                formatCaption: (date) => `${format(date, 'yyyy年M月')}`
              }}
              components={{
                DayContent: CustomDayContent,
                IconLeft: () => <ChevronLeft size={20} />,
                IconRight: () => <ChevronRight size={20} />
              }}
            />
          </div>

          {/* Input Card */}
          <div className="border border-gray-300 rounded-xl p-4 bg-white shadow-sm">
            <div className="mb-3 text-sm font-bold text-gray-700">
              {format(selectedDate, 'yyyy年M月d日 (E)', { locale: ja })}
            </div>

            {/* 自分の工数入力行 */}
            <div className="relative group">
              <label className="block text-xs font-semibold text-gray-500 mb-2">工数 (hh:mm)</label>
              <div className="flex items-center gap-3">
                {currentUserName && (
                  <span className="shrink-0 text-sm font-medium text-gray-700 w-24 truncate">
                    {currentUserName}
                  </span>
                )}
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Clock size={18} className="text-gray-400 group-focus-within:text-indigo-500 transition-colors" />
                  </div>
                  <input
                    type="time"
                    value={inputValue}
                    onChange={handleInputChange}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-lg font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none bg-white transition-all text-gray-900 shadow-sm"
                    placeholder="--:--"
                  />
                </div>
              </div>
            </div>

            {/* 作業内容 (実績工数モード) */}
            {withContent && (
              <div className="mt-3">
                <label className="block text-xs font-semibold text-gray-500 mb-2">作業内容</label>
                <textarea
                  value={contentLog[format(selectedDate, 'yyyy-MM-dd')] ?? ''}
                  onChange={handleContentChange}
                  rows={2}
                  placeholder="この日に行った作業内容を記入"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none bg-white resize-none shadow-sm"
                />
              </div>
            )}

            {/* 他メンバーの工数 (選択日に入力がある場合のみ表示) */}
            {otherMemberLogs && otherMemberLogs.length > 0 && (() => {
              const dateKey = format(selectedDate, 'yyyy-MM-dd');
              const rows = otherMemberLogs.filter(m => (m.log[dateKey] ?? 0) > 0);
              if (rows.length === 0) return null;
              return (
                <div className="mt-3 pt-3 border-t border-gray-300">
                  <p className="text-xs font-semibold text-gray-400 mb-2">他メンバーの工数</p>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {rows.map((m) => (
                      <div key={m.name} className="flex items-start gap-3">
                        <span className="shrink-0 text-sm text-gray-500 w-24 truncate pt-2">{m.name}</span>
                        <div className="flex-1">
                          <div className="px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm font-medium text-gray-500 font-sans">
                            {formatTimeFromHours(m.log[dateKey])}
                          </div>
                          {m.contentLog?.[dateKey] && (
                            <p className="mt-1 px-1 text-xs text-gray-500 whitespace-pre-wrap">{m.contentLog[dateKey]}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-300 bg-white flex justify-end">
          <button
            onClick={handleSave}
            className="bg-indigo-600 text-white px-8 py-2.5 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Check size={18} />
            完了
          </button>
        </div>

      </div>
    </div>
  );
};
