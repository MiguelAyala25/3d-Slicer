import { z } from 'zod';
import { PARAM_BOUNDS } from './params';
import { ValidationError } from './errors';
import type { Axis, Disc } from '../types/sculpture';
import type { WaffleDistributionMethod } from './waffle/types';

/**
 * Esquema de validación y parseo de lista de discos ('discs').
 */
export function validateAndParseDiscs(rawDiscs: unknown, maxPlates: number): Disc[] {
  if (!Array.isArray(rawDiscs)) {
    throw new ValidationError('PROJECT_DISCS_LIST_INVALID', {});
  }

  const seenIds = new Set<number>();
  const discs: Disc[] = [];

  for (let i = 0; i < rawDiscs.length; i++) {
    const item = rawDiscs[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ValidationError('PROJECT_DISC_ITEM_INVALID', { position: i });
    }

    const discObj = item as Record<string, unknown>;
    const id = Number(discObj.id);
    const x = Number(discObj.x);
    const y = Number(discObj.y);
    const diameter = Number(discObj.diameter);
    const gapIndex = Number(discObj.hueco);

    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError('PROJECT_DISC_ID_INVALID', { index: i, id: String(discObj.id) });
    }
    if (seenIds.has(id)) {
      throw new ValidationError('PROJECT_DISC_ID_DUPLICATE', { id });
    }
    seenIds.add(id);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ValidationError('PROJECT_DISC_COORDS_NON_NUMERIC', { id });
    }
    if (
      !Number.isFinite(diameter) ||
      diameter < PARAM_BOUNDS.discDiameter.min ||
      diameter > PARAM_BOUNDS.discDiameter.max
    ) {
      throw new ValidationError('PROJECT_DISC_DIAMETER_INVALID', { id, diameter });
    }
    if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex >= maxPlates - 1) {
      throw new ValidationError('PROJECT_DISC_GAP_OUT_OF_RANGE', {
        id,
        gapIndex,
        maxAllowed: maxPlates - 2,
      });
    }

    discs.push({ id, x, y, diameter, gapIndex });
  }

  return discs;
}

const MaterialObjectSchema = z.strictObject({
  thickness: z.number(),
  sheetW: z.number(),
  sheetH: z.number(),
  sheetMargin: z.number(),
  partGap: z.number(),
  kerf: z.number(),
  scrapTagEnabled: z.boolean(),
});

export type ValidatedMaterial = z.infer<typeof MaterialObjectSchema>;

export function validateMaterialSection(matRaw: unknown): ValidatedMaterial {
  if (!matRaw || typeof matRaw !== 'object' || Array.isArray(matRaw)) {
    throw new ValidationError('PROJECT_FIELD_MUST_BE_OBJECT', { field: 'material' });
  }
  const mat = matRaw as Record<string, unknown>;
  const requiredMatKeys = [
    'thickness',
    'sheetW',
    'sheetH',
    'sheetMargin',
    'partGap',
    'kerf',
    'scrapTagEnabled',
  ] as const;

  for (const rk of requiredMatKeys) {
    if (!(rk in mat)) {
      throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', { field: `material.${rk}` });
    }
  }

  for (const k of Object.keys(mat)) {
    if (!requiredMatKeys.includes(k as (typeof requiredMatKeys)[number])) {
      throw new ValidationError('PROJECT_UNRECOGNIZED_SECTION_FIELD', { field: k, section: 'material' });
    }
  }

  const numericMatKeys = ['thickness', 'sheetW', 'sheetH', 'sheetMargin', 'partGap', 'kerf'] as const;
  for (const nk of numericMatKeys) {
    if (typeof mat[nk] !== 'number' || !Number.isFinite(mat[nk])) {
      throw new ValidationError('PROJECT_FIELD_MUST_BE_NUMERIC', { field: `material.${nk}` });
    }
  }
  if (typeof mat.scrapTagEnabled !== 'boolean') {
    throw new ValidationError('PROJECT_FIELD_MUST_BE_BOOLEAN', { field: 'material.scrapTagEnabled' });
  }

  const parseResult = MaterialObjectSchema.safeParse(mat);
  if (!parseResult.success) {
    throw new ValidationError('PROJECT_SCHEMA_ISSUE', {
      message: parseResult.error.issues[0].message,
    });
  }

  return parseResult.data;
}

export interface ValidatedStackedTechnique {
  plates: number;
  axis: Axis;
}

export function validateStackedTechniqueParams(tParamsRaw: unknown): ValidatedStackedTechnique {
  if (!tParamsRaw || typeof tParamsRaw !== 'object' || Array.isArray(tParamsRaw)) {
    throw new ValidationError('PROJECT_FIELD_MUST_BE_OBJECT', { field: 'technique.params' });
  }
  const tParams = tParamsRaw as Record<string, unknown>;

  if (!('plates' in tParams)) {
    throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', {
      field: 'technique.params.plates',
    });
  }
  if (!('axis' in tParams)) {
    throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', {
      field: 'technique.params.axis',
    });
  }
  for (const k of Object.keys(tParams)) {
    if (k !== 'plates' && k !== 'axis') {
      throw new ValidationError('PROJECT_UNRECOGNIZED_SECTION_FIELD', {
        field: k,
        section: 'technique.params',
      });
    }
  }
  if (typeof tParams.plates !== 'number' || !Number.isFinite(tParams.plates)) {
    throw new ValidationError('PROJECT_FIELD_MUST_BE_NUMERIC', {
      field: 'technique.params.plates',
    });
  }

  return {
    plates: tParams.plates,
    axis: String(tParams.axis).toLowerCase() as Axis,
  };
}

