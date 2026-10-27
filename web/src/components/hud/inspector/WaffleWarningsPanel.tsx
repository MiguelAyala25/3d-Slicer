import { AlertTriangle, Info } from 'lucide-react';
import { useSculptureStore } from '../../../store/useSculptureStore';
import type { WaffleWarning } from '../../../core/waffle/types';

export function WaffleWarningsPanel() {
  const waffleResult = useSculptureStore((s) => s.waffleResult);
  const selectedWafflePieceId = useSculptureStore((s) => s.selectedWafflePieceId);
  const selectWafflePiece = useSculptureStore((s) => s.selectWafflePiece);

  if (!waffleResult || waffleResult.warnings.length === 0) {
    return null;
  }

  const warnings = waffleResult.warnings;
  const warningCount = warnings.filter((w) => w.severity === 'warning').length;
  const infoCount = warnings.filter((w) => w.severity === 'info').length;

  return (
    <div
      data-testid="waffle-warnings-panel"
      className="flex flex-col gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300"
    >
      <div className="flex items-center justify-between font-medium select-none">
        <span className="flex items-center gap-1.5 text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            {warnings.length} {warnings.length === 1 ? 'aviso' : 'avisos'} de corte
            {warningCount > 0 && ` (${warningCount} advertencia${warningCount > 1 ? 's' : ''})`}
            {infoCount > 0 && ` (${infoCount} info)`}
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-1 mt-0.5">
        {warnings.map((w: WaffleWarning, idx: number) => {
          const isSelected = w.pieceId !== null && selectedWafflePieceId === w.pieceId;
          const isWarning = w.severity === 'warning';

          return (
            <button
              key={`${w.code}-${w.pieceId ?? 'all'}-${idx}`}
              type="button"
              data-testid={`waffle-warning-${w.code}`}
              onClick={() => {
                if (w.pieceId) {
                  selectWafflePiece(isSelected ? null : w.pieceId);
                }
              }}
              className={`w-full text-left p-1.5 rounded transition-colors flex items-start gap-1.5 ${
                isSelected
                  ? 'bg-amber-500/25 border border-amber-400/50'
                  : 'hover:bg-amber-500/15'
              } ${w.pieceId ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {isWarning ? (
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-400" />
              ) : (
                <Info className="w-3 h-3 shrink-0 mt-0.5 text-blue-400" />
              )}
              <div className="flex-1 flex flex-col gap-0.5 leading-tight">
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  <span className="px-1 py-0.2 bg-black/40 rounded border border-white/10 font-bold">
                    {w.code}
                  </span>
                  {w.pieceId && (
                    <span className="text-[#F4F4F5]">Pieza {w.pieceId}</span>
                  )}
                </div>
                <span className="text-[11px] text-amber-200/90">{w.message}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
