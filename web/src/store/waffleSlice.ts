import type { ModelDimension } from '../core/sizing';
import type { WaffleParams, WaffleSliceResult } from '../core/waffle/types';

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
}

export const INITIAL_WAFFLE_STATE: WaffleState = {
  waffleParams: {
    upAxis: 'z',
    pitch: 12.0, // 4 * default thickness (3.0)
    slotClearance: 0.1,
    gridOffset: 0.0,
    slotLabelsEnabled: true,
    targetScale: 1.0,
  },
  wafflePitchManuallyEdited: false,
  waffleResult: null,
  waffleFamilyFilter: 'both',
  selectedWafflePieceId: null,
  isCalibrationSheetModalOpen: false,
};
