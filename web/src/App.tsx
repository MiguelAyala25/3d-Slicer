import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { useSculptureStore } from './store/useSculptureStore';
import { Viewport3D } from './components/viewport/Viewport3D';
import { ProjectPill } from './components/hud/ProjectPill';
import { EmptyStateCard } from './components/hud/EmptyStateCard';
import { ViewToggles } from './components/hud/ViewToggles';
import { FloorNavigatorHUD } from './components/hud/FloorNavigatorHUD';
import { WaffleNavigatorHUD } from './components/hud/WaffleNavigatorHUD';
import { JOINT_UI } from './components/joints/registry';
import { RightInspector } from './components/hud/RightInspector';
import { StatusBarPill } from './components/hud/StatusBarPill';
import { SheetPreviewModal } from './components/modal/SheetPreviewModal';
import {
  INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE,
  parseProjectJson,
} from './core/project';

export default function App() {
  const meshGeometry = useSculptureStore((s) => s.meshGeometry);
  const viewMode = useSculptureStore((s) => s.viewMode);
  const setViewMode = useSculptureStore((s) => s.setViewMode);
  const toggleWireframe = useSculptureStore((s) => s.toggleWireframe);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const waffleResult = useSculptureStore((s) => s.waffleResult);
  const params = useSculptureStore((s) => s.params);
  const loadMeshArrayBuffer = useSculptureStore((s) => s.loadMeshArrayBuffer);
  const importProjectFromParsed = useSculptureStore(
    (s) => s.importProjectFromParsed
  );

  const stepFloor = useSculptureStore((s) => s.stepFloor);
  const setCameraPreset = useSculptureStore((s) => s.setCameraPreset);
  const deleteSelectedDisc = useSculptureStore((s) => s.deleteSelectedDisc);
  const undoDiscs = useSculptureStore((s) => s.undoDiscs);
  const redoDiscs = useSculptureStore((s) => s.redoDiscs);
  const stepWafflePiece = useSculptureStore((s) => s.stepWafflePiece);
  const closeSheetPreviewModal = useSculptureStore(
    (s) => s.closeSheetPreviewModal
  );
  const isPreviewModalOpen = useSculptureStore((s) => s.isPreviewModalOpen);
  const checkAutosaveOnStartup = useSculptureStore(
    (s) => s.checkAutosaveOnStartup
  );
  const build = useSculptureStore((s) => s.build);
  const JointDock = build.jointId ? JOINT_UI[build.jointId]?.Dock : undefined;

  const [isWindowDragging, setIsWindowDragging] = useState(false);

  // Corrección #5f: Detectar sesión guardada para mostrar banner "Restaurar sesión / Descartar".
  // Prohibido sobrescribir el estado sin preguntar al usuario.
  useEffect(() => {
    void checkAutosaveOnStartup();
  }, [checkAutosaveOnStartup]);

  // Advertencia beforeunload si hay malla o contenido de unión en sesión (CH-12)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useSculptureStore.getState();
      const hasJointContent =
        state.build.jointId === 'discs' && state.discs.length > 0;
      if (state.meshGeometry !== null || hasJointContent) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Soporte global para arrastrar y soltar archivos (.obj, .stl, .3mf, .ply, .json)
  useEffect(() => {
    let dragCounter = 0;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsWindowDragging(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        setIsWindowDragging(false);
        dragCounter = 0;
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setIsWindowDragging(false);

      const file = e.dataTransfer?.files?.[0];
      if (!file) return;

      const lower = file.name.toLowerCase();
      if (lower.endsWith('.json')) {
        try {
          const text = await file.text();
          const parsed = parseProjectJson(text, params);
          const outcome = await importProjectFromParsed(parsed, false);
          if (outcome.needsConfirmation) {
            const accepted = window.confirm(
              INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE
            );
            if (accepted) {
              await importProjectFromParsed(parsed, true);
            }
          }
        } catch (err) {
          useSculptureStore.setState({
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (
        lower.endsWith('.obj') ||
        lower.endsWith('.stl') ||
        lower.endsWith('.3mf') ||
        lower.endsWith('.ply')
      ) {
        try {
          useSculptureStore.getState().setIsLoadingMesh(true);
          const buffer = await file.arrayBuffer();
          await loadMeshArrayBuffer(buffer, file.name, true);
        } catch (err) {
          useSculptureStore.setState({
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        } finally {
          useSculptureStore.getState().setIsLoadingMesh(false);
        }
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [params, importProjectFromParsed, loadMeshArrayBuffer]);

  // Atajos de teclado seguros alineados con §1.3 y Corrección #5a + B6
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const isEditable =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        Boolean(el?.isContentEditable);
      if (isEditable) return;

      if (e.key === 'Escape' && isPreviewModalOpen) {
        e.preventDefault();
        closeSheetPreviewModal();
        return;
      }

      // Undo / Redo (Ctrl/Cmd + Z, Ctrl/Cmd + Y, Ctrl/Cmd + Shift + Z)
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) redoDiscs();
          else undoDiscs();
          return;
        }
        if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          redoDiscs();
          return;
        }
        return; // Ignorar cualquier otra combinación con Ctrl/Cmd
      }

      if (e.altKey) return;

      // Shift + 7 -> Vista Inferior (Abajo)
      if (
        e.shiftKey &&
        (e.code === 'Digit7' || e.key === '7' || e.key === '/')
      ) {
        e.preventDefault();
        setCameraPreset('bottom');
        return;
      }

      if (e.shiftKey) return;

      switch (e.key) {
        case 'm':
        case 'M':
          e.preventDefault();
          toggleWireframe();
          break;
        case 'v':
        case 'V':
          if (sliceResult || waffleResult) {
            e.preventDefault();
            setViewMode(viewMode === 'original' ? 'plates' : 'original');
          }
          break;
        case 'w':
        case 'W':
        case 'ArrowUp':
          e.preventDefault();
          if (build.techniqueId === 'waffle') {
            stepWafflePiece(1);
          } else {
            stepFloor(1);
          }
          break;
        case 's':
        case 'S':
        case 'ArrowDown':
          e.preventDefault();
          if (build.techniqueId === 'waffle') {
            stepWafflePiece(-1);
          } else {
            stepFloor(-1);
          }
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelectedDisc();
          break;
        case '7':
        case 't':
        case 'T':
          e.preventDefault();
          setCameraPreset('top');
          break;
        case 'b':
        case 'B':
          e.preventDefault();
          setCameraPreset('bottom');
          break;
        case '1':
        case 'f':
        case 'F':
          e.preventDefault();
          setCameraPreset('front');
          break;
        case '3':
        case 'l':
        case 'L':
          e.preventDefault();
          setCameraPreset('right');
          break;
        case '0':
        case 'p':
        case 'P':
          e.preventDefault();
          setCameraPreset('iso');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    stepFloor,
    stepWafflePiece,
    build.techniqueId,
    setCameraPreset,
    deleteSelectedDisc,
    undoDiscs,
    redoDiscs,
    closeSheetPreviewModal,
    isPreviewModalOpen,
    toggleWireframe,
    sliceResult,
    waffleResult,
    viewMode,
    setViewMode,
  ]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#09090B]">
      <Viewport3D />

      {/* Menú superior dinámico (Opción A): EmptyStateCard sin modelo vs ProjectPill + ViewToggles con modelo */}
      {meshGeometry ? (
        <>
          <ProjectPill />
          <ViewToggles />
        </>
      ) : (
        <EmptyStateCard />
      )}

      {build.techniqueId === 'waffle' ? (
        <WaffleNavigatorHUD />
      ) : (
        <FloorNavigatorHUD />
      )}
      {JointDock && <JointDock />}
      <RightInspector />
      <StatusBarPill />
      <SheetPreviewModal />

      {/* Overlay al arrastrar archivo sobre la ventana */}
      {isWindowDragging && (
        <div className="fixed inset-0 z-50 pointer-events-none bg-[#09090b]/85 backdrop-blur-md border-2 border-dashed border-[#2997ff] flex flex-col items-center justify-center gap-3">
          <div className="w-16 h-16 rounded-full bg-[#2997ff]/10 border border-[#2997ff]/30 flex items-center justify-center text-[#2997ff] animate-pulse">
            <Upload className="w-8 h-8" />
          </div>
          <p className="text-lg font-semibold text-white">
            Suelta el archivo aquí para abrirlo
          </p>
          <p className="text-xs text-[#8b919e] font-mono-tabular">
            .obj · .stl · .3mf · .ply · .json
          </p>
        </div>
      )}
    </main>
  );
}
