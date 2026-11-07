import { create } from 'zustand';
import type * as THREE from 'three';
import { DEFAULT_PARAMS, PARAM_BOUNDS } from '../core/params';
import { INITIAL_BUILD, type BuildConfig, type JointId, type TechniqueId } from '../core/build/types';
import { getJoint } from '../core/build/registry';
import { validateBuildParams } from '../core/build/validateBuild';
import { ValidationError } from '../core/validator';
import { platesForTargetDimension, scaleForTargetDimension, type ModelDimension, type ModelExtents, type SizeIntent } from '../core/sizing';
import { createDiscsSlice, type DiscsSlice } from './discsSlice';
import { computeUpdatedWaffleParamsForExtents, createWaffleSlice, type WaffleActions, type WaffleState } from './waffleSlice';
import { AUTO_SLICE_DEBOUNCE_MS, clearAutoSliceTimer, loadMeshWithWorkerOrFallback, runSliceJob, scheduleAutoSlice } from './workerClient';
import type { WaffleSliceResult } from '../core/waffle/types';
import { saveMeshBufferToIndexedDB } from '../core/autosave';
import { createProjectSlice, persistAutosaveIfLoaded, type PendingAutosaveSession, type ProjectSlice } from './projectSlice';
import { createViewSlice, getNextNonEmptyFloor, type CameraPreset, type ViewMode, type ViewSlice } from './viewSlice';
import type { Axis, MeshMetadata, SculptureParams, SliceResult } from '../types/sculpture';

export { AUTO_SLICE_DEBOUNCE_MS };
export type { CameraPreset, PendingAutosaveSession, ViewMode };

export interface SculptureState {
  params: SculptureParams;
  build: BuildConfig;
  gapManuallyEdited: boolean;
  isResultDirty: boolean;
  modelExtents: ModelExtents | null;
  sizeIntent: SizeIntent;
  sizeCommitSeq: number;
  meshGeometry: THREE.BufferGeometry | null;
  meshMetadata: MeshMetadata | null;
  meshFileName: string | null;
  isLoadingMesh: boolean;
  isSlicing: boolean;
  sliceResult: SliceResult | null;
  lastSliceAxis: Axis | null;
  lastSliceDurationMs: number | null;
  statusMessage: string;
  errorMessage: string | null;
}

export interface SculptureActions {
  setParam: <K extends keyof SculptureParams>(key: K, value: SculptureParams[K]) => void;
  setIsLoadingMesh: (loading: boolean) => void;
  loadMeshArrayBuffer: (buffer: ArrayBuffer, fileName: string, autoSlice?: boolean) => Promise<void>;
  runSlice: () => Promise<void>;
  setPlatesFromDimension: (dim: ModelDimension, mm: number) => void;
  setTechnique: (id: TechniqueId, opts?: { confirmed?: boolean }) => { needsConfirmation: boolean; discCount: number };
  setJoint: (id: JointId, opts?: { confirmed?: boolean }) => { needsConfirmation: boolean; discCount: number };
  clearError: () => void;
}

export type SculptureStore = SculptureState &
  SculptureActions &
  DiscsSlice &
  ProjectSlice &
  ViewSlice &
  WaffleState &
  WaffleActions;

function isStackedSliceReady(build: BuildConfig): boolean {
  return build.techniqueId === 'stacked' && (build.jointId === 'none' || build.jointId === 'discs');
}

function recalcPlatesForSizeIntent(
  extents: ModelExtents | null,
  intent: SizeIntent,
  axis: Axis,
  thickness: number,
  gap: number,
  fallbackPlates: number,
  fallbackStatus: string
): { plates: number; statusMessage: string } {
  if (intent.kind !== 'size' || !extents) {
    return { plates: fallbackPlates, statusMessage: fallbackStatus };
  }
  const outcome = platesForTargetDimension(extents, axis, intent.dim, intent.targetMm, thickness, gap);
  const statusMessage =
    outcome.clamped === 'min'
      ? 'Límite de placas alcanzado (2)'
      : outcome.clamped === 'max'
      ? 'Límite de placas alcanzado (200)'
      : fallbackStatus;
  return { plates: outcome.plates, statusMessage };
}

