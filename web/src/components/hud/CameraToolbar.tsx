import { Eye, EyeOff, Grid3X3 } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface CameraToolbarProps {
  className?: string;
}

export function CameraToolbar({ className = '' }: CameraToolbarProps) {
  const viewMode = useSculptureStore((s) => s.viewMode);
  const wireframe = useSculptureStore((s) => s.wireframe);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const setViewMode = useSculptureStore((s) => s.setViewMode);
  const toggleWireframe = useSculptureStore((s) => s.toggleWireframe);

  const showingOriginal = viewMode === 'original';

  return (
    <div
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-30 hud-surface rounded-lg px-2 py-1.5 flex items-center gap-1.5 shadow-lg max-[1100px]:top-16 max-[1100px]:left-3 max-[1100px]:translate-x-0 ${className}`}
    >
      <button
        type="button"
        disabled={!sliceResult}
        onClick={() => setViewMode(showingOriginal ? 'plates' : 'original')}
        title="Alternar entre modelo 3D original y placas rebanadas"
        className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40 text-xs font-medium text-[#F4F4F5] flex items-center gap-1.5 select-none"
      >
        {showingOriginal ? (
          <>
            <Eye className="w-3.5 h-3.5 text-[#A1A1AA]" />
            <span>Ver placas</span>
          </>
        ) : (
          <>
            <EyeOff className="w-3.5 h-3.5 text-[#A1A1AA]" />
            <span>Ver modelo original</span>
          </>
        )}
      </button>

      <button
        type="button"
        onClick={toggleWireframe}
        title="Alternar malla de alambre (Wireframe)"
        aria-pressed={wireframe}
        className={`h-8 coarse:min-h-10 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 select-none ${
          wireframe
            ? 'bg-white/15 text-white'
            : 'bg-white/5 text-[#A1A1AA] hover:text-white'
        }`}
      >
        <Grid3X3 className="w-3.5 h-3.5" />
        <span>Malla</span>
      </button>
    </div>
  );
}
