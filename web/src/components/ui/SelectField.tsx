import { useId } from 'react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  disabledReason?: string; // se agrega al texto visible: "Waffle (próximamente)"
}

export interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  placeholder?: string;
  onChange: (value: T) => void;
  testId?: string;
  disabled?: boolean;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  placeholder,
  onChange,
  testId,
  disabled = false,
}: SelectFieldProps<T>) {
  const selectId = useId();

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={selectId}
        className="text-[11px] font-medium text-[#8b919e] select-none"
      >
        {label}
      </label>
      <select
        id={selectId}
        data-testid={testId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full h-9 coarse:min-h-10 px-3 rounded-xl bg-[#131315] border border-white/[0.08] text-[13px] font-sans text-white focus:outline-none focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3]/50 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed transition-colors"
      >
        {placeholder && (
          <option value="" disabled={value !== ''} className="bg-[#131315] text-[#8b919e]">
            {placeholder}
          </option>
        )}
        {options.map((opt) => {
          const labelText = opt.disabledReason
            ? `${opt.label} (${opt.disabledReason.toLowerCase()})`
            : opt.label;
          return (
            <option
              key={opt.value}
              value={opt.value}
              disabled={opt.disabled}
              className="bg-[#131315] text-white"
            >
              {labelText}
            </option>
          );
        })}
      </select>
    </div>
  );
}
