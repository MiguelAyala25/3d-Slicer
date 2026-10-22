import { useEffect, useId, useState, type ReactNode } from 'react';

export interface NumericInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  resetKey?: number;
  testId?: string;
  labelRight?: ReactNode;
  ariaDescribedBy?: string;
  onChange: (newValue: number) => void;
}

export function NumericInput({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
  resetKey,
  testId,
  labelRight,
  ariaDescribedBy,
  onChange,
}: NumericInputProps) {
  const inputId = useId();
  const [draft, setDraft] = useState<string>(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value, resetKey]);

  const commitDraft = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    const rounded = Number.isInteger(step)
      ? Math.round(clamped)
      : Number(clamped.toFixed(3));
    setDraft(String(rounded));
    if (Math.abs(rounded - value) > 1e-6) {
      onChange(rounded);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label
          htmlFor={inputId}
          className="text-xs font-medium text-[#A1A1AA] select-none"
        >
          {label}
        </label>
        {labelRight}
      </div>
      <div className="relative flex items-center">
        <input
          id={inputId}
          data-testid={testId}
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-describedby={ariaDescribedBy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDraft(String(value));
              e.currentTarget.blur();
            }
          }}
          className="w-full h-8 coarse:min-h-10 px-2.5 pr-8 rounded-md bg-[#1C1C21] border border-white/[0.08] text-xs font-mono-tabular text-[#F4F4F5] focus:outline-none focus:border-[#0A84FF] disabled:opacity-50"
        />
        {unit && (
          <span className="absolute right-2 text-[11px] text-[#9CA3AF] pointer-events-none select-none">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
