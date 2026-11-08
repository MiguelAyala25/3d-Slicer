import { PARAM_BOUNDS, CORE_GAP_BOUNDS } from './params';
import { ValidationError } from './errors';
import type { CoreParams } from '../types/sculpture';

export const SUPPORTED_EXTENSIONS = new Set(['.obj', '.stl', '.3mf', '.ply']);
export const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB

export function validateFileExtension(fileName: string, byteLength?: number): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new ValidationError('FILE_PATH_EMPTY', {});
  }
  const dotIdx = trimmed.lastIndexOf('.');
  const ext = dotIdx >= 0 ? trimmed.slice(dotIdx).toLowerCase() : '';
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new ValidationError('FILE_FORMAT_UNSUPPORTED', { ext });
  }
  if (byteLength !== undefined) {
    if (byteLength === 0) {
      throw new ValidationError('FILE_EMPTY', { fileName: trimmed });
    }
    if (byteLength > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError('FILE_TOO_LARGE', { fileName: trimmed });
    }
  }
  return ext;
}

export function validateParams(params: CoreParams): void {
  if (
    !Number.isInteger(params.plates) ||
    params.plates < PARAM_BOUNDS.plates.min ||
    params.plates > PARAM_BOUNDS.plates.max
  ) {
    throw new ValidationError('PARAM_PLATES_OUT_OF_RANGE', {
      min: PARAM_BOUNDS.plates.min,
      max: PARAM_BOUNDS.plates.max,
      received: params.plates,
    });
  }
  if (
    !Number.isFinite(params.thickness) ||
    params.thickness < PARAM_BOUNDS.thickness.min ||
    params.thickness > PARAM_BOUNDS.thickness.max
  ) {
    throw new ValidationError('PARAM_THICKNESS_OUT_OF_RANGE', {
      min: PARAM_BOUNDS.thickness.min,
      max: PARAM_BOUNDS.thickness.max,
      received: params.thickness,
    });
  }
  if (
    !Number.isFinite(params.gap) ||
    params.gap < CORE_GAP_BOUNDS.min ||
    params.gap > CORE_GAP_BOUNDS.max
  ) {
    throw new ValidationError('PARAM_GAP_OUT_OF_RANGE', {
      min: CORE_GAP_BOUNDS.min,
      max: CORE_GAP_BOUNDS.max,
      received: params.gap,
    });
  }
  if (!['x', 'y', 'z'].includes(params.axis)) {
    throw new ValidationError('PARAM_AXIS_INVALID', { received: params.axis });
  }
  if (
    !Number.isFinite(params.sheetW) ||
    params.sheetW < PARAM_BOUNDS.sheetW.min ||
    params.sheetW > PARAM_BOUNDS.sheetW.max ||
    !Number.isFinite(params.sheetH) ||
    params.sheetH < PARAM_BOUNDS.sheetH.min ||
    params.sheetH > PARAM_BOUNDS.sheetH.max
  ) {
    throw new ValidationError('PARAM_SHEET_DIM_OUT_OF_RANGE', {
      min: PARAM_BOUNDS.sheetW.min,
      max: PARAM_BOUNDS.sheetW.max,
      sheetW: params.sheetW,
      sheetH: params.sheetH,
    });
  }
  if (
    !Number.isFinite(params.sheetMargin) ||
    params.sheetMargin < PARAM_BOUNDS.sheetMargin.min ||
    params.sheetMargin > PARAM_BOUNDS.sheetMargin.max
  ) {
    throw new ValidationError('PARAM_SHEET_MARGIN_OUT_OF_RANGE', {
      min: PARAM_BOUNDS.sheetMargin.min,
      max: PARAM_BOUNDS.sheetMargin.max,
      received: params.sheetMargin,
    });
  }
  if (params.sheetMargin * 2 >= Math.min(params.sheetW, params.sheetH)) {
    throw new ValidationError('SHEET_MARGIN_TOO_LARGE', {
      sheetMargin: params.sheetMargin,
      sheetW: params.sheetW,
      sheetH: params.sheetH,
    });
  }
  if (
    !Number.isFinite(params.partGap) ||
    params.partGap < PARAM_BOUNDS.partGap.min ||
    params.partGap > PARAM_BOUNDS.partGap.max
  ) {
    throw new ValidationError('PARAM_PART_GAP_OUT_OF_RANGE', {
      min: PARAM_BOUNDS.partGap.min,
      max: PARAM_BOUNDS.partGap.max,
      received: params.partGap,
    });
  }
  if (
    !Number.isFinite(params.kerf) ||
    params.kerf < PARAM_BOUNDS.kerf.min ||
    params.kerf > PARAM_BOUNDS.kerf.max
  ) {
    throw new ValidationError('PARAM_KERF_OUT_OF_RANGE', {
      min: PARAM_BOUNDS.kerf.min,
      max: PARAM_BOUNDS.kerf.max,
      received: params.kerf,
    });
  }
  if (typeof params.scrapTagEnabled !== 'boolean') {
    throw new ValidationError('PARAM_SCRAP_TAG_NOT_BOOLEAN', {});
  }
}
