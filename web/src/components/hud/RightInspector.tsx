import { useState } from 'react';
import {
  AlertTriangle,
  FileOutput,
  Layers,
  Loader2,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { getDiscSheetNotice, PARAM_BOUNDS } from '../../core/params';
import { useSculptureStore } from '../../store/useSculptureStore';
import type { Axis } from '../../types/sculpture';
import { Collapsible } from '../ui/Collapsible';
import { NumericInput } from '../ui/NumericInput';

export interface RightInspectorProps {
  className?: string;
}

const AXES: Axis[] = ['z', 'x', 'y'];

export function RightInspector({ className = '' }: RightInspectorProps) {
  const [drawerOpen, setDrawerOpen] = useState(true);

  const params = useSculptureStore((s) => s.params);
  const isResultDirty = useSculptureStore((s) => s.isResultDirty);
  const isSlicing = useSculptureStore((s) => s.isSlicing);
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const discs = useSculptureStore((s) => s.discs);
  const setParam = useSculptureStore((s) => s.setParam);
  const runSlice = useSculptureStore((s) => s.runSlice);
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
    <>
      {/* Botón toggle para pantallas < 1100px (Corrección C4) */}
      <button
        type="button"
        onClick={() => setDrawerOpen((v) => !v)}
        className="hidden max-[1100px]:flex fixed top-3 right-3 z-40 hud-surface h-8 px-2.5 rounded-md items-center gap-1.5 text-xs font-medium text-[#F4F4F5]"
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-[#0A84FF]" />
        <span>Parámetros</span>
      </button>

      <aside
        aria-label="Inspector de parámetros y exportación"
        className={`fixed top-3 right-3 bottom-14 z-30 w-72 hud-surface rounded-xl p-3.5 flex flex-col gap-3 overflow-y-auto shadow-2xl transition-transform ${
          drawerOpen
            ? 'translate-x-0'
            : 'max-[1100px]:translate-x-[110%]'
        } ${className}`}
      >
        {/* 1. Sección Principal: Corte y Escala (params.py:13-16, ui.py:96-113) */}
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
              Corte y escala
            </h2>
            {isResultDirty && (
              <span className="text-[11px] font-medium text-amber-400">
                Desactualizado
              </span>
            )}
          </div>

          <NumericInput
            label="Número de placas"
            value={params.plates}
            min={PARAM_BOUNDS.plates.min}
            max={PARAM_BOUNDS.plates.max}
            step={PARAM_BOUNDS.plates.step}
            onChange={(v) => setParam('plates', v)}
          />

          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="Grosor de placa"
              value={params.thickness}
              min={PARAM_BOUNDS.thickness.min}
              max={PARAM_BOUNDS.thickness.max}
              step={PARAM_BOUNDS.thickness.step}
              unit="mm"
              onChange={(v) => setParam('thickness', v)}
            />
            <NumericInput
              label="Separación"
              value={params.gap}
              min={PARAM_BOUNDS.gap.min}
              max={PARAM_BOUNDS.gap.max}
              step={PARAM_BOUNDS.gap.step}
              unit="mm"
              onChange={(v) => setParam('gap', v)}
            />
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#1C1C21] border border-white/[0.08] text-[11px] text-[#A1A1AA]">
            <Layers className="w-3.5 h-3.5 text-[#0A84FF] shrink-0" />
            <span>{getDiscSheetNotice(params)}</span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#A1A1AA] select-none">
              Eje de corte
            </span>
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-md bg-[#1C1C21] border border-white/[0.08]">
              {AXES.map((ax) => (
                <button
                  key={ax}
                  type="button"
                  onClick={() => setParam('axis', ax)}
                  className={`h-7 rounded text-xs font-semibold uppercase transition-colors select-none ${
                    params.axis === ax
                      ? 'bg-[#0A84FF] text-white'
                      : 'text-[#A1A1AA] hover:text-white'
                  }`}
                >
                  Eje {ax.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

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
                <span>
                  {isResultDirty ? 'Rebanar (actualizar)' : 'Aplicar corte'}
                </span>
              </>
            )}
          </button>
        </section>

        {/* 2. Acordeón: Hoja de Corte (params.py:19-25, ui.py:124-149) */}
        <Collapsible
          title="Hoja de corte"
          summary={`${params.sheetW}×${params.sheetH} mm`}
        >
          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="Ancho de hoja"
              value={params.sheetW}
              min={PARAM_BOUNDS.sheetW.min}
              max={PARAM_BOUNDS.sheetW.max}
              step={PARAM_BOUNDS.sheetW.step}
              unit="mm"
              onChange={(v) => setParam('sheetW', v)}
            />
            <NumericInput
              label="Alto de hoja"
              value={params.sheetH}
              min={PARAM_BOUNDS.sheetH.min}
              max={PARAM_BOUNDS.sheetH.max}
              step={PARAM_BOUNDS.sheetH.step}
              unit="mm"
              onChange={(v) => setParam('sheetH', v)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="Margen"
              value={params.sheetMargin}
              min={PARAM_BOUNDS.sheetMargin.min}
              max={PARAM_BOUNDS.sheetMargin.max}
              step={PARAM_BOUNDS.sheetMargin.step}
              unit="mm"
              onChange={(v) => setParam('sheetMargin', v)}
            />
            <NumericInput
              label="Sep. piezas"
              value={params.partGap}
              min={PARAM_BOUNDS.partGap.min}
              max={PARAM_BOUNDS.partGap.max}
              step={PARAM_BOUNDS.partGap.step}
              unit="mm"
              onChange={(v) => setParam('partGap', v)}
            />
          </div>
          <NumericInput
            label="Compensación láser (Kerf)"
            value={params.kerf}
            min={PARAM_BOUNDS.kerf.min}
            max={PARAM_BOUNDS.kerf.max}
            step={PARAM_BOUNDS.kerf.step}
            unit="mm"
            onChange={(v) => setParam('kerf', v)}
          />
        </Collapsible>

        {/* 3. Acordeón: Discos y Rotulado (params.py:28-33, ui.py:155-169, Corrección #0 y #2) */}
        <Collapsible
          title="Discos y rotulado"
          summary={`Ø${params.discDiameter} mm`}
        >
          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="Diámetro por defecto"
              value={params.discDiameter}
              min={PARAM_BOUNDS.discDiameter.min}
              max={PARAM_BOUNDS.discDiameter.max}
              step={PARAM_BOUNDS.discDiameter.step}
              unit="mm"
              onChange={(v) => setParam('discDiameter', v)}
            />
            <NumericInput
              label="Holgura grabado"
              value={params.engraveClearance}
              min={PARAM_BOUNDS.engraveClearance.min}
              max={PARAM_BOUNDS.engraveClearance.max}
              step={PARAM_BOUNDS.engraveClearance.step}
              unit="mm"
              onChange={(v) => setParam('engraveClearance', v)}
            />
          </div>

          <label className="flex items-center justify-between gap-2 pt-1 text-xs text-[#A1A1AA] cursor-pointer select-none">
            <span>Etiquetar sobrante aprovechable</span>
            <input
              type="checkbox"
              checked={params.scrapTagEnabled}
              onChange={(e) => setParam('scrapTagEnabled', e.target.checked)}
              className="rounded accent-[#0A84FF] w-4 h-4"
            />
          </label>
        </Collapsible>

        {/* 4. Sección: Resultado, Métricas seleccionables y Exportación */}
        <section className="border-t border-white/[0.08] pt-2.5 flex flex-col gap-2 hud-text-selectable">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
            Resultado
          </h2>

          {sliceResult ? (
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
              <div
                className="flex justify-between"
                data-testid="stat-discs-total"
              >
                <span className="text-[#A1A1AA]">Discos totales:</span>
                <span data-testid="total-discs-count">{discs.length}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#9CA3AF]">
              Sin corte activo. Carga un modelo y pulsa «Aplicar corte».
            </p>
          )}

          {/* Advertencias de malla y corte */}
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
            disabled={!sliceResult}
            onClick={openSheetPreviewModal}
            className="mt-1 w-full h-9 coarse:min-h-10 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow select-none"
          >
            <FileOutput className="w-3.5 h-3.5" />
            <span>Vista previa y exportar</span>
          </button>
        </section>
      </aside>
    </>
  );
}
