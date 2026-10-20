import { create } from 'zustand';
import * as THREE from 'three';
import { DEFAULT_PARAMS } from '../core/params';
import { DiscManager } from '../core/discs';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { generateLayouts } from '../core/layout';
import {
  checkParamsCompatibility,
  parseProjectJson,
  serializeProjectJson,
  type ParsedProjectData,
} from '../core/project';
import {
  clearAutosaveStorage,
  loadMeshBufferFromIndexedDB,
  loadProjectFromLocalStorage,
  saveMeshBufferToIndexedDB,
  saveProjectToLocalStorage,
  type AutosaveSessionSnapshot,
  type StoredMeshRecord,
} from '../core/autosave';
import { sliceMesh } from '../core/slicer';
import type {
  Axis,
  Disc,
  MeshMetadata,
  SculptureParams,
  SheetLayout,
  SliceResult,
  WorkerRequest,
  WorkerResponse,
} from '../types/sculpture';

export type CameraPreset = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export type ViewMode = 'original' | 'plates';

export interface PendingAutosaveSession {
  snapshot: AutosaveSessionSnapshot | null;
  meshRecord: StoredMeshRecord | null;
}

export interface SculptureState {
  // Parámetros y banderas
  params: SculptureParams;
  gapManuallyEdited: boolean;
  isResultDirty: boolean;

  // Malla y corte
  meshGeometry: THREE.BufferGeometry | null;
  meshMetadata: MeshMetadata | null;
  sliceResult: SliceResult | null;
  isSlicing: boolean;
  isLoadingMesh: boolean;
  lastSliceAxis: Axis | null;
  lastSliceDurationMs: number | null;

  // Navegación de pisos y vista
  viewMode: ViewMode;
  wireframe: boolean;
  showAllFloors: boolean;
  activeFloor: number; // Índice físico 0 .. params.plates - 1

  // Discos e interacción
  modeAddDiscs: boolean;
  discManager: DiscManager;
  discs: Disc[];
  selectedDiscId: number | null;
  canUndo: boolean;
  canRedo: boolean;

  // Cámara
  cameraPreset: CameraPreset;
  cameraPresetTrigger: number;

  // Modal de previsualización de hojas 2D
  sheetLayouts: SheetLayout[] | null;
  isPreviewModalOpen: boolean;

  // Sesión de autosave pendiente de confirmación (Corrección #5f)
  pendingAutosave: PendingAutosaveSession | null;

  // Mensajes de estado y errores
  statusMessage: string;
  errorMessage: string | null;

  // Acciones
  setParam: <K extends keyof SculptureParams>(key: K, value: SculptureParams[K]) => void;
  setIsLoadingMesh: (loading: boolean) => void;
  loadMeshArrayBuffer: (buffer: ArrayBuffer, fileName: string, autoSlice?: boolean) => Promise<void>;
  runSlice: () => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  toggleWireframe: () => void;
  setShowAllFloors: (showAll: boolean) => void;
  setActiveFloor: (floorIndex: number) => void;
  stepFloor: (delta: 1 | -1) => void;
  setCameraPreset: (preset: CameraPreset) => void;

  // Acciones de discos
  setModeAddDiscs: (enabled: boolean) => void;
  addDiscAtActiveFloor: (x: number, y: number) => void;
  commitDiscMove: (discId: number, startX: number, startY: number, finalX: number, finalY: number) => boolean;
  selectDisc: (discId: number | null) => void;
  updateSelectedDiscDiameter: (newDiameter: number) => void;
  deleteSelectedDisc: () => void;
  clearActiveFloorDiscs: () => void;
  clearAllDiscs: () => void;
  undoDiscs: () => void;
  redoDiscs: () => void;

  // Proyecto, autosave y exportación
  checkAutosaveOnStartup: () => Promise<void>;
  restoreAutosaveSession: () => Promise<void>;
  discardAutosaveSession: () => Promise<void>;
  exportProjectJsonString: () => string;
  importProjectFromParsed: (parsed: ParsedProjectData, forceAdapt?: boolean) => Promise<{ needsConfirmation: boolean }>;
  openSheetPreviewModal: () => void;
  closeSheetPreviewModal: () => void;
  clearError: () => void;
}

