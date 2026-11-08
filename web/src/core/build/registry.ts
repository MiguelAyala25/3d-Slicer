import { ValidationError } from '../validator';
import { DISCS_JOINT } from '../joints/discs';
import { NONE_JOINT } from '../joints/none';
import { UI_TEXTS_ES } from '../../i18n/es';
import type {
  JointDefinition,
  JointId,
  TechniqueDefinition,
  TechniqueId,
} from './types';

export const TECHNIQUES: TechniqueDefinition[] = [
  {
    id: 'stacked',
    label: UI_TEXTS_ES.techniqueStackedLabel,
    available: true,
    allowedJointIds: ['none', 'discs', 'rod'],
    defaultJointId: 'discs',
  },
  {
    id: 'waffle',
    label: UI_TEXTS_ES.techniqueWaffleLabel,
    available: true,
    allowedJointIds: ['slots'],
    defaultJointId: 'slots',
  },
];

export const SLOTS_JOINT: JointDefinition = {
  id: 'slots',
  label: UI_TEXTS_ES.jointSlotsLabel,
  available: true,
  gapPolicy: { kind: 'fixed', value: 0 },
  validateParams(): void {},
};

export const ROD_PLACEHOLDER: JointDefinition = {
  id: 'rod',
  label: UI_TEXTS_ES.jointRodLabel,
  available: false,
  unavailableReason: UI_TEXTS_ES.jointRodUnavailableReason,
  gapPolicy: { kind: 'fixed', value: 0 },
  validateParams(): void {
    throw new ValidationError('BUILD_ROD_JOINT_UNAVAILABLE', {});
  },
};

export const JOINTS: JointDefinition[] = [
  NONE_JOINT,
  DISCS_JOINT,
  SLOTS_JOINT,
  ROD_PLACEHOLDER,
];

export function getJoint(id: JointId): JointDefinition {
  const joint = JOINTS.find((j) => j.id === id);
  if (!joint) {
    throw new ValidationError('BUILD_UNKNOWN_JOINT', { id });
  }
  return joint;
}

export function getTechnique(id: TechniqueId): TechniqueDefinition {
  const tech = TECHNIQUES.find((t) => t.id === id);
  if (!tech) {
    throw new ValidationError('BUILD_UNKNOWN_TECHNIQUE', { id });
  }
  return tech;
}
