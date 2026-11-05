import type { PlateEngraveDisc, SculptureParams, SheetLayout } from '../../types/sculpture';

export type TechniqueId = 'stacked' | 'waffle';
export type JointId = 'none' | 'discs' | 'rod' | 'slots';

export interface RegistryEntry<Id extends string> {
  id: Id;
  label: string;
  available: boolean;
  unavailableReason?: string;
}

export type GapPolicy =
  | { kind: 'fixed'; value: 0 }
  | { kind: 'range'; min: number; max: number; step: number };

export interface JointDefinition extends RegistryEntry<JointId> {
  gapPolicy: GapPolicy;
  validateParams(params: SculptureParams): void;
}

export interface TechniqueDefinition extends RegistryEntry<TechniqueId> {
  allowedJointIds: readonly JointId[];
  defaultJointId: JointId;
}

export interface BuildConfig {
  techniqueId: TechniqueId | '';
  jointId: JointId | '';
}

export const DEFAULT_BUILD: BuildConfig = {
  techniqueId: 'stacked',
  jointId: 'discs',
};

export const INITIAL_BUILD: BuildConfig = {
  techniqueId: '',
  jointId: '',
};

export interface JointLayoutCursor {
  sheets: SheetLayout[];
  currentSheet: SheetLayout;
  cursorX: number;
  cursorY: number;
  rowHeight: number;
  sheetCounter: number;
}

export interface JointLayoutHooks {
  sheetEngraveClearance: number;
  plateEngraveMarks(plateIndex: number, boundsMinX: number, boundsMinY: number): PlateEngraveDisc[];
  placeExtraParts(cursor: JointLayoutCursor, params: SculptureParams): boolean;
}
