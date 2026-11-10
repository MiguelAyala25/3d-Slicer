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
    <div className="border-t border-white/[0.06] pt-2">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between py-1 text-left text-[11px] font-medium text-[#8b919e] hover:text-white select-none cursor-pointer transition-colors"
      >
        <span className="flex items-center gap-1.5">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#2997ff]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#8b919e]" />
          )}
          <span>{title}</span>
        </span>
        {summary && (
          <span className="text-[11px] font-mono-tabular font-normal text-[#8b919e]">
            {summary}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="mt-2 pl-2 border-l border-white/[0.08] flex flex-col gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
