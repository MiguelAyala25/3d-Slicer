import { AlertCircle, X } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface StatusBarPillProps {
  className?: string;
}

export function StatusBarPill({ className = '' }: StatusBarPillProps) {
  const errorMessage = useSculptureStore((s) => s.errorMessage);
  const clearError = useSculptureStore((s) => s.clearError);

  // Eliminados los mensajes informativos flotantes (statusMessage) por solicitud de UX.
  // Solo se muestran errores críticos para no interrumpir el flujo.
  if (!errorMessage) {
    return null;
  }

  return (
    <div
      className={`absolute bottom-3 left-3 z-30 flex flex-col gap-1.5 max-w-md select-none ${className}`}
    >
      <div
        role="alert"
        className="bg-red-950/90 backdrop-blur-xl border border-red-500/40 rounded-2xl px-3.5 py-2 text-xs text-red-200 flex items-center justify-between gap-2 shadow-2xl"
      >
        <span className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="font-mono-tabular">{errorMessage}</span>
        </span>
        <button
          type="button"
          onClick={clearError}
          aria-label="Cerrar error"
          className="p-1 rounded-lg hover:bg-white/10 text-red-300 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
