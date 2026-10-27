import { JOINTS, TECHNIQUES } from '../../../core/build/registry';
import type { JointId, TechniqueId } from '../../../core/build/types';
import { PARAM_BOUNDS } from '../../../core/params';
import { useSculptureStore } from '../../../store/useSculptureStore';
import type { Axis } from '../../../types/sculpture';
import type { WaffleDistributionMethod } from '../../../core/waffle/types';
import { JOINT_UI } from '../../joints/registry';
import { NumericInput } from '../../ui/NumericInput';
import { SelectField } from '../../ui/SelectField';

const AXES: Axis[] = ['z', 'x', 'y'];

const DISTRIBUTION_METHOD_OPTIONS: Array<{ value: WaffleDistributionMethod; label: string }> = [
  { value: 'count', label: 'Por cantidad' },
  { value: 'distance', label: 'Por distancia' },
];

export function TechniqueSection() {
  const build = useSculptureStore((s) => s.build);
  const params = useSculptureStore((s) => s.params);
  const waffleParams = useSculptureStore((s) => s.waffleParams);
  const waffleResult = useSculptureStore((s) => s.waffleResult);
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

  const distributionMethod: WaffleDistributionMethod = waffleParams.distributionMethod || 'count';
  const count1 = waffleParams.count1 ?? 8;
  const count2 = waffleParams.count2 ?? 8;
  const distance1 = waffleParams.distance1 ?? waffleParams.pitch ?? 12.0;
  const distance2 = waffleParams.distance2 ?? waffleParams.pitch ?? 12.0;
  const notchFactor = waffleParams.notchFactor ?? 0.1;
  const notchAngle = waffleParams.notchAngle ?? 45.0;

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
          <div className="flex items-center justify-between pt-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
              Distribución de cortes
            </h3>
          </div>

          <SelectField<WaffleDistributionMethod>
            label="Método"
            value={distributionMethod}
            options={DISTRIBUTION_METHOD_OPTIONS}
            onChange={(v) => setWaffleParam('distributionMethod', v)}
            testId="select-waffle-method"
          />

          {distributionMethod === 'count' ? (
            <>
              <NumericInput
                label={
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-[#3B82F6] shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <polygon points="3,2 14,8 3,14" />
                    </svg>
                    <span>1.er eje</span>
                  </span>
                }
                value={count1}
                min={1}
                max={200}
                step={1}
                testId="input-waffle-axis1"
                onChange={(v) => setWaffleParam('count1', v)}
              />

              <NumericInput
                label={
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <polygon points="3,2 14,8 3,14" />
                    </svg>
                    <span>2.º eje</span>
                  </span>
                }
                value={count2}
                min={1}
                max={200}
                step={1}
                testId="input-waffle-axis2"
                onChange={(v) => setWaffleParam('count2', v)}
              />
            </>
          ) : (
            <>
              <NumericInput
                label={
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-[#3B82F6] shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <polygon points="3,2 14,8 3,14" />
                    </svg>
                    <span>1.er eje</span>
                  </span>
                }
                value={distance1}
                min={minWafflePitch}
                max={1000}
                step={0.5}
                unit="mm"
                testId="input-waffle-axis1"
                onChange={(v) => {
                  setWaffleParam('distance1', v);
                  setWaffleParam('pitch', v);
                }}
              />

              <NumericInput
                label={
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <polygon points="3,2 14,8 3,14" />
                    </svg>
                    <span>2.º eje</span>
                  </span>
                }
                value={distance2}
                min={minWafflePitch}
                max={1000}
                step={0.5}
                unit="mm"
                testId="input-waffle-axis2"
                onChange={(v) => setWaffleParam('distance2', v)}
              />
            </>
          )}

          <NumericInput
            label="Factor de muesca"
            value={notchFactor}
            min={0}
            max={1}
            step={0.05}
            testId="input-waffle-notch-factor"
            onChange={(v) => setWaffleParam('notchFactor', v)}
          />

          <NumericInput
            label="Ángulo de muesca"
            value={notchAngle}
            min={0}
            max={85}
            step={5}
            unit="°"
            testId="input-waffle-notch-angle"
            onChange={(v) => setWaffleParam('notchAngle', v)}
          />

          {waffleResult && (
            <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-[#A1A1AA] font-mono-tabular">
              <span>
                Rejilla: {waffleResult.p1Sections.length} × {waffleResult.p2Sections.length} piezas (
                {waffleResult.p1Sections.length + waffleResult.p2Sections.length} total)
              </span>
            </div>
          )}

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
                min={Number((-Math.max(distance1, 10) / 2).toFixed(2))}
                max={Number((Math.max(distance1, 10) / 2).toFixed(2))}
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
