import { AlertTriangle, Layers, Lock, Ruler } from 'lucide-react';
import {
  DIMENSION_LABELS,
  finalSize,
  finalSizeFromScale,
  linkedDimension,
  maxFit,
  waffleMaxFit,
  type ModelDimension,
} from '../../../core/sizing';
import { useSculptureStore } from '../../../store/useSculptureStore';
import { NumericInput } from '../../ui/NumericInput';

const DIMENSIONS: ModelDimension[] = ['alto', 'ancho', 'largo'];

export function ModelSection() {
  const build = useSculptureStore((s) => s.build);
  const modelExtents = useSculptureStore((s) => s.modelExtents);
  const params = useSculptureStore((s) => s.params);
  const sizeIntent = useSculptureStore((s) => s.sizeIntent);
  const sizeCommitSeq = useSculptureStore((s) => s.sizeCommitSeq);
  const waffleParams = useSculptureStore((s) => s.waffleParams);
  const setPlatesFromDimension = useSculptureStore(
    (s) => s.setPlatesFromDimension
  );
  const setWaffleDimensionTarget = useSculptureStore(
    (s) => s.setWaffleDimensionTarget
  );

  const isWaffle = build.techniqueId === 'waffle';
  const linked = isWaffle ? null : linkedDimension(params.axis);

  const currentSize = modelExtents
    ? isWaffle
      ? finalSizeFromScale(modelExtents, waffleParams.targetScale)
      : finalSize(
          modelExtents,
          params.axis,
          params.plates,
          params.thickness,
          params.gap
        )
    : null;

  const stackedFit = modelExtents && !isWaffle
    ? maxFit(modelExtents, params.axis, params.thickness, params.gap, params)
    : null;

  const waffleFit = modelExtents && isWaffle
    ? waffleMaxFit(modelExtents, waffleParams.upAxis, params)
    : null;

  return (
    <section data-testid="section-model" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
          Modelo
        </h2>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[#A1A1AA] select-none">
          <Ruler className="w-3.5 h-3.5 text-[#0A84FF]" />
          <span>Tamaño</span>
        </div>
        <button
          type="button"
          disabled
          aria-pressed="true"
          title="Escala no uniforme: no disponible"
          className="p-1 rounded text-[#9CA3AF] opacity-50 cursor-not-allowed"
        >
          <Lock className="w-3.5 h-3.5" />
        </button>
      </div>

      {!modelExtents ? (
        <div className="flex flex-col gap-2">
          {DIMENSIONS.map((dim) => (
            <NumericInput
              key={dim}
              label={DIMENSION_LABELS[dim]}
              value={0}
              min={0.1}
              max={10000}
              step={0.1}
              unit="mm"
              disabled
              testId={`dim-${dim}`}
              onChange={() => {}}
            />
          ))}
          <p className="text-xs text-[#9CA3AF]">
            Carga un modelo para ver sus medidas
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {DIMENSIONS.map((dim) => {
            const isLinked = linked === dim;
            const hasTarget =
              sizeIntent.kind === 'size' && sizeIntent.dim === dim;
            const descId = `desc-${dim}`;

            return (
              <div key={dim} className="flex flex-col gap-0.5">
                <NumericInput
                  label={DIMENSION_LABELS[dim]}
                  value={currentSize ? currentSize[dim] : 0}
                  min={0.1}
                  max={10000}
                  step={0.1}
                  unit="mm"
                  resetKey={sizeCommitSeq}
                  testId={`dim-${dim}`}
                  ariaDescribedBy={isLinked ? descId : undefined}
                  labelRight={
                    isLinked ? (
                      <span
                        id={descId}
                        className="flex items-center gap-1 text-[10px] text-[#0A84FF] select-none"
                        title="Ligada a Placas"
                        aria-label="Ligada a Placas"
                      >
                        <Layers className="w-3 h-3" />
                        <span>Ligada a Placas</span>
                      </span>
                    ) : undefined
                  }
                  onChange={(v) => {
                    if (isWaffle) {
                      setWaffleDimensionTarget(dim, v);
                    } else {
                      setPlatesFromDimension(dim, v);
                    }
                  }}
                />
                {hasTarget && (
                  <span className="text-[11px] text-[#0A84FF] font-medium font-mono-tabular select-none pl-1">
                    Objetivo: {sizeIntent.targetMm.toFixed(1)} mm
                  </span>
                )}
              </div>
            );
          })}

          {isWaffle ? (
            waffleFit === null ? (
              <div
                data-testid="max-fit-line"
                className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>El modelo completo excede el área útil de la hoja</span>
              </div>
            ) : waffleParams.targetScale > waffleFit.maxScale ? (
              <div
                data-testid="max-fit-line"
                className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Supera el máximo garantizado en hoja (
                  {(waffleFit.maxScale * 100).toFixed(0)}%); verifica al exportar
                </span>
              </div>
            ) : (
              <div
                data-testid="max-fit-line"
                className="text-[11px] text-[#A1A1AA] font-mono-tabular select-none"
              >
                <span>
                  Máx. garantizado en hoja:{' '}
                  {waffleFit.size.ancho.toFixed(1)} ×{' '}
                  {waffleFit.size.largo.toFixed(1)} ×{' '}
                  {waffleFit.size.alto.toFixed(1)} mm
                </span>
              </div>
            )
          ) : stackedFit === null ? (
            <div
              data-testid="max-fit-line"
              className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                El modelo completo excede el área útil incluso con 2 placas
              </span>
            </div>
          ) : params.plates > stackedFit.plates ? (
            <div
              data-testid="max-fit-line"
              className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Supera el máximo garantizado en hoja ({stackedFit.plates} placas);
                verifica al exportar
              </span>
            </div>
          ) : (
            <div
              data-testid="max-fit-line"
              className="text-[11px] text-[#A1A1AA] font-mono-tabular select-none"
            >
              <span>
                Máx. garantizado en hoja: {stackedFit.plates} placas ·{' '}
                {stackedFit.size.ancho.toFixed(1)} × {stackedFit.size.largo.toFixed(1)} ×{' '}
                {stackedFit.size.alto.toFixed(1)} mm
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
