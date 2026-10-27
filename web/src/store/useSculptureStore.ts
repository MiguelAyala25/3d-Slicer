import { create } from 'zustand';
import * as THREE from 'three';
import { DEFAULT_PARAMS } from '../core/params';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { generateSheetLayouts, generateWaffleSheetLayouts } from '../core/layout';
import { generateDiscsLayouts } from '../core/joints/discs/discLayout';
import {
  INITIAL_BUILD,
  type BuildConfig,
  type JointId,
  type TechniqueId,
} from '../core/build/types';
import { getJoint } from '../core/build/registry';
import { validateBuildParams } from '../core/build/validateBuild';
import { ValidationError } from '../core/validator';
import { PARAM_BOUNDS } from '../core/params';
import {
  computeAdaptiveWafflePitch,
  computeInitialWaffleScale,
  horizontalExtentsForUpAxis,
  platesForTargetDimension,
  scaleForTargetDimension,
  waffleMaxFit,
  type ModelDimension,
  type ModelExtents,
  type SizeIntent,
} from '../core/sizing';
import { createDiscsSlice, type DiscsSlice } from './discsSlice';
import {
  INITIAL_WAFFLE_STATE,
  type WaffleActions,
  type WaffleState,
} from './waffleSlice';
import { sliceWaffleMesh } from '../core/waffle/waffleSlicer';
import { generateSlotCalibrationSheet } from '../core/waffle/calibrationSheet';
import type { WaffleParams, WaffleSliceResult, WaffleSection } from '../core/waffle/types';
import {
  checkParamsCompatibility,
  serializeProject,
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
  build: BuildConfig;
  gapManuallyEdited: boolean;
  isResultDirty: boolean;
  modelExtents: ModelExtents | null;
  sizeIntent: SizeIntent;
  sizeCommitSeq: number;

  // Malla y corte
  meshGeometry: THREE.BufferGeometry | null;
  meshMetadata: MeshMetadata | null;
  meshFileName: string | null;
  isLoadingMesh: boolean;
  isSlicing: boolean;
  sliceResult: SliceResult | null;
  lastSliceAxis: Axis | null;
  lastSliceDurationMs: number | null;

  // Navegación de pisos y vista
  viewMode: ViewMode;
  wireframe: boolean;
  showAllFloors: boolean;
  activeFloor: number; // Índice físico 0 .. params.plates - 1

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
}

