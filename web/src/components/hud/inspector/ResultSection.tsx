import { AlertTriangle, FileOutput, Loader2 } from 'lucide-react';
import { useSculptureStore } from '../../../store/useSculptureStore';

export function ResultSection() {
  const build = useSculptureStore((s) => s.build);
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const isSlicing = useSculptureStore((s) => s.isSlicing);
  const discs = useSculptureStore((s) => s.discs);
  const openSheetPreviewModal = useSculptureStore(
    (s) => s.openSheetPreviewModal
  );

  const validPlatesCount = sliceResult
    ? sliceResult.plates.filter((p) => p.length > 0).length
    : 0;

  const scaledDims = sliceResult
    ? {
        w: (
          sliceResult.scaledBounds[1][0] - sliceResult.scaledBounds[0][0]
        ).toFixed(1),
        d: (
          sliceResult.scaledBounds[1][1] - sliceResult.scaledBounds[0][1]
        ).toFixed(1),
        h: sliceResult.scaledHeight.toFixed(1),
      }
    : null;

  return (
    <section className="border-t border-white/[0.08] pt-2.5 flex flex-col gap-2 hud-text-selectable">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
        Resultado
      </h2>

      {isSlicing ? (
        <div className="flex items-center gap-2 p-2.5 rounded-md bg-[#1C1C21] border border-white/[0.08] text-xs text-[#A1A1AA]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A84FF]" />
          <span>Rebanando modelo...</span>
        </div>
      ) : sliceResult ? (
        <div className="flex flex-col gap-1 text-xs font-mono-tabular text-[#F4F4F5] bg-[#1C1C21] p-2.5 rounded-md border border-white/[0.08]">
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Placas válidas:</span>
            <span>
              {validPlatesCount} / {sliceResult.plates.length}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Escala auto:</span>
            <span>{sliceResult.scaleFactor.toFixed(3)}x</span>
          </div>
          {scaledDims && (
            <div className="flex justify-between">
              <span className="text-[#A1A1AA]">Dimensiones:</span>
              <span>
                {scaledDims.w} × {scaledDims.d} × {scaledDims.h} mm
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Altura ensamblada:</span>
            <span>{sliceResult.scaledHeight.toFixed(1)} mm</span>
          </div>
          {build.jointId === 'discs' && (
            <div
              className="flex justify-between"
              data-testid="stat-discs-total"
            >
              <span className="text-[#A1A1AA]">Discos totales:</span>
              <span data-testid="total-discs-count">{discs.length}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-[#9CA3AF]">
          Sin corte activo. Carga un modelo 3D para comenzar.
        </p>
      )}

      {(meshMetadata?.warnings.length || sliceResult?.warnings.length) ? (
        <div className="flex flex-col gap-1 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
          {meshMetadata?.warnings.map((w, idx) => (
            <div key={`mw-${idx}`} className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
          {sliceResult?.warnings.map((w) => (
            <div
              key={`sw-${w.floorIndex}`}
              className="flex items-start gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        disabled={!sliceResult || isSlicing}
        onClick={openSheetPreviewModal}
        className="mt-1 w-full h-9 coarse:min-h-10 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow select-none"
      >
        <FileOutput className="w-3.5 h-3.5" />
        <span>Vista previa y exportar</span>
      </button>
    </section>
  );
}
