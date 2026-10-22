import { PARAM_BOUNDS } from '../../params';
import { validateDiscsParams } from './discParams';
import type { JointDefinition } from '../../build/types';
import type { SculptureParams } from '../../../types/sculpture';

export const DISCS_JOINT: JointDefinition = {
  id: 'discs',
  label: 'Con discos',
  available: true,
  gapPolicy: {
    kind: 'range',
    min: PARAM_BOUNDS.gap.min,
    max: PARAM_BOUNDS.gap.max,
    step: PARAM_BOUNDS.gap.step,
  },
  validateParams(params: SculptureParams): void {
    validateDiscsParams(params);
  },
};

export { DiscManager, MAX_HISTORY, type AddDiscOutcome } from './DiscManager';
export {
  clampDiscPositionToGap,
  isDiscInsidePlate,
  isDiscValidForGap,
  isPointOnPlate,
} from './discGeometry';
export {
  getDiscSheetNotice,
  getDiscThickness,
  isDiscsSeparateSheet,
  validateDiscsParams,
} from './discParams';
export {
  createDiscsLayoutHooks,
  generateDiscsLayouts,
  layoutDiscsIntoSheets,
} from './discLayout';
export {
  parseDiscsHueco,
  serializeDiscsHueco,
} from './discProject';