const WaffleTechniqueParamsSchema = z.strictObject({
  upAxis: z.enum(['x', 'y', 'z']),
  pitch: z.number(),
  slotClearance: z.number(),
  gridOffset: z.number(),
  slotLabelsEnabled: z.boolean(),
  targetScale: z.number(),
  distributionMethod: z.custom<WaffleDistributionMethod>().optional(),
  count1: z.number().optional(),
  count2: z.number().optional(),
  distance1: z.number().optional(),
  distance2: z.number().optional(),
  notchFactor: z.number().optional(),
  notchAngle: z.number().optional(),
});

export type ValidatedWaffleTechnique = z.infer<typeof WaffleTechniqueParamsSchema>;

export function validateWaffleTechniqueParams(tParamsRaw: unknown): ValidatedWaffleTechnique {
  if (!tParamsRaw || typeof tParamsRaw !== 'object' || Array.isArray(tParamsRaw)) {
    throw new ValidationError('PROJECT_FIELD_MUST_BE_OBJECT', { field: 'technique.params' });
  }
  const tParams = tParamsRaw as Record<string, unknown>;

  const requiredWaffleKeys = [
    'upAxis',
    'pitch',
    'slotClearance',
    'gridOffset',
    'slotLabelsEnabled',
    'targetScale',
  ] as const;

  const allowedWaffleKeys = [
    ...requiredWaffleKeys,
    'distributionMethod',
    'count1',
    'count2',
    'distance1',
    'distance2',
    'notchFactor',
    'notchAngle',
  ] as const;

  for (const rk of requiredWaffleKeys) {
    if (!(rk in tParams)) {
      throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', {
        field: `technique.params.${rk}`,
      });
    }
  }

  for (const k of Object.keys(tParams)) {
    if (!allowedWaffleKeys.includes(k as (typeof allowedWaffleKeys)[number])) {
      throw new ValidationError('PROJECT_UNRECOGNIZED_SECTION_FIELD', {
        field: k,
        section: 'technique.params',
      });
    }
  }

  const upAxis = String(tParams.upAxis).toLowerCase();
  if (upAxis !== 'x' && upAxis !== 'y' && upAxis !== 'z') {
    throw new ValidationError('PROJECT_WAFFLE_UP_AXIS_INVALID', {});
  }

  const numKeys = ['pitch', 'slotClearance', 'gridOffset', 'targetScale'] as const;
  for (const nk of numKeys) {
    if (typeof tParams[nk] !== 'number' || !Number.isFinite(tParams[nk])) {
      throw new ValidationError('PROJECT_FIELD_MUST_BE_NUMERIC', {
        field: `technique.params.${nk}`,
      });
    }
  }

  if (typeof tParams.slotLabelsEnabled !== 'boolean') {
    throw new ValidationError('PROJECT_FIELD_MUST_BE_BOOLEAN', {
      field: 'technique.params.slotLabelsEnabled',
    });
  }

  const normalized = {
    ...tParams,
    upAxis,
  };

  const parsed = WaffleTechniqueParamsSchema.safeParse(normalized);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError('PROJECT_SCHEMA_ISSUE', { message: issue.message });
  }

  return parsed.data;
}

const DiscsJointParamsSchema = z.strictObject({
  gap: z.number(),
  discDiameter: z.number(),
  engraveClearance: z.number(),
});

export type ValidatedDiscsJointParams = z.infer<typeof DiscsJointParamsSchema>;

export function validateDiscsJointParams(jParamsRaw: unknown): ValidatedDiscsJointParams {
  if (!jParamsRaw || typeof jParamsRaw !== 'object' || Array.isArray(jParamsRaw)) {
    throw new ValidationError('PROJECT_FIELD_MUST_BE_OBJECT', { field: 'joint.params' });
  }
  const jParams = jParamsRaw as Record<string, unknown>;
  const reqJointKeys = ['gap', 'discDiameter', 'engraveClearance'] as const;

  for (const rk of reqJointKeys) {
    if (!(rk in jParams)) {
      throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', {
        field: `joint.params.${rk}`,
      });
    }
  }
  for (const k of Object.keys(jParams)) {
    if (!reqJointKeys.includes(k as (typeof reqJointKeys)[number])) {
      throw new ValidationError('PROJECT_UNRECOGNIZED_SECTION_FIELD', {
        field: k,
        section: 'joint.params',
      });
    }
  }

  for (const rk of reqJointKeys) {
    if (typeof jParams[rk] !== 'number' || !Number.isFinite(jParams[rk])) {
      throw new ValidationError('PROJECT_FIELD_MUST_BE_NUMERIC', {
        field: `joint.params.${rk}`,
      });
    }
  }

  const parsed = DiscsJointParamsSchema.safeParse(jParams);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError('PROJECT_SCHEMA_ISSUE', { message: issue.message });
  }

  return parsed.data;
}
