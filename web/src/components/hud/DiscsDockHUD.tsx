import {
  MousePointer,
  PlusCircle,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { PARAM_BOUNDS } from '../../core/params';
import { useSculptureStore } from '../../store/useSculptureStore';

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
      className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-30 hud-surface rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 shadow-2xl ${className}`}
    >
      {/* Selector explícito de modo: Seleccionar vs Poner discos (Corrección #1) */}
      <div className="flex items-center rounded-lg bg-[#1C1C21] p-0.5 border border-white/[0.08]">
        <button
          type="button"
          onClick={() => setModeAddDiscs(false)}
          aria-pressed={!modeAddDiscs}
          className={`h-8 coarse:min-h-10 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors select-none ${
            !modeAddDiscs
              ? 'bg-[#0A84FF] text-white'
              : 'text-[#A1A1AA] hover:text-white'
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
          className={`h-8 coarse:min-h-10 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors select-none ${
            modeAddDiscs
              ? 'bg-amber-500 text-black font-semibold'
              : 'text-[#A1A1AA] hover:text-white'
          }`}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Poner discos</span>
        </button>
      </div>

      <div className="h-4 w-px bg-white/10" />

      {/* Diámetro del disco seleccionado o por defecto (6.0 mm, [1..50]) */}
      <label className="flex items-center gap-1.5 text-xs text-[#A1A1AA] select-none">
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
          className="w-16 h-8 coarse:min-h-10 px-2 rounded-md bg-[#1C1C21] border border-white/[0.08] text-xs font-mono-tabular text-[#F4F4F5] focus:outline-none focus:border-[#0A84FF]"
        />
        <span className="text-[11px] text-[#9CA3AF]">mm</span>
      </label>

      <button
        type="button"
        disabled={!selectedDisc}
        onClick={deleteSelectedDisc}
        title="Eliminar disco seleccionado (Supr / Backspace)"
        className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-red-500/20 disabled:opacity-40 text-xs font-medium text-red-400 flex items-center gap-1 select-none"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Borrar</span>
      </button>

      <button
        type="button"
        disabled={floorDiscCount === 0}
        onClick={clearActiveFloorDiscs}
        title="Eliminar todos los discos del piso activo"
        className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40 text-xs font-medium text-[#A1A1AA] hover:text-white select-none"
      >
        Limpiar piso ({floorDiscCount})
      </button>

      <div className="h-4 w-px bg-white/10" />

      <button
        type="button"
        disabled={!canUndo}
        onClick={undoDiscs}
        title="Deshacer (Ctrl+Z)"
        aria-label="Deshacer"
        className="h-8 coarse:min-h-10 px-2 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40 text-[#F4F4F5]"
      >
        <Undo2 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={redoDiscs}
        title="Rehacer (Ctrl+Y)"
        aria-label="Rehacer"
        className="h-8 coarse:min-h-10 px-2 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40 text-[#F4F4F5]"
      >
        <Redo2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
