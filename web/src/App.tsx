import { useEffect } from 'react';
import { useSculptureStore } from './store/useSculptureStore';
import { Viewport3D } from './components/viewport/Viewport3D';
import { TopProjectBar } from './components/hud/TopProjectBar';
import { CameraToolbar } from './components/hud/CameraToolbar';
import { FloorNavigatorHUD } from './components/hud/FloorNavigatorHUD';
import { WaffleNavigatorHUD } from './components/hud/WaffleNavigatorHUD';
import { JOINT_UI } from './components/joints/registry';
import { RightInspector } from './components/hud/RightInspector';
import { StatusBarPill } from './components/hud/StatusBarPill';
import { SheetPreviewModal } from './components/modal/SheetPreviewModal';

export default function App() {
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

  // Corrección #5f: Detectar sesión guardada para mostrar banner "Restaurar sesión / Descartar".
  // Prohibido sobrescribir el estado sin preguntar al usuario.
  useEffect(() => {
    void checkAutosaveOnStartup();
  }, [checkAutosaveOnStartup]);

  // Advertencia beforeunload si hay malla o contenido de unión en sesión (CH-12)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useSculptureStore.getState();
      const hasJointContent = state.build.jointId === 'discs' && state.discs.length > 0;
      if (state.meshGeometry !== null || hasJointContent) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

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
      if (e.shiftKey && (e.code === 'Digit7' || e.key === '7' || e.key === '/')) {
        e.preventDefault();
        setCameraPreset('bottom');
        return;
      }

      if (e.shiftKey) return;

      switch (e.key) {
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
  ]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#09090B]">
      <Viewport3D />
      <TopProjectBar />
      <CameraToolbar />
      {build.techniqueId === 'waffle' ? (
        <WaffleNavigatorHUD />
      ) : (
        <FloorNavigatorHUD />
      )}
      {JointDock && <JointDock />}
      <RightInspector />
      <StatusBarPill />
      <SheetPreviewModal />
    </main>
  );
}
