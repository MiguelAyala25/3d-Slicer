import type { StateCreator } from 'zustand';
import { DiscManager } from '../core/joints/discs/DiscManager';
import { DEFAULT_PARAMS } from '../core/params';
import type { Disc, SliceResult } from '../types/sculpture';
import type { SculptureStore } from './useSculptureStore';

export interface DiscsState {
  modeAddDiscs: boolean;
  discManager: DiscManager;
  discs: Disc[];
  selectedDiscId: number | null;
  canUndo: boolean;
  canRedo: boolean;
  discGapMemory: number | null;
  discGapManuallyEditedMemory: boolean;
}

export interface DiscsActions {
  setModeAddDiscs: (enabled: boolean) => void;
  addDiscAtActiveFloor: (x: number, y: number) => void;
  commitDiscMove: (
    discId: number,
    startX: number,
    startY: number,
    finalX: number,
    finalY: number
  ) => boolean;
  selectDisc: (discId: number | null) => void;
  updateSelectedDiscDiameter: (newDiameter: number) => void;
  deleteSelectedDisc: () => void;
  clearActiveFloorDiscs: () => void;
  clearAllDiscs: () => void;
  undoDiscs: () => void;
  redoDiscs: () => void;
  resetDiscs: () => void;
  onSliceApplied: (opts: {
    axisChanged: boolean;
    prevScaleFactor: number;
    result: SliceResult;
  }) => void;
}

export type DiscsSlice = DiscsState & DiscsActions;

export const createDiscsSlice: StateCreator<
  SculptureStore,
  [],
  [],
  DiscsSlice
> = (set, get) => {
  const manager = new DiscManager(DEFAULT_PARAMS.discDiameter);

  const syncDiscsState = (statusMsg?: string) => {
    set({
      discs: manager.getAllDiscs(),
      canUndo: manager.canUndo(),
      canRedo: manager.canRedo(),
      ...(statusMsg ? { statusMessage: statusMsg } : {}),
    });
  };

  return {
    modeAddDiscs: false,
    discManager: manager,
    discs: [],
    selectedDiscId: null,
    canUndo: false,
    canRedo: false,
    discGapMemory: null,
    discGapManuallyEditedMemory: false,

    setModeAddDiscs: (enabled) => {
      if (get().build.jointId !== 'discs') return;
      set({ modeAddDiscs: enabled });
    },

    addDiscAtActiveFloor: (x, y) => {
      if (get().build.jointId !== 'discs') return;
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
      if (get().build.jointId !== 'discs') return false;
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

    selectDisc: (discId) => {
      if (get().build.jointId !== 'discs') return;
      set({ selectedDiscId: discId });
    },

    updateSelectedDiscDiameter: (newDiameter) => {
      if (get().build.jointId !== 'discs') return;
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
      if (get().build.jointId !== 'discs') return;
      const { selectedDiscId } = get();
      if (selectedDiscId === null) return;
      if (manager.removeDisc(selectedDiscId)) {
        set({ selectedDiscId: null });
        syncDiscsState(`Disco #${selectedDiscId} eliminado`);
      }
    },

    clearActiveFloorDiscs: () => {
      if (get().build.jointId !== 'discs') return;
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
      if (get().build.jointId !== 'discs') return;
      manager.clearAll(true);
      set({ selectedDiscId: null });
      syncDiscsState('Todos los discos fueron eliminados');
    },

    undoDiscs: () => {
      if (get().build.jointId !== 'discs') return;
      if (manager.undo()) {
        syncDiscsState('Deshacer aplicado');
      }
    },

    redoDiscs: () => {
      if (get().build.jointId !== 'discs') return;
      if (manager.redo()) {
        syncDiscsState('Rehacer aplicado');
      }
    },

    resetDiscs: () => {
      manager.clearAll(false);
      set({
        discs: [],
        selectedDiscId: null,
        canUndo: false,
        canRedo: false,
      });
    },

    onSliceApplied: ({ axisChanged, prevScaleFactor, result }) => {
      if (get().build.jointId !== 'discs') return;
      if (axisChanged) {
        manager.clearAll(false);
      } else if (
        prevScaleFactor > 0 &&
        Math.abs(result.scaleFactor - prevScaleFactor) > 1e-6
      ) {
        const scaleRatio = result.scaleFactor / prevScaleFactor;
        manager.rescalePositions(scaleRatio);
        manager.purgeInvalidDiscs(result.plates);
      } else {
        manager.purgeInvalidDiscs(result.plates);
      }
      syncDiscsState();
    },
  };
};
