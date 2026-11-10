import { Eye, EyeOff, Grid3X3 } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface ViewTogglesProps {
  className?: string;
}

export function ViewToggles({ className = '' }: ViewTogglesProps) {
  const meshGeometry = useSculptureStore((s) => s.meshGeometry);
  const viewMode = useSculptureStore((s) => s.viewMode);
  const wireframe = useSculptureStore((s) => s.wireframe);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const waffleResult = useSculptureStore((s) => s.waffleResult);
  const setViewMode = useSculptureStore((s) => s.setViewMode);
  const toggleWireframe = useSculptureStore((s) => s.toggleWireframe);

  // Si no hay malla cargada, no mostramos los toggles de vista
  if (!meshGeometry) return null;

  const hasResult = Boolean(sliceResult || waffleResult);
  const showingOriginal = viewMode === 'original';

  return (
    <div
      aria-label="Controles de vista 3D"
      className={`fixed top-3 inset-x-0 z-30 pointer-events-none flex justify-center min-[1100px]:pr-[342px] transition-all ${className}`}
    >
      <div className="pointer-events-auto bg-[#1b1b1d]/95 backdrop-blur-xl border border-white/[0.08] rounded-xl p-1 flex items-center gap-1 shadow-2xl">
        {/* Botón de alternar placas / modelo original (sólo visible si hay resultado de corte) */}
        {hasResult && (
          <button
            type="button"
            onClick={() => setViewMode(showingOriginal ? 'plates' : 'original')}
            title={
              showingOriginal
                ? 'Ver placas rebanadas (Atajo: V)'
                : 'Ver modelo 3D original (Atajo: V)'
            }
            aria-label={
              showingOriginal
                ? 'Ver placas rebanadas'
                : 'Ver modelo original'
            }
            className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              !showingOriginal
                ? 'bg-[#0071e3]/20 border border-[#0071e3]/50 text-[#2997ff]'
                : 'text-[#8b919e] hover:text-white hover:bg-white/10'
            }`}
          >
            {showingOriginal ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Botón de alternar malla de alambre (Wireframe) */}
        <button
          type="button"
          onClick={toggleWireframe}
          title="Alternar malla de alambre (Atajo: M)"
          aria-pressed={wireframe}
          aria-label="Malla de alambre"
          className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
            wireframe
              ? 'bg-[#0071e3]/20 border border-[#0071e3]/50 text-[#2997ff]'
              : 'text-[#8b919e] hover:text-white hover:bg-white/10'
          }`}
        >
          <Grid3X3 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
