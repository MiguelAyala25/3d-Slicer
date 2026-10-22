import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { MaterialSection } from './inspector/MaterialSection';
import { ModelSection } from './inspector/ModelSection';
import { ResultSection } from './inspector/ResultSection';
import { TechniqueSection } from './inspector/TechniqueSection';

export interface RightInspectorProps {
  className?: string;
}

export function RightInspector({ className = '' }: RightInspectorProps) {
  const [drawerOpen, setDrawerOpen] = useState(true);

  return (
    <>
      {/* Botón toggle para pantallas < 1100px */}
      <button
        type="button"
        onClick={() => setDrawerOpen((v) => !v)}
        className="hidden max-[1100px]:flex fixed top-3 right-3 z-40 hud-surface h-8 px-2.5 rounded-md items-center gap-1.5 text-xs font-medium text-[#F4F4F5]"
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-[#0A84FF]" />
        <span>Parámetros</span>
      </button>

      <aside
        aria-label="Inspector de parámetros y exportación"
        className={`fixed top-3 right-3 bottom-14 z-30 w-72 hud-surface rounded-xl p-3.5 flex flex-col gap-3 overflow-y-auto shadow-2xl transition-transform ${
          drawerOpen
            ? 'translate-x-0'
            : 'max-[1100px]:translate-x-[110%]'
        } ${className}`}
      >
        <MaterialSection />
        <ModelSection />
        <TechniqueSection />
        <ResultSection />
      </aside>
    </>
  );
}
