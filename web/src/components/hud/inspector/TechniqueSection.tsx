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
  const setTechnique = useSculptureStore((s) => s.setTechnique);
  const setJoint = useSculptureStore((s) => s.setJoint);
  const setParam = useSculptureStore((s) => s.setParam);

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
        onChange={(v) => {
          if (v) setTechnique(v);
        }}
        testId="select-technique"
      />

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
