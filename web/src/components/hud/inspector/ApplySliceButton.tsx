import { Loader2, Play } from 'lucide-react';
import { useSculptureStore } from '../../../store/useSculptureStore';

export function ApplySliceButton() {
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
  const isSlicing = useSculptureStore((s) => s.isSlicing);
  const isResultDirty = useSculptureStore((s) => s.isResultDirty);
  const runSlice = useSculptureStore((s) => s.runSlice);

  return (
    <button
      type="button"
      disabled={!meshMetadata || isSlicing}
      onClick={() => void runSlice()}
      className="w-full h-9 coarse:min-h-10 rounded-md bg-[#0A84FF] hover:bg-[#0070E0] disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow select-none"
    >
      {isSlicing ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Rebanando...</span>
        </>
      ) : (
        <>
          <Play className="w-3.5 h-3.5" />
          <span>{isResultDirty ? 'Rebanar (actualizar)' : 'Aplicar corte'}</span>
        </>
      )}
    </button>
  );
}
