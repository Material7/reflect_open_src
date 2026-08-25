import React, { useMemo } from 'react';
import { DayPicker, DayContentProps } from 'react-day-picker';
import { format, parse } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useProject } from '@/context/ProjectContext';

interface DatePickerWithHolidaysProps {
  value: string; // YYYY-MM-DD or ''
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  /** 値があるとき × でクリアできる（任意項目向け） */
  clearable?: boolean;
  /** この日付より前は選択不可（YYYY-MM-DD） */
  min?: string;
}

export const DatePickerWithHolidays: React.FC<DatePickerWithHolidaysProps> = ({
  value,
  onChange,
  className,
  disabled = false,
  clearable = false,
  min,
}) => {
  const { settings } = useProject();
  const holidaySet = useMemo(
    () => new Set((settings.holidays || []).map(h => h.date)),
    [settings.holidays]
  );

  const selectedDate = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined;
  const minDate = min ? parse(min, 'yyyy-MM-dd', new Date()) : undefined;
  const showClear = clearable && !!value && !disabled;

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange(format(date, 'yyyy-MM-dd'));
    }
  };

  const CustomDayContent = (props: DayContentProps) => {
    const { date } = props;
    const dateKey = format(date, 'yyyy-MM-dd');
    const dayOfWeek = date.getDay();

    let textColorClass = 'text-gray-900';
    if (dayOfWeek === 0 || holidaySet.has(dateKey)) {
      textColorClass = 'text-red-500 font-bold';
    } else if (dayOfWeek === 6) {
      textColorClass = 'text-blue-600 font-bold';
    }

    return (
      <span className={textColorClass}>{format(date, 'd')}</span>
    );
  };

  return (
    <Popover>
      <div className="relative">
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`w-full flex items-center gap-2 px-3 py-2 ${showClear ? 'pr-7' : ''} border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white text-left ${disabled ? 'cursor-not-allowed opacity-50' : ''} ${className || ''}`}
          >
            <CalendarIcon size={14} className="text-gray-400 shrink-0" />
            <span className={value ? 'text-gray-900' : 'text-gray-400 font-normal'}>
              {value || '選択してください'}
            </span>
          </button>
        </PopoverTrigger>
        {showClear && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(''); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 p-0.5 rounded"
            title="クリア"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto p-0 bg-white" align="start">
        <style>{`
          .holiday-picker .rdp { margin: 0; }
          .holiday-picker .rdp-month { width: 100%; }
          .holiday-picker .rdp-table { width: 100%; }
          .holiday-picker .rdp-caption {
            display: flex; align-items: center; justify-content: space-between;
            padding: 0.5rem; margin-bottom: 0.5rem;
          }
          .holiday-picker .rdp-caption_label { font-size: 0.95rem; font-weight: 600; color: #111827; }
          .holiday-picker .rdp-nav { display: flex; gap: 0.25rem; }
          .holiday-picker .rdp-nav_button { color: #374151; border-radius: 6px; padding: 4px; }
          .holiday-picker .rdp-nav_button:hover { background-color: #f3f4f6; }
          .holiday-picker .rdp-head_cell { font-size: 0.75rem; font-weight: 500; color: #6b7280; padding-bottom: 0.25rem; }
          .holiday-picker .rdp-button { width: 32px; height: 32px; border-radius: 6px !important; border: 2px solid transparent !important; padding: 0; }
          .holiday-picker .rdp-day_selected { background-color: #4f46e5 !important; border-color: #4f46e5 !important; }
          .holiday-picker .rdp-day_selected span { color: white !important; font-weight: bold !important; }
          .holiday-picker .rdp-button:hover:not([disabled]):not(.rdp-day_selected) { background-color: #f9fafb !important; }
        `}</style>
        <div className="holiday-picker p-3">
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            defaultMonth={selectedDate || new Date()}
            disabled={minDate ? { before: minDate } : undefined}
            locale={ja}
            formatters={{
              formatCaption: (date) => `${format(date, 'yyyy年M月')}`,
            }}
            components={{
              DayContent: CustomDayContent,
              IconLeft: () => <ChevronLeft size={16} />,
              IconRight: () => <ChevronRight size={16} />,
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
