import { useMemo } from 'react';
import { AlertTriangle, Layers, Lock, Ruler } from 'lucide-react';
import {
  DIMENSION_LABELS,
  finalSize,
  finalSizeFromScale,
  hasExtremeAssumedDimensions,
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
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
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

  const assumedDims = useMemo(() => {
    if (meshMetadata?.extents) {
      return {
        x: meshMetadata.extents[0],
        y: meshMetadata.extents[1],
        z: meshMetadata.extents[2],
      };
    }
    if (modelExtents) {
      return {
        x: modelExtents.x,
        y: modelExtents.y,
        z: modelExtents.z,
      };
    }
    return null;
  }, [meshMetadata?.extents, modelExtents]);

  const isExtremeAssumed = assumedDims ? hasExtremeAssumedDimensions(assumedDims) : false;

  return (
    <section
      data-testid="section-model"
      className="flex flex-col gap-2.5 bg-white/[0.02] p-2.5 rounded-2xl border border-white/[0.05]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 select-none">
          <Ruler className="w-3.5 h-3.5 text-[#2997ff]" />
          <h2 className="text-[13px] font-semibold text-[#cccccc]">
            Modelo
          </h2>
        </div>
        <button
          type="button"
          disabled
          aria-pressed="true"
          title="Escala no uniforme: no disponible"
          className="p-1 rounded-full text-[#8b919e] opacity-50 cursor-not-allowed"
        >
          <Lock className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[#8b919e] select-none">
          Tamaño
        </span>
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
          {assumedDims && (
            <div
              data-testid="assumed-original-size"
              className="text-[11px] text-[#A1A1AA] font-mono-tabular select-none border-t border-white/[0.06] pt-1.5"
            >
              <span>
                Tamaño original asumido:{' '}
                {assumedDims.x.toFixed(1)} × {assumedDims.y.toFixed(1)} ×{' '}
                {assumedDims.z.toFixed(1)} mm
              </span>
            </div>
          )}

          {isExtremeAssumed && (
            <div
              data-testid="assumed-units-warning"
              className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Dimensiones inusuales (&lt; 1 mm o &gt; 5000 mm). Verifica si el modelo original fue diseñado en otras unidades (cm, m, pulgadas).
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
