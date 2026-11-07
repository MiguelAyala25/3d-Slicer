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
    throw new ValidationError("El archivo de proyecto no contiene una lista 'discs' válida.");
  }

  const seenIds = new Set<number>();
  const discs: Disc[] = [];

  for (let i = 0; i < rawDiscs.length; i++) {
    const item = rawDiscs[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ValidationError(`El disco en la posición ${i} es inválido.`);
    }

    const discObj = item as Record<string, unknown>;
    const id = Number(discObj.id);
    const x = Number(discObj.x);
    const y = Number(discObj.y);
    const diameter = Number(discObj.diameter);
    const gapIndex = Number(discObj.hueco);

    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError(`El disco #${i} tiene un 'id' inválido (${String(discObj.id)}).`);
    }
    if (seenIds.has(id)) {
      throw new ValidationError(`El archivo contiene IDs de disco duplicados (id=${id}).`);
    }
    seenIds.add(id);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ValidationError(`El disco id=${id} tiene coordenadas (x, y) no numéricas.`);
    }
    if (
      !Number.isFinite(diameter) ||
      diameter < PARAM_BOUNDS.discDiameter.min ||
      diameter > PARAM_BOUNDS.discDiameter.max
    ) {
      throw new ValidationError(
        `El disco id=${id} tiene un diámetro inválido (${diameter} mm).`
      );
    }
    if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex >= maxPlates - 1) {
      throw new ValidationError(
        `El disco id=${id} tiene un hueco fuera de rango (${gapIndex}; máximo permitido ${maxPlates - 2}).`
      );
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
    throw new ValidationError("El campo 'material' debe ser un objeto.");
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
      throw new ValidationError(`Falta el campo obligatorio 'material.${rk}' en el archivo JSON.`);
    }
  }

  for (const k of Object.keys(mat)) {
    if (!requiredMatKeys.includes(k as (typeof requiredMatKeys)[number])) {
      throw new ValidationError(`Campo no reconocido '${k}' en 'material'.`);
    }
  }

  const numericMatKeys = ['thickness', 'sheetW', 'sheetH', 'sheetMargin', 'partGap', 'kerf'] as const;
  for (const nk of numericMatKeys) {
    if (typeof mat[nk] !== 'number' || !Number.isFinite(mat[nk])) {
      throw new ValidationError(`El campo 'material.${nk}' debe ser numérico.`);
    }
  }
  if (typeof mat.scrapTagEnabled !== 'boolean') {
    throw new ValidationError("El campo 'material.scrapTagEnabled' debe ser booleano.");
  }

  const parseResult = MaterialObjectSchema.safeParse(mat);
  if (!parseResult.success) {
    throw new ValidationError(parseResult.error.issues[0].message);
  }

  return parseResult.data;
}

export interface ValidatedStackedTechnique {
  plates: number;
  axis: Axis;
}

export function validateStackedTechniqueParams(tParamsRaw: unknown): ValidatedStackedTechnique {
  if (!tParamsRaw || typeof tParamsRaw !== 'object' || Array.isArray(tParamsRaw)) {
    throw new ValidationError("El campo 'technique.params' debe ser un objeto.");
  }
  const tParams = tParamsRaw as Record<string, unknown>;

  if (!('plates' in tParams)) {
    throw new ValidationError("Falta el campo obligatorio 'technique.params.plates' en el archivo JSON.");
  }
  if (!('axis' in tParams)) {
    throw new ValidationError("Falta el campo obligatorio 'technique.params.axis' en el archivo JSON.");
  }
  for (const k of Object.keys(tParams)) {
    if (k !== 'plates' && k !== 'axis') {
      throw new ValidationError(`Campo no reconocido '${k}' en 'technique.params'.`);
    }
  }
  if (typeof tParams.plates !== 'number' || !Number.isFinite(tParams.plates)) {
    throw new ValidationError("El campo 'technique.params.plates' debe ser numérico.");
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
    throw new ValidationError("El campo 'technique.params' debe ser un objeto.");
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
      throw new ValidationError(`Falta el campo obligatorio 'technique.params.${rk}' en el archivo JSON.`);
    }
  }

  for (const k of Object.keys(tParams)) {
    if (!allowedWaffleKeys.includes(k as (typeof allowedWaffleKeys)[number])) {
      throw new ValidationError(`Campo no reconocido '${k}' en 'technique.params'.`);
    }
  }

  const upAxis = String(tParams.upAxis).toLowerCase();
  if (upAxis !== 'x' && upAxis !== 'y' && upAxis !== 'z') {
    throw new ValidationError("El campo 'technique.params.upAxis' debe ser 'x', 'y' o 'z'.");
  }

  const numKeys = ['pitch', 'slotClearance', 'gridOffset', 'targetScale'] as const;
  for (const nk of numKeys) {
    if (typeof tParams[nk] !== 'number' || !Number.isFinite(tParams[nk])) {
      throw new ValidationError(`El campo 'technique.params.${nk}' debe ser numérico.`);
    }
  }

  if (typeof tParams.slotLabelsEnabled !== 'boolean') {
    throw new ValidationError("El campo 'technique.params.slotLabelsEnabled' debe ser booleano.");
  }

  const normalized = {
    ...tParams,
    upAxis,
  };

  const parsed = WaffleTechniqueParamsSchema.safeParse(normalized);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(issue.message);
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
    throw new ValidationError("El campo 'joint.params' debe ser un objeto.");
  }
  const jParams = jParamsRaw as Record<string, unknown>;
  const reqJointKeys = ['gap', 'discDiameter', 'engraveClearance'] as const;

  for (const rk of reqJointKeys) {
    if (!(rk in jParams)) {
      throw new ValidationError(`Falta el campo obligatorio 'joint.params.${rk}' en el archivo JSON.`);
    }
  }
  for (const k of Object.keys(jParams)) {
    if (!reqJointKeys.includes(k as (typeof reqJointKeys)[number])) {
      throw new ValidationError(`Campo no reconocido '${k}' en 'joint.params'.`);
    }
  }

  for (const rk of reqJointKeys) {
    if (typeof jParams[rk] !== 'number' || !Number.isFinite(jParams[rk])) {
      throw new ValidationError(`El campo 'joint.params.${rk}' debe ser numérico.`);
    }
  }

  const parsed = DiscsJointParamsSchema.safeParse(jParams);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(issue.message);
  }

  return parsed.data;
}
