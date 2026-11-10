import { useRef, type ChangeEvent } from 'react';
import {
  INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE,
  parseProjectJson,
} from '../../core/project';
import { useSculptureStore } from '../../store/useSculptureStore';

export function useProjectFileActions() {
  const meshInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);

  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
  const meshGeometry = useSculptureStore((s) => s.meshGeometry);
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

  const loadMeshFromFile = async (file: File) => {
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
  };

  const loadProjectFromFile = async (file: File) => {
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
    }
  };

  const handleMeshFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await loadMeshFromFile(file);
    } finally {
      e.target.value = '';
    }
  };

  const handleProjectFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await loadProjectFromFile(file);
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

  const triggerOpenMeshDialog = () => {
    meshInputRef.current?.click();
  };

  const triggerOpenProjectDialog = () => {
    projectInputRef.current?.click();
  };

  return {
    meshInputRef,
    projectInputRef,
    meshMetadata,
    meshGeometry,
    params,
    pendingAutosave,
    isLoadingMesh,
    isSlicing,
    loadMeshFromFile,
    loadProjectFromFile,
    handleMeshFileChange,
    handleProjectFileChange,
    handleSaveProject,
    triggerOpenMeshDialog,
    triggerOpenProjectDialog,
    restoreAutosaveSession,
    discardAutosaveSession,
  };
}
