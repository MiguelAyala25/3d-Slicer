import type { Axis, CoreParams } from '../types/sculpture';
import type { FamilyId } from './waffle/canonicalFrame';

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

/**
 * Calcula el factor de escala continuo para alcanzar una dimensión objetivo en mm.
 * Utilizado por la técnica Waffle donde el candado de proporción está cerrado y no aplica N*t + (N-1)*g.
 */
export function scaleForTargetDimension(
  extents: ModelExtents,
  dim: ModelDimension,
  targetMm: number
): number {
  const orig = extentOf(extents, dim);
  return orig > 0 ? targetMm / orig : 1.0;
}

/**
 * Devuelve las 3 dimensiones finales a partir de extents sin escalar y un factor de escala uniforme.
 */
export function finalSizeFromScale(extents: ModelExtents, scale: number): FinalSize {
  return {
    alto: extents.z * scale,
    ancho: extents.x * scale,
    largo: extents.y * scale,
    scale,
  };
}

/**
 * Calcula la escala máxima para la técnica Waffle de modo que ninguna pieza
 * exceda el área útil de la hoja (ancho útil x alto útil) sin rotación.
 */
export function waffleMaxFit(
  extents: ModelExtents,
  upAxis: Axis,
  sheet: Pick<CoreParams, 'sheetW' | 'sheetH' | 'sheetMargin'>
): {
  maxScale: number;
  size: FinalSize;
  limitingFamily: FamilyId;
  limitingAxisLabel: string;
} | null {
  const usableW = sheet.sheetW - 2.0 * sheet.sheetMargin;
  const usableH = sheet.sheetH - 2.0 * sheet.sheetMargin;
  if (usableW <= 0 || usableH <= 0) return null;

  let vExtent = 0;
  let uP1Extent = 0;
  let uP2Extent = 0;
  let vLabel = '';
  let uP1Label = '';
  let uP2Label = '';

  if (upAxis === 'z') {
    vExtent = extents.z;
    vLabel = 'Alto (Z)';
    uP1Extent = extents.y;
    uP1Label = 'Largo (Y)';
    uP2Extent = extents.x;
    uP2Label = 'Ancho (X)';
  } else if (upAxis === 'x') {
    vExtent = extents.x;
    vLabel = 'Ancho (X)';
    uP1Extent = extents.z;
    uP1Label = 'Alto (Z)';
    uP2Extent = extents.y;
    uP2Label = 'Largo (Y)';
  } else {
    // upAxis === 'y'
    vExtent = extents.y;
    vLabel = 'Largo (Y)';
    uP1Extent = extents.x;
    uP1Label = 'Ancho (X)';
    uP2Extent = extents.z;
    uP2Label = 'Alto (Z)';
  }

  if (vExtent <= 0 || uP1Extent <= 0 || uP2Extent <= 0) return null;

  const sV = usableH / vExtent;
  const sU1 = usableW / uP1Extent;
  const sU2 = usableW / uP2Extent;

  let maxScale = sV;
  let limitingFamily: FamilyId = 'P1';
  let limitingAxisLabel = vLabel;

  if (sU1 < maxScale) {
    maxScale = sU1;
    limitingFamily = 'P1';
    limitingAxisLabel = uP1Label;
  }
  if (sU2 < maxScale) {
    maxScale = sU2;
    limitingFamily = 'P2';
    limitingAxisLabel = uP2Label;
  }

  return {
    maxScale,
    size: finalSizeFromScale(extents, maxScale),
    limitingFamily,
    limitingAxisLabel,
  };
}

export function horizontalExtentsForUpAxis(
  extents: ModelExtents,
  upAxis: Axis
): { h1: number; h2: number } {
  if (upAxis === 'x') {
    return { h1: extents.y, h2: extents.z };
  }
  if (upAxis === 'y') {
    return { h1: extents.z, h2: extents.x };
  }
  return { h1: extents.x, h2: extents.y };
}

/**
 * Calcula un factor de escala uniforme saludable para Waffle a partir de los extents del modelo,
 * sincronizándolo con el tamaño activo en Modelo (uniformScale o sizeIntent) y asegurando que
 * las dimensiones horizontales permitan múltiples secciones si el modelo viene en unidades
 * pequeñas (metros/normalizado) o es muy angosto respecto al grosor.
 */
export function computeInitialWaffleScale(
  extents: ModelExtents,
  params: Pick<
    CoreParams,
    'axis' | 'plates' | 'thickness' | 'gap' | 'sheetW' | 'sheetH' | 'sheetMargin'
  >,
  upAxis: Axis,
  pitch: number,
  sizeIntent: SizeIntent
): number {
  if (sizeIntent.kind === 'size') {
    return scaleForTargetDimension(extents, sizeIntent.dim, sizeIntent.targetMm);
  }

  const baseScale = uniformScale(
    extents,
    params.axis,
    params.plates,
    params.thickness,
    params.gap
  );

  const { h1, h2 } = horizontalExtentsForUpAxis(extents, upAxis);
  const minHoriz = Math.min(h1, h2);
  if (minHoriz <= 0) return baseScale;

  const minLegalPitch = 2 * params.thickness;
  if (minHoriz * baseScale >= 4 * minLegalPitch) {
    return baseScale;
  }

  const desiredScale = (5 * Math.max(pitch, minLegalPitch)) / minHoriz;
  const fit = waffleMaxFit(extents, upAxis, params);
  if (fit && fit.maxScale > 0) {
    return Math.min(desiredScale, fit.maxScale * 0.85);
  }
  return desiredScale;
}

/**
 * Calcula la separación automática inicial entre secciones (pitch) cuando el usuario
 * no la ha editado manualmente: usa 4*t por defecto, pero si el eje horizontal menor
 * escalado es pequeño (< 4 * 4*t), reduce el paso (hasta el mínimo legal 2*t) para
 * garantizar al menos 4 secciones por eje.
 */
export function computeAdaptiveWafflePitch(
  extents: ModelExtents | null,
  scaleFactor: number,
  upAxis: Axis,
  thickness: number
): number {
  const defaultPitch = Number((4 * thickness).toFixed(2));
  const minPitch = Number((2 * thickness).toFixed(2));
  if (!extents || scaleFactor <= 0) return defaultPitch;

  const { h1, h2 } = horizontalExtentsForUpAxis(extents, upAxis);
  const minHorizMm = Math.min(h1, h2) * scaleFactor;
  if (minHorizMm <= 0 || minHorizMm >= 4 * defaultPitch) {
    return defaultPitch;
  }

  const rawPitch = minHorizMm / 4;
  const stepped = Math.floor(rawPitch * 2) / 2;
  return Math.max(minPitch, Math.min(defaultPitch, Number(stepped.toFixed(2))));
}

