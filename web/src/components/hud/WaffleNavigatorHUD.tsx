import { ChevronDown, ChevronUp, Grid3X3 } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';
import { getWaffleAxesConfig } from '../../core/waffle/canonicalFrame';
import type { WaffleFamilyFilter } from '../../store/waffleSlice';

export interface WaffleNavigatorHUDProps {
  className?: string;
}

export function WaffleNavigatorHUD({ className = '' }: WaffleNavigatorHUDProps) {
  const waffleResult = useSculptureStore((s) => s.waffleResult);
  const waffleParams = useSculptureStore((s) => s.waffleParams);
  const waffleFamilyFilter = useSculptureStore((s) => s.waffleFamilyFilter);
  const selectedWafflePieceId = useSculptureStore((s) => s.selectedWafflePieceId);
  const setWaffleFamilyFilter = useSculptureStore((s) => s.setWaffleFamilyFilter);
  const selectWafflePiece = useSculptureStore((s) => s.selectWafflePiece);
  const stepWafflePiece = useSculptureStore((s) => s.stepWafflePiece);

  if (!waffleResult) return null;

  const axesConfig = getWaffleAxesConfig(waffleParams.upAxis);
  const p1Sections = waffleResult.p1Sections;
  const p2Sections = waffleResult.p2Sections;
  const totalCount = p1Sections.length + p2Sections.length;

  const visibleSections =
    waffleFamilyFilter === 'P1'
      ? p1Sections
      : waffleFamilyFilter === 'P2'
      ? p2Sections
      : [...p1Sections, ...p2Sections];

  const filterButtons: Array<{ id: WaffleFamilyFilter; label: string }> = [
    { id: 'both', label: 'Ambas' },
    { id: 'P1', label: `Solo ${axesConfig.p1Prefix}` },
    { id: 'P2', label: `Solo ${axesConfig.p2Prefix}` },
  ];

  return (
    <aside
      aria-label="Navegador Waffle"
      className={`fixed left-3 top-1/2 -translate-y-1/2 z-30 hud-surface rounded-xl p-3 flex flex-col items-center gap-3 w-48 max-[1100px]:w-14 max-[1100px]:p-2 shadow-xl ${className}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F4F4F5] select-none max-[1100px]:hidden">
        <Grid3X3 className="w-3.5 h-3.5 text-[#0A84FF]" />
        <span>
          Waffle ({totalCount} piezas)
        </span>
      </div>

      {/* Segmented control for family filter */}
      <div
        data-testid="waffle-family-filter"
        className="w-full flex rounded-lg bg-black/40 p-0.5 border border-white/[0.08] max-[1100px]:hidden text-[11px]"
      >
        {filterButtons.map((btn) => {
          const isActive = waffleFamilyFilter === btn.id;
          return (
            <button
              key={btn.id}
              type="button"
              onClick={() => setWaffleFamilyFilter(btn.id)}
              className={`flex-1 py-1 rounded-md font-medium transition-colors text-center ${
                isActive
                  ? 'bg-[#0A84FF] text-white shadow-sm'
                  : 'text-[#A1A1AA] hover:text-[#F4F4F5]'
              }`}
            >
              {btn.label}
            </button>
          );
        })}
      </div>

      {/* Next piece button (W / ArrowUp) */}
      <button
        type="button"
        data-testid="waffle-step-next"
        onClick={() => stepWafflePiece(1)}
        title="Pieza siguiente (W / Flecha arriba)"
        aria-label="Pieza siguiente"
        className="w-full h-8 coarse:min-h-10 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center justify-center gap-1 select-none"
      >
        <ChevronUp className="w-4 h-4" />
        <span className="max-[1100px]:hidden">Siguiente (W)</span>
      </button>

      {/* Piece dropdown selector */}
      <div className="w-full max-[1100px]:hidden">
        <select
          data-testid="waffle-piece-select"
          aria-label="Seleccionar pieza activa"
          value={selectedWafflePieceId ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            selectWafflePiece(val === '' ? null : val);
          }}
          className="w-full bg-black/40 border border-white/[0.12] rounded-md py-1.5 px-2 text-xs text-[#F4F4F5] focus:outline-none focus:border-[#0A84FF] cursor-pointer"
        >
          <option value="">Vista ensamblada</option>
          {visibleSections.map((sec) => (
            <option key={sec.id} value={sec.id}>
              Pieza {sec.id} ({sec.family})
            </option>
          ))}
        </select>
      </div>

      {/* Prev piece button (S / ArrowDown) */}
      <button
        type="button"
        data-testid="waffle-step-prev"
        onClick={() => stepWafflePiece(-1)}
        title="Pieza anterior (S / Flecha abajo)"
        aria-label="Pieza anterior"
        className="w-full h-8 coarse:min-h-10 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center justify-center gap-1 select-none"
      >
        <ChevronDown className="w-4 h-4" />
        <span className="max-[1100px]:hidden">Anterior (S)</span>
      </button>

      {/* Deselect button if active */}
      {selectedWafflePieceId && (
        <button
          type="button"
          onClick={() => selectWafflePiece(null)}
          className="w-full text-[11px] text-[#A1A1AA] hover:text-[#F4F4F5] underline max-[1100px]:hidden"
        >
          Ver ensamble completo
        </button>
      )}
    </aside>
  );
}
