import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface CollapsibleProps {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Collapsible({
  title,
  summary,
  defaultOpen = false,
  children,
}: CollapsibleProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-white/[0.08] pt-2.5">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between py-1 text-left text-xs font-semibold text-[#F4F4F5] hover:text-white select-none"
      >
        <span className="flex items-center gap-1.5">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#A1A1AA]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#A1A1AA]" />
          )}
          <span>{title}</span>
        </span>
        {summary && (
          <span className="text-[11px] font-mono-tabular font-normal text-[#A1A1AA]">
            {summary}
          </span>
        )}
      </button>
      {isOpen && <div className="mt-2.5 flex flex-col gap-2.5">{children}</div>}
    </div>
  );
}
