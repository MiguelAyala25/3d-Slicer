import { useState, type DragEvent } from 'react';
import { Box, FolderOpen, Loader2, RotateCcw, Upload, X } from 'lucide-react';
import { useProjectFileActions } from './useProjectFileActions';

export interface EmptyStateCardProps {
  className?: string;
}

export function EmptyStateCard({ className = '' }: EmptyStateCardProps) {
  const {
    meshInputRef,
    projectInputRef,
    pendingAutosave,
    isLoadingMesh,
    loadMeshFromFile,
    loadProjectFromFile,
    handleMeshFileChange,
    handleProjectFileChange,
    triggerOpenMeshDialog,
    triggerOpenProjectDialog,
    restoreAutosaveSession,
    discardAutosaveSession,
  } = useProjectFileActions();

  const [isDraggingOverCard, setIsDraggingOverCard] = useState(false);

  const handleCardDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverCard(true);
  };

  const handleCardDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverCard(false);
  };

  const handleCardDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverCard(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      await loadProjectFromFile(file);
    } else if (
      lower.endsWith('.obj') ||
      lower.endsWith('.stl') ||
      lower.endsWith('.3mf') ||
      lower.endsWith('.ply')
    ) {
      await loadMeshFromFile(file);
    }
  };

  return (
    <div
      className={`absolute inset-0 pointer-events-none flex items-center justify-center p-4 z-20 ${className}`}
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

      <div className="pointer-events-auto w-full max-w-[420px] bg-[#1b1b1d]/95 backdrop-blur-xl border border-white/[0.08] rounded-[24px] p-5 flex flex-col gap-4 shadow-2xl text-white select-none transition-all">
        {/* Encabezado */}
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <Box className="w-4 h-4 text-[#2997ff]" />
            <h2 className="text-[14px] font-semibold text-white">
              Nuevo proyecto
            </h2>
          </div>
        </div>

        {/* Tarjeta de recuperación de sesión si existe */}
        {pendingAutosave && (
          <div
            role="region"
            aria-label="Recuperación de sesión automática"
            data-testid="autosave-banner"
            className="flex flex-col gap-2.5 bg-white/[0.02] p-3 rounded-2xl border border-[#0071e3]/40"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <RotateCcw className="w-3.5 h-3.5 text-[#2997ff] shrink-0" />
                <span className="text-[12px] font-semibold text-[#f4f4f5]">
                  Sesión anterior encontrada
                </span>
              </div>
              {pendingAutosave.meshRecord?.fileName && (
                <span className="px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[10px] font-mono-tabular text-[#8b919e] truncate max-w-[140px]">
                  {pendingAutosave.meshRecord.fileName}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void restoreAutosaveSession()}
                className="h-8 px-3 rounded-xl bg-[#0071e3] hover:bg-[#0077ED] text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-[0.98] cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restaurar sesión</span>
              </button>
              <button
                type="button"
                onClick={() => void discardAutosaveSession()}
                className="h-8 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-[#8b919e] hover:text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Descartar</span>
              </button>
            </div>
          </div>
        )}

        {/* Zona Dropzone para arrastrar o elegir modelo 3D */}
        <div
          onClick={triggerOpenMeshDialog}
          onDragOver={handleCardDragOver}
          onDragLeave={handleCardDragLeave}
          onDrop={handleCardDrop}
          className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${
            isDraggingOverCard
              ? 'border-[#2997ff] bg-[#2997ff]/10 scale-[1.01]'
              : 'border-white/[0.12] hover:border-[#2997ff]/50 bg-white/[0.02] hover:bg-white/[0.04]'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-[#2997ff] mb-1">
            {isLoadingMesh ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
          </div>

          <p className="text-[13px] font-medium text-[#f4f4f5] text-center">
            {isLoadingMesh ? 'Cargando modelo 3D...' : 'Arrastra tu modelo 3D aquí'}
          </p>

          <p className="text-[11px] text-[#8b919e] font-mono-tabular">
            .obj · .stl · .3mf · .ply
          </p>

          <button
            type="button"
            disabled={isLoadingMesh}
            onClick={(e) => {
              e.stopPropagation();
              triggerOpenMeshDialog();
            }}
            className="mt-1 h-8 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-white transition-colors cursor-pointer"
          >
            Elegir archivo
          </button>
        </div>

        {/* Abrir proyecto guardado */}
        <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={triggerOpenProjectDialog}
            className="flex items-center gap-1.5 text-[11px] text-[#8b919e] hover:text-[#2997ff] transition-colors py-1 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Abrir proyecto guardado (.json)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
