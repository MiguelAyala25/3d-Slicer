import { AlertCircle, Info, Loader2, X } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface StatusBarPillProps {
  className?: string;
}

export function StatusBarPill({ className = '' }: StatusBarPillProps) {
  const statusMessage = useSculptureStore((s) => s.statusMessage);
  const errorMessage = useSculptureStore((s) => s.errorMessage);
  const isLoadingMesh = useSculptureStore((s) => s.isLoadingMesh);
  const isSlicing = useSculptureStore((s) => s.isSlicing);
  const clearError = useSculptureStore((s) => s.clearError);
  const meshGeometry = useSculptureStore((s) => s.meshGeometry);

  const isBusy = isLoadingMesh || isSlicing;

  // Si no hay malla cargada, ni error, ni proceso activo, no mostramos el mensaje redundante
  if (!meshGeometry && !errorMessage && !isBusy) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-3 left-3 z-30 flex flex-col gap-1.5 max-w-md ${className}`}
    >
      {errorMessage && (
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
      )}

      {statusMessage && (
        <div className="bg-[#1b1b1d]/95 backdrop-blur-xl border border-white/[0.08] rounded-full px-3 py-1.5 text-xs text-[#8b919e] flex items-center gap-2 shadow-2xl select-none">
          {isBusy ? (
            <Loader2 className="w-3.5 h-3.5 text-[#2997ff] animate-spin shrink-0" />
          ) : (
            <Info className="w-3.5 h-3.5 text-[#2997ff] shrink-0" />
          )}
          <span className="truncate font-mono-tabular text-[#cccccc]">
            {statusMessage}
          </span>
        </div>
      )}
    </div>
  );
}
