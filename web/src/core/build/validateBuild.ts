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
    throw new ValidationError('BUILD_TECHNIQUE_REQUIRED', {});
  }
  if (build.techniqueId !== 'stacked' && build.techniqueId !== 'waffle') {
    throw new ValidationError('BUILD_UNKNOWN_TECHNIQUE', { id: build.techniqueId });
  }

  if (!build.jointId) {
    throw new ValidationError('BUILD_JOINT_REQUIRED', {});
  }

  if (build.techniqueId === 'waffle') {
    if (build.jointId !== 'slots') {
      throw new ValidationError('BUILD_WAFFLE_REQUIRES_SLOTS_JOINT', { withCode: true });
    }

    validateParams(params);

    if (waffleParams) {
      const minPitch = 2 * params.thickness;
      if (waffleParams.pitch < minPitch - 1e-9) {
        throw new ValidationError('WAFFLE_PITCH_TOO_SMALL', {
          pitch: waffleParams.pitch,
          minPitch: minPitch.toFixed(2),
        });
      }

      const maxOffset = waffleParams.pitch * 0.5;
      if (Math.abs(waffleParams.gridOffset) > maxOffset + 1e-9) {
        throw new ValidationError('WAFFLE_GRID_OFFSET_OUT_OF_RANGE', {
          gridOffset: waffleParams.gridOffset,
          maxOffset: maxOffset.toFixed(2),
        });
      }

      const drawnSlotWidth = params.thickness + waffleParams.slotClearance - params.kerf;
      if (drawnSlotWidth < 0.05) {
        throw new ValidationError('WAFFLE_DRAWN_SLOT_TOO_NARROW', {
          drawnSlotWidth: drawnSlotWidth.toFixed(3),
          kerf: params.kerf,
        });
      }

      if (waffleParams.targetScale <= 0) {
        throw new ValidationError('WAFFLE_TARGET_SCALE_INVALID', {});
      }
    }
    return;
  }

  // techniqueId === 'stacked'
  if (build.jointId === 'slots') {
    throw new ValidationError('BUILD_SLOTS_EXCLUSIVE_TO_WAFFLE', {});
  }

  validateParams(params);

  const joint = getJoint(build.jointId);
  if (!joint.available) {
    throw new ValidationError('BUILD_JOINT_UNAVAILABLE', { label: joint.label });
  }

  joint.validateParams(params);
}
