import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface FloorNavigatorHUDProps {
  className?: string;
}

export function FloorNavigatorHUD({ className = '' }: FloorNavigatorHUDProps) {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const showAllFloors = useSculptureStore((s) => s.showAllFloors);
  const setActiveFloor = useSculptureStore((s) => s.setActiveFloor);
  const stepFloor = useSculptureStore((s) => s.stepFloor);
  const setShowAllFloors = useSculptureStore((s) => s.setShowAllFloors);

  if (!sliceResult) return null;

  const totalPlates = sliceResult.plates.length;
  const validIndices: number[] = [];
  for (let i = 0; i < totalPlates; i++) {
    if (sliceResult.plates[i] && sliceResult.plates[i].length > 0) {
      validIndices.push(i);
    }
  }
  const validCount = validIndices.length;

  const handleSliderChange = (rawIndex: number) => {
    if (sliceResult.plates[rawIndex]?.length > 0) {
      setActiveFloor(rawIndex);
      return;
    }
    // Saltar automáticamente a la placa no vacía más cercana (Corrección B13)
    let closest = activeFloor;
    let bestDist = Infinity;
    for (const vi of validIndices) {
      const d = Math.abs(vi - rawIndex);
      if (d < bestDist) {
        bestDist = d;
        closest = vi;
      }
    }
    setActiveFloor(closest);
  };

  return (
    <aside
      aria-label="Navegador de pisos"
      className={`fixed left-3 top-1/2 -translate-y-1/2 z-30 hud-surface rounded-xl p-3 flex flex-col items-center gap-3 w-44 max-[1100px]:w-12 max-[1100px]:p-2 shadow-xl ${className}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F4F4F5] select-none max-[1100px]:hidden">
        <Layers className="w-3.5 h-3.5 text-[#0A84FF]" />
        <span>
          Piso {activeFloor} ({validCount} de {totalPlates})
        </span>
      </div>

      <button
        type="button"
        onClick={() => stepFloor(1)}
        title="Piso siguiente (W / Flecha arriba)"
        aria-label="Piso siguiente"
        className="w-full h-8 coarse:min-h-10 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center justify-center gap-1 select-none"
      >
        <ChevronUp className="w-4 h-4" />
        <span className="max-[1100px]:hidden">Subir (W)</span>
      </button>

      <div className="h-36 flex items-center justify-center py-2">
        <input
          type="range"
          min={0}
          max={Math.max(0, totalPlates - 1)}
          step={1}
          value={activeFloor}
          aria-label="Selector de piso activo"
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          className="h-32 accent-[#0A84FF] cursor-pointer"
        />
      </div>

      <button
        type="button"
        onClick={() => stepFloor(-1)}
        title="Piso anterior (S / Flecha abajo)"
        aria-label="Piso anterior"
        className="w-full h-8 coarse:min-h-10 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center justify-center gap-1 select-none"
      >
        <ChevronDown className="w-4 h-4" />
        <span className="max-[1100px]:hidden">Bajar (S)</span>
      </button>

      <label className="w-full pt-2 border-t border-white/[0.08] flex items-center justify-between gap-2 text-xs text-[#A1A1AA] cursor-pointer select-none max-[1100px]:hidden">
        <span>Solo piso activo</span>
        <input
          type="checkbox"
          checked={!showAllFloors}
          onChange={(e) => setShowAllFloors(!e.target.checked)}
          className="rounded accent-[#0A84FF] w-4 h-4"
        />
      </label>
    </aside>
  );
}
