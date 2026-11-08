import { DEFAULT_BUILD } from './build/types';
import type { BuildConfig, JointId, TechniqueId } from './build/types';
import { validateBuildParams } from './build/validateBuild';
import { DEFAULT_PARAMS } from './params';
import { validateParams, ValidationError } from './validator';
import { UI_TEXTS_ES } from '../i18n/es';
import type { Axis, Disc, SculptureParams } from '../types/sculpture';
import type { WaffleParams } from './waffle/types';
import {
  validateAndParseDiscs,
  validateMaterialSection,
  validateStackedTechniqueParams,
  validateWaffleTechniqueParams,
  validateDiscsJointParams,
} from './projectSchema';

export const FORMAT_VERSION = '1.0';

export interface ParsedProjectData {
  version: '1.0' | '2.0';
  params: SculptureParams;
  discs: Disc[];
  build: BuildConfig;
  waffleParams?: WaffleParams;
}

export function formatCanonicalFloat(n: number): string {
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
 * Serializa el proyecto en el formato canónico v1.0 compatible byte a byte con
 * web/golden/l_block_project.json (indentación de 2 espacios y flotantes formateados).
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
      `      "x": ${formatCanonicalFloat(d.x)},`,
      `      "y": ${formatCanonicalFloat(d.y)},`,
      `      "diameter": ${formatCanonicalFloat(d.diameter)}`,
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
    `  "thickness": ${formatCanonicalFloat(params.thickness)},`,
    `  "gap": ${formatCanonicalFloat(params.gap)},`,
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
    `    "thickness": ${formatCanonicalFloat(params.thickness)},`,
    `    "sheetW": ${formatCanonicalFloat(params.sheetW)},`,
    `    "sheetH": ${formatCanonicalFloat(params.sheetH)},`,
    `    "sheetMargin": ${formatCanonicalFloat(params.sheetMargin)},`,
    `    "partGap": ${formatCanonicalFloat(params.partGap)},`,
    `    "kerf": ${formatCanonicalFloat(params.kerf)},`,
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
      `      "pitch": ${formatCanonicalFloat(wp.pitch)},`,
      `      "slotClearance": ${formatCanonicalFloat(wp.slotClearance)},`,
      `      "gridOffset": ${formatCanonicalFloat(wp.gridOffset)},`,
      `      "slotLabelsEnabled": ${wp.slotLabelsEnabled ? 'true' : 'false'},`,
      `      "targetScale": ${formatCanonicalFloat(wp.targetScale)}`,
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
      tLines.push(`      "distance1": ${formatCanonicalFloat(wp.distance1)}`);
    }
    if (wp.distance2 !== undefined) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "distance2": ${formatCanonicalFloat(wp.distance2)}`);
    }
    if (wp.notchFactor !== undefined) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "notchFactor": ${formatCanonicalFloat(wp.notchFactor)}`);
    }
    if (wp.notchAngle !== undefined) {
      tLines[tLines.length - 1] += ',';
      tLines.push(`      "notchAngle": ${formatCanonicalFloat(wp.notchAngle)}`);
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
        `      "gap": ${formatCanonicalFloat(params.gap)},`,
        `      "discDiameter": ${formatCanonicalFloat(params.discDiameter)},`,
        `      "engraveClearance": ${formatCanonicalFloat(params.engraveClearance)}`,
        '    },'
      );
      if (discs.length === 0) {
        lines.push('    "discs": []');
      } else {
        const discBlocks = discs.map((d) => [
          '      {',
          `        "id": ${d.id},`,
          `        "hueco": ${d.gapIndex},`,
          `        "x": ${formatCanonicalFloat(d.x)},`,
          `        "y": ${formatCanonicalFloat(d.y)},`,
          `        "diameter": ${formatCanonicalFloat(d.diameter)}`,
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

export function parseProjectJson(
  jsonText: string,
  baseParams: SculptureParams = DEFAULT_PARAMS
): ParsedProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new ValidationError('PROJECT_INVALID_JSON', {});
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('PROJECT_INVALID_FORMAT', {});
  }

  const obj = raw as Record<string, unknown>;
  const version = obj.version;
  if (version !== '1.0' && version !== '2.0') {
    throw new ValidationError('PROJECT_UNSUPPORTED_VERSION', { version: String(version) });
  }

  if (version === '1.0') {
    const requiredKeys = ['plates', 'thickness', 'gap', 'axis', 'discs'] as const;
    for (const key of requiredKeys) {
      if (!(key in obj)) {
        throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', { field: key });
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
    const discs = validateAndParseDiscs(obj.discs, params.plates);

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
      throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', { field: k });
    }
  }
  for (const k of Object.keys(obj)) {
    if (!allowedRootKeys.includes(k)) {
      throw new ValidationError('PROJECT_UNRECOGNIZED_ROOT_FIELD', { field: k });
    }
  }

  // Material
  const mat = validateMaterialSection(obj.material);

  // Technique
  if (!obj.technique || typeof obj.technique !== 'object' || Array.isArray(obj.technique)) {
    throw new ValidationError('PROJECT_FIELD_MUST_BE_OBJECT', { field: 'technique' });
  }
  const tech = obj.technique as Record<string, unknown>;
  if (!('id' in tech)) {
    throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', { field: 'technique.id' });
  }
  if (!('params' in tech)) {
    throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', { field: 'technique.params' });
  }
  for (const k of Object.keys(tech)) {
    if (k !== 'id' && k !== 'params') {
      throw new ValidationError('PROJECT_UNRECOGNIZED_SECTION_FIELD', {
        field: k,
        section: 'technique',
      });
    }
  }

  const techId = String(tech.id);
  if (techId !== 'stacked' && techId !== 'waffle') {
    throw new ValidationError('BUILD_UNKNOWN_TECHNIQUE', { id: techId });
  }

  let parsedWaffleParams: WaffleParams | undefined;
  let plates = baseParams.plates;
  let axis: Axis = baseParams.axis;

  if (techId === 'waffle') {
    const validatedWaffle = validateWaffleTechniqueParams(tech.params);
    parsedWaffleParams = {
      upAxis: validatedWaffle.upAxis,
      pitch: validatedWaffle.pitch,
      slotClearance: validatedWaffle.slotClearance,
      gridOffset: validatedWaffle.gridOffset,
      slotLabelsEnabled: validatedWaffle.slotLabelsEnabled,
      targetScale: validatedWaffle.targetScale,
      distributionMethod: validatedWaffle.distributionMethod,
      count1: validatedWaffle.count1,
      count2: validatedWaffle.count2,
      distance1: validatedWaffle.distance1,
      distance2: validatedWaffle.distance2,
      notchFactor: validatedWaffle.notchFactor,
      notchAngle: validatedWaffle.notchAngle,
    };
    axis = validatedWaffle.upAxis;
  } else {
    // techId === 'stacked'
    const validatedStacked = validateStackedTechniqueParams(tech.params);
    plates = validatedStacked.plates;
    axis = validatedStacked.axis;
  }

  // Joint
  if (!obj.joint || typeof obj.joint !== 'object' || Array.isArray(obj.joint)) {
    throw new ValidationError('PROJECT_FIELD_MUST_BE_OBJECT', { field: 'joint' });
  }
  const joint = obj.joint as Record<string, unknown>;
  if (!('id' in joint)) {
    throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', { field: 'joint.id' });
  }
  if (!('params' in joint)) {
    throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', { field: 'joint.params' });
  }

  const jointId = String(joint.id);
  if (techId === 'waffle') {
    if (jointId !== 'slots') {
      throw new ValidationError('BUILD_WAFFLE_REQUIRES_SLOTS_JOINT', { withCode: true });
    }
  } else {
    if (jointId === 'slots') {
      throw new ValidationError('BUILD_SLOTS_EXCLUSIVE_TO_WAFFLE', {});
    }
    if (jointId !== 'none' && jointId !== 'discs' && jointId !== 'rod') {
      throw new ValidationError('BUILD_UNKNOWN_JOINT', { id: jointId });
    }
    if (jointId === 'rod') {
      throw new ValidationError('BUILD_ROD_JOINT_UNAVAILABLE', {});
    }
  }

  if (jointId === 'slots') {
    if ('discs' in joint) {
      throw new ValidationError('PROJECT_SLOTS_NO_DISCS_ALLOWED', {});
    }
    for (const k of Object.keys(joint)) {
      if (k !== 'id' && k !== 'params') {
        throw new ValidationError('PROJECT_UNRECOGNIZED_SECTION_FIELD', {
          field: k,
          section: 'joint',
        });
      }
    }
  } else if (jointId === 'none') {
    if ('discs' in joint) {
      throw new ValidationError('PROJECT_NONE_JOINT_NO_DISCS_ALLOWED', {});
    }
    for (const k of Object.keys(joint)) {
      if (k !== 'id' && k !== 'params') {
        throw new ValidationError('PROJECT_UNRECOGNIZED_SECTION_FIELD', {
          field: k,
          section: 'joint',
        });
      }
    }
  } else if (jointId === 'discs') {
    if (!('discs' in joint)) {
      throw new ValidationError('PROJECT_MISSING_REQUIRED_FIELD', { field: 'joint.discs' });
    }
    for (const k of Object.keys(joint)) {
      if (k !== 'id' && k !== 'params' && k !== 'discs') {
        throw new ValidationError('PROJECT_UNRECOGNIZED_SECTION_FIELD', {
          field: k,
          section: 'joint',
        });
      }
    }
  }

  let gap = 0;
  let discDiameter = baseParams.discDiameter;
  let engraveClearance = baseParams.engraveClearance;

  if (jointId === 'slots' || jointId === 'none') {
    if (!joint.params || typeof joint.params !== 'object' || Array.isArray(joint.params)) {
      throw new ValidationError('PROJECT_FIELD_MUST_BE_OBJECT', { field: 'joint.params' });
    }
    const keys = Object.keys(joint.params as Record<string, unknown>);
    if (keys.length > 0) {
      throw new ValidationError('PROJECT_UNRECOGNIZED_SECTION_FIELD', {
        field: keys[0],
        section: 'joint.params',
      });
    }
  } else if (jointId === 'discs') {
    const validatedDiscsParams = validateDiscsJointParams(joint.params);
    gap = validatedDiscsParams.gap;
    discDiameter = validatedDiscsParams.discDiameter;
    engraveClearance = validatedDiscsParams.engraveClearance;
  }

  const build: BuildConfig = {
    techniqueId: techId as TechniqueId,
    jointId: jointId as JointId,
  };

  const params: SculptureParams = {
    thickness: mat.thickness,
    sheetW: mat.sheetW,
    sheetH: mat.sheetH,
    sheetMargin: mat.sheetMargin,
    partGap: mat.partGap,
    kerf: mat.kerf,
    scrapTagEnabled: mat.scrapTagEnabled,
    plates,
    axis,
    gap,
    discDiameter,
    engraveClearance,
  };

  validateBuildParams(params, build, parsedWaffleParams);

  let discs: Disc[] = [];
  if (jointId === 'discs') {
    discs = validateAndParseDiscs(joint.discs, params.plates);
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
 * Verifica si los parámetros geométricos de corte (placas, espesor, hueco, eje y configuración waffle) coinciden
 * con el proyecto abierto para evitar aplicar un corte con parámetros incompatibles.
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
  UI_TEXTS_ES.incompatibleProjectConfirm;
