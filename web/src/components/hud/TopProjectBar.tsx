import { useRef, type ChangeEvent } from 'react';
import {
  Box,
  FolderOpen,
  Loader2,
  RotateCcw,
  Save,
  Upload,
  X,
} from 'lucide-react';
import {
  INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE,
  parseProjectJson,
} from '../../core/project';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface TopProjectBarProps {
  className?: string;
}

export function TopProjectBar({ className = '' }: TopProjectBarProps) {
  const meshInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);

  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
  const params = useSculptureStore((s) => s.params);
  const pendingAutosave = useSculptureStore((s) => s.pendingAutosave);
  const isLoadingMesh = useSculptureStore((s) => s.isLoadingMesh);
  const isSlicing = useSculptureStore((s) => s.isSlicing);
  const loadMeshArrayBuffer = useSculptureStore((s) => s.loadMeshArrayBuffer);
  const exportProjectJsonString = useSculptureStore(
    (s) => s.exportProjectJsonString
  );
  const importProjectFromParsed = useSculptureStore(
    (s) => s.importProjectFromParsed
  );
  const restoreAutosaveSession = useSculptureStore(
    (s) => s.restoreAutosaveSession
  );
  const discardAutosaveSession = useSculptureStore(
    (s) => s.discardAutosaveSession
  );

  const handleMeshFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      await loadMeshArrayBuffer(buffer, file.name, true);
    } finally {
      e.target.value = '';
    }
  };

  const handleProjectFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseProjectJson(text, params);
      const outcome = await importProjectFromParsed(parsed, false);
      if (outcome.needsConfirmation) {
        const accepted = window.confirm(INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE);
        if (accepted) {
          await importProjectFromParsed(parsed, true);
        }
      }
    } catch (err) {
      useSculptureStore.setState({
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveProject = () => {
    try {
      const json = exportProjectJsonString();
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = meshMetadata?.fileName
        ? meshMetadata.fileName.replace(/\.[^.]+$/, '')
        : 'escultura';
      a.download = `${baseName}_proyecto.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      useSculptureStore.setState({
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      className={`fixed top-3 left-3 z-30 flex flex-col gap-2 max-w-[calc(100vw-24px)] ${className}`}
    >
      <div className="hud-surface rounded-lg px-2.5 py-1.5 flex flex-wrap items-center gap-2 shadow-lg">
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

        <button
          type="button"
          disabled={isLoadingMesh || isSlicing}
          onClick={() => meshInputRef.current?.click()}
          className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-[#0A84FF] hover:bg-[#0070E0] disabled:opacity-60 text-xs font-medium text-white flex items-center gap-1.5 select-none transition-colors"
        >
          {isLoadingMesh ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          <span>{isLoadingMesh ? 'Cargando...' : 'Cargar modelo 3D'}</span>
        </button>

        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#1C1C21] border border-white/[0.08] text-xs text-[#A1A1AA] hud-text-selectable">
          <Box className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
          <span className="truncate max-w-[160px] font-mono-tabular text-[#F4F4F5]">
            {meshMetadata ? meshMetadata.fileName : 'Sin archivo'}
          </span>
        </div>

        <div className="h-4 w-px bg-white/10 mx-0.5" />

        <button
          type="button"
          onClick={() => projectInputRef.current?.click()}
          title="Cargar proyecto (.json)"
          className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center gap-1.5 select-none"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[#A1A1AA]" />
          <span>Abrir JSON</span>
        </button>

        <button
          type="button"
          onClick={handleSaveProject}
          title="Guardar proyecto (.json)"
          className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center gap-1.5 select-none"
        >
          <Save className="w-3.5 h-3.5 text-[#A1A1AA]" />
          <span>Guardar JSON</span>
        </button>
      </div>

      {/* Banner condicional de Autosave (Corrección #5f: prohibido sobrescribir sin preguntar) */}
      {pendingAutosave && (
        <div
          role="region"
          aria-label="Recuperación de sesión automática"
          data-testid="autosave-banner"
          className="hud-surface rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-3 border-amber-500/40 shadow-lg"
        >
          <span className="text-xs text-[#F4F4F5]">
            Sesión anterior encontrada
            {pendingAutosave.meshRecord?.fileName
              ? ` (${pendingAutosave.meshRecord.fileName})`
              : ''}
            . ¿Deseas restaurarla?
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void restoreAutosaveSession()}
              className="h-7 px-2.5 rounded bg-[#0A84FF] hover:bg-[#0070E0] text-xs font-medium text-white flex items-center gap-1 select-none"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restaurar sesión</span>
            </button>
            <button
              type="button"
              onClick={() => void discardAutosaveSession()}
              className="h-7 px-2.5 rounded bg-white/5 hover:bg-white/10 text-xs font-medium text-[#A1A1AA] hover:text-white flex items-center gap-1 select-none"
            >
              <X className="w-3.5 h-3.5" />
              <span>Descartar</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
