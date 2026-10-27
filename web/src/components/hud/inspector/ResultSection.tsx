import { useMemo } from 'react';
import { AlertTriangle, FileOutput, Loader2, Sliders } from 'lucide-react';
import { useSculptureStore } from '../../../store/useSculptureStore';
import { getWaffleAxesConfig } from '../../../core/waffle/canonicalFrame';
import { generateWaffleSheetLayouts } from '../../../core/layout';
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

  const hasResult = isWaffle ? Boolean(waffleResult) : Boolean(sliceResult);

  return (
    <section className="border-t border-white/[0.08] pt-2.5 flex flex-col gap-2 hud-text-selectable">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
        Resultado
      </h2>

      {isSlicing ? (
        <div className="flex items-center gap-2 p-2.5 rounded-md bg-[#1C1C21] border border-white/[0.08] text-xs text-[#A1A1AA]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A84FF]" />
          <span>{isWaffle ? 'Rebanando Waffle...' : 'Rebanando modelo...'}</span>
        </div>
      ) : isWaffle && waffleResult ? (
        <div className="flex flex-col gap-1 text-xs font-mono-tabular text-[#F4F4F5] bg-[#1C1C21] p-2.5 rounded-md border border-white/[0.08]">
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Secciones familia {axesConfig?.p1Prefix}:</span>
            <span>{waffleResult.p1Sections.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Secciones familia {axesConfig?.p2Prefix}:</span>
            <span>{waffleResult.p2Sections.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Total de piezas:</span>
            <span data-testid="waffle-total-pieces">
              {waffleResult.p1Sections.length + waffleResult.p2Sections.length}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Cruces activos:</span>
            <span>{waffleResult.crossings.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Ancho ranura (w):</span>
            <span>{waffleResult.drawnSlotWidth.toFixed(2)} mm</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Escala uniforme:</span>
            <span>{waffleParams.targetScale.toFixed(3)}x</span>
          </div>
          {waffle3dDims && (
            <div className="flex justify-between">
              <span className="text-[#A1A1AA]">Dimensiones 3D:</span>
              <span>
                {waffle3dDims.dx} × {waffle3dDims.dy} × {waffle3dDims.dz} mm
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[#A1A1AA]">Número de hojas:</span>
            <span
              data-testid="waffle-sheet-count"
              className={waffleSheetCount === 'Excede hoja' ? 'text-amber-400 font-semibold' : ''}
            >
              {waffleSheetCount ?? '—'}
            </span>
          </div>
        </div>
      ) : !isWaffle && sliceResult ? (
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

      {/* Warnings */}
      {isWaffle ? (
        <WaffleWarningsPanel />
      ) : (
        (meshMetadata?.warnings.length || sliceResult?.warnings.length) ? (
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
        ) : null
      )}

      {isWaffle && (
        <button
          type="button"
          data-testid="btn-calibration-sheet"
          onClick={openCalibrationSheetPreview}
          className="w-full h-8 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center justify-center gap-1.5 border border-white/[0.08] select-none"
        >
          <Sliders className="w-3.5 h-3.5 text-[#0A84FF]" />
          <span>Hoja de prueba de ranuras</span>
        </button>
      )}

      <button
        type="button"
        disabled={!hasResult || isSlicing}
        onClick={openSheetPreviewModal}
        className="mt-1 w-full h-9 coarse:min-h-10 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow select-none"
      >
        <FileOutput className="w-3.5 h-3.5" />
        <span>Vista previa y exportar</span>
      </button>
    </section>
  );
}