export interface SculptureActions {
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
  setPlatesFromDimension: (dim: ModelDimension, mm: number) => void;
  setTechnique: (id: TechniqueId, opts?: { confirmed?: boolean }) => { needsConfirmation: boolean; discCount: number };
  setJoint: (id: JointId, opts?: { confirmed?: boolean }) => { needsConfirmation: boolean; discCount: number };

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

export type SculptureStore = SculptureState & SculptureActions & DiscsSlice & WaffleState & WaffleActions;

let workerInstance: Worker | null = null;
let currentMeshId = 0;
let latestJobId = 0;

let autoSliceTimer: ReturnType<typeof setTimeout> | null = null;
let isWorkerExecuting = false;
let pendingWorkerJob: {
  jobId: number;
  meshId: number;
  isWaffle: boolean;
  paramsSnapshot: SculptureParams;
  waffleParamsSnapshot: WaffleParams;
  resolve: () => void;
} | null = null;

function clearAutoSliceTimer(): void {
  if (autoSliceTimer) {
    clearTimeout(autoSliceTimer);
    autoSliceTimer = null;
  }
}

function scheduleAutoSlice(action: () => void, delayMs = 350): void {
  clearAutoSliceTimer();
  if (
    typeof window === 'undefined' ||
    delayMs <= 0 ||
    (typeof process !== 'undefined' &&
      (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true'))
  ) {
    action();
    return;
  }
  autoSliceTimer = setTimeout(() => {
    autoSliceTimer = null;
    action();
  }, delayMs);
}

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
  current: number,
  delta: 1 | -1
): number {
  const n = plates.length;
  if (n === 0) return 0;
  let idx = current + delta;
  while (idx >= 0 && idx < n) {
    if (plates[idx] && plates[idx].length > 0) {
      return idx;
    }
    idx += delta;
  }
  return current;
}

export const useSculptureStore = create<SculptureStore>()((set, get, api) => {
  let lastSlicedAxis: Axis | null = null;
  const discsSlice = createDiscsSlice(set, get, api);

  return {
    ...discsSlice,
    ...INITIAL_WAFFLE_STATE,

    params: { ...DEFAULT_PARAMS },
    build: { ...INITIAL_BUILD },
    gapManuallyEdited: false,
    isResultDirty: false,
    modelExtents: null,
    sizeIntent: { kind: 'plates' },
    sizeCommitSeq: 0,

    meshGeometry: null,
    meshMetadata: null,
    meshFileName: null,
    sliceResult: null,
    isSlicing: false,
    isLoadingMesh: false,
    lastSliceAxis: null,
    lastSliceDurationMs: null,

    viewMode: 'original',
    wireframe: false,
    showAllFloors: true,
    activeFloor: 0,

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

      // Sincronización exacta de ui.py:265-272 (solo con unión 'discs', CH-6)
      if (key === 'thickness' && !state.gapManuallyEdited && state.build.jointId === 'discs') {
        nextParams.gap = value as number;
      } else if (key === 'gap') {
        nextGapEdited = true;
      } else if (key === 'discDiameter') {
        try {
          state.discManager.setDefaultDiameter(value as number);
        } catch {
          // Ignorado si no es válido aún
        }
      }

      let nextSizeIntent = state.sizeIntent;
      let nextStatusMessage = state.statusMessage;

      if (key === 'plates') {
        nextSizeIntent = { kind: 'plates' };
      } else if (
        (key === 'thickness' || key === 'gap' || key === 'axis') &&
        state.sizeIntent.kind === 'size' &&
        state.modelExtents !== null
      ) {
        const outcome = platesForTargetDimension(
          state.modelExtents,
          nextParams.axis,
          state.sizeIntent.dim,
          state.sizeIntent.targetMm,
          nextParams.thickness,
          nextParams.gap
        );
        nextParams.plates = outcome.plates;
        if (outcome.clamped === 'min') {
          nextStatusMessage = 'Límite de placas alcanzado (2)';
        } else if (outcome.clamped === 'max') {
          nextStatusMessage = 'Límite de placas alcanzado (200)';
        }
      }

      set({
        params: nextParams,
        gapManuallyEdited: nextGapEdited,
        sizeIntent: nextSizeIntent,
        statusMessage: nextStatusMessage,
        isResultDirty: state.sliceResult !== null,
        errorMessage: null,
      });

      // Autosave automático si hay malla cargada
      if (state.meshGeometry && state.meshFileName) {
        saveProjectToLocalStorage(
          get().params,
          get().discs,
          state.meshFileName,
          get().build,
          get().waffleParams
        );
      }

      if (key === 'thickness' && !get().wafflePitchManuallyEdited) {
        set((s) => ({
          waffleParams: {
            ...s.waffleParams,
            pitch: Number((4 * Number(value)).toFixed(2)),
          },
        }));
      }

      // Auto-slice si está en técnica waffle
      if (
        state.meshGeometry &&
        get().build.techniqueId === 'waffle' &&
        (key === 'thickness' || key === 'kerf')
      ) {
        scheduleAutoSlice(() => void get().runSlice(), 350);
      }

      // Auto-slice inteligente si el cambio afecta al corte
      const sliceAffectingKeys = ['plates', 'thickness', 'gap', 'axis'];
      if (
        sliceAffectingKeys.includes(key as string) &&
        state.meshGeometry &&
        get().build.techniqueId === 'stacked' &&
        (get().build.jointId === 'none' || get().build.jointId === 'discs')
      ) {
        if (key === 'axis') {
          // Cambio discreto de eje: ejecutar inmediatamente sin debounce
          clearAutoSliceTimer();
          void get().runSlice();
        } else {
          // Parámetros continuos (placas, grosor, separación): debounce de 350ms
          // para no recalcular cortes intermedios innecesarios al usar las flechitas o escribir
          scheduleAutoSlice(() => void get().runSlice(), 350);
        }
      }
    },

    setIsLoadingMesh: (loading) => set({ isLoadingMesh: loading }),

    loadMeshArrayBuffer: async (buffer, fileName, autoSlice = true) => {
      clearAutoSliceTimer();
      set({ isLoadingMesh: true, errorMessage: null, statusMessage: `Cargando ${fileName}...` });
      try {
        const { geometry, metadata } = loadMeshFromBuffer(buffer, fileName);
        currentMeshId += 1;
        const meshId = currentMeshId;

        get().resetDiscs();

        if (!geometry.boundingBox) {
          geometry.computeBoundingBox();
        }
        const bbox = geometry.boundingBox!;
        const extents: ModelExtents = {
          x: bbox.max.x - bbox.min.x,
          y: bbox.max.y - bbox.min.y,
          z: bbox.max.z - bbox.min.z,
        };

        const initialSizeIntent: SizeIntent = { kind: 'plates' };
        const initialWaffleScale = computeInitialWaffleScale(
          extents,
          get().params,
          get().waffleParams.upAxis,
          get().waffleParams.pitch,
          initialSizeIntent
        );
        const initialWafflePitch = get().wafflePitchManuallyEdited
          ? get().waffleParams.pitch
          : computeAdaptiveWafflePitch(
              extents,
              initialWaffleScale,
              get().waffleParams.upAxis,
              get().params.thickness
            );

        set({
          meshGeometry: geometry,
          meshMetadata: metadata,
          meshFileName: fileName,
          modelExtents: extents,
          sizeIntent: initialSizeIntent,
          waffleParams: {
            ...get().waffleParams,
            targetScale: initialWaffleScale,
            pitch: initialWafflePitch,
          },
          sliceResult: null,
          waffleResult: null,
          selectedWafflePieceId: null,
          isResultDirty: false,
          activeFloor: 0,
          isLoadingMesh: false,
          statusMessage: `Modelo '${fileName}' cargado (${metadata.vertexCount} vértices, ${metadata.faceCount} triángulos)`,
        });

        const worker = getOrCreateWorker();
        if (worker) {
          const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
          const transferArray = new Float32Array(posAttr.array);
          const req: WorkerRequest = {
            type: 'SET_MESH',
            meshId,
            positions: transferArray,
          };
          worker.postMessage(req, [transferArray.buffer]);
        }

        saveMeshBufferToIndexedDB(fileName, buffer).catch(() => {
          // Fallback silencioso si IndexedDB falla
        });

        if (
          autoSlice &&
          ((get().build.techniqueId === 'stacked' &&
            (get().build.jointId === 'none' || get().build.jointId === 'discs')) ||
            get().build.techniqueId === 'waffle')
        ) {
          await get().runSlice();
        }
      } catch (err) {
        set({
          isLoadingMesh: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          statusMessage: 'Error al cargar el modelo 3D',
        });
      }
    },

    runSlice: async () => {
      clearAutoSliceTimer();
      const state = get();
      if (!state.meshGeometry) return;
      if (!state.build.techniqueId || !state.build.jointId) return;

      const isWaffle = state.build.techniqueId === 'waffle';
      const paramsSnapshot = { ...state.params };
      const waffleParamsSnapshot = { ...state.waffleParams };

      try {
        validateBuildParams(paramsSnapshot, state.build, waffleParamsSnapshot);
      } catch (err) {
        set({
          isSlicing: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          statusMessage: isWaffle ? 'Error de validación de Waffle' : 'Error de validación de corte',
        });
        return;
      }

      latestJobId += 1;
      const jobId = latestJobId;
      const meshId = currentMeshId;

      set({
        isSlicing: true,
        errorMessage: null,
        statusMessage: isWaffle ? 'Rebanando Waffle...' : 'Rebanando modelo...',
      });

      const applySliceOutcome = (result: SliceResult, durationMs: number) => {
        const prevScaleFactor = state.sliceResult?.scaleFactor ?? 0;
        const axisChanged = state.sliceResult !== null && lastSlicedAxis !== state.params.axis;
        lastSlicedAxis = state.params.axis;

        if (state.build.jointId === 'discs') {
          get().onSliceApplied({ axisChanged, prevScaleFactor, result });
        }

        const firstFloor = getNextNonEmptyFloor(result.plates, 0, 1);

        set((s) => ({
          sliceResult: result,
          lastSliceAxis: paramsSnapshot.axis,
          lastSliceDurationMs: Math.round(durationMs),
          isSlicing: false,
          isResultDirty: false,
          viewMode: 'plates',
          activeFloor: Math.min(s.activeFloor, result.plates.length - 1) >= 0
            ? Math.min(s.activeFloor, result.plates.length - 1)
            : firstFloor,
          statusMessage: `Corte completado en ${Math.round(durationMs)} ms (${result.plates.length} placas)`,
        }));

        if (state.meshFileName) {
          saveProjectToLocalStorage(
            get().params,
            get().discs,
            state.meshFileName,
            get().build,
            get().waffleParams
          );
        }
      };

      const applyWaffleSliceOutcome = (result: WaffleSliceResult, durationMs: number) => {
        const totalPieces = result.p1Sections.length + result.p2Sections.length;
        set((s) => {
          const allPieces = [...result.p1Sections, ...result.p2Sections];
          const stillSelected = allPieces.some((p) => p.id === s.selectedWafflePieceId);
          const nextSelected = stillSelected
            ? s.selectedWafflePieceId
            : (result.p1Sections[0]?.id ?? result.p2Sections[0]?.id ?? null);

          return {
            waffleResult: result,
            isSlicing: false,
            isResultDirty: false,
            viewMode: 'plates',
            selectedWafflePieceId: nextSelected,
            statusMessage: `Corte Waffle completado en ${Math.round(durationMs)} ms (${totalPieces} piezas: ${result.p1Sections.length} X, ${result.p2Sections.length} Y)`,
          };
        });

        if (state.meshFileName) {
          saveProjectToLocalStorage(
            get().params,
            get().discs,
            state.meshFileName,
            get().build,
            get().waffleParams
          );
        }
      };

      const worker = getOrCreateWorker();
      if (worker) {
        await new Promise<void>((resolve) => {
          const executeJob = (
            targetJobId: number,
            targetMeshId: number,
            isWaffleJob: boolean,
            targetParams: SculptureParams,
            targetWaffleParams: WaffleParams,
            onJobDone: () => void
          ) => {
            isWorkerExecuting = true;

            const onMessage = (evt: MessageEvent<WorkerResponse>) => {
              const msg = evt.data;
              if (msg.jobId !== targetJobId) return;
              worker.removeEventListener('message', onMessage);
              worker.removeEventListener('error', onError);

              if (msg.type === 'SLICE_SUCCESS') {
                if (targetJobId === latestJobId) {
                  applySliceOutcome(msg.result, msg.durationMs);
                }
              } else if (msg.type === 'SLICE_WAFFLE_SUCCESS') {
                if (targetJobId === latestJobId) {
                  applyWaffleSliceOutcome(msg.result, msg.durationMs);
                }
              } else if (msg.type === 'SLICE_ERROR') {
                if (targetJobId === latestJobId) {
                  set({
                    isSlicing: false,
                    errorMessage: msg.error,
                    statusMessage: 'Error durante el corte',
                  });
                }
              }

              onJobDone();

              if (pendingWorkerJob) {
                const next = pendingWorkerJob;
                pendingWorkerJob = null;
                executeJob(
                  next.jobId,
                  next.meshId,
                  next.isWaffle,
                  next.paramsSnapshot,
                  next.waffleParamsSnapshot,
                  next.resolve
                );
              } else {
                isWorkerExecuting = false;
              }
            };

            const onError = (err: ErrorEvent) => {
              worker.removeEventListener('message', onMessage);
              worker.removeEventListener('error', onError);
              if (targetJobId === latestJobId) {
                set({
                  isSlicing: false,
                  errorMessage: err.message || 'Error en el worker de corte',
                  statusMessage: 'Error durante el corte',
                });
              }
              onJobDone();

              if (pendingWorkerJob) {
                const next = pendingWorkerJob;
                pendingWorkerJob = null;
                executeJob(
                  next.jobId,
                  next.meshId,
                  next.isWaffle,
                  next.paramsSnapshot,
                  next.waffleParamsSnapshot,
                  next.resolve
                );
              } else {
                isWorkerExecuting = false;
              }
            };

            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);

            if (isWaffleJob) {
              const req: WorkerRequest = {
                type: 'SLICE_WAFFLE',
                jobId: targetJobId,
                meshId: targetMeshId,
                coreParams: targetParams,
                waffleParams: targetWaffleParams,
              };
              worker.postMessage(req);
            } else {
              const req: WorkerRequest = {
                type: 'SLICE',
                jobId: targetJobId,
                meshId: targetMeshId,
                params: targetParams,
              };
              worker.postMessage(req);
            }
          };

          if (isWorkerExecuting) {
            // El worker ya está procesando un corte:
            // Si había un trabajo anterior en cola que no ha empezado, resolverlo
            if (pendingWorkerJob) {
              pendingWorkerJob.resolve();
            }
            pendingWorkerJob = {
              jobId,
              meshId,
              isWaffle,
              paramsSnapshot,
              waffleParamsSnapshot,
              resolve,
            };
          } else {
            executeJob(
              jobId,
              meshId,
              isWaffle,
              paramsSnapshot,
              waffleParamsSnapshot,
              resolve
            );
          }
        });
      } else {
        // Fallback síncrono (entorno de pruebas Vitest / jsdom)
        try {
          const t0 = performance.now();
          const posAttr = state.meshGeometry.getAttribute(
            'position'
          ) as THREE.BufferAttribute;
          if (isWaffle) {
            const result = sliceWaffleMesh(
              new Float32Array(posAttr.array),
              paramsSnapshot,
              waffleParamsSnapshot
            );
            applyWaffleSliceOutcome(result, performance.now() - t0);
          } else {
            const result = sliceMesh(
              new Float32Array(posAttr.array),
              paramsSnapshot
            );
            applySliceOutcome(result, performance.now() - t0);
          }
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

    setPlatesFromDimension: (dim, mm) => {
      if (!Number.isFinite(mm) || mm <= 0) return;
      const state = get();
      if (!state.modelExtents) return;
      const outcome = platesForTargetDimension(
        state.modelExtents,
        state.params.axis,
        dim,
        mm,
        state.params.thickness,
        state.params.gap
      );
      const statusMessage =
        outcome.clamped === 'min'
          ? 'Límite de placas alcanzado (2)'
          : outcome.clamped === 'max'
          ? 'Límite de placas alcanzado (200)'
          : state.statusMessage;

      const nextWaffleScale = scaleForTargetDimension(state.modelExtents, dim, mm);
      set({
        params: { ...state.params, plates: outcome.plates },
        waffleParams: { ...state.waffleParams, targetScale: nextWaffleScale },
        sizeIntent: { kind: 'size', dim, targetMm: mm },
        sizeCommitSeq: state.sizeCommitSeq + 1,
        isResultDirty: state.sliceResult !== null,
        statusMessage,
      });

      if (state.meshGeometry && state.meshFileName) {
        saveProjectToLocalStorage(
          get().params,
          get().discs,
          state.meshFileName,
          get().build,
          get().waffleParams
        );
      }

      if (
        state.meshGeometry &&
        get().build.techniqueId === 'stacked' &&
        (get().build.jointId === 'none' || get().build.jointId === 'discs')
      ) {
        scheduleAutoSlice(() => void get().runSlice(), 350);
      }
    },

    setTechnique: (id, opts) => {
      clearAutoSliceTimer();
      if (id !== 'stacked' && id !== 'waffle') {
        throw new ValidationError(`Técnica desconocida: '${id}'.`);
      }
      const currentTechniqueId = get().build.techniqueId;
      const currentJointId = get().build.jointId;
      if (id === currentTechniqueId) {
        return { needsConfirmation: false, discCount: 0 };
      }

      const discs = get().discs;
      if (currentTechniqueId === 'stacked' && currentJointId === 'discs' && discs.length > 0 && !opts?.confirmed) {
        return { needsConfirmation: true, discCount: discs.length };
      }

      if (id === 'waffle') {
        if (currentJointId === 'discs') {
          get().discManager.loadDiscsFromProject([]);
          set({
            selectedDiscId: null,
            modeAddDiscs: false,
            discs: [],
            canUndo: false,
            canRedo: false,
          });
        }

        set((s) => {
          const nextScale = s.modelExtents
            ? computeInitialWaffleScale(
                s.modelExtents,
                s.params,
                s.waffleParams.upAxis,
                s.waffleParams.pitch,
                s.sizeIntent
              )
            : s.waffleParams.targetScale;

          const nextPitch = s.wafflePitchManuallyEdited
            ? s.waffleParams.pitch
            : computeAdaptiveWafflePitch(
                s.modelExtents,
                nextScale,
                s.waffleParams.upAxis,
                s.params.thickness
              );

          return {
            build: { ...s.build, techniqueId: 'waffle', jointId: 'slots' },
            waffleParams: {
              ...s.waffleParams,
              targetScale: nextScale,
              pitch: nextPitch,
            },
            isResultDirty: s.waffleResult !== null,
          };
        });

        if (get().meshGeometry && get().meshFileName) {
          saveProjectToLocalStorage(
            get().params,
            get().discs,
            get().meshFileName,
            get().build,
            get().waffleParams
          );
        }

        if (get().meshGeometry) {
          void get().runSlice();
        }
      } else if (id === 'stacked') {
        set((s) => {
          const nextJointId =
            s.build.jointId && s.build.jointId !== 'slots'
              ? s.build.jointId
              : '';
          return {
            build: { ...s.build, techniqueId: 'stacked', jointId: nextJointId },
            isResultDirty: s.sliceResult !== null,
          };
        });

        if (get().meshGeometry && get().meshFileName) {
          saveProjectToLocalStorage(
            get().params,
            get().discs,
            get().meshFileName,
            get().build,
            get().waffleParams
          );
        }

        if (get().meshGeometry) {
          void get().runSlice();
        }
      }

      return { needsConfirmation: false, discCount: 0 };
    },

    setJoint: (id, opts) => {
      clearAutoSliceTimer();
      const joint = getJoint(id);
      if (!joint.available) {
        throw new ValidationError(`La unión «${joint.label}» aún no está disponible.`);
      }
      if (id === 'slots') {
        throw new ValidationError('La unión «Encaje por ranuras» es exclusiva de la técnica «Waffle».');
      }
      if (get().build.techniqueId === 'waffle') {
        throw new ValidationError('La técnica «Waffle» solo admite la unión «Encaje por ranuras».');
      }
      const currentJointId = get().build.jointId;
      if (id === currentJointId) {
        return { needsConfirmation: false, discCount: 0 };
      }
      const discs = get().discs;
      if (currentJointId === 'discs' && discs.length > 0 && !opts?.confirmed) {
        return { needsConfirmation: true, discCount: discs.length };
      }

      if (currentJointId === 'discs') {
        get().discManager.loadDiscsFromProject([]);
        set({
          selectedDiscId: null,
          modeAddDiscs: false,
          discs: [],
          canUndo: false,
          canRedo: false,
          discGapMemory: get().params.gap,
          discGapManuallyEditedMemory: get().gapManuallyEdited,
        });
      }

      if (id === 'none') {
        const nextGap = 0;
        let nextPlates = get().params.plates;
        let nextStatusMessage = get().statusMessage;
        if (get().sizeIntent.kind === 'size' && get().modelExtents !== null) {
          const intent = get().sizeIntent as { kind: 'size'; dim: ModelDimension; targetMm: number };
          const outcome = platesForTargetDimension(
            get().modelExtents!,
            get().params.axis,
            intent.dim,
            intent.targetMm,
            get().params.thickness,
            nextGap
          );
          nextPlates = outcome.plates;
          if (outcome.clamped === 'min') {
            nextStatusMessage = 'Límite de placas alcanzado (2)';
          } else if (outcome.clamped === 'max') {
            nextStatusMessage = 'Límite de placas alcanzado (200)';
          }
        }
        set((s) => ({
          build: { ...s.build, jointId: id },
          params: { ...s.params, gap: nextGap, plates: nextPlates },
          statusMessage: nextStatusMessage,
          isResultDirty: s.sliceResult !== null,
        }));
      } else if (id === 'discs') {
        const memory = get().discGapMemory;
        const memoryEdited = get().discGapManuallyEditedMemory;
        const nextGap =
          memory !== null && memory >= PARAM_BOUNDS.gap.min
            ? memory
            : Math.max(PARAM_BOUNDS.gap.min, get().params.thickness);
        const nextGapEdited = memory !== null ? memoryEdited : false;
        let nextPlates = get().params.plates;
        let nextStatusMessage = get().statusMessage;
        if (get().sizeIntent.kind === 'size' && get().modelExtents !== null) {
          const intent = get().sizeIntent as { kind: 'size'; dim: ModelDimension; targetMm: number };
          const outcome = platesForTargetDimension(
            get().modelExtents!,
            get().params.axis,
            intent.dim,
            intent.targetMm,
            get().params.thickness,
            nextGap
          );
          nextPlates = outcome.plates;
          if (outcome.clamped === 'min') {
            nextStatusMessage = 'Límite de placas alcanzado (2)';
          } else if (outcome.clamped === 'max') {
            nextStatusMessage = 'Límite de placas alcanzado (200)';
          }
        }
        set((s) => ({
          build: { ...s.build, jointId: id },
          params: { ...s.params, gap: nextGap, plates: nextPlates },
          gapManuallyEdited: nextGapEdited,
          statusMessage: nextStatusMessage,
          isResultDirty: s.sliceResult !== null,
        }));
      }

      if (get().meshGeometry && get().meshFileName) {
        saveProjectToLocalStorage(get().params, get().discs, get().meshFileName, get().build);
      }

      if (
        get().meshGeometry &&
        get().build.techniqueId === 'stacked' &&
        (get().build.jointId === 'none' || get().build.jointId === 'discs')
      ) {
        void get().runSlice();
      }

      return { needsConfirmation: false, discCount: 0 };
    },

    checkAutosaveOnStartup: async () => {
      try {
        const envelope = loadProjectFromLocalStorage();
        if (!envelope) return;
        const meshRecord = await loadMeshBufferFromIndexedDB();
        if (meshRecord && meshRecord.fileName === envelope.meshFileName) {
          set({
            pendingAutosave: {
              snapshot: envelope,
              meshRecord,
            },
          });
        }
      } catch {
        // Ignorado si localStorage o IndexedDB fallan
      }
    },

    restoreAutosaveSession: async () => {
      const { pendingAutosave } = get();
      if (!pendingAutosave || !pendingAutosave.snapshot) return;

      const { snapshot, meshRecord } = pendingAutosave;
      set({ pendingAutosave: null });

      try {
        set({ params: { ...snapshot.params }, gapManuallyEdited: true });
        if (meshRecord) {
          await get().loadMeshArrayBuffer(
            meshRecord.buffer,
            meshRecord.fileName,
            false
          );
        }
        let healedWaffleParams = snapshot.waffleParams;
        const loadedExtents = get().modelExtents;
        if (healedWaffleParams && loadedExtents) {
          const { h1, h2 } = horizontalExtentsForUpAxis(
            loadedExtents,
            healedWaffleParams.upAxis
          );
          const minHorizScaled = Math.min(h1, h2) * healedWaffleParams.targetScale;
          if (
            Math.abs(healedWaffleParams.targetScale - 1.0) < 1e-6 &&
            minHorizScaled < 2 * healedWaffleParams.pitch
          ) {
            const healedScale = computeInitialWaffleScale(
              loadedExtents,
              snapshot.params,
              healedWaffleParams.upAxis,
              healedWaffleParams.pitch,
              { kind: 'plates' }
            );
            const healedPitch = computeAdaptiveWafflePitch(
              loadedExtents,
              healedScale,
              healedWaffleParams.upAxis,
              snapshot.params.thickness
            );
            healedWaffleParams = {
              ...healedWaffleParams,
              targetScale: healedScale,
              pitch: healedPitch,
            };
          }
        }
        await get().importProjectFromParsed(
          {
            version:
              snapshot.build.jointId === 'none' || snapshot.build.techniqueId === 'waffle'
                ? '2.0'
                : '1.0',
            params: snapshot.params,
            discs: snapshot.discs,
            build: snapshot.build,
            waffleParams: healedWaffleParams,
          },
          true
        );
        set({ statusMessage: 'Sesión anterior restaurada con éxito' });
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
          statusMessage: 'Error al restaurar la sesión anterior',
        });
      }
    },

    discardAutosaveSession: async () => {
      set({ pendingAutosave: null });
      try {
        clearAutosaveStorage();
      } catch {
        // Ignorado
      }
    },

    exportProjectJsonString: () => {
      const { params, discs, build, waffleParams } = get();
      return serializeProject(params, build, discs, waffleParams);
    },

    importProjectFromParsed: async (parsed, forceAdapt = false) => {
      const state = get();
      const mergedParams: SculptureParams = {
        ...state.params,
        ...parsed.params,
      };
      const compatible = checkParamsCompatibility(
        mergedParams,
        state.params,
        parsed.build,
        state.build,
        parsed.waffleParams,
        state.waffleParams,
        mergedParams,
        state.params
      );
      const isResultNull =
        parsed.build.techniqueId === 'waffle'
          ? state.waffleResult === null
          : state.sliceResult === null;

      if (!compatible && !forceAdapt && !isResultNull) {
        return { needsConfirmation: true };
      }

      set({
        build: { ...parsed.build },
        params: mergedParams,
        gapManuallyEdited:
          Math.abs(mergedParams.gap - mergedParams.thickness) > 0.01,
        sizeIntent: { kind: 'plates' },
      });

      if (parsed.waffleParams) {
        set({
          waffleParams: { ...parsed.waffleParams },
          wafflePitchManuallyEdited: true,
        });
      }

      clearAutoSliceTimer();
      if (state.meshGeometry && (!compatible || isResultNull)) {
        await get().runSlice();
      }

      const manager = get().discManager;
      if (parsed.build.jointId === 'discs') {
        manager.loadDiscsFromProject(parsed.discs);
        const currentSlice = get().sliceResult;
        if (currentSlice) {
          manager.purgeInvalidDiscs(currentSlice.plates);
        }
        set({
          discs: manager.getAllDiscs(),
          canUndo: manager.canUndo(),
          canRedo: manager.canRedo(),
          selectedDiscId: null,
          statusMessage: 'Proyecto cargado correctamente',
        });
      } else {
        manager.loadDiscsFromProject([]);
        set({
          discs: [],
          canUndo: false,
          canRedo: false,
          selectedDiscId: null,
          statusMessage: 'Proyecto cargado correctamente',
        });
      }
      return { needsConfirmation: false };
    },

    setWaffleParam: (key, value) => {
      const current = get().waffleParams;
      if (current[key] === value) return;

      const nextWaffleParams = { ...current, [key]: value };
      const pitchManuallyEdited =
        key === 'pitch' || key === 'count1' || key === 'count2' || key === 'distance1' || key === 'distance2'
          ? true
          : get().wafflePitchManuallyEdited;

      if (key === 'distributionMethod') {
        const result = get().waffleResult;
        if (result) {
          if (value === 'distance') {
            const p1Len = result.p1Sections.length;
            const p2Len = result.p2Sections.length;
            const extX = result.scaledBounds3D.max[0] - result.scaledBounds3D.min[0];
            const extY = result.scaledBounds3D.max[1] - result.scaledBounds3D.min[1];
            if (p1Len > 0 && extX > 0) {
              nextWaffleParams.distance1 = Math.max(2 * get().params.thickness, Number((extX / p1Len).toFixed(1)));
            }
            if (p2Len > 0 && extY > 0) {
              nextWaffleParams.distance2 = Math.max(2 * get().params.thickness, Number((extY / p2Len).toFixed(1)));
            }
          } else if (value === 'count') {
            if (result.p1Sections.length > 0) {
              nextWaffleParams.count1 = result.p1Sections.length;
            }
            if (result.p2Sections.length > 0) {
              nextWaffleParams.count2 = result.p2Sections.length;
            }
          }
        }
      }

      set({
        waffleParams: nextWaffleParams,
        wafflePitchManuallyEdited: pitchManuallyEdited,
        isResultDirty: get().waffleResult !== null,
      });

      if (get().meshGeometry && get().meshFileName) {
        saveProjectToLocalStorage(
          get().params,
          get().discs,
          get().meshFileName,
          get().build,
          nextWaffleParams
        );
      }

      if (get().meshGeometry && get().build.techniqueId === 'waffle') {
        if (key === 'upAxis') {
          clearAutoSliceTimer();
          void get().runSlice();
        } else {
          scheduleAutoSlice(() => void get().runSlice(), 350);
        }
      }
    },

    setWaffleDimensionTarget: (dim, targetMm) => {
      if (!Number.isFinite(targetMm) || targetMm <= 0) return;
      const state = get();
      if (!state.modelExtents) return;

      const nextScale = scaleForTargetDimension(state.modelExtents, dim, targetMm);
      const nextWaffleParams = {
        ...state.waffleParams,
        targetScale: nextScale,
      };

      set({
        waffleParams: nextWaffleParams,
        sizeIntent: { kind: 'size', dim, targetMm },
        sizeCommitSeq: state.sizeCommitSeq + 1,
        isResultDirty: state.waffleResult !== null,
      });

      if (state.meshGeometry && state.meshFileName) {
        saveProjectToLocalStorage(
          get().params,
          get().discs,
          state.meshFileName,
          get().build,
          nextWaffleParams
        );
      }

      if (state.meshGeometry && get().build.techniqueId === 'waffle') {
        scheduleAutoSlice(() => void get().runSlice(), 350);
      }
    },

    setWaffleFamilyFilter: (filter) => set({ waffleFamilyFilter: filter }),

    selectWafflePiece: (pieceId) => set({ selectedWafflePieceId: pieceId }),

    stepWafflePiece: (delta) => {
      const { waffleResult, waffleFamilyFilter, selectedWafflePieceId } = get();
      if (!waffleResult) return;
      const pieces: WaffleSection[] =
        waffleFamilyFilter === 'P1'
          ? waffleResult.p1Sections
          : waffleFamilyFilter === 'P2'
          ? waffleResult.p2Sections
          : [...waffleResult.p1Sections, ...waffleResult.p2Sections];

      if (pieces.length === 0) return;
      const currentIndex = pieces.findIndex((p: WaffleSection) => p.id === selectedWafflePieceId);
      const nextIndex =
        currentIndex === -1
          ? 0
          : (currentIndex + delta + pieces.length) % pieces.length;
      set({ selectedWafflePieceId: pieces[nextIndex].id });
    },

    openCalibrationSheetPreview: () => {
      const { params, waffleParams } = get();
      try {
        const calSheet = generateSlotCalibrationSheet(
          params.thickness,
          params.kerf,
          waffleParams.slotClearance
        );
        set({
          sheetLayouts: [calSheet],
          isPreviewModalOpen: true,
          isCalibrationSheetModalOpen: true,
          errorMessage: null,
        });
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },
    closeCalibrationSheetPreview: () => set({ isCalibrationSheetModalOpen: false }),

    optimizeWaffleGridForTargetSections: (targetSectionsPerAxis = 6) => {
      const state = get();
      if (!state.modelExtents) return;

      const { h1, h2 } = horizontalExtentsForUpAxis(
        state.modelExtents,
        state.waffleParams.upAxis
      );
      const minHoriz = Math.min(h1, h2);
      if (minHoriz <= 0) return;

      const minLegalPitch = Math.max(
        2 * state.params.thickness,
        Number(
          (
            state.params.thickness +
            state.waffleParams.slotClearance -
            state.params.kerf +
            0.5
          ).toFixed(2)
        )
      );

      let nextScale = state.waffleParams.targetScale;
      let nextPitch = state.waffleParams.pitch;

      const currentMinHorizMm = minHoriz * nextScale;
      const candidatePitch = Math.floor((currentMinHorizMm / targetSectionsPerAxis) * 2) / 2;

      if (candidatePitch >= minLegalPitch) {
        nextPitch = Number(candidatePitch.toFixed(2));
      } else {
        nextPitch = minLegalPitch;
        const neededScale = (targetSectionsPerAxis * nextPitch) / minHoriz;
        const fit = waffleMaxFit(state.modelExtents, state.waffleParams.upAxis, state.params);
        nextScale = fit && fit.maxScale > 0
          ? Math.min(neededScale, fit.maxScale * 0.85)
          : neededScale;
      }

      const nextWaffleParams: WaffleParams = {
        ...state.waffleParams,
        targetScale: nextScale,
        pitch: nextPitch,
        gridOffset: Math.max(-nextPitch * 0.5, Math.min(nextPitch * 0.5, state.waffleParams.gridOffset)),
      };

      set({
        waffleParams: nextWaffleParams,
        wafflePitchManuallyEdited: true,
        sizeCommitSeq: state.sizeCommitSeq + 1,
        isResultDirty: state.waffleResult !== null,
      });

      if (state.meshGeometry && state.meshFileName) {
        saveProjectToLocalStorage(
          get().params,
          get().discs,
          state.meshFileName,
          get().build,
          nextWaffleParams
        );
      }

      if (state.meshGeometry && get().build.techniqueId === 'waffle') {
        clearAutoSliceTimer();
        void get().runSlice();
      }
    },

    openSheetPreviewModal: () => {
      const { sliceResult, waffleResult, discs, params, build } = get();
      if (build.techniqueId === 'waffle') {
        if (!waffleResult) return;
        try {
          const layouts = generateWaffleSheetLayouts(waffleResult, params);
          set({ sheetLayouts: layouts, isPreviewModalOpen: true, errorMessage: null });
        } catch (err) {
          set({
            errorMessage: err instanceof Error ? err.message : String(err),
            statusMessage: 'Error al generar la distribución de hojas',
          });
        }
        return;
      }

      if (!sliceResult) return;
      try {
        const layouts =
          build.jointId === 'discs'
            ? generateDiscsLayouts(sliceResult, discs, params)
            : generateSheetLayouts(sliceResult, params);
        set({ sheetLayouts: layouts, isPreviewModalOpen: true, errorMessage: null });
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
          statusMessage: 'Error al generar la distribución de hojas',
        });
      }
    },

    closeSheetPreviewModal: () => set({ isPreviewModalOpen: false }),

    clearError: () => set({ errorMessage: null }),
  };
});