let workerInstance: Worker | null = null;
let currentMeshId = 0;
let latestJobId = 0;

function getOrCreateWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null;
  }
  if (!workerInstance) {
    try {
      workerInstance = new Worker(
        new URL('../worker/slicer.worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch {
      workerInstance = null;
    }
  }
  return workerInstance;
}

if (typeof window !== 'undefined') {
  getOrCreateWorker();
}

function getNextNonEmptyFloor(
  plates: SliceResult['plates'],
  fromFloor: number,
  delta: 1 | -1
): number {
  let idx = fromFloor + delta;
  while (idx >= 0 && idx < plates.length) {
    if (plates[idx] && plates[idx].length > 0) {
      return idx;
    }
    idx += delta;
  }
  return fromFloor;
}

function getFirstNonEmptyFloor(plates: SliceResult['plates']): number {
  for (let i = 0; i < plates.length; i++) {
    if (plates[i] && plates[i].length > 0) return i;
  }
  return 0;
}

export const useSculptureStore = create<SculptureState>((set, get) => {
  const manager = new DiscManager(DEFAULT_PARAMS.discDiameter);

  function syncDiscsState(statusMsg?: string): void {
    const state = get();
    const allDiscs = manager.getAllDiscs();
    const selectedExists =
      state.selectedDiscId !== null &&
      allDiscs.some((d) => d.id === state.selectedDiscId);

    set({
      discs: allDiscs,
      selectedDiscId: selectedExists ? state.selectedDiscId : null,
      canUndo: manager.canUndo(),
      canRedo: manager.canRedo(),
      ...(statusMsg ? { statusMessage: statusMsg } : {}),
    });

    saveProjectToLocalStorage(
      get().params,
      allDiscs,
      get().meshMetadata?.fileName ?? null
    );
  }

  return {
    params: { ...DEFAULT_PARAMS },
    gapManuallyEdited: false,
    isResultDirty: false,

    meshGeometry: null,
    meshMetadata: null,
    sliceResult: null,
    isSlicing: false,
    isLoadingMesh: false,
    lastSliceAxis: null,
    lastSliceDurationMs: null,

    viewMode: 'original',
    wireframe: false,
    showAllFloors: true,
    activeFloor: 0,

    modeAddDiscs: false,
    discManager: manager,
    discs: [],
    selectedDiscId: null,
    canUndo: false,
    canRedo: false,

    cameraPreset: 'iso',
    cameraPresetTrigger: 0,

    sheetLayouts: null,
    isPreviewModalOpen: false,

    pendingAutosave: null,

    statusMessage: 'Carga un modelo 3D (.obj, .stl, .3mf, .ply) para comenzar',
    errorMessage: null,

    setParam: (key, value) => {
      const state = get();
      const nextParams: SculptureParams = { ...state.params, [key]: value };
      let nextGapEdited = state.gapManuallyEdited;

      // Sincronización exacta de ui.py:265-272
      if (key === 'thickness' && !state.gapManuallyEdited) {
        nextParams.gap = value as number;
      } else if (key === 'gap') {
        nextGapEdited = true;
      } else if (key === 'discDiameter') {
        try {
          manager.setDefaultDiameter(value as number);
        } catch {
          // Validado al aplicar
        }
      }

      const geometricKeys: Array<keyof SculptureParams> = [
        'plates',
        'thickness',
        'gap',
        'axis',
      ];
      const marksDirty =
        state.sliceResult !== null && geometricKeys.includes(key);

      set({
        params: nextParams,
        gapManuallyEdited: nextGapEdited,
        isResultDirty: marksDirty ? true : state.isResultDirty,
      });

      saveProjectToLocalStorage(
        nextParams,
        get().discs,
        get().meshMetadata?.fileName ?? null
      );
    },

    setIsLoadingMesh: (loading) => set({ isLoadingMesh: loading }),

    loadMeshArrayBuffer: async (buffer, fileName, autoSlice = false) => {
      set({
        isLoadingMesh: true,
        statusMessage: `Cargando ${fileName}...`,
      });
      // Permitir que el ciclo de eventos de React dibuje el spinner antes del análisis de geometría
      await new Promise((resolve) => setTimeout(resolve, 30));

      try {
        const prevGeom = get().meshGeometry;
        const { geometry, metadata } = loadMeshFromBuffer(buffer, fileName);
        if (prevGeom) {
          prevGeom.dispose();
        }

        currentMeshId += 1;
        const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
        const clonedPositions = new Float32Array(posAttr.array);

        const worker = getOrCreateWorker();
        if (worker) {
          const msg: WorkerRequest = {
            type: 'SET_MESH',
            meshId: currentMeshId,
            positions: clonedPositions,
          };
          worker.postMessage(msg, [clonedPositions.buffer]);
        }

        manager.clearAll(false);
        void saveMeshBufferToIndexedDB(fileName, buffer);

        set({
          meshGeometry: geometry,
          meshMetadata: metadata,
          sliceResult: null,
          isResultDirty: false,
          activeFloor: 0,
          viewMode: 'original',
          modeAddDiscs: false,
          discs: [],
          selectedDiscId: null,
          canUndo: false,
          canRedo: false,
          errorMessage: null,
          statusMessage: `Modelo cargado: ${fileName} (${metadata.faceCount.toLocaleString()} caras)`,
          cameraPreset: 'iso',
          cameraPresetTrigger: get().cameraPresetTrigger + 1,
          isLoadingMesh: false,
        });

        if (autoSlice) {
          await get().runSlice();
        }
      } catch (err) {
        set({
          isLoadingMesh: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },

    runSlice: async () => {
      const state = get();
      if (!state.meshGeometry) {
        set({ errorMessage: 'Primero debes cargar un archivo de malla 3D.' });
        return;
      }

      const jobId = ++latestJobId;
      const meshId = currentMeshId;
      const paramsSnapshot = { ...state.params };
      const prevScaleFactor = state.sliceResult?.scaleFactor ?? null;
      const axisChanged =
        state.lastSliceAxis !== null &&
        state.lastSliceAxis !== paramsSnapshot.axis;

      set({
        isSlicing: true,
        errorMessage: null,
        statusMessage: 'Calculando planos de corte...',
      });

      const applySliceOutcome = (result: SliceResult, durationMs: number) => {
        if (jobId !== latestJobId || meshId !== currentMeshId) {
          return; // Resultado obsoleto descartado
        }

        let removedDiscs = 0;
        if (axisChanged) {
          removedDiscs = manager.getAllDiscs().length;
          manager.clearAll(true);
        } else {
          // Corrección #5c: reescalar (x, y) por newAutoScale / oldAutoScale antes de purgeInvalidDiscs
          if (prevScaleFactor !== null && prevScaleFactor > 0) {
            const scaleRatio = result.scaleFactor / prevScaleFactor;
            manager.rescalePositions(scaleRatio);
          }
          removedDiscs = manager.purgeInvalidDiscs(result.plates);
        }

        const firstValidFloor = getFirstNonEmptyFloor(result.plates);
        const currentFloor = get().activeFloor;
        const nextFloor =
          currentFloor < result.plates.length &&
          result.plates[currentFloor]?.length > 0
            ? currentFloor
            : firstValidFloor;

        const validPlatesCount = result.plates.filter((p) => p.length > 0).length;
        const orphanNotice =
          removedDiscs > 0
            ? ` (${removedDiscs} disco(s) fuera de contorno retirados)`
            : '';

        set({
          sliceResult: result,
          isSlicing: false,
          isResultDirty: false,
          lastSliceAxis: paramsSnapshot.axis,
          lastSliceDurationMs: durationMs,
          viewMode: 'plates',
          activeFloor: nextFloor,
        });

        syncDiscsState(
          `Corte completado: ${validPlatesCount}/${result.plates.length} placas válidas en ${durationMs.toFixed(0)} ms${orphanNotice}`
        );
      };

      const worker = getOrCreateWorker();
      if (worker) {
        await new Promise<void>((resolve) => {
          const handler = (ev: MessageEvent<WorkerResponse>) => {
            const data = ev.data;
            if (data.jobId !== jobId) return;
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            if (data.type === 'SLICE_SUCCESS') {
              applySliceOutcome(data.result, data.durationMs);
            } else {
              set({
                isSlicing: false,
                errorMessage: data.error,
                statusMessage: 'Error durante el corte',
              });
            }
            resolve();
          };
          const errorHandler = (err: ErrorEvent) => {
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            set({
              isSlicing: false,
              errorMessage: err.message || 'Error en el worker de corte',
              statusMessage: 'Error durante el corte',
            });
            resolve();
          };
          worker.addEventListener('message', handler);
          worker.addEventListener('error', errorHandler);
          const req: WorkerRequest = {
            type: 'SLICE',
            jobId,
            meshId,
            params: paramsSnapshot,
          };
          worker.postMessage(req);
        });
      } else {
        // Fallback síncrono (entorno de pruebas Vitest / jsdom)
        try {
          const t0 = performance.now();
          const posAttr = state.meshGeometry.getAttribute(
            'position'
          ) as THREE.BufferAttribute;
          const result = sliceMesh(
            new Float32Array(posAttr.array),
            paramsSnapshot
          );
          applySliceOutcome(result, performance.now() - t0);
        } catch (err) {
          set({
            isSlicing: false,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },

    setViewMode: (mode) => set({ viewMode: mode }),
    toggleWireframe: () => set((s) => ({ wireframe: !s.wireframe })),
    setShowAllFloors: (showAll) => set({ showAllFloors: showAll }),

    setActiveFloor: (floorIndex) => {
      const res = get().sliceResult;
      if (!res) return;
      const clamped = Math.max(0, Math.min(res.plates.length - 1, floorIndex));
      set({ activeFloor: clamped, selectedDiscId: null });
    },

    stepFloor: (delta) => {
      const { sliceResult, activeFloor } = get();
      if (!sliceResult) return;
      const next = getNextNonEmptyFloor(sliceResult.plates, activeFloor, delta);
      set({ activeFloor: next, selectedDiscId: null });
    },

    setCameraPreset: (preset) =>
      set((s) => ({
        cameraPreset: preset,
        cameraPresetTrigger: s.cameraPresetTrigger + 1,
      })),

    setModeAddDiscs: (enabled) => set({ modeAddDiscs: enabled }),

    addDiscAtActiveFloor: (x, y) => {
      const { sliceResult, activeFloor, params } = get();
      if (!sliceResult) return;
      try {
        const outcome = manager.addDisc(
          x,
          y,
          activeFloor,
          sliceResult.plates,
          params.discDiameter,
          true
        );
        set({ selectedDiscId: outcome.primary.id, errorMessage: null });
        const copyMsg = outcome.autoCopied
          ? ` + auto-copia en P${activeFloor + 1}-P${activeFloor + 2}`
          : '';
        syncDiscsState(
          `Disco #${outcome.primary.id} colocado en (${x.toFixed(1)}, ${y.toFixed(1)})${copyMsg}`
        );
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },

    commitDiscMove: (discId, startX, startY, finalX, finalY) => {
      const { sliceResult } = get();
      if (!sliceResult) return false;
      const movedDist = Math.hypot(finalX - startX, finalY - startY);
      if (movedDist < 1e-4) return false;
      const ok = manager.moveDisc(
        discId,
        finalX,
        finalY,
        sliceResult.plates,
        true
      );
      if (ok) {
        syncDiscsState(
          `Disco #${discId} movido a (${finalX.toFixed(1)}, ${finalY.toFixed(1)})`
        );
      }
      return ok;
    },

    selectDisc: (discId) => set({ selectedDiscId: discId }),

    updateSelectedDiscDiameter: (newDiameter) => {
      const { selectedDiscId, sliceResult } = get();
      if (selectedDiscId === null || !sliceResult) return;
      try {
        const ok = manager.setDiameter(
          selectedDiscId,
          newDiameter,
          sliceResult.plates
        );
        if (ok) {
          try {
            manager.setDefaultDiameter(newDiameter);
          } catch {
            // Ignorado si no es válido
          }
          set((s) => ({
            errorMessage: null,
            params: { ...s.params, discDiameter: newDiameter },
          }));
          syncDiscsState(
            `Diámetro de disco #${selectedDiscId} actualizado a Ø${newDiameter.toFixed(1)} mm`
          );
        }
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },

    deleteSelectedDisc: () => {
      const { selectedDiscId } = get();
      if (selectedDiscId === null) return;
      if (manager.removeDisc(selectedDiscId)) {
        set({ selectedDiscId: null });
        syncDiscsState(`Disco #${selectedDiscId} eliminado`);
      }
    },

    clearActiveFloorDiscs: () => {
      const { activeFloor } = get();
      const count = manager.clearGap(activeFloor);
      if (count > 0) {
        set({ selectedDiscId: null });
        syncDiscsState(
          `Se eliminaron ${count} disco(s) del piso P${activeFloor}-P${activeFloor + 1}`
        );
      }
    },

    clearAllDiscs: () => {
      manager.clearAll(true);
      set({ selectedDiscId: null });
      syncDiscsState('Todos los discos fueron eliminados');
    },

    undoDiscs: () => {
      if (manager.undo()) {
        syncDiscsState('Deshacer aplicado');
      }
    },

    redoDiscs: () => {
      if (manager.redo()) {
        syncDiscsState('Rehacer aplicado');
      }
    },

    checkAutosaveOnStartup: async () => {
      const snapshot = loadProjectFromLocalStorage();
      const meshRecord = await loadMeshBufferFromIndexedDB();
      if (snapshot || meshRecord) {
        set({
          pendingAutosave: { snapshot, meshRecord },
        });
      }
    },

    restoreAutosaveSession: async () => {
      const pending = get().pendingAutosave;
      if (!pending) return;
      set({ pendingAutosave: null });

      if (pending.meshRecord) {
        await get().loadMeshArrayBuffer(
          pending.meshRecord.buffer,
          pending.meshRecord.fileName,
          false
        );
      }
      if (pending.snapshot) {
        await get().importProjectFromParsed(
          {
            version: '1.0',
            params: pending.snapshot.params,
            discs: pending.snapshot.discs,
          },
          true
        );
      } else if (pending.meshRecord) {
        await get().runSlice();
      }
      set({ statusMessage: 'Sesión anterior restaurada correctamente' });
    },

    discardAutosaveSession: async () => {
      await clearAutosaveStorage();
      set({
        pendingAutosave: null,
        statusMessage: 'Sesión guardada descartada',
      });
    },

    exportProjectJsonString: () => {
      const { params, discs } = get();
      return serializeProjectJson(params, discs);
    },

    importProjectFromParsed: async (parsed, forceAdapt = false) => {
      const state = get();
      const mergedParams: SculptureParams = {
        ...state.params,
        plates: parsed.params.plates,
        thickness: parsed.params.thickness,
        gap: parsed.params.gap,
        axis: parsed.params.axis,
      };
      const compatible = checkParamsCompatibility(mergedParams, state.params);
      if (!compatible && !forceAdapt && state.sliceResult !== null) {
        return { needsConfirmation: true };
      }

      set({
        params: mergedParams,
        gapManuallyEdited:
          Math.abs(mergedParams.gap - mergedParams.thickness) > 0.01,
      });

      if (state.meshGeometry && (!compatible || state.sliceResult === null)) {
        await get().runSlice();
      }

      manager.loadDiscsFromProject(parsed.discs);
      const currentSlice = get().sliceResult;
      if (currentSlice) {
        manager.purgeInvalidDiscs(currentSlice.plates);
      }
      syncDiscsState('Proyecto cargado correctamente');
      return { needsConfirmation: false };
    },

    openSheetPreviewModal: () => {
      const { sliceResult, discs, params } = get();
      if (!sliceResult) {
        set({ errorMessage: 'Primero debes rebanar el modelo 3D.' });
        return;
      }
      try {
        const layouts = generateLayouts(sliceResult, discs, params);
        set({
          sheetLayouts: layouts,
          isPreviewModalOpen: true,
          errorMessage: null,
        });
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },

    closeSheetPreviewModal: () => set({ isPreviewModalOpen: false }),
    clearError: () => set({ errorMessage: null }),
  };
});

export { parseProjectJson };
