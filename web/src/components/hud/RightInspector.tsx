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
        className="hidden max-[1100px]:flex fixed top-3 right-3 z-40 bg-[#1b1b1d]/90 backdrop-blur-md border border-white/[0.08] h-8 px-3 rounded-full items-center gap-1.5 text-xs font-medium text-white shadow-lg"
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-[#2997ff]" />
        <span>Parámetros</span>
      </button>

      <aside
        aria-label="Inspector de parámetros y exportación"
        className={`fixed top-3 right-3 bottom-3 z-30 w-[330px] bg-[#1b1b1d]/95 backdrop-blur-xl border border-white/[0.08] rounded-[24px] p-3.5 flex flex-col gap-2.5 overflow-y-auto custom-scrollbar shadow-2xl transition-transform ${
          drawerOpen
            ? 'translate-x-0'
            : 'max-[1100px]:translate-x-[110%]'
        } ${className}`}
      >
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.08] select-none shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[#2997ff]" />
            <span className="text-[15px] font-semibold text-white">
              Parámetros CAD
            </span>
          </div>
        </div>

        <MaterialSection />
        <ModelSection />
        <TechniqueSection />
        <ResultSection />
      </aside>
    </>
  );
}
