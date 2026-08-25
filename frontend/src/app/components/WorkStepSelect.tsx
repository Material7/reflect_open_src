import React, { useState, useRef, useEffect } from 'react';
import { WORK_STEPS, WorkStepMaster, workStepByCode, INITIAL_WORK_STEP } from '@/lib/constants';
import { ChevronDown, Check, Lock } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface WorkStepSelectProps {
  value: string;
  onChange: (code: string) => void;
  disabledCodes?: string[];
  className?: string;
}

export const WorkStepSelect: React.FC<WorkStepSelectProps> = ({ value, onChange, disabledCodes = [], className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredStep, setHoveredStep] = useState<WorkStepMaster | null>(null);
  const [tooltipTop, setTooltipTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedStep = workStepByCode(value) ?? INITIAL_WORK_STEP;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleItemMouseEnter = (step: WorkStepMaster, el: HTMLDivElement) => {
    hoverTimeoutRef.current = setTimeout(() => {
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const itemRect = el.getBoundingClientRect();
        setTooltipTop(itemRect.top - containerRect.top);
      }
      setHoveredStep(step);
    }, 800);
  };

  const handleItemMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredStep(null);
  };

  return (
    <div className={twMerge("relative w-full", className)} ref={containerRef}>
      <div
        className="w-full border border-gray-300 rounded px-3 py-2 bg-white flex items-center justify-between cursor-pointer hover:border-blue-500 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={(e) => handleItemMouseEnter(selectedStep, e.currentTarget as HTMLDivElement)}
        onMouseLeave={handleItemMouseLeave}
      >
        <span className="text-sm font-medium">{selectedStep.code}</span>
        <ChevronDown size={16} className="text-gray-500" />
      </div>

      {/* ツールチップ: ドロップダウンが閉じている場合 */}
      {!isOpen && hoveredStep && (
        <div className="absolute z-[60] left-full top-0 ml-2 w-48 bg-gray-800 text-white text-xs rounded p-2 shadow-lg pointer-events-none">
          <div className="font-bold">{hoveredStep.code}：{hoveredStep.name}</div>
          <div className="mt-0.5 opacity-75">進捗率: {hoveredStep.progress}%</div>
          <div className="absolute top-3 -left-1 w-2 h-2 bg-gray-800 rotate-45" />
        </div>
      )}

      {isOpen && (
        <>
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto">
            {WORK_STEPS.map((step) => {
              const isDisabled = disabledCodes.includes(step.code);
              return (
                <WorkStepItem
                  key={step.code}
                  step={step}
                  isSelected={step.code === value}
                  isDisabled={isDisabled}
                  onClick={() => {
                    if (!isDisabled) {
                      onChange(step.code);
                      setIsOpen(false);
                    }
                  }}
                  onMouseEnter={handleItemMouseEnter}
                  onMouseLeave={handleItemMouseLeave}
                />
              );
            })}
          </div>

          {/* ツールチップ: overflow の外側に描画、アイテム横に位置合わせ */}
          {hoveredStep && (
            <div
              className="absolute z-[60] left-full ml-2 w-48 bg-gray-800 text-white text-xs rounded p-2 shadow-lg pointer-events-none"
              style={{ top: tooltipTop }}
            >
              <div className="font-bold">{hoveredStep.code}：{hoveredStep.name}</div>
              <div className="mt-0.5 opacity-75">進捗率: {hoveredStep.progress}%</div>
              <div className="absolute top-3 -left-1 w-2 h-2 bg-gray-800 rotate-45" />
            </div>
          )}
        </>
      )}
    </div>
  );
};

interface WorkStepItemProps {
  step: WorkStepMaster;
  isSelected: boolean;
  isDisabled: boolean;
  onClick: () => void;
  onMouseEnter: (step: WorkStepMaster, el: HTMLDivElement) => void;
  onMouseLeave: () => void;
}

const WorkStepItem: React.FC<WorkStepItemProps> = ({ step, isSelected, isDisabled, onClick, onMouseEnter, onMouseLeave }) => {
  const itemRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={itemRef}
      className={clsx(
        "px-3 py-2 text-sm flex items-center justify-between",
        isDisabled
          ? "cursor-not-allowed text-gray-300 bg-gray-50"
          : isSelected
          ? "cursor-pointer bg-blue-50 text-blue-700"
          : "cursor-pointer hover:bg-gray-50 text-gray-700"
      )}
      onClick={onClick}
      onMouseEnter={() => itemRef.current && onMouseEnter(step, itemRef.current)}
      onMouseLeave={onMouseLeave}
    >
      <span>{step.code}</span>
      {isDisabled ? <Lock size={12} className="text-gray-300" /> : isSelected && <Check size={14} />}
    </div>
  );
};
