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
        className="text-xs font-medium text-[#A1A1AA] select-none"
      >
        {label}
      </label>
      <select
        id={selectId}
        data-testid={testId}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full h-8 coarse:min-h-10 px-2.5 rounded-md bg-[#1C1C21] border border-white/[0.08] text-xs font-sans text-[#F4F4F5] focus:outline-none focus:border-[#0A84FF] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
      >
        {placeholder && (
          <option value="" disabled={value !== ''} className="bg-[#1C1C21] text-[#9CA3AF]">
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
              className="bg-[#1C1C21] text-[#F4F4F5]"
            >
              {labelText}
            </option>
          );
        })}
      </select>
    </div>
  );
}
