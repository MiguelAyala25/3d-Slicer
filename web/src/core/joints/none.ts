import { ValidationError } from '../validator';
import { UI_TEXTS_ES } from '../../i18n/es';
import type { JointDefinition } from '../build/types';
import type { SculptureParams } from '../../types/sculpture';

export const NONE_JOINT: JointDefinition = {
  id: 'none',
  label: UI_TEXTS_ES.jointNoneLabel,
  available: true,
  gapPolicy: { kind: 'fixed', value: 0 },
  validateParams(params: SculptureParams): void {
    if (params.gap !== 0) {
      throw new ValidationError('NONE_JOINT_REQUIRES_ZERO_GAP', { received: params.gap });
    }
  },
};
