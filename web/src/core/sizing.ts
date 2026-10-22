import type { Axis, CoreParams } from '../types/sculpture';

export type ModelDimension = 'alto' | 'ancho' | 'largo';
export interface ModelExtents {
  x: number;
  y: number;
  z: number;
} // mm sin escalar
export interface FinalSize {
  alto: number;
  ancho: number;
  largo: number;
  scale: number;
}
export type SizeIntent =
  | { kind: 'plates' }
  | { kind: 'size'; dim: ModelDimension; targetMm: number };

export const DIMENSION_LABELS: Record<ModelDimension, string> = {
  alto: 'Alto (Z)',
  ancho: 'Ancho (X)',
  largo: 'Largo (Y)',
};
export const TIE_TOLERANCE = 1e-9;

/**
 * Fórmula única de altura ensamblada (§3.B.2, DoD-6).
 * Devuelve exactamente plates * thickness + (plates - 1) * gap.
 */
export function assembledHeight(plates: number, thickness: number, gap: number): number {
  return plates * thickness + (plates - 1) * gap;
}

export function linkedDimension(axis: Axis): ModelDimension {
  switch (axis) {
    case 'z':
      return 'alto';
    case 'x':
      return 'ancho';
    case 'y':
      return 'largo';
  }
}

export function extentOf(extents: ModelExtents, dim: ModelDimension): number {
  switch (dim) {
    case 'alto':
      return extents.z;
    case 'ancho':
      return extents.x;
    case 'largo':
      return extents.y;
  }
}

export function planarEnvelope(extents: ModelExtents, axis: Axis): { w: number; h: number } {
  switch (axis) {
    case 'z':
      return { w: extents.x, h: extents.y };
    case 'x':
      return { w: extents.z, h: extents.y };
    case 'y':
      return { w: extents.x, h: extents.z };
  }
}

export function uniformScale(
  extents: ModelExtents,
  axis: Axis,
  plates: number,
  thickness: number,
  gap: number
): number {
  const cutDim = linkedDimension(axis);
  const origHeight = extentOf(extents, cutDim);
  return origHeight > 0 ? assembledHeight(plates, thickness, gap) / origHeight : 1;
}

export function finalSize(
  extents: ModelExtents,
  axis: Axis,
  plates: number,
  thickness: number,
  gap: number
): FinalSize {
  const scale = uniformScale(extents, axis, plates, thickness, gap);
  return {
    alto: extents.z * scale,
    ancho: extents.x * scale,
    largo: extents.y * scale,
    scale,
  };
}

export function platesForTargetDimension(
  extents: ModelExtents,
  axis: Axis,
  dim: ModelDimension,
  targetMm: number,
  thickness: number,
  gap: number
): { plates: number; clamped: 'min' | 'max' | null } {
  const cutDim = linkedDimension(axis);
  const cutExtent = extentOf(extents, cutDim);
  const dimExtent = extentOf(extents, dim);

  if (dimExtent <= 0 || thickness + gap <= 0) {
    return { plates: 2, clamped: 'min' };
  }

  const x = ((targetMm * cutExtent) / dimExtent + gap) / (thickness + gap);

  const f = Math.floor(x + TIE_TOLERANCE);
  let n: number;
  if (Math.abs(x - f - 0.5) <= TIE_TOLERANCE) {
    n = f; // Gana el menor en caso de empate
  } else {
    n = Math.round(x);
  }

  if (n < 2) {
    return { plates: 2, clamped: 'min' };
  }
  if (n > 200) {
    return { plates: 200, clamped: 'max' };
  }
  return { plates: n, clamped: null };
}

export function maxFit(
  extents: ModelExtents,
  axis: Axis,
  thickness: number,
  gap: number,
  sheet: Pick<CoreParams, 'sheetW' | 'sheetH' | 'sheetMargin'>
): { plates: number; size: FinalSize } | null {
  const usableW = sheet.sheetW - 2.0 * sheet.sheetMargin;
  const usableH = sheet.sheetH - 2.0 * sheet.sheetMargin;
  if (usableW <= 0 || usableH <= 0) return null;

  const env = planarEnvelope(extents, axis);
  if (env.w <= 0 || env.h <= 0) return null;

  const sMax = Math.min(usableW / env.w, usableH / env.h);
  const cutDim = linkedDimension(axis);
  const Hmax = sMax * extentOf(extents, cutDim);

  const n = Math.floor((Hmax + gap) / (thickness + gap) + 1e-9);
  if (n < 2) return null;

  const plates = Math.min(200, n);
  return {
    plates,
    size: finalSize(extents, axis, plates, thickness, gap),
  };
}