export const useSculptureStore = create<SculptureStore>()((set, get, api) => {
  let lastSlicedAxis: Axis | null = null;
  const discsSlice = createDiscsSlice(set, get, api);
  const projectSlice = createProjectSlice(set, get, api);
  const viewSlice = createViewSlice(set, get, api);
  const waffleSlice = createWaffleSlice(set, get, api);

  return {
    ...discsSlice,
    ...projectSlice,
    ...viewSlice,
    ...waffleSlice,
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
    statusMessage: 'Carga un modelo 3D (.obj, .stl, .3mf, .ply) para comenzar',
    errorMessage: null,

    setParam: (key, value) => {
      const state = get();
      const nextParams: SculptureParams = { ...state.params, [key]: value };
      let nextGapEdited = state.gapManuallyEdited;

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

      const nextSizeIntent: SizeIntent = key === 'plates' ? { kind: 'plates' } : state.sizeIntent;
      let nextStatusMessage = state.statusMessage;
      if (key === 'thickness' || key === 'gap' || key === 'axis') {
        const recalc = recalcPlatesForSizeIntent(
          state.modelExtents,
          nextSizeIntent,
          nextParams.axis,
          nextParams.thickness,
          nextParams.gap,
          nextParams.plates,
          state.statusMessage
        );
        nextParams.plates = recalc.plates;
        nextStatusMessage = recalc.statusMessage;
      }

      set({
        params: nextParams,
        gapManuallyEdited: nextGapEdited,
        sizeIntent: nextSizeIntent,
        statusMessage: nextStatusMessage,
        isResultDirty: state.sliceResult !== null,
        errorMessage: null,
      });
      persistAutosaveIfLoaded(get());

      if (key === 'thickness' && !get().wafflePitchManuallyEdited) {
        set((s) => ({
          waffleParams: { ...s.waffleParams, pitch: Number((4 * Number(value)).toFixed(2)) },
        }));
      }

      if (state.meshGeometry && get().build.techniqueId === 'waffle' && (key === 'thickness' || key === 'kerf')) {
        scheduleAutoSlice(() => void get().runSlice());
      }

      if (
        ['plates', 'thickness', 'gap', 'axis'].includes(key as string) &&
        state.meshGeometry &&
        isStackedSliceReady(get().build)
      ) {
        if (key === 'axis') {
          clearAutoSliceTimer();
          void get().runSlice();
        } else {
          scheduleAutoSlice(() => void get().runSlice());
        }
      }
    },

    setIsLoadingMesh: (loading) => set({ isLoadingMesh: loading }),

    loadMeshArrayBuffer: async (buffer, fileName, autoSlice = true) => {
      clearAutoSliceTimer();
      set({ isLoadingMesh: true, errorMessage: null, statusMessage: `Cargando ${fileName}...` });

      await new Promise<void>((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => setTimeout(resolve, 16));
        } else {
          setTimeout(resolve, 0);
        }
      });

      try {
        const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
        const upOrientation = ext === '.obj' ? 'y-up' : undefined;
        const { geometry, metadata } = await loadMeshWithWorkerOrFallback(buffer, fileName, upOrientation);

        get().resetDiscs();
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const bbox = geometry.boundingBox!;
        const extents: ModelExtents = {
          x: bbox.max.x - bbox.min.x,
          y: bbox.max.y - bbox.min.y,
          z: bbox.max.z - bbox.min.z,
        };

        const initialSizeIntent: SizeIntent = { kind: 'plates' };
        const nextWaffleParams = computeUpdatedWaffleParamsForExtents(
          extents,
          get().params,
          get().waffleParams,
          initialSizeIntent,
          get().wafflePitchManuallyEdited
        );

        set({
          meshGeometry: geometry,
          meshMetadata: metadata,
          meshFileName: fileName,
          modelExtents: extents,
          sizeIntent: initialSizeIntent,
          waffleParams: nextWaffleParams,
          sliceResult: null,
          waffleResult: null,
          selectedWafflePieceId: null,
          isResultDirty: false,
          activeFloor: 0,
          isLoadingMesh: false,
          statusMessage: `Modelo '${fileName}' cargado (${metadata.vertexCount} vértices, ${metadata.faceCount} triángulos)`,
        });

        saveMeshBufferToIndexedDB(fileName, buffer).catch(() => {});
        if (autoSlice && (isStackedSliceReady(get().build) || get().build.techniqueId === 'waffle')) {
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
      if (!state.meshGeometry || !state.build.techniqueId || !state.build.jointId) return;

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
          activeFloor:
            Math.min(s.activeFloor, result.plates.length - 1) >= 0
              ? Math.min(s.activeFloor, result.plates.length - 1)
              : firstFloor,
          statusMessage: `Corte completado en ${Math.round(durationMs)} ms (${result.plates.length} placas)`,
        }));
        persistAutosaveIfLoaded(get());
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
        persistAutosaveIfLoaded(get());
      };

      await runSliceJob({
        isWaffle,
        geometry: state.meshGeometry,
        paramsSnapshot,
        waffleParamsSnapshot,
        callbacks: {
          onSliceSuccess: applySliceOutcome,
          onWaffleSuccess: applyWaffleSliceOutcome,
          onSkipped: () => set({ isSlicing: false }),
          onWorkerError: (errorMsg) =>
            set({ isSlicing: false, errorMessage: errorMsg, statusMessage: 'Error durante el corte' }),
          onSyncError: (errorMsg) => set({ isSlicing: false, errorMessage: errorMsg }),
        },
      });
    },

    setPlatesFromDimension: (dim, mm) => {
      if (!Number.isFinite(mm) || mm <= 0) return;
      const state = get();
      if (!state.modelExtents) return;
      const intent: SizeIntent = { kind: 'size', dim, targetMm: mm };
      const { plates, statusMessage } = recalcPlatesForSizeIntent(
        state.modelExtents,
        intent,
        state.params.axis,
        state.params.thickness,
        state.params.gap,
        state.params.plates,
        state.statusMessage
      );
      const nextWaffleScale = scaleForTargetDimension(state.modelExtents, dim, mm);
      set({
        params: { ...state.params, plates },
        waffleParams: { ...state.waffleParams, targetScale: nextWaffleScale },
        sizeIntent: intent,
        sizeCommitSeq: state.sizeCommitSeq + 1,
        isResultDirty: state.sliceResult !== null,
        statusMessage,
      });
      persistAutosaveIfLoaded(get());
      if (state.meshGeometry && isStackedSliceReady(get().build)) {
        scheduleAutoSlice(() => void get().runSlice());
      }
    },

    setTechnique: (id, opts) => {
      clearAutoSliceTimer();
      if (id !== 'stacked' && id !== 'waffle') {
        throw new ValidationError(`Técnica desconocida: '${id}'.`);
      }
      const { techniqueId: currentTechniqueId, jointId: currentJointId } = get().build;
      if (id === currentTechniqueId) return { needsConfirmation: false, discCount: 0 };

      const discs = get().discs;
      if (currentTechniqueId === 'stacked' && currentJointId === 'discs' && discs.length > 0 && !opts?.confirmed) {
        return { needsConfirmation: true, discCount: discs.length };
      }

      if (id === 'waffle') {
        if (currentJointId === 'discs') {
          get().resetDiscs();
          set({ modeAddDiscs: false });
        }
        set((s) => ({
          build: { ...s.build, techniqueId: 'waffle', jointId: 'slots' },
          waffleParams: computeUpdatedWaffleParamsForExtents(
            s.modelExtents,
            s.params,
            s.waffleParams,
            s.sizeIntent,
            s.wafflePitchManuallyEdited
          ),
          isResultDirty: s.waffleResult !== null,
        }));
      } else {
        set((s) => ({
          build: {
            ...s.build,
            techniqueId: 'stacked',
            jointId: s.build.jointId && s.build.jointId !== 'slots' ? s.build.jointId : '',
          },
          isResultDirty: s.sliceResult !== null,
        }));
      }

      persistAutosaveIfLoaded(get());
      if (get().meshGeometry) void get().runSlice();
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
      if (id === currentJointId) return { needsConfirmation: false, discCount: 0 };

      const discs = get().discs;
      if (currentJointId === 'discs' && discs.length > 0 && !opts?.confirmed) {
        return { needsConfirmation: true, discCount: discs.length };
      }

      if (currentJointId === 'discs') {
        get().resetDiscs();
        set({
          modeAddDiscs: false,
          discGapMemory: get().params.gap,
          discGapManuallyEditedMemory: get().gapManuallyEdited,
        });
      }

      if (id === 'none' || id === 'discs') {
        const memory = get().discGapMemory;
        const memoryEdited = get().discGapManuallyEditedMemory;
        const nextGap =
          id === 'none'
            ? 0
            : memory !== null && memory >= PARAM_BOUNDS.gap.min
            ? memory
            : Math.max(PARAM_BOUNDS.gap.min, get().params.thickness);
        const nextGapEdited =
          id === 'none' ? get().gapManuallyEdited : memory !== null ? memoryEdited : false;

        const { plates: nextPlates, statusMessage: nextStatusMessage } = recalcPlatesForSizeIntent(
          get().modelExtents,
          get().sizeIntent,
          get().params.axis,
          get().params.thickness,
          nextGap,
          get().params.plates,
          get().statusMessage
        );

        set((s) => ({
          build: { ...s.build, jointId: id },
          params: { ...s.params, gap: nextGap, plates: nextPlates },
          ...(id === 'discs' ? { gapManuallyEdited: nextGapEdited } : {}),
          statusMessage: nextStatusMessage,
          isResultDirty: s.sliceResult !== null,
        }));
      }

      persistAutosaveIfLoaded(get(), undefined, false);
      if (get().meshGeometry && isStackedSliceReady(get().build)) {
        void get().runSlice();
      }
      return { needsConfirmation: false, discCount: 0 };
    },

    clearError: () => set({ errorMessage: null }),
  };
});

if (typeof window !== 'undefined') {
  (window as unknown as { __SCULPTURE_STORE__: typeof useSculptureStore }).__SCULPTURE_STORE__ =
    useSculptureStore;
}
