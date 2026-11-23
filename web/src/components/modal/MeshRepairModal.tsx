import { useState } from 'react';
import { Wrench, X } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';
import type { MeshRepairDiagnosis, MeshRepairOptions } from '../../types/sculpture';

interface MeshRepairDialogContentProps {
  diagnosis: MeshRepairDiagnosis;
  onRepair: (options: MeshRepairOptions) => void;
  onLoadRaw: () => void;
  onCancel: () => void;
}

function MeshRepairDialogContent({
  diagnosis,
  onRepair,
  onLoadRaw,
  onCancel,
}: MeshRepairDialogContentProps) {
  const [fillHoles, setFillHoles] = useState(diagnosis.openHoleLoopCount > 0);
  const [harmonizeWinding, setHarmonizeWinding] = useState(
    diagnosis.invertedFaceEstimate > 0
  );
  const [pruneFlaps, setPruneFlaps] = useState(diagnosis.prunableFlapCount > 0);

  const anySelected = fillHoles || harmonizeWinding || pruneFlaps;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mesh-repair-title"
      data-testid="mesh-repair-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-[460px] bg-[#1b1b1d]/98 backdrop-blur-xl border border-white/[0.1] rounded-[24px] p-5 flex flex-col gap-4 shadow-2xl text-white select-none">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
              <Wrench className="w-4 h-4" />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <h2
                id="mesh-repair-title"
                className="text-[14px] font-semibold text-white leading-snug"
              >
                Se detectaron problemas en la malla
              </h2>
              <span
                className="inline-flex w-fit max-w-full px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[10px] font-mono-tabular text-[#a1a1aa] truncate"
                title={diagnosis.fileName}
              >
                {diagnosis.fileName}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar carga"
            data-testid="btn-cancel-repair-modal"
            className="p-1.5 rounded-full text-[#8b919e] hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Descripción */}
        <p className="text-[12px] text-[#a1a1aa] leading-relaxed">
          Estos defectos pueden causar planos vacíos o contornos incompletos al cortar. Elige qué reparaciones aplicar antes de cargar:
        </p>

        {/* Lista de reparaciones detectadas */}
        <div className="flex flex-col gap-2">
          {diagnosis.openHoleLoopCount > 0 && (
            <label className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={fillHoles}
                onChange={(e) => setFillHoles(e.target.checked)}
                data-testid="repair-check-fill-holes"
                className="mt-0.5 h-4 w-4 rounded accent-[#0071e3] cursor-pointer shrink-0"
              />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[12px] font-semibold text-[#f4f4f5]">
                  Cerrar huecos abiertos
                </span>
                <span className="text-[11px] text-[#8b919e] leading-snug">
                  {diagnosis.openHoleLoopCount} hueco(s) ({diagnosis.openEdgeCount} aristas · +{diagnosis.estimatedCapTriangles} triángulos). Evita vacíos al cortar en X e Y.
                </span>
              </div>
            </label>
          )}

          {diagnosis.invertedFaceEstimate > 0 && (
            <label className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={harmonizeWinding}
                onChange={(e) => setHarmonizeWinding(e.target.checked)}
                data-testid="repair-check-harmonize-winding"
                className="mt-0.5 h-4 w-4 rounded accent-[#0071e3] cursor-pointer shrink-0"
              />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[12px] font-semibold text-[#f4f4f5]">
                  Armonizar normales invertidas
                </span>
                <span className="text-[11px] text-[#8b919e] leading-snug">
                  {diagnosis.invertedFaceEstimate} cara(s) con orientación inconsistente ({diagnosis.inconsistentWindingEdgeCount} aristas).
                </span>
              </div>
            </label>
          )}

          {diagnosis.prunableFlapCount > 0 && (
            <label className="flex items-start gap-3 p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={pruneFlaps}
                onChange={(e) => setPruneFlaps(e.target.checked)}
                data-testid="repair-check-prune-flaps"
                className="mt-0.5 h-4 w-4 rounded accent-[#0071e3] cursor-pointer shrink-0"
              />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[12px] font-semibold text-[#f4f4f5]">
                  Eliminar triángulos rebaba no-manifold
                </span>
                <span className="text-[11px] text-[#8b919e] leading-snug">
                  {diagnosis.prunableFlapCount} triángulo(s) rebaba coplanar(es) en bordes no-manifold.
                </span>
              </div>
            </label>
          )}
        </div>

        {/* Acciones */}
        <div className="flex flex-col sm:flex-row-reverse gap-2 pt-1 border-t border-white/[0.06]">
          <button
            type="button"
            disabled={!anySelected}
            onClick={() =>
              onRepair({
                fillHoles,
                harmonizeWinding,
                pruneFlaps,
              })
            }
            data-testid="btn-repair-and-load"
            className="flex-1 h-9 px-4 rounded-xl bg-[#0071e3] hover:bg-[#0077ED] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white transition-all shadow-md active:scale-[0.98] cursor-pointer"
          >
            Reparar y cargar
          </button>

          <button
            type="button"
            onClick={onLoadRaw}
            data-testid="btn-load-without-repair"
            className="flex-1 h-9 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-[#e4e4e7] transition-colors cursor-pointer"
          >
            Cargar sin reparar
          </button>
        </div>
      </div>
    </div>
  );
}

export function MeshRepairModal() {
  const pendingMeshRepair = useSculptureStore((s) => s.pendingMeshRepair);
  const resolvePendingMeshRepair = useSculptureStore(
    (s) => s.resolvePendingMeshRepair
  );
  const cancelPendingMeshRepair = useSculptureStore(
    (s) => s.cancelPendingMeshRepair
  );

  if (!pendingMeshRepair) return null;

  return (
    <MeshRepairDialogContent
      key={pendingMeshRepair.meshId}
      diagnosis={pendingMeshRepair.diagnosis}
      onRepair={(options) => void resolvePendingMeshRepair(options)}
      onLoadRaw={() =>
        void resolvePendingMeshRepair({
          fillHoles: false,
          harmonizeWinding: false,
          pruneFlaps: false,
        })
      }
      onCancel={cancelPendingMeshRepair}
    />
  );
}
