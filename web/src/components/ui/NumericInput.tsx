import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

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
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef<number>(value);

  useEffect(() => {
    setDraft(String(value));
    lastCommittedRef.current = value;
  }, [value, resetKey]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const commitValue = (valToCommit: number) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const clamped = Math.max(min, Math.min(max, valToCommit));
    const rounded = Number.isInteger(step)
      ? Math.round(clamped)
      : Number(clamped.toFixed(3));
    setDraft(String(rounded));
    if (Math.abs(rounded - lastCommittedRef.current) > 1e-6) {
      lastCommittedRef.current = rounded;
      onChange(rounded);
    }
  };

  const commitDraft = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    commitValue(parsed);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextStr = e.target.value;
    setDraft(nextStr);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const parsed = Number.parseFloat(nextStr);
    if (!Number.isFinite(parsed)) return;

    // Detect step change (spinner arrows or arrow keys): difference is a multiple of step
    const diff = Math.abs(parsed - lastCommittedRef.current);
    const isStepChange = Math.abs(diff - step) < 1e-4;

    if (isStepChange && parsed >= min && parsed <= max) {
      commitValue(parsed);
      return;
    }

    // Debounced commit for typed values within valid range
    if (parsed >= min && parsed <= max) {
      debounceTimerRef.current = setTimeout(() => {
        commitValue(parsed);
      }, 400);
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
          onChange={handleInputChange}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
              }
              commitDraft();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
              }
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
