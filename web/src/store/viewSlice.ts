import type { StateCreator } from 'zustand';
import { generateDiscsLayouts } from '../core/joints/discs/discLayout';
import { generateSheetLayouts, generateWaffleSheetLayouts } from '../core/layout';
import { getDiscardedChainsSummary } from '../core/slicer';
import type { SheetLayout, SliceResult } from '../types/sculpture';
import type { SculptureStore } from './useSculptureStore';

export type CameraPreset = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export type ViewMode = 'original' | 'plates';

export interface ViewState {
  viewMode: ViewMode;
  wireframe: boolean;
  showAllFloors: boolean;
  activeFloor: number;
  cameraPreset: CameraPreset;
  cameraPresetTrigger: number;
  sheetLayouts: SheetLayout[] | null;
  isPreviewModalOpen: boolean;
  exportAnywayConfirmed: boolean;
}

export interface ViewActions {
  setViewMode: (mode: ViewMode) => void;
  toggleWireframe: () => void;
  setShowAllFloors: (showAll: boolean) => void;
  setActiveFloor: (floorIndex: number) => void;
  stepFloor: (delta: 1 | -1) => void;
  setCameraPreset: (preset: CameraPreset) => void;
  openSheetPreviewModal: () => void;
  closeSheetPreviewModal: () => void;
  confirmExportAnyway: () => void;
}

export type ViewSlice = ViewState & ViewActions;

export function isExportBlockedByDiscardedChains(
  techniqueId: string,
  sliceResult: SliceResult | null,
  exportAnywayConfirmed: boolean
): boolean {
  if (techniqueId !== 'stacked' || !sliceResult) return false;
  const summary = getDiscardedChainsSummary(sliceResult);
  return summary.totalDiscarded > 0 && !exportAnywayConfirmed;
}

export function getNextNonEmptyFloor(
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

export const createViewSlice: StateCreator<
  SculptureStore,
  [],
  [],
  ViewSlice
> = (set, get) => ({
  viewMode: 'original',
  wireframe: false,
  showAllFloors: true,
  activeFloor: 0,
  cameraPreset: 'iso',
  cameraPresetTrigger: 0,
  sheetLayouts: null,
  isPreviewModalOpen: false,
  exportAnywayConfirmed: false,

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleWireframe: () => set((s) => ({ wireframe: !s.wireframe })),
  setShowAllFloors: (showAll) => set({ showAllFloors: showAll }),

  confirmExportAnyway: () => set({ exportAnywayConfirmed: true }),

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

  openSheetPreviewModal: () => {
    const { sliceResult, waffleResult, discs, params, build } = get();
    if (build.techniqueId === 'waffle') {
      if (!waffleResult) return;
      try {
        const layouts = generateWaffleSheetLayouts(waffleResult, params);
        set({ sheetLayouts: layouts, isPreviewModalOpen: true, exportAnywayConfirmed: false, errorMessage: null });
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
      set({ sheetLayouts: layouts, isPreviewModalOpen: true, exportAnywayConfirmed: false, errorMessage: null });
    } catch (err) {
      set({
        errorMessage: err instanceof Error ? err.message : String(err),
        statusMessage: 'Error al generar la distribución de hojas',
      });
    }
  },

  closeSheetPreviewModal: () => set({ isPreviewModalOpen: false, exportAnywayConfirmed: false }),
});
