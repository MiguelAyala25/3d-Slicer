import { PARAM_BOUNDS, CORE_GAP_BOUNDS } from './params';
import { ValidationError } from './errors';
import type { CoreParams } from '../types/sculpture';

export const SUPPORTED_EXTENSIONS = new Set(['.obj', '.stl', '.3mf', '.ply']);
export const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB

export function validateFileExtension(fileName: string, byteLength?: number): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new ValidationError('La ruta del archivo está vacía.');
  }
  const dotIdx = trimmed.lastIndexOf('.');
  const ext = dotIdx >= 0 ? trimmed.slice(dotIdx).toLowerCase() : '';
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new ValidationError(
      `Formato de archivo no soportado: '${ext || '(sin extensión)'}'. Formatos válidos: .3mf, .obj, .ply, .stl`
    );
  }
  if (byteLength !== undefined) {
    if (byteLength === 0) {
      throw new ValidationError(`El archivo '${trimmed}' está vacío (0 bytes).`);
    }
    if (byteLength > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(
        `El archivo '${trimmed}' excede el tamaño máximo permitido de 150 MB.`
      );
    }
  }
  return ext;
}

export function validateParams(params: CoreParams): void {
  if (
    !Number.isInteger(params.plates) ||
    params.plates < PARAM_BOUNDS.plates.min ||
    params.plates > PARAM_BOUNDS.plates.max
  ) {
    throw new ValidationError(
      `El número de placas debe ser un entero entre ${PARAM_BOUNDS.plates.min} y ${PARAM_BOUNDS.plates.max} (recibido: ${params.plates}).`
    );
  }
  if (
    !Number.isFinite(params.thickness) ||
    params.thickness < PARAM_BOUNDS.thickness.min ||
    params.thickness > PARAM_BOUNDS.thickness.max
  ) {
    throw new ValidationError(
      `El grosor debe estar entre ${PARAM_BOUNDS.thickness.min} y ${PARAM_BOUNDS.thickness.max} mm (recibido: ${params.thickness}).`
    );
  }
  if (
    !Number.isFinite(params.gap) ||
    params.gap < CORE_GAP_BOUNDS.min ||
    params.gap > CORE_GAP_BOUNDS.max
  ) {
    throw new ValidationError(
      `La separación debe ser mayor o igual a ${CORE_GAP_BOUNDS.min} mm y menor o igual a ${CORE_GAP_BOUNDS.max} mm (recibido: ${params.gap}).`
    );
  }
  if (!['x', 'y', 'z'].includes(params.axis)) {
    throw new ValidationError(
      `El eje de corte debe ser 'x', 'y' o 'z' (recibido: '${params.axis}').`
    );
  }
  if (
    !Number.isFinite(params.sheetW) ||
    params.sheetW < PARAM_BOUNDS.sheetW.min ||
    params.sheetW > PARAM_BOUNDS.sheetW.max ||
    !Number.isFinite(params.sheetH) ||
    params.sheetH < PARAM_BOUNDS.sheetH.min ||
    params.sheetH > PARAM_BOUNDS.sheetH.max
  ) {
    throw new ValidationError(
      `Las dimensiones de la hoja deben estar entre ${PARAM_BOUNDS.sheetW.min} y ${PARAM_BOUNDS.sheetW.max} mm (recibido: ${params.sheetW} x ${params.sheetH}).`
    );
  }
  if (
    !Number.isFinite(params.sheetMargin) ||
    params.sheetMargin < PARAM_BOUNDS.sheetMargin.min ||
    params.sheetMargin > PARAM_BOUNDS.sheetMargin.max
  ) {
    throw new ValidationError(
      `El margen de la hoja debe estar entre ${PARAM_BOUNDS.sheetMargin.min} y ${PARAM_BOUNDS.sheetMargin.max} mm (recibido: ${params.sheetMargin}).`
    );
  }
  if (params.sheetMargin * 2 >= Math.min(params.sheetW, params.sheetH)) {
    throw new ValidationError(
      `El margen (${params.sheetMargin} mm) es demasiado grande para la hoja de ${params.sheetW} x ${params.sheetH} mm.`
    );
  }
  if (
    !Number.isFinite(params.partGap) ||
    params.partGap < PARAM_BOUNDS.partGap.min ||
    params.partGap > PARAM_BOUNDS.partGap.max
  ) {
    throw new ValidationError(
      `La separación entre piezas debe estar entre ${PARAM_BOUNDS.partGap.min} y ${PARAM_BOUNDS.partGap.max} mm (recibido: ${params.partGap}).`
    );
  }
  if (
    !Number.isFinite(params.kerf) ||
    params.kerf < PARAM_BOUNDS.kerf.min ||
    params.kerf > PARAM_BOUNDS.kerf.max
  ) {
    throw new ValidationError(
      `El kerf debe estar entre ${PARAM_BOUNDS.kerf.min} y ${PARAM_BOUNDS.kerf.max} mm (recibido: ${params.kerf}).`
    );
  }
  if (typeof params.scrapTagEnabled !== 'boolean') {
    throw new ValidationError('scrapTagEnabled debe ser un valor booleano.');
  }
}
