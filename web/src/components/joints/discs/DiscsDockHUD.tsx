import {
  MousePointer,
  PlusCircle,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { PARAM_BOUNDS } from '../../../core/params';
import { useSculptureStore } from '../../../store/useSculptureStore';

export interface DiscsDockHUDProps {
  className?: string;
}

export function DiscsDockHUD({ className = '' }: DiscsDockHUDProps) {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const modeAddDiscs = useSculptureStore((s) => s.modeAddDiscs);
  const discs = useSculptureStore((s) => s.discs);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const selectedDiscId = useSculptureStore((s) => s.selectedDiscId);
  const defaultDiscDiameter = useSculptureStore((s) => s.params.discDiameter);
  const canUndo = useSculptureStore((s) => s.canUndo);
  const canRedo = useSculptureStore((s) => s.canRedo);

  const setModeAddDiscs = useSculptureStore((s) => s.setModeAddDiscs);
  const setParam = useSculptureStore((s) => s.setParam);
  const updateSelectedDiscDiameter = useSculptureStore(
    (s) => s.updateSelectedDiscDiameter
  );
  const deleteSelectedDisc = useSculptureStore((s) => s.deleteSelectedDisc);
  const clearActiveFloorDiscs = useSculptureStore(
    (s) => s.clearActiveFloorDiscs
  );
  const undoDiscs = useSculptureStore((s) => s.undoDiscs);
  const redoDiscs = useSculptureStore((s) => s.redoDiscs);

  if (!sliceResult) return null;

  const selectedDisc = discs.find((d) => d.id === selectedDiscId) ?? null;
  const displayedDiameter = selectedDisc
    ? selectedDisc.diameter
    : defaultDiscDiameter;
  const floorDiscCount = discs.filter((d) => d.gapIndex === activeFloor).length;

  const handleDiameterChange = (val: number) => {
    const clamped = Math.max(
      PARAM_BOUNDS.discDiameter.min,
      Math.min(PARAM_BOUNDS.discDiameter.max, val)
    );
    setParam('discDiameter', clamped);
    if (selectedDisc) {
      updateSelectedDiscDiameter(clamped);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Herramientas de discos de unión"
      className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-[#1b1b1d]/95 backdrop-blur-xl border border-white/[0.08] rounded-full px-3 py-1.5 flex flex-nowrap items-center gap-2 shadow-2xl whitespace-nowrap max-w-[calc(100%-24px)] overflow-x-auto custom-scrollbar select-none ${className}`}
    >
      {/* Selector explícito de modo: Seleccionar vs Poner discos (Corrección #1) */}
      <div className="flex items-center rounded-full bg-[#131315] p-0.5 border border-white/[0.08] shrink-0">
        <button
          type="button"
          onClick={() => setModeAddDiscs(false)}
          aria-pressed={!modeAddDiscs}
          className={`h-7 px-3 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none ${
            !modeAddDiscs
              ? 'bg-[#0071e3] text-white'
              : 'text-[#8b919e] hover:text-white'
          }`}
        >
          <MousePointer className="w-3.5 h-3.5" />
          <span>Seleccionar</span>
        </button>
        <button
          type="button"
          onClick={() => setModeAddDiscs(true)}
          aria-pressed={modeAddDiscs}
          data-testid="toggle-add-discs"
          className={`h-7 px-3 rounded-full text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none ${
            modeAddDiscs
              ? 'bg-amber-500 text-black font-semibold'
              : 'text-[#8b919e] hover:text-white'
          }`}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Poner discos</span>
        </button>
      </div>

      <div className="h-4 w-px bg-white/10 shrink-0" />

      {/* Diámetro del disco seleccionado o por defecto (6.0 mm, [1..50]) */}
      <label className="flex items-center gap-1.5 text-xs text-[#8b919e] select-none shrink-0">
        <span>{selectedDisc ? `Disco #${selectedDisc.id} Ø` : 'Diámetro Ø'}</span>
        <input
          type="number"
          aria-label="Diámetro"
          min={PARAM_BOUNDS.discDiameter.min}
          max={PARAM_BOUNDS.discDiameter.max}
          step={PARAM_BOUNDS.discDiameter.step}
          value={displayedDiameter}
          onChange={(e) => {
            const parsed = Number.parseFloat(e.target.value);
            if (Number.isFinite(parsed)) {
              handleDiameterChange(parsed);
            }
          }}
          className="w-14 h-7 px-2 rounded-lg bg-[#131315] border border-white/[0.08] text-xs font-mono-tabular text-[#f4f4f5] focus:outline-none focus:border-[#2997ff]"
        />
        <span className="text-[11px] text-[#8b919e]">mm</span>
      </label>

      <button
        type="button"
        disabled={!selectedDisc}
        onClick={deleteSelectedDisc}
        title="Eliminar disco seleccionado (Supr / Backspace)"
        className="h-7 px-2.5 rounded-lg bg-white/5 hover:bg-red-500/20 disabled:opacity-40 text-xs font-medium text-red-400 flex items-center gap-1.5 select-none shrink-0 cursor-pointer disabled:cursor-not-allowed transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Borrar</span>
      </button>

      <button
        type="button"
        disabled={floorDiscCount === 0}
        onClick={clearActiveFloorDiscs}
        title="Eliminar todos los discos del piso activo"
        className="h-7 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-xs font-medium text-[#8b919e] hover:text-white select-none shrink-0 cursor-pointer disabled:cursor-not-allowed transition-colors"
      >
        Limpiar piso ({floorDiscCount})
      </button>

      <div className="h-4 w-px bg-white/10 shrink-0" />

      <button
        type="button"
        disabled={!canUndo}
        onClick={undoDiscs}
        title="Deshacer (Ctrl+Z)"
        aria-label="Deshacer"
        className="h-7 w-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-[#f4f4f5] flex items-center justify-center shrink-0 cursor-pointer disabled:cursor-not-allowed transition-colors"
      >
        <Undo2 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={redoDiscs}
        title="Rehacer (Ctrl+Y)"
        aria-label="Rehacer"
        className="h-7 w-7 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-[#f4f4f5] flex items-center justify-center shrink-0 cursor-pointer disabled:cursor-not-allowed transition-colors"
      >
        <Redo2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
