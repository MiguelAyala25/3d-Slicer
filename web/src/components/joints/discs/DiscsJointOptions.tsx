import { Layers } from 'lucide-react';
import { PARAM_BOUNDS } from '../../../core/params';
import { getDiscSheetNotice } from '../../../core/joints/discs/discParams';
import { useSculptureStore } from '../../../store/useSculptureStore';
import { NumericInput } from '../../ui/NumericInput';

export function DiscsJointOptions() {
  const params = useSculptureStore((s) => s.params);
  const setParam = useSculptureStore((s) => s.setParam);

  return (
    <div className="flex flex-col gap-2.5 border-l border-white/[0.08] pl-2.5 mt-1">
      <NumericInput
        label="Separación (grosor del disco)"
        value={params.gap}
        min={PARAM_BOUNDS.gap.min}
        max={PARAM_BOUNDS.gap.max}
        step={PARAM_BOUNDS.gap.step}
        unit="mm"
        onChange={(v) => setParam('gap', v)}
      />

      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#1C1C21] border border-white/[0.08] text-[11px] text-[#A1A1AA]">
        <Layers className="w-3.5 h-3.5 text-[#0A84FF] shrink-0" />
        <span>{getDiscSheetNotice(params)}</span>
      </div>

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
    </div>
  );
}
