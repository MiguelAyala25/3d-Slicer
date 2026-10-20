import { AlertCircle, Info, X } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface StatusBarPillProps {
  className?: string;
}

export function StatusBarPill({ className = '' }: StatusBarPillProps) {
  const statusMessage = useSculptureStore((s) => s.statusMessage);
  const errorMessage = useSculptureStore((s) => s.errorMessage);
  const clearError = useSculptureStore((s) => s.clearError);

  return (
    <div
      className={`fixed bottom-3 left-3 z-30 flex flex-col gap-1.5 max-w-md ${className}`}
    >
      {errorMessage && (
        <div
          role="alert"
          className="hud-surface rounded-lg px-3 py-2 border-red-500/50 bg-red-950/90 text-xs text-red-200 flex items-center justify-between gap-2 shadow-lg hud-text-selectable"
        >
          <span className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Cerrar error"
            className="p-0.5 rounded hover:bg-white/10 text-red-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="hud-surface rounded-full px-3 py-1.5 text-xs text-[#A1A1AA] flex items-center gap-1.5 shadow hud-text-selectable">
        <Info className="w-3.5 h-3.5 text-[#0A84FF] shrink-0" />
        <span className="truncate">{statusMessage}</span>
      </div>
    </div>
  );
}
