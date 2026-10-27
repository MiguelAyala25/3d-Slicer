import { DEFAULT_BUILD } from './build/types';
import type { BuildConfig, JointId, TechniqueId } from './build/types';
import { validateBuildParams } from './build/validateBuild';
import { DEFAULT_PARAMS, PARAM_BOUNDS } from './params';
import { validateParams, ValidationError } from './validator';
import type { Axis, Disc, SculptureParams } from '../types/sculpture';
import type { WaffleParams } from './waffle/types';

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
  waffleParams?: WaffleParams;
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
  discs: Disc[],
  waffleParams?: WaffleParams
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
  ];

  if (build.techniqueId === 'waffle') {
    const wp = waffleParams ?? {
      upAxis: 'z',
      pitch: 12.0,
      slotClearance: 0.1,
      gridOffset: 0.0,
      slotLabelsEnabled: true,
      targetScale: 1.0,
    };
    const tLines = [
      `      "upAxis": "${wp.upAxis}",`,
      `      "pitch": ${formatPythonFloat(wp.pitch)},`,
      `      "slotClearance": ${formatPythonFloat(wp.slotClearance)},`,
      `      "gridOffset": ${formatPythonFloat(wp.gridOffset)},`,
      `      "slotLabelsEnabled": ${wp.slotLabelsEnabled ? 'true' : 'false'},`,
      `      "targetScale": ${formatPythonFloat(wp.targetScale)}`,
    ];
    if (wp.distributionMethod) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "distributionMethod": "${wp.distributionMethod}"`);
    }
    if (wp.count1 !== undefined) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "count1": ${wp.count1}`);
    }
    if (wp.count2 !== undefined) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "count2": ${wp.count2}`);
    }
    if (wp.distance1 !== undefined) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "distance1": ${formatPythonFloat(wp.distance1)}`);
    }
    if (wp.distance2 !== undefined) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "distance2": ${formatPythonFloat(wp.distance2)}`);
    }
    if (wp.notchFactor !== undefined) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "notchFactor": ${formatPythonFloat(wp.notchFactor)}`);
    }
    if (wp.notchAngle !== undefined) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "notchAngle": ${formatPythonFloat(wp.notchAngle)}`);
    }

    lines.push(
      '  "technique": {',
      '    "id": "waffle",',
      '    "params": {',
      ...tLines,
      '    }',
      '  },',
      '  "joint": {',
      '    "id": "slots",',
      '    "params": {}',
      '  }'
    );
  } else {
    lines.push(
      '  "technique": {',
      `    "id": "${build.techniqueId}",`,
      '    "params": {',
      `      "plates": ${params.plates},`,
      `      "axis": "${params.axis}"`,
      '    }',
      '  },',
      '  "joint": {',
      `    "id": "${build.jointId}",`
    );

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
  }

  lines.push('}');
  return lines.join('\n');
}

export function serializeProject(
  params: SculptureParams,
  build: BuildConfig,
  discs: Disc[],
  waffleParams?: WaffleParams
): string {
  const version = projectFormatFor(build, params);
  if (version === '1.0') {
    return serializeProjectJson(params, discs);
  }
  return serializeProject2(params, build, discs, waffleParams);
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

  if (!tech.params || typeof tech.params !== 'object' || Array.isArray(tech.params)) {
    throw new ValidationError("El campo 'technique.params' debe ser un objeto.");
  }
  const tParams = tech.params as Record<string, unknown>;

  let parsedWaffleParams: WaffleParams | undefined;

  if (techId === 'waffle') {
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
      if (!allowedWaffleKeys.includes(k as any)) {
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

    parsedWaffleParams = {
      upAxis: upAxis as Axis,
      pitch: tParams.pitch as number,
      slotClearance: tParams.slotClearance as number,
      gridOffset: tParams.gridOffset as number,
      slotLabelsEnabled: tParams.slotLabelsEnabled as boolean,
      targetScale: tParams.targetScale as number,
      distributionMethod: tParams.distributionMethod as any,
      count1: typeof tParams.count1 === 'number' ? tParams.count1 : undefined,
      count2: typeof tParams.count2 === 'number' ? tParams.count2 : undefined,
      distance1: typeof tParams.distance1 === 'number' ? tParams.distance1 : undefined,
      distance2: typeof tParams.distance2 === 'number' ? tParams.distance2 : undefined,
      notchFactor: typeof tParams.notchFactor === 'number' ? tParams.notchFactor : undefined,
      notchAngle: typeof tParams.notchAngle === 'number' ? tParams.notchAngle : undefined,
    };
  } else {
    // techId === 'stacked'
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
  if (techId === 'waffle') {
    if (jointId !== 'slots') {
      throw new ValidationError("La técnica «Waffle» solo admite la unión «Encaje por ranuras» ('slots').");
    }
  } else {
    if (jointId === 'slots') {
      throw new ValidationError("La unión «Encaje por ranuras» es exclusiva de la técnica «Waffle».");
    }
    if (jointId !== 'none' && jointId !== 'discs' && jointId !== 'rod') {
      throw new ValidationError(`Unión desconocida: '${jointId}'.`);
    }
    if (jointId === 'rod') {
      throw new ValidationError('La unión «Con varilla» aún no está disponible.');
    }
  }

  if (jointId === 'slots') {
    if ('discs' in joint) {
      throw new ValidationError('La unión «Encaje por ranuras» no admite discos.');
    }
    for (const k of Object.keys(joint)) {
      if (k !== 'id' && k !== 'params') {
        throw new ValidationError(`Campo no reconocido '${k}' en 'joint'.`);
      }
    }
  } else if (jointId === 'none') {
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
  if (jointId === 'slots' || jointId === 'none') {
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
    plates: techId === 'waffle' ? baseParams.plates : (tParams.plates as number),
    axis: techId === 'waffle' ? (parsedWaffleParams?.upAxis ?? 'z') : (String(tParams.axis).toLowerCase() as Axis),
    gap: jointId === 'none' || jointId === 'slots' ? 0 : (jParams.gap as number),
    discDiameter: jointId === 'none' || jointId === 'slots' ? baseParams.discDiameter : (jParams.discDiameter as number),
    engraveClearance: jointId === 'none' || jointId === 'slots' ? baseParams.engraveClearance : (jParams.engraveClearance as number),
  };

  validateBuildParams(params, build, parsedWaffleParams);

  let discs: Disc[] = [];
  if (jointId === 'discs') {
    discs = parseDiscsList(joint.discs, params.plates);
  }

  return {
    version: '2.0',
    params,
    discs,
    build,
    waffleParams: parsedWaffleParams,
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
  currentBuild?: BuildConfig,
  fileWaffle?: WaffleParams,
  currentWaffle?: WaffleParams,
  fileCore?: Pick<SculptureParams, 'thickness' | 'kerf'>,
  currentCore?: Pick<SculptureParams, 'thickness' | 'kerf'>
): boolean {
  if (fileBuild && currentBuild) {
    if (
      fileBuild.techniqueId !== currentBuild.techniqueId ||
      fileBuild.jointId !== currentBuild.jointId
    ) {
      return false;
    }

    if (fileBuild.techniqueId === 'waffle') {
      if (fileWaffle && currentWaffle) {
        if (fileWaffle.upAxis !== currentWaffle.upAxis) return false;
        if (Math.abs(fileWaffle.pitch - currentWaffle.pitch) > 1e-4) return false;
        if (Math.abs(fileWaffle.slotClearance - currentWaffle.slotClearance) > 1e-4) return false;
        if (Math.abs(fileWaffle.gridOffset - currentWaffle.gridOffset) > 1e-4) return false;
        if (Math.abs(fileWaffle.targetScale - currentWaffle.targetScale) > 1e-4) return false;
        if (fileWaffle.slotLabelsEnabled !== currentWaffle.slotLabelsEnabled) return false;
      }
      if (Math.abs(fileParams.thickness - currentParams.thickness) > 1e-4) return false;
      if (fileCore && currentCore) {
        if (Math.abs(fileCore.kerf - currentCore.kerf) > 1e-4) return false;
      }
      return true;
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
