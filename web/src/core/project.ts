import { DEFAULT_PARAMS, PARAM_BOUNDS } from './params';
import { validateParams, ValidationError } from './validator';
import type { Axis, Disc, SculptureParams } from '../types/sculpture';

export const FORMAT_VERSION = '1.0';

/**
 * Esquema exacto de project.py:29-39 y web/golden/l_block_project.json (§0.0).
 */
export interface SerializedProjectFile {
  version: string;
  plates: number;
  thickness: number;
  gap: number;
  axis: Axis;
  discs: Array<{
    id: number;
    hueco: number;
    x: number;
    y: number;
    diameter: number;
  }>;
}

export interface ParsedProjectData {
  version: string;
  params: SculptureParams;
  discs: Disc[];
}

function formatPythonFloat(n: number): string {
  return Number.isInteger(n) ? `${n.toFixed(1)}` : `${n}`;
}

/**
 * Serializa el proyecto en el formato exacto de project.py:14-46 y
 * web/golden/l_block_project.json (byte-compatible con json.dumps(..., indent=2)).
 */
export function serializeProjectJson(
  params: SculptureParams,
  discs: Disc[]
): string {
  validateParams(params);
  const discBlocks = discs.map((d) => {
    const lines = [
      '    {',
      `      "id": ${d.id},`,
      `      "hueco": ${d.gapIndex},`,
      `      "x": ${formatPythonFloat(d.x)},`,
      `      "y": ${formatPythonFloat(d.y)},`,
      `      "diameter": ${formatPythonFloat(d.diameter)}`,
      '    }',
    ];
    return lines.join('\n');
  });

  const discsSection =
    discBlocks.length === 0
      ? '  "discs": []'
      : `  "discs": [\n${discBlocks.join(',\n')}\n  ]`;

  return [
    '{',
    `  "version": "${FORMAT_VERSION}",`,
    `  "plates": ${params.plates},`,
    `  "thickness": ${formatPythonFloat(params.thickness)},`,
    `  "gap": ${formatPythonFloat(params.gap)},`,
    `  "axis": "${params.axis}",`,
    discsSection,
    '}',
  ].join('\n');
}

export function parseProjectJson(
  jsonText: string,
  baseParams: SculptureParams = DEFAULT_PARAMS
): ParsedProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new ValidationError('El archivo de proyecto no contiene un JSON válido.');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('El formato del archivo de proyecto es inválido.');
  }

  const obj = raw as Record<string, unknown>;
  if (obj.version !== FORMAT_VERSION) {
    throw new ValidationError(
      `Versión de archivo no soportada: '${String(obj.version ?? 'desconocida')}' (se esperaba '${FORMAT_VERSION}').`
    );
  }

  const requiredKeys = ['plates', 'thickness', 'gap', 'axis', 'discs'] as const;
  for (const key of requiredKeys) {
    if (!(key in obj)) {
      throw new ValidationError(`Falta el campo obligatorio '${key}' en el archivo JSON.`);
    }
  }

  const params: SculptureParams = {
    ...baseParams,
    plates: Number(obj.plates),
    thickness: Number(obj.thickness),
    gap: Number(obj.gap),
    axis: String(obj.axis).toLowerCase() as Axis,
  };

  validateParams(params);

  if (!Array.isArray(obj.discs)) {
    throw new ValidationError("El archivo de proyecto no contiene una lista 'discs' válida.");
  }

  const seenIds = new Set<number>();
  const discs: Disc[] = [];

  for (let i = 0; i < obj.discs.length; i++) {
    const item = obj.discs[i] as Record<string, unknown>;
    if (!item || typeof item !== 'object') {
      throw new ValidationError(`El disco en la posición ${i} es inválido.`);
    }
    const id = Number(item.id);
    const x = Number(item.x);
    const y = Number(item.y);
    const diameter = Number(item.diameter);
    const gapIndex = Number(item.hueco);

    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError(`El disco #${i} tiene un 'id' inválido (${String(item.id)}).`);
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
    if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex >= params.plates - 1) {
      throw new ValidationError(
        `El disco id=${id} tiene un hueco fuera de rango (${gapIndex}; máximo permitido ${params.plates - 2}).`
      );
    }

    discs.push({ id, x, y, diameter, gapIndex });
  }

  return {
    version: FORMAT_VERSION,
    params,
    discs,
  };
}

/**
 * Traducción exacta de project.py:88-115 (check_params_compatibility).
 * Verifica si los parámetros geométricos de corte coinciden.
 */
export function checkParamsCompatibility(
  fileParams: Pick<SculptureParams, 'plates' | 'thickness' | 'gap' | 'axis'>,
  currentParams: Pick<SculptureParams, 'plates' | 'thickness' | 'gap' | 'axis'>
): boolean {
  if (fileParams.plates !== currentParams.plates) return false;
  if (Math.abs(fileParams.thickness - currentParams.thickness) > 1e-4) return false;
  if (Math.abs(fileParams.gap - currentParams.gap) > 1e-4) return false;
  if (fileParams.axis !== currentParams.axis) return false;
  return true;
}

export const INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE =
  'Los parámetros del archivo difieren de los actuales. Adaptar el proyecto implica volver a rebanar el modelo 3D. ¿Deseas rebanar y adaptar el proyecto, o cancelar?';
