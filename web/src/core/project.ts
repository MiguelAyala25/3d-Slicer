import { DEFAULT_BUILD } from './build/types';
import type { BuildConfig, JointId, TechniqueId } from './build/types';
import { validateBuildParams } from './build/validateBuild';
import { DEFAULT_PARAMS, PARAM_BOUNDS } from './params';
import { validateParams, ValidationError } from './validator';
import type { Axis, Disc, SculptureParams } from '../types/sculpture';

export const FORMAT_VERSION = '1.0';
export const FORMAT_VERSION_V1 = '1.0';
export const FORMAT_VERSION_V2 = '2.0';

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
  version: '1.0' | '2.0';
  params: SculptureParams;
  discs: Disc[];
  build: BuildConfig;
}

export function formatPythonFloat(n: number): string {
  return Number.isInteger(n) ? `${n.toFixed(1)}` : `${n}`;
}

export function projectFormatFor(
  build: BuildConfig,
  params: SculptureParams
): '1.0' | '2.0' {
  if (
    build.techniqueId === 'stacked' &&
    build.jointId === 'discs' &&
    params.gap > 0
  ) {
    return '1.0';
  }
  return '2.0';
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

function serializeProject2(
  params: SculptureParams,
  build: BuildConfig,
  discs: Disc[]
): string {
  const lines: string[] = [
    '{',
    '  "version": "2.0",',
    '  "material": {',
    `    "thickness": ${formatPythonFloat(params.thickness)},`,
    `    "sheetW": ${formatPythonFloat(params.sheetW)},`,
    `    "sheetH": ${formatPythonFloat(params.sheetH)},`,
    `    "sheetMargin": ${formatPythonFloat(params.sheetMargin)},`,
    `    "partGap": ${formatPythonFloat(params.partGap)},`,
    `    "kerf": ${formatPythonFloat(params.kerf)},`,
    `    "scrapTagEnabled": ${params.scrapTagEnabled ? 'true' : 'false'}`,
    '  },',
    '  "technique": {',
    `    "id": "${build.techniqueId}",`,
    '    "params": {',
    `      "plates": ${params.plates},`,
    `      "axis": "${params.axis}"`,
    '    }',
    '  },',
    '  "joint": {',
    `    "id": "${build.jointId}",`,
  ];

  if (build.jointId === 'none') {
    lines.push('    "params": {}');
  } else if (build.jointId === 'discs') {
    lines.push(
      '    "params": {',
      `      "gap": ${formatPythonFloat(params.gap)},`,
      `      "discDiameter": ${formatPythonFloat(params.discDiameter)},`,
      `      "engraveClearance": ${formatPythonFloat(params.engraveClearance)}`,
      '    },'
    );
    if (discs.length === 0) {
      lines.push('    "discs": []');
    } else {
      const discBlocks = discs.map((d) => [
        '      {',
        `        "id": ${d.id},`,
        `        "hueco": ${d.gapIndex},`,
        `        "x": ${formatPythonFloat(d.x)},`,
        `        "y": ${formatPythonFloat(d.y)},`,
        `        "diameter": ${formatPythonFloat(d.diameter)}`,
        '      }',
      ].join('\n'));
      lines.push(`    "discs": [\n${discBlocks.join(',\n')}\n    ]`);
    }
  }

  lines.push('  }');
  lines.push('}');
  return lines.join('\n');
}

export function serializeProject(
  params: SculptureParams,
  build: BuildConfig,
  discs: Disc[]
): string {
  const version = projectFormatFor(build, params);
  if (version === '1.0') {
    return serializeProjectJson(params, discs);
  }
  return serializeProject2(params, build, discs);
}

function parseDiscsList(rawDiscs: unknown, maxPlates: number): Disc[] {
  if (!Array.isArray(rawDiscs)) {
    throw new ValidationError("El archivo de proyecto no contiene una lista 'discs' válida.");
  }

  const seenIds = new Set<number>();
  const discs: Disc[] = [];

  for (let i = 0; i < rawDiscs.length; i++) {
    const item = rawDiscs[i] as Record<string, unknown>;
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
    if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex >= maxPlates - 1) {
      throw new ValidationError(
        `El disco id=${id} tiene un hueco fuera de rango (${gapIndex}; máximo permitido ${maxPlates - 2}).`
      );
    }

    discs.push({ id, x, y, diameter, gapIndex });
  }

  return discs;
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
  const version = obj.version;
  if (version !== '1.0' && version !== '2.0') {
    throw new ValidationError(
      `Versión de archivo no soportada: '${String(version)}' (se esperaba '1.0' o '2.0').`
    );
  }

  if (version === '1.0') {
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
    const discs = parseDiscsList(obj.discs, params.plates);

    return {
      version: '1.0',
      params,
      discs,
      build: { ...DEFAULT_BUILD },
    };
  }

  // Versión 2.0
  const allowedRootKeys = ['version', 'material', 'technique', 'joint'];
  for (const k of ['material', 'technique', 'joint']) {
    if (!(k in obj)) {
      throw new ValidationError(`Falta el campo obligatorio '${k}' en el archivo JSON.`);
    }
  }
  for (const k of Object.keys(obj)) {
    if (!allowedRootKeys.includes(k)) {
      throw new ValidationError(`Campo no reconocido '${k}' en la raíz.`);
    }
  }

  // Material
  if (!obj.material || typeof obj.material !== 'object' || Array.isArray(obj.material)) {
    throw new ValidationError("El campo 'material' debe ser un objeto.");
  }
  const mat = obj.material as Record<string, unknown>;
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
    if (!requiredMatKeys.includes(k as any)) {
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

  // Technique
  if (!obj.technique || typeof obj.technique !== 'object' || Array.isArray(obj.technique)) {
    throw new ValidationError("El campo 'technique' debe ser un objeto.");
  }
  const tech = obj.technique as Record<string, unknown>;
  if (!('id' in tech)) {
    throw new ValidationError("Falta el campo obligatorio 'technique.id' en el archivo JSON.");
  }
  if (!('params' in tech)) {
    throw new ValidationError("Falta el campo obligatorio 'technique.params' en el archivo JSON.");
  }
  for (const k of Object.keys(tech)) {
    if (k !== 'id' && k !== 'params') {
      throw new ValidationError(`Campo no reconocido '${k}' en 'technique'.`);
    }
  }

  const techId = String(tech.id);
  if (techId !== 'stacked' && techId !== 'waffle') {
    throw new ValidationError(`Técnica desconocida: '${techId}'.`);
  }
  if (techId === 'waffle') {
    throw new ValidationError('La técnica «Waffle» aún no está disponible.');
  }

  if (!tech.params || typeof tech.params !== 'object' || Array.isArray(tech.params)) {
    throw new ValidationError("El campo 'technique.params' debe ser un objeto.");
  }
  const tParams = tech.params as Record<string, unknown>;
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

  // Joint
  if (!obj.joint || typeof obj.joint !== 'object' || Array.isArray(obj.joint)) {
    throw new ValidationError("El campo 'joint' debe ser un objeto.");
  }
  const joint = obj.joint as Record<string, unknown>;
  if (!('id' in joint)) {
    throw new ValidationError("Falta el campo obligatorio 'joint.id' en el archivo JSON.");
  }
  if (!('params' in joint)) {
    throw new ValidationError("Falta el campo obligatorio 'joint.params' en el archivo JSON.");
  }

  const jointId = String(joint.id);
  if (jointId !== 'none' && jointId !== 'discs' && jointId !== 'rod') {
    throw new ValidationError(`Unión desconocida: '${jointId}'.`);
  }
  if (jointId === 'rod') {
    throw new ValidationError('La unión «Con varilla» aún no está disponible.');
  }

  if (jointId === 'none') {
    if ('discs' in joint) {
      throw new ValidationError('La unión «Sin separación» no admite discos.');
    }
    for (const k of Object.keys(joint)) {
      if (k !== 'id' && k !== 'params') {
        throw new ValidationError(`Campo no reconocido '${k}' en 'joint'.`);
      }
    }
  } else if (jointId === 'discs') {
    if (!('discs' in joint)) {
      throw new ValidationError("Falta el campo obligatorio 'joint.discs' en el archivo JSON.");
    }
    for (const k of Object.keys(joint)) {
      if (k !== 'id' && k !== 'params' && k !== 'discs') {
        throw new ValidationError(`Campo no reconocido '${k}' en 'joint'.`);
      }
    }
  }

  if (!joint.params || typeof joint.params !== 'object' || Array.isArray(joint.params)) {
    throw new ValidationError("El campo 'joint.params' debe ser un objeto.");
  }
  const jParams = joint.params as Record<string, unknown>;
  if (jointId === 'none') {
    const keys = Object.keys(jParams);
    if (keys.length > 0) {
      throw new ValidationError(`Campo no reconocido '${keys[0]}' en 'joint.params'.`);
    }
  } else if (jointId === 'discs') {
    const reqJointKeys = ['gap', 'discDiameter', 'engraveClearance'] as const;
    for (const rk of reqJointKeys) {
      if (!(rk in jParams)) {
        throw new ValidationError(`Falta el campo obligatorio 'joint.params.${rk}' en el archivo JSON.`);
      }
    }
    for (const k of Object.keys(jParams)) {
      if (!reqJointKeys.includes(k as any)) {
        throw new ValidationError(`Campo no reconocido '${k}' en 'joint.params'.`);
      }
    }
    for (const rk of reqJointKeys) {
      if (typeof jParams[rk] !== 'number' || !Number.isFinite(jParams[rk])) {
        throw new ValidationError(`El campo 'joint.params.${rk}' debe ser numérico.`);
      }
    }
  }

  const build: BuildConfig = {
    techniqueId: techId as TechniqueId,
    jointId: jointId as JointId,
  };

  const params: SculptureParams = {
    thickness: mat.thickness as number,
    sheetW: mat.sheetW as number,
    sheetH: mat.sheetH as number,
    sheetMargin: mat.sheetMargin as number,
    partGap: mat.partGap as number,
    kerf: mat.kerf as number,
    scrapTagEnabled: mat.scrapTagEnabled as boolean,
    plates: tParams.plates as number,
    axis: String(tParams.axis).toLowerCase() as Axis,
    gap: jointId === 'none' ? 0 : (jParams.gap as number),
    discDiameter: jointId === 'none' ? baseParams.discDiameter : (jParams.discDiameter as number),
    engraveClearance: jointId === 'none' ? baseParams.engraveClearance : (jParams.engraveClearance as number),
  };

  validateBuildParams(params, build);

  let discs: Disc[] = [];
  if (jointId === 'discs') {
    discs = parseDiscsList(joint.discs, params.plates);
  }

  return {
    version: '2.0',
    params,
    discs,
    build,
  };
}

/**
 * Traducción exacta de project.py:88-115 (check_params_compatibility).
 * Verifica si los parámetros geométricos de corte coinciden.
 */
export function checkParamsCompatibility(
  fileParams: Pick<SculptureParams, 'plates' | 'thickness' | 'gap' | 'axis'>,
  currentParams: Pick<SculptureParams, 'plates' | 'thickness' | 'gap' | 'axis'>,
  fileBuild?: BuildConfig,
  currentBuild?: BuildConfig
): boolean {
  if (fileBuild && currentBuild) {
    if (
      fileBuild.techniqueId !== currentBuild.techniqueId ||
      fileBuild.jointId !== currentBuild.jointId
    ) {
      return false;
    }
  }
  if (fileParams.plates !== currentParams.plates) return false;
  if (Math.abs(fileParams.thickness - currentParams.thickness) > 1e-4) return false;
  if (Math.abs(fileParams.gap - currentParams.gap) > 1e-4) return false;
  if (fileParams.axis !== currentParams.axis) return false;
  return true;
}

export const INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE =
  'Los parámetros del archivo difieren de los actuales. Adaptar el proyecto implica volver a rebanar el modelo 3D. ¿Deseas rebanar y adaptar el proyecto, o cancelar?';
