import { validateParams, ValidationError } from '../validator';
import { getJoint } from './registry';
import type { BuildConfig } from './types';
import type { SculptureParams } from '../../types/sculpture';
import type { WaffleParams } from '../waffle/types';

export function validateBuildParams(
  params: SculptureParams,
  build: BuildConfig,
  waffleParams?: WaffleParams
): void {
  if (!build.techniqueId) {
    throw new ValidationError('Selecciona una técnica de construcción.');
  }
  if (build.techniqueId !== 'stacked' && build.techniqueId !== 'waffle') {
    throw new ValidationError(`Técnica desconocida: '${build.techniqueId}'.`);
  }

  if (!build.jointId) {
    throw new ValidationError('Selecciona un tipo de unión.');
  }

  if (build.techniqueId === 'waffle') {
    if (build.jointId !== 'slots') {
      throw new ValidationError(
        "La técnica «Waffle» solo admite la unión «Encaje por ranuras» ('slots')."
      );
    }

    validateParams(params);

    if (waffleParams) {
      const minPitch = 2 * params.thickness;
      if (waffleParams.pitch < minPitch - 1e-9) {
        throw new ValidationError(
          `La separación entre secciones (${waffleParams.pitch} mm) debe ser al menos 2 veces el grosor de placa (${minPitch.toFixed(2)} mm).`
        );
      }

      const maxOffset = waffleParams.pitch * 0.5;
      if (Math.abs(waffleParams.gridOffset) > maxOffset + 1e-9) {
        throw new ValidationError(
          `El desfase de rejilla (${waffleParams.gridOffset} mm) debe estar entre -${maxOffset.toFixed(2)} y +${maxOffset.toFixed(2)} mm.`
        );
      }

      const drawnSlotWidth = params.thickness + waffleParams.slotClearance - params.kerf;
      if (drawnSlotWidth < 0.05) {
        throw new ValidationError(
          `El ancho dibujado de ranura (t + holgura - kerf = ${drawnSlotWidth.toFixed(3)} mm) debe ser mayor a 0.05 mm. Reduce el kerf (${params.kerf} mm) o aumenta el grosor/holgura.`
        );
      }

      if (waffleParams.targetScale <= 0) {
        throw new ValidationError('El factor de escala debe ser mayor a 0.');
      }
    }
    return;
  }

  // techniqueId === 'stacked'
  if (build.jointId === 'slots') {
    throw new ValidationError(
      'La unión «Encaje por ranuras» es exclusiva de la técnica «Waffle».'
    );
  }

  validateParams(params);

  const joint = getJoint(build.jointId);
  if (!joint.available) {
    throw new ValidationError(`La unión «${joint.label}» aún no está disponible.`);
  }

  joint.validateParams(params);
}
