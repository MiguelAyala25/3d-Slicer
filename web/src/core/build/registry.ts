import { ValidationError } from '../validator';
import { DISCS_JOINT } from '../joints/discs';
import { NONE_JOINT } from '../joints/none';
import type {
  JointDefinition,
  JointId,
  RegistryEntry,
  TechniqueDefinition,
  TechniqueId,
} from './types';

export const TECHNIQUES: TechniqueDefinition[] = [
  {
    id: 'stacked',
    label: 'Planos apilados',
    available: true,
    allowedJointIds: ['none', 'discs', 'rod'],
    defaultJointId: 'discs',
  },
  {
    id: 'waffle',
    label: 'Waffle',
    available: true,
    allowedJointIds: ['slots'],
    defaultJointId: 'slots',
  },
];

export const SLOTS_JOINT: JointDefinition = {
  id: 'slots',
  label: 'Encaje por ranuras',
  available: true,
  gapPolicy: { kind: 'fixed', value: 0 },
  validateParams(): void {},
};

export const ROD_PLACEHOLDER: JointDefinition = {
  id: 'rod',
  label: 'Con varilla',
  available: false,
  unavailableReason: 'Próximamente',
  gapPolicy: { kind: 'fixed', value: 0 },
  validateParams(): void {
    throw new ValidationError('La unión «Con varilla» aún no está disponible.');
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
    throw new ValidationError(`Unión desconocida: '${id}'.`);
  }
  return joint;
}

export function getTechnique(id: TechniqueId): TechniqueDefinition {
  const tech = TECHNIQUES.find((t) => t.id === id);
  if (!tech) {
    throw new ValidationError(`Técnica desconocida: '${id}'.`);
  }
  return tech;
}

export function isAvailable<T extends string>(entry: RegistryEntry<T>): boolean {
  return entry.available;
}
