import { useState, useRef, useEffect } from 'react';
import { Box, FolderOpen, MoreHorizontal, Save, Upload } from 'lucide-react';
import { useProjectFileActions } from './useProjectFileActions';

export interface ProjectPillProps {
  className?: string;
}

export function ProjectPill({ className = '' }: ProjectPillProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  const {
    meshInputRef,
    projectInputRef,
    meshMetadata,
    handleMeshFileChange,
    handleProjectFileChange,
    handleSaveProject,
    triggerOpenMeshDialog,
    triggerOpenProjectDialog,
  } = useProjectFileActions();

  // Cerrar menú al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      ref={menuContainerRef}
      className={`fixed top-3 left-3 z-30 flex flex-col gap-1.5 select-none ${className}`}
    >
      <input
        ref={meshInputRef}
        type="file"
        accept=".obj,.stl,.3mf,.ply"
        onChange={handleMeshFileChange}
        className="hidden"
        data-testid="mesh-file-input"
      />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json"
        onChange={handleProjectFileChange}
        className="hidden"
        data-testid="project-file-input"
      />

      {/* Pastilla compacta */}
      <div className="bg-[#1b1b1d]/95 backdrop-blur-xl border border-white/[0.08] hover:border-white/15 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-2xl transition-all">
        <Box className="w-3.5 h-3.5 text-[#2997ff] shrink-0" />
        <span
          className="font-mono-tabular text-xs text-[#f4f4f5] font-medium truncate max-w-[200px]"
          title={meshMetadata?.fileName || 'Modelo 3D'}
        >
          {meshMetadata?.fileName || 'Modelo 3D'}
        </span>

        <div className="h-3.5 w-px bg-white/10 mx-0.5" />

        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          title="Opciones de proyecto"
          aria-expanded={menuOpen}
          className={`p-1 -mr-1 rounded-full text-[#8b919e] hover:text-white hover:bg-white/10 transition-colors cursor-pointer ${
            menuOpen ? 'bg-white/15 text-white' : ''
          }`}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Menú desplegable */}
      {menuOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="w-52 bg-[#1b1b1d]/98 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-1.5 shadow-2xl flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#8b919e]">
            Proyecto
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              triggerOpenMeshDialog();
            }}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs text-[#f4f4f5] transition-colors text-left cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[#2997ff]" />
            <span>Cambiar modelo 3D...</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              triggerOpenProjectDialog();
            }}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs text-[#f4f4f5] transition-colors text-left cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#2997ff]" />
            <span>Abrir proyecto...</span>
          </button>

          <div className="my-0.5 h-px bg-white/[0.08]" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              handleSaveProject();
            }}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs text-[#f4f4f5] transition-colors text-left cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 text-[#2997ff]" />
            <span>Guardar proyecto</span>
          </button>
        </div>
      )}
    </div>
  );
}
