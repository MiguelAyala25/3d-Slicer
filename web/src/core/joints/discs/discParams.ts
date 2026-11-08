import { PARAM_BOUNDS } from '../../params';
import { ValidationError } from '../../validator';
import { UI_TEXTS_ES } from '../../../i18n/es';
import type { SculptureParams } from '../../../types/sculpture';

export function getDiscThickness(params: Pick<SculptureParams, 'gap'>): number {
  return params.gap;
}

export function isDiscsSeparateSheet(
  params: Pick<SculptureParams, 'gap' | 'thickness'>
): boolean {
  return Math.abs(params.gap - params.thickness) > 0.01;
}

export function getDiscSheetNotice(
  params: Pick<SculptureParams, 'gap' | 'thickness'>
): string {
  if (!isDiscsSeparateSheet(params)) {
    return UI_TEXTS_ES.discSheetSameNotice;
  }
  return UI_TEXTS_ES.discSheetSeparateNotice(params.gap);
}

export function validateDiscsParams(params: SculptureParams): void {
  if (
    !Number.isFinite(params.gap) ||
    params.gap < PARAM_BOUNDS.gap.min ||
    params.gap > PARAM_BOUNDS.gap.max
  ) {
    throw new ValidationError('PARAM_GAP_OUT_OF_RANGE', {
      min: PARAM_BOUNDS.gap.min,
      max: PARAM_BOUNDS.gap.max,
      received: params.gap,
    });
  }
  if (
    !Number.isFinite(params.discDiameter) ||
    params.discDiameter < PARAM_BOUNDS.discDiameter.min ||
    params.discDiameter > PARAM_BOUNDS.discDiameter.max
  ) {
    throw new ValidationError('DISC_PARAM_DIAMETER_OUT_OF_RANGE', {
      min: PARAM_BOUNDS.discDiameter.min,
      max: PARAM_BOUNDS.discDiameter.max,
      received: params.discDiameter,
    });
  }
  if (
    !Number.isFinite(params.engraveClearance) ||
    params.engraveClearance < PARAM_BOUNDS.engraveClearance.min ||
    params.engraveClearance > PARAM_BOUNDS.engraveClearance.max
  ) {
    throw new ValidationError('DISC_PARAM_CLEARANCE_OUT_OF_RANGE', {
      min: PARAM_BOUNDS.engraveClearance.min,
      max: PARAM_BOUNDS.engraveClearance.max,
      received: params.engraveClearance,
    });
  }
}
