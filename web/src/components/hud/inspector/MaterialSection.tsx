import { useState } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { PARAM_BOUNDS } from '../../../core/params';
import { useSculptureStore } from '../../../store/useSculptureStore';
import { Collapsible } from '../../ui/Collapsible';
import { NumericInput } from '../../ui/NumericInput';

export function MaterialSection() {
  const [isOpen, setIsOpen] = useState(false);
  const params = useSculptureStore((s) => s.params);
  const setParam = useSculptureStore((s) => s.setParam);

  return (
    <section data-testid="section-material" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        data-testid="toggle-material-collapse"
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[#18181B] hover:bg-[#202025] border transition-all cursor-pointer group ${
          isOpen
            ? 'border-white/20 bg-[#1C1C21] shadow-sm'
            : 'border-white/10 hover:border-white/20'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#0A84FF] shrink-0 transition-transform" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#A1A1AA] group-hover:text-white shrink-0 transition-transform" />
          )}
          <Layers className="w-3.5 h-3.5 text-[#0A84FF] shrink-0" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F4F4F5]">
            Material
          </h2>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] text-[11px] font-mono-tabular text-[#A1A1AA] group-hover:text-[#F4F4F5] group-hover:border-white/15 transition-colors shrink-0">
          <span>{params.thickness} mm</span>
          <span className="text-white/20">·</span>
          <span>{params.sheetW}×{params.sheetH}</span>
        </div>
      </button>

      {isOpen && (
        <div className="p-3 rounded-lg bg-[#141417]/80 border border-white/[0.08] flex flex-col gap-2.5">
          <NumericInput
            label="Grosor de placa"
            value={params.thickness}
            min={PARAM_BOUNDS.thickness.min}
            max={PARAM_BOUNDS.thickness.max}
            step={PARAM_BOUNDS.thickness.step}
            unit="mm"
            onChange={(v) => setParam('thickness', v)}
          />

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

          <label className="flex items-center justify-between gap-2 text-xs text-[#A1A1AA] cursor-pointer select-none">
            <span>Etiquetar sobrante aprovechable</span>
            <input
              type="checkbox"
              checked={params.scrapTagEnabled}
              onChange={(e) => setParam('scrapTagEnabled', e.target.checked)}
              className="rounded accent-[#0A84FF] w-4 h-4 cursor-pointer"
            />
          </label>

          <Collapsible title="Avanzado" defaultOpen={false}>
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
        </div>
      )}
    </section>
  );
}
