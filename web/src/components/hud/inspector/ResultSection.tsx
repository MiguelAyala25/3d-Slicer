import { useMemo } from 'react';
import { AlertTriangle, FileOutput, Loader2, Sliders } from 'lucide-react';
import { useSculptureStore } from '../../../store/useSculptureStore';
import { getWaffleAxesConfig } from '../../../core/waffle/canonicalFrame';
import { generateWaffleSheetLayouts } from '../../../core/layout';
import { getDiscardedChainsSummary } from '../../../core/slicer';
import { WaffleWarningsPanel } from './WaffleWarningsPanel';

export function ResultSection() {
  const build = useSculptureStore((s) => s.build);
  const params = useSculptureStore((s) => s.params);
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const waffleResult = useSculptureStore((s) => s.waffleResult);
  const waffleParams = useSculptureStore((s) => s.waffleParams);
  const isSlicing = useSculptureStore((s) => s.isSlicing);
  const discs = useSculptureStore((s) => s.discs);
  const openSheetPreviewModal = useSculptureStore(
    (s) => s.openSheetPreviewModal
  );
  const openCalibrationSheetPreview = useSculptureStore(
    (s) => s.openCalibrationSheetPreview
  );

  const isWaffle = build.techniqueId === 'waffle';
  const axesConfig = isWaffle ? getWaffleAxesConfig(waffleParams.upAxis) : null;

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

  const waffleSheetCount = useMemo(() => {
    if (!waffleResult) return null;
    try {
      const sheets = generateWaffleSheetLayouts(waffleResult, params);
      return sheets.length;
    } catch {
      return 'Excede hoja';
    }
  }, [waffleResult, params]);

  const waffle3dDims = useMemo(() => {
    if (!waffleResult) return null;
    const { min, max } = waffleResult.scaledBounds3D;
    return {
      dx: (max[0] - min[0]).toFixed(1),
      dy: (max[1] - min[1]).toFixed(1),
      dz: (max[2] - min[2]).toFixed(1),
    };
  }, [waffleResult]);

  const discardedSummary = useMemo(() => {
    if (isWaffle) return { totalDiscarded: 0, affectedFloors: [] };
    return getDiscardedChainsSummary(sliceResult);
  }, [isWaffle, sliceResult]);

  const hasResult = isWaffle ? Boolean(waffleResult) : Boolean(sliceResult);

  return (
    <section className="bg-white/[0.02] p-2.5 rounded-2xl border border-white/[0.05] flex flex-col gap-2.5 hud-text-selectable">
      <h2 className="text-[13px] font-semibold text-[#cccccc] select-none">
        Resultado
      </h2>

      {isSlicing ? (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#131315] border border-white/[0.06] text-xs text-[#cccccc]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2997ff]" />
          <span>Calculando corte...</span>
        </div>
      ) : isWaffle && waffleResult ? (
        <div className="flex flex-col gap-1.5 text-xs font-mono-tabular text-white bg-[#131315] p-3 rounded-xl border border-white/[0.06]">
          <div className="flex justify-between">
            <span className="text-[#8b919e]">Secciones familia {axesConfig?.p1Prefix}:</span>
            <span>{waffleResult.p1Sections.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b919e]">Secciones familia {axesConfig?.p2Prefix}:</span>
            <span>{waffleResult.p2Sections.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b919e]">Total de piezas:</span>
            <span data-testid="waffle-total-pieces" className="font-semibold">
              {waffleResult.p1Sections.length + waffleResult.p2Sections.length}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b919e]">Cruces activos:</span>
            <span>{waffleResult.crossings.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b919e]">Ancho ranura (w):</span>
            <span>{waffleResult.drawnSlotWidth.toFixed(2)} mm</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b919e]">Escala uniforme:</span>
            <span>{waffleParams.targetScale.toFixed(3)}x</span>
          </div>
          {waffle3dDims && (
            <div className="flex justify-between">
              <span className="text-[#8b919e]">Dimensiones 3D:</span>
              <span>
                {waffle3dDims.dx} × {waffle3dDims.dy} × {waffle3dDims.dz} mm
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-white/[0.05] pt-1.5">
            <span className="text-[#8b919e]">Número de hojas:</span>
            <span
              data-testid="waffle-sheet-count"
              className={waffleSheetCount === 'Excede hoja' ? 'text-amber-400 font-semibold' : 'font-semibold'}
            >
              {waffleSheetCount ?? '—'}
            </span>
          </div>
        </div>
      ) : !isWaffle && sliceResult ? (
        <div className="flex flex-col gap-1.5 text-xs font-mono-tabular text-white bg-[#131315] p-3 rounded-xl border border-white/[0.06]">
          <div className="flex justify-between">
            <span className="text-[#8b919e]">Placas válidas:</span>
            <span className="font-semibold">
              {validPlatesCount} / {sliceResult.plates.length}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b919e]">Escala auto:</span>
            <span>{sliceResult.scaleFactor.toFixed(3)}x</span>
          </div>
          {scaledDims && (
            <div className="flex justify-between">
              <span className="text-[#8b919e]">Dimensiones:</span>
              <span>
                {scaledDims.w} × {scaledDims.d} × {scaledDims.h} mm
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#8b919e]">Altura ensamblada:</span>
            <span className="text-[#2997ff] font-semibold">
              {sliceResult.scaledHeight.toFixed(1)} mm
            </span>
          </div>
          {build.jointId === 'discs' && (
            <div
              className="flex justify-between border-t border-white/[0.05] pt-1.5"
              data-testid="stat-discs-total"
            >
              <span className="text-[#8b919e]">Discos totales:</span>
              <span data-testid="total-discs-count" className="font-semibold">
                {discs.length}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-[#8b919e]">
          Sin corte activo. Carga un modelo 3D para comenzar.
        </p>
      )}

      {/* Warnings */}
      {isWaffle ? (
        <WaffleWarningsPanel />
      ) : (
        (meshMetadata?.warnings.length || sliceResult?.warnings.length) ? (
          <div className="flex flex-col gap-1 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
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
        ) : null
      )}

      {isWaffle && (
        <button
          type="button"
          data-testid="btn-slot-calibration-sheet"
          onClick={openCalibrationSheetPreview}
          className="w-full bg-[#252527] text-[#2997ff] border border-[#2997ff]/40 hover:bg-[#2997ff]/10 rounded-2xl py-2.5 text-[12px] font-medium transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-sm select-none cursor-pointer"
        >
          <Sliders className="w-3.5 h-3.5 text-[#2997ff]" />
          <span>Hoja de prueba de ranuras</span>
        </button>
      )}

      {!isWaffle && discardedSummary.totalDiscarded > 0 && (
        <div
          data-testid="discarded-chains-notice"
          className="flex items-center gap-1.5 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-[11px] text-amber-200"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>
            {discardedSummary.totalDiscarded} cadena(s) abierta(s) descartada(s). Se requerirá confirmación para exportar.
          </span>
        </div>
      )}

      <button
        type="button"
        disabled={!hasResult || isSlicing}
        onClick={openSheetPreviewModal}
        className="mt-1 w-full bg-[#0066cc] hover:bg-[#0052a3] disabled:opacity-40 text-white rounded-2xl py-2.5 text-[13px] font-semibold transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-md select-none cursor-pointer disabled:cursor-not-allowed"
      >
        <FileOutput className="w-4 h-4" />
        <span>Vista previa y exportar</span>
      </button>
    </section>
  );
}
