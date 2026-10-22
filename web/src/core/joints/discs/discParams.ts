import { PARAM_BOUNDS } from '../../params';
import { ValidationError } from '../../validator';
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
    return 'Discos: misma lámina que placas';
  }
  return `Discos: lámina aparte de ${params.gap.toFixed(1)} mm`;
}

export function validateDiscsParams(params: SculptureParams): void {
  if (
    !Number.isFinite(params.gap) ||
    params.gap < PARAM_BOUNDS.gap.min ||
    params.gap > PARAM_BOUNDS.gap.max
  ) {
    throw new ValidationError(
      `La separación debe ser mayor o igual a ${PARAM_BOUNDS.gap.min} mm y menor o igual a ${PARAM_BOUNDS.gap.max} mm (recibido: ${params.gap}).`
    );
  }
  if (
    !Number.isFinite(params.discDiameter) ||
    params.discDiameter < PARAM_BOUNDS.discDiameter.min ||
    params.discDiameter > PARAM_BOUNDS.discDiameter.max
  ) {
    throw new ValidationError(
      `El diámetro del disco debe estar entre ${PARAM_BOUNDS.discDiameter.min} y ${PARAM_BOUNDS.discDiameter.max} mm (recibido: ${params.discDiameter}).`
    );
  }
  if (
    !Number.isFinite(params.engraveClearance) ||
    params.engraveClearance < PARAM_BOUNDS.engraveClearance.min ||
    params.engraveClearance > PARAM_BOUNDS.engraveClearance.max
  ) {
    throw new ValidationError(
      `La holgura de grabado debe estar entre ${PARAM_BOUNDS.engraveClearance.min} y ${PARAM_BOUNDS.engraveClearance.max} mm (recibido: ${params.engraveClearance}).`
    );
  }
}
