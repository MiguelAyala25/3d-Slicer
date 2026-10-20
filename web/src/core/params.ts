import type { SculptureParams } from '../types/sculpture';

/**
 * Límites y pasos extraídos de params.py:9-59 y ui.py:94-205 (§0.0).
 */
export const PARAM_BOUNDS = {
  plates: { min: 2, max: 200, step: 1 },
  thickness: { min: 0.1, max: 100.0, step: 0.5 },
  gap: { min: 0.1, max: 1000.0, step: 0.5 },
  sheetW: { min: 10.0, max: 5000.0, step: 10.0 },
  sheetH: { min: 10.0, max: 5000.0, step: 10.0 },
  sheetMargin: { min: 0.0, max: 200.0, step: 1.0 },
  partGap: { min: 0.0, max: 100.0, step: 1.0 },
  kerf: { min: 0.0, max: 5.0, step: 0.01 },
  discDiameter: { min: 1.0, max: 5000.0, step: 1.0 },
  engraveClearance: { min: 0.0, max: 10.0, step: 0.1 },
} as const;

/**
 * Valores por defecto extraídos de params.py:9-33 (§0.0).
 */
export const DEFAULT_PARAMS: SculptureParams = {
  plates: 10,
  thickness: 3.0,
  gap: 3.0,
  axis: 'z',
  sheetW: 600.0,
  sheetH: 400.0,
  sheetMargin: 10.0,
  partGap: 5.0,
  kerf: 0.15,
  discDiameter: 6.0,
  engraveClearance: 0.3,
  scrapTagEnabled: true,
};

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
    return 'Discos: misma lámina que placas';
  }
  return `Discos: lámina aparte de ${params.gap.toFixed(1)} mm`;
}
