import type { StateCreator } from 'zustand';
import {
  computeAdaptiveWafflePitch,
  computeInitialWaffleScale,
  horizontalExtentsForUpAxis,
  scaleForTargetDimension,
  waffleMaxFit,
  type ModelDimension,
  type ModelExtents,
  type SizeIntent,
} from '../core/sizing';
import { generateSlotCalibrationSheet } from '../core/waffle/calibrationSheet';
import type { WaffleParams, WaffleSection, WaffleSliceResult } from '../core/waffle/types';
import type { SculptureParams } from '../types/sculpture';
import { persistAutosaveIfLoaded } from './projectSlice';
import { clearAutoSliceTimer, scheduleAutoSlice } from './workerClient';
import type { SculptureStore } from './useSculptureStore';

export function computeUpdatedWaffleParamsForExtents(
  extents: ModelExtents | null,
  params: SculptureParams,
  waffleParams: WaffleParams,
  sizeIntent: SizeIntent,
  wafflePitchManuallyEdited: boolean
): WaffleParams {
  const nextScale = extents
    ? computeInitialWaffleScale(extents, params, waffleParams.upAxis, waffleParams.pitch, sizeIntent)
    : waffleParams.targetScale;
  const nextPitch = wafflePitchManuallyEdited
    ? waffleParams.pitch
    : computeAdaptiveWafflePitch(extents, nextScale, waffleParams.upAxis, params.thickness);
  return { ...waffleParams, targetScale: nextScale, pitch: nextPitch };
}

export type WaffleFamilyFilter = 'both' | 'P1' | 'P2';

export interface WaffleState {
  waffleParams: WaffleParams;
  wafflePitchManuallyEdited: boolean;
  waffleResult: WaffleSliceResult | null;
  waffleFamilyFilter: WaffleFamilyFilter;
  selectedWafflePieceId: string | null;
  isCalibrationSheetModalOpen: boolean;
}

export interface WaffleActions {
  setWaffleParam: <K extends keyof WaffleParams>(key: K, value: WaffleParams[K]) => void;
  setWaffleDimensionTarget: (dim: ModelDimension, targetMm: number) => void;
  setWaffleFamilyFilter: (filter: WaffleFamilyFilter) => void;
  selectWafflePiece: (pieceId: string | null) => void;
  stepWafflePiece: (delta: 1 | -1) => void;
  openCalibrationSheetPreview: () => void;
  closeCalibrationSheetPreview: () => void;
  optimizeWaffleGridForTargetSections: (targetSectionsPerAxis?: number) => void;
}

export type WaffleSlice = WaffleState & WaffleActions;

export const INITIAL_WAFFLE_STATE: WaffleState = {
  waffleParams: {
    upAxis: 'z',
    pitch: 12.0, // 4 * default thickness (3.0)
    slotClearance: 0.1,
    gridOffset: 0.0,
    slotLabelsEnabled: true,
    targetScale: 1.0,
    distributionMethod: 'count',
    count1: 8,
    count2: 8,
    distance1: 12.0,
    distance2: 12.0,
    notchFactor: 0.1,
    notchAngle: 45.0,
  },
  wafflePitchManuallyEdited: false,
  waffleResult: null,
  waffleFamilyFilter: 'both',
  selectedWafflePieceId: null,
  isCalibrationSheetModalOpen: false,
};

export const createWaffleSlice: StateCreator<
  SculptureStore,
  [],
  [],
  WaffleSlice
> = (set, get) => ({
  ...INITIAL_WAFFLE_STATE,

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

    persistAutosaveIfLoaded(get(), nextWaffleParams);

    if (get().meshGeometry && get().build.techniqueId === 'waffle') {
      if (key === 'upAxis') {
        clearAutoSliceTimer();
        void get().runSlice();
      } else {
        scheduleAutoSlice(() => void get().runSlice());
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

    persistAutosaveIfLoaded(get(), nextWaffleParams);

    if (state.meshGeometry && get().build.techniqueId === 'waffle') {
      scheduleAutoSlice(() => void get().runSlice());
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

    persistAutosaveIfLoaded(get(), nextWaffleParams);

    if (state.meshGeometry && get().build.techniqueId === 'waffle') {
      clearAutoSliceTimer();
      void get().runSlice();
    }
  },
});
