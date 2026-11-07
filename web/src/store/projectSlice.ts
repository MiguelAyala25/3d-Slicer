import type { StateCreator } from 'zustand';
import {
  clearAutosaveStorage,
  loadMeshBufferFromIndexedDB,
  loadProjectFromLocalStorage,
  saveProjectToLocalStorage,
  type AutosaveSessionSnapshot,
  type StoredMeshRecord,
} from '../core/autosave';
import {
  checkParamsCompatibility,
  serializeProject,
  type ParsedProjectData,
} from '../core/project';
import {
  computeAdaptiveWafflePitch,
  computeInitialWaffleScale,
  horizontalExtentsForUpAxis,
} from '../core/sizing';
import type { WaffleParams } from '../core/waffle/types';
import type { SculptureParams } from '../types/sculpture';
import { clearAutoSliceTimer } from './workerClient';
import type { SculptureStore } from './useSculptureStore';

export interface PendingAutosaveSession {
  snapshot: AutosaveSessionSnapshot | null;
  meshRecord: StoredMeshRecord | null;
}

export interface ProjectState {
  pendingAutosave: PendingAutosaveSession | null;
}

export interface ProjectActions {
  checkAutosaveOnStartup: () => Promise<void>;
  restoreAutosaveSession: () => Promise<void>;
  discardAutosaveSession: () => Promise<void>;
  exportProjectJsonString: () => string;
  importProjectFromParsed: (
    parsed: ParsedProjectData,
    forceAdapt?: boolean
  ) => Promise<{ needsConfirmation: boolean }>;
}

export type ProjectSlice = ProjectState & ProjectActions;

export function persistAutosaveIfLoaded(
  state: Pick<
    SculptureStore,
    'meshGeometry' | 'meshFileName' | 'params' | 'discs' | 'build' | 'waffleParams'
  >,
  waffleParamsOverride?: WaffleParams,
  includeWaffleParams = true
): void {
  if (state.meshGeometry && state.meshFileName) {
    saveProjectToLocalStorage(
      state.params,
      state.discs,
      state.meshFileName,
      state.build,
      includeWaffleParams ? (waffleParamsOverride ?? state.waffleParams) : undefined
    );
  }
}

export const createProjectSlice: StateCreator<
  SculptureStore,
  [],
  [],
  ProjectSlice
> = (set, get) => ({
  pendingAutosave: null,

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
});
