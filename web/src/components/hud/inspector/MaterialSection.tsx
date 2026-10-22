import { PARAM_BOUNDS } from '../../../core/params';
import { useSculptureStore } from '../../../store/useSculptureStore';
import { Collapsible } from '../../ui/Collapsible';
import { NumericInput } from '../../ui/NumericInput';

export function MaterialSection() {
  const params = useSculptureStore((s) => s.params);
  const setParam = useSculptureStore((s) => s.setParam);

  const advancedSummary = `Margen ${params.sheetMargin} · Sep. ${params.partGap} · Kerf ${params.kerf} mm`;

  return (
    <section data-testid="section-material" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
          Material
        </h2>
      </div>

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

      <Collapsible title="Avanzado" summary={advancedSummary} defaultOpen={false}>
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
    </section>
  );
}
