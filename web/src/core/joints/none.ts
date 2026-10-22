import { ValidationError } from '../validator';
import type { JointDefinition } from '../build/types';
import type { SculptureParams } from '../../types/sculpture';

export const NONE_JOINT: JointDefinition = {
  id: 'none',
  label: 'Sin separación',
  available: true,
  gapPolicy: { kind: 'fixed', value: 0 },
  validateParams(params: SculptureParams): void {
    if (params.gap !== 0) {
      throw new ValidationError(
        `La unión «Sin separación» requiere separación 0 mm (recibido: ${params.gap}).`
      );
    }
  },
};
