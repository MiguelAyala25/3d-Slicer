import { JOINTS, TECHNIQUES } from '../../../core/build/registry';
import type { JointId, TechniqueId } from '../../../core/build/types';
import { PARAM_BOUNDS } from '../../../core/params';
import { useSculptureStore } from '../../../store/useSculptureStore';
import type { Axis } from '../../../types/sculpture';
import { JOINT_UI } from '../../joints/registry';
import { NumericInput } from '../../ui/NumericInput';
import { SelectField } from '../../ui/SelectField';

const AXES: Axis[] = ['z', 'x', 'y'];

export function TechniqueSection() {
  const build = useSculptureStore((s) => s.build);
  const params = useSculptureStore((s) => s.params);
  const waffleParams = useSculptureStore((s) => s.waffleParams);
  const setTechnique = useSculptureStore((s) => s.setTechnique);
  const setJoint = useSculptureStore((s) => s.setJoint);
  const setParam = useSculptureStore((s) => s.setParam);
  const setWaffleParam = useSculptureStore((s) => s.setWaffleParam);

  const techniqueOptions = TECHNIQUES.map((t) => ({
    value: t.id,
    label: t.label,
    disabled: !t.available,
    disabledReason: t.unavailableReason,
  }));

  const jointOptions = JOINTS.map((j) => ({
    value: j.id,
    label: j.label,
    disabled: !j.available,
    disabledReason: j.unavailableReason,
  }));

  const handleTechniqueChange = (newTechniqueId: TechniqueId | '') => {
    if (!newTechniqueId) return;
    const res = setTechnique(newTechniqueId);
    if (res.needsConfirmation) {
      const ok = window.confirm(
        `Cambiar la técnica a Waffle eliminará los ${res.discCount} discos colocados. Esta acción no se puede deshacer. ¿Deseas continuar?`
      );
      if (ok) {
        setTechnique(newTechniqueId, { confirmed: true });
      }
    }
  };

  const handleJointChange = (newJointId: JointId | '') => {
    if (!newJointId) return;
    const res = setJoint(newJointId);
    if (res.needsConfirmation) {
      const ok = window.confirm(
        `Cambiar la unión eliminará los ${res.discCount} discos colocados. Esta acción no se puede deshacer. ¿Deseas continuar?`
      );
      if (ok) {
        setJoint(newJointId, { confirmed: true });
      }
    }
  };

  const JointOptions = build.jointId ? JOINT_UI[build.jointId]?.Options : undefined;

  const minWafflePitch = Math.max(
    2 * params.thickness,
    Number((params.thickness + waffleParams.slotClearance - params.kerf + 0.5).toFixed(2))
  );

  return (
    <section data-testid="section-technique" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
          Técnica de construcción
        </h2>
      </div>

      <SelectField<TechniqueId | ''>
        label="Técnica"
        value={build.techniqueId}
        options={techniqueOptions}
        placeholder="Selecciona una técnica..."
        onChange={(v) => handleTechniqueChange(v)}
        testId="select-technique"
      />

      {build.techniqueId === 'waffle' && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#A1A1AA] select-none">
              Eje vertical
            </span>
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-md bg-[#1C1C21] border border-white/[0.08]">
              {AXES.map((ax) => (
                <button
                  key={ax}
                  type="button"
                  data-testid={`waffle-up-axis-${ax}`}
                  onClick={() => setWaffleParam('upAxis', ax)}
                  className={`h-7 rounded text-xs font-semibold uppercase transition-colors select-none ${
                    waffleParams.upAxis === ax
                      ? 'bg-[#0A84FF] text-white'
                      : 'text-[#A1A1AA] hover:text-white'
                  }`}
                >
                  Eje {ax.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <NumericInput
            label="Separación entre secciones"
            value={waffleParams.pitch}
            min={minWafflePitch}
            max={1000}
            step={0.5}
            unit="mm"
            testId="input-waffle-pitch"
            onChange={(v) => setWaffleParam('pitch', v)}
          />

          <NumericInput
            label="Holgura de ranura"
            value={waffleParams.slotClearance}
            min={0}
            max={1}
            step={0.05}
            unit="mm"
            testId="input-waffle-clearance"
            onChange={(v) => setWaffleParam('slotClearance', v)}
          />

          <details className="group border border-white/[0.08] rounded-md bg-[#1C1C21] text-xs">
            <summary className="p-2 cursor-pointer font-medium text-[#A1A1AA] hover:text-[#F4F4F5] flex items-center justify-between select-none">
              <span>Avanzado</span>
              <span className="text-[10px] text-[#71717A] font-normal">
                Desfase {waffleParams.gridOffset.toFixed(1)} mm · Etiquetas {waffleParams.slotLabelsEnabled ? 'Sí' : 'No'}
              </span>
            </summary>
            <div className="p-2 pt-2 flex flex-col gap-2.5 border-t border-white/[0.04]">
              <NumericInput
                label="Desfase de rejilla"
                value={waffleParams.gridOffset}
                min={Number((-waffleParams.pitch / 2).toFixed(2))}
                max={Number((waffleParams.pitch / 2).toFixed(2))}
                step={0.5}
                unit="mm"
                testId="input-waffle-offset"
                onChange={(v) => setWaffleParam('gridOffset', v)}
              />

              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#F4F4F5] select-none pt-0.5">
                <input
                  type="checkbox"
                  data-testid="checkbox-waffle-slot-labels"
                  checked={waffleParams.slotLabelsEnabled}
                  onChange={(e) => setWaffleParam('slotLabelsEnabled', e.target.checked)}
                  className="rounded accent-[#0A84FF] w-4 h-4 cursor-pointer"
                />
                <span>Grabar etiquetas en ranuras</span>
              </label>
            </div>
          </details>

          <SelectField<JointId | ''>
            label="Unión"
            value="slots"
            disabled={true}
            options={[{ value: 'slots', label: 'Encaje por ranuras' }]}
            testId="select-joint"
            onChange={() => {}}
          />
          <p className="text-xs text-[#9CA3AF] pl-1">
            Las piezas se encajan directamente por ranuras verticales (sin uniones adicionales).
          </p>
        </>
      )}

      {build.techniqueId === 'stacked' && (
        <>
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

          <NumericInput
            label="Número de placas"
            value={params.plates}
            min={PARAM_BOUNDS.plates.min}
            max={PARAM_BOUNDS.plates.max}
            step={PARAM_BOUNDS.plates.step}
            onChange={(v) => setParam('plates', v)}
          />

          <SelectField<JointId | ''>
            label="Unión"
            value={build.jointId}
            options={jointOptions}
            placeholder="Selecciona una unión..."
            onChange={(v) => handleJointChange(v)}
            testId="select-joint"
          />

          {build.jointId === 'none' && (
            <p className="text-xs text-[#9CA3AF] pl-1">
              Las placas se apilan pegadas (separación 0 mm).
            </p>
          )}

          {build.jointId === 'discs' && JointOptions && <JointOptions />}
        </>
      )}
    </section>
  );
}
