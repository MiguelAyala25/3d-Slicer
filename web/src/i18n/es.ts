/**
 * Diccionario de textos, mensajes de error y advertencias en español.
 * 100 % headless (sin dependencias de Three.js, React ni DOM).
 */

import type { ErrorCode, ErrorParamsMap, WarningCode, WarningParamsMap } from '../core/errors';

export const ERROR_MESSAGES_ES: { [K in ErrorCode]: (p: ErrorParamsMap[K]) => string } = {
  // Slicer / Mesh Geometry
  MESH_TOO_FEW_TRIANGLES_FOR_SLICE: () => 'La malla tiene menos de 4 triángulos.',
  MESH_ZERO_HEIGHT_ON_AXIS: (p) => `La malla tiene altura 0 en el eje '${p.axis}'.`,
  MESH_EMPTY: () => 'La malla cargada está vacía (no contiene triángulos).',
  MESH_BBOX_FAILED: () => 'No se pudo calcular el bounding box de la malla.',
  MESH_FLAT_OR_DEGENERATE: (p) =>
    `La malla es plana o degenerada (dimensiones: ${p.x} x ${p.y} x ${p.z}). Se requiere un modelo 3D con volumen.`,
  MESH_INDEXING_FAILED: () => 'Error al indexar los vértices de la malla.',
  MESH_TOO_FEW_FACES: (p) =>
    `La malla tiene muy pocas caras (${p.faceCount}). Se requiere un modelo 3D con al menos 4 caras.`,
  MESH_TOO_MANY_TRIANGLES: (p) =>
    `La malla tiene ${p.faceCount} triángulos, excediendo el máximo permitido (${p.maxTriangles}). Simplifica la malla antes de cargarla.`,
  MESH_ONLY_LINES_OR_POINTS: () =>
    'El archivo contiene únicamente líneas o puntos sueltos y ninguna malla triangular 3D.',
  MESH_NO_TRIANGLES_FOUND: () => 'No se encontraron mallas triangulares en el archivo.',
  MESH_MERGE_FAILED: () => 'No fue posible fusionar los sub-objetos de la malla 3D.',
  PLY_POINT_CLOUD_NO_FACES: () =>
    'El archivo PLY es una nube de puntos (0 caras declaradas) y no contiene triángulos.',
  PLY_NO_VALID_TRIANGLES: () => 'El archivo PLY no contiene caras triangulares válidas.',
  FILE_EXTENSION_UNSUPPORTED: (p) => `Extensión no soportada: ${p.ext}`,

  // Layout
  SHEET_MARGIN_TOO_LARGE: (p) =>
    `El margen (${p.sheetMargin} mm) es demasiado grande para la hoja de ${p.sheetW} x ${p.sheetH} mm.`,
  PLATE_EXCEEDS_USABLE_AREA: (p) =>
    `La placa ${p.plateIndex} (${p.widthMm} x ${p.heightMm} mm) excede el área útil de la hoja (${p.usableWMm} x ${p.usableHMm} mm). Ajusta el tamaño de la hoja o escala el modelo 3D.`,
  WAFFLE_PIECE_EXCEEDS_USABLE_AREA: (p) =>
    `La pieza ${p.sectionId} (${p.widthMm} x ${p.heightMm} mm) excede el área útil de la hoja (${p.usableWMm} x ${p.usableHMm} mm). Ajusta el tamaño de la hoja o reduce la escala del modelo.`,

  // Param Validation
  FILE_PATH_EMPTY: () => 'La ruta del archivo está vacía.',
  FILE_FORMAT_UNSUPPORTED: (p) =>
    `Formato de archivo no soportado: '${p.ext || '(sin extensión)'}'. Formatos válidos: .3mf, .obj, .ply, .stl`,
  FILE_EMPTY: (p) => `El archivo '${p.fileName}' está vacío (0 bytes).`,
  FILE_TOO_LARGE: (p) =>
    `El archivo '${p.fileName}' excede el tamaño máximo permitido de 150 MB.`,
  PARAM_PLATES_OUT_OF_RANGE: (p) =>
    `El número de placas debe ser un entero entre ${p.min} y ${p.max} (recibido: ${p.received}).`,
  PARAM_THICKNESS_OUT_OF_RANGE: (p) =>
    `El grosor debe estar entre ${p.min} y ${p.max} mm (recibido: ${p.received}).`,
  PARAM_GAP_OUT_OF_RANGE: (p) =>
    `La separación debe ser mayor o igual a ${p.min} mm y menor o igual a ${p.max} mm (recibido: ${p.received}).`,
  PARAM_AXIS_INVALID: (p) => `El eje de corte debe ser 'x', 'y' o 'z' (recibido: '${p.received}').`,
  PARAM_SHEET_DIM_OUT_OF_RANGE: (p) =>
    `Las dimensiones de la hoja deben estar entre ${p.min} y ${p.max} mm (recibido: ${p.sheetW} x ${p.sheetH}).`,
  PARAM_SHEET_MARGIN_OUT_OF_RANGE: (p) =>
    `El margen de la hoja debe estar entre ${p.min} y ${p.max} mm (recibido: ${p.received}).`,
  PARAM_PART_GAP_OUT_OF_RANGE: (p) =>
    `La separación entre piezas debe estar entre ${p.min} y ${p.max} mm (recibido: ${p.received}).`,
  PARAM_KERF_OUT_OF_RANGE: (p) =>
    `El kerf debe estar entre ${p.min} y ${p.max} mm (recibido: ${p.received}).`,
  PARAM_SCRAP_TAG_NOT_BOOLEAN: () => 'scrapTagEnabled debe ser un valor booleano.',

  // Project Parsing & Validation
  PROJECT_INVALID_JSON: () => 'El archivo de proyecto no contiene un JSON válido.',
  PROJECT_INVALID_FORMAT: () => 'El formato del archivo de proyecto es inválido.',
  PROJECT_UNSUPPORTED_VERSION: (p) =>
    `Versión de archivo no soportada: '${p.version}' (se esperaba '1.0' o '2.0').`,
  PROJECT_MISSING_REQUIRED_FIELD: (p) =>
    `Falta el campo obligatorio '${p.field}' en el archivo JSON.`,
  PROJECT_UNRECOGNIZED_ROOT_FIELD: (p) => `Campo no reconocido '${p.field}' en la raíz.`,
  PROJECT_FIELD_MUST_BE_OBJECT: (p) => `El campo '${p.field}' debe ser un objeto.`,
  PROJECT_UNRECOGNIZED_SECTION_FIELD: (p) =>
    `Campo no reconocido '${p.field}' en '${p.section}'.`,
  PROJECT_FIELD_MUST_BE_NUMERIC: (p) => `El campo '${p.field}' debe ser numérico.`,
  PROJECT_FIELD_MUST_BE_BOOLEAN: (p) => `El campo '${p.field}' debe ser booleano.`,
  PROJECT_WAFFLE_UP_AXIS_INVALID: () => "El campo 'technique.params.upAxis' debe ser 'x', 'y' o 'z'.",
  PROJECT_DISCS_LIST_INVALID: () => "El archivo de proyecto no contiene una lista 'discs' válida.",
  PROJECT_DISC_ITEM_INVALID: (p) => `El disco en la posición ${p.position} es inválido.`,
  PROJECT_DISC_ID_INVALID: (p) => `El disco #${p.index} tiene un 'id' inválido (${p.id}).`,
  PROJECT_DISC_ID_DUPLICATE: (p) => `El archivo contiene IDs de disco duplicados (id=${p.id}).`,
  PROJECT_DISC_COORDS_NON_NUMERIC: (p) =>
    `El disco id=${p.id} tiene coordenadas (x, y) no numéricas.`,
  PROJECT_DISC_DIAMETER_INVALID: (p) =>
    `El disco id=${p.id} tiene un diámetro inválido (${p.diameter} mm).`,
  PROJECT_DISC_GAP_OUT_OF_RANGE: (p) =>
    `El disco id=${p.id} tiene un hueco fuera de rango (${p.gapIndex}; máximo permitido ${p.maxAllowed}).`,
  PROJECT_SLOTS_NO_DISCS_ALLOWED: () => 'La unión «Encaje por ranuras» no admite discos.',
  PROJECT_NONE_JOINT_NO_DISCS_ALLOWED: () => 'La unión «Sin separación» no admite discos.',
  PROJECT_SCHEMA_ISSUE: (p) => p.message,

  // Build & Joints
  BUILD_TECHNIQUE_REQUIRED: () => 'Selecciona una técnica de construcción.',
  BUILD_UNKNOWN_TECHNIQUE: (p) => `Técnica desconocida: '${p.id}'.`,
  BUILD_JOINT_REQUIRED: () => 'Selecciona un tipo de unión.',
  BUILD_WAFFLE_REQUIRES_SLOTS_JOINT: (p) =>
    p?.withCode
      ? "La técnica «Waffle» solo admite la unión «Encaje por ranuras» ('slots')."
      : 'La técnica «Waffle» solo admite la unión «Encaje por ranuras».',
  BUILD_SLOTS_EXCLUSIVE_TO_WAFFLE: () =>
    'La unión «Encaje por ranuras» es exclusiva de la técnica «Waffle».',
  BUILD_UNKNOWN_JOINT: (p) => `Unión desconocida: '${p.id}'.`,
  BUILD_ROD_JOINT_UNAVAILABLE: () => 'La unión «Con varilla» aún no está disponible.',
  BUILD_JOINT_UNAVAILABLE: (p) => `La unión «${p.label}» aún no está disponible.`,
  NONE_JOINT_REQUIRES_ZERO_GAP: (p) =>
    `La unión «Sin separación» requiere separación 0 mm (recibido: ${p.received}).`,

  // Discs
  DISC_DEFAULT_DIAMETER_OUT_OF_RANGE: (p) =>
    `El diámetro por defecto debe estar entre ${p.min} y ${p.max} mm.`,
  DISC_GAP_INDEX_OUT_OF_RANGE: (p) =>
    `El índice de hueco ${p.gapIndex} está fuera de rango (0 a ${p.maxRange}).`,
  DISC_POINT_OUTSIDE_PLATE: (p) =>
    `El punto seleccionado está fuera de la placa activa P${p.gapIndex}.`,
  DISC_DIAMETER_OUT_OF_RANGE: (p) =>
    `El diámetro debe estar entre ${p.min} y ${p.max} mm.`,
  DISC_DIAMETER_EXCEEDS_PLATE_BORDER: (p) =>
    `El diámetro Ø${p.diameter} mm excede el borde de las placas P${p.gapIndex}/P${p.nextGapIndex} en la posición actual.`,
  DISC_PARAM_DIAMETER_OUT_OF_RANGE: (p) =>
    `El diámetro del disco debe estar entre ${p.min} y ${p.max} mm (recibido: ${p.received}).`,
  DISC_PARAM_CLEARANCE_OUT_OF_RANGE: (p) =>
    `La holgura de grabado debe estar entre ${p.min} y ${p.max} mm (recibido: ${p.received}).`,

  // Waffle
  WAFFLE_PITCH_TOO_SMALL: (p) =>
    `La separación entre secciones (${p.pitch} mm) debe ser al menos 2 veces el grosor de placa (${p.minPitch} mm).`,
  WAFFLE_AXIS1_DIST_TOO_SMALL: (p) =>
    `La separación del 1.er eje (${p.dist} mm) debe ser al menos 2 veces el grosor de placa (${p.minPitch} mm).`,
  WAFFLE_AXIS2_DIST_TOO_SMALL: (p) =>
    `La separación del 2.º eje (${p.dist} mm) debe ser al menos 2 veces el grosor de placa (${p.minPitch} mm).`,
  WAFFLE_GRID_OFFSET_OUT_OF_RANGE: (p) =>
    `El desfase de rejilla (${p.gridOffset} mm) debe estar entre -${p.maxOffset} y +${p.maxOffset} mm.`,
  WAFFLE_DRAWN_SLOT_TOO_NARROW: (p) =>
    `El ancho dibujado de ranura (t + holgura - kerf = ${p.drawnSlotWidth} mm) debe ser mayor a 0.05 mm. Reduce el kerf (${p.kerf} mm) o aumenta el grosor/holgura.`,
  WAFFLE_TARGET_SCALE_INVALID: () => 'El factor de escala debe ser mayor a 0.',
  WAFFLE_TOO_MANY_SECTIONS: (p) =>
    `El total de secciones de la rejilla (${p.totalSections}) excede el máximo permitido de 400. Aumenta la separación entre secciones o reduce la cantidad de cortes.`,
};

export const WARNING_MESSAGES_ES: { [K in WarningCode]: (p: WarningParamsMap[K]) => string } = {
  SLICE_FLOOR_OPEN_CHAINS: (p) =>
    `Piso ${p.floorIndex}: ${p.openChainsDiscarded} cadena(s) abierta(s) descartada(s), ${p.openChainsRepaired} micro-brecha(s) cerrada(s).`,
  WARN_MESH_OPEN_EDGES: (p) =>
    `La malla no es cerrada (${p.count} aristas abiertas). Algunos cortes podrían quedar incompletos.`,
  WARN_MESH_NON_MANIFOLD_EDGES: (p) =>
    `La malla contiene ${p.count} aristas no-manifold (más de 2 caras compartidas).`,
  WARN_MESH_OPEN_COMPONENTS: (p) =>
    `Se detectaron ${p.count} componente(s) conexa(s) abierta(s); no se modificó la orientación de sus caras.`,
  WARN_MESH_INVERTED_NORMALS_FIXED: (p) =>
    `Se normalizó automáticamente la orientación de normales en ${p.count} componente(s) cerrada(s) con caras invertidas.`,
  WARN_LOADER_IGNORED_LINES_OR_POINTS: (p) =>
    `Se omitieron ${p.count} objeto(s) de líneas/puntos que no forman parte de la malla triangular.`,
  WARN_LOADER_Y_UP_TO_Z_UP: () => 'Se ajustó la orientación del modelo de Y-up a Z-up.',
  WARN_LOADER_3MF_UNIT_SCALE: (p) => `Se aplicó factor de conversión de unidades 3MF (x${p.scale}).`,
  WARN_WAFFLE_W1_OMITTED_SECTION: (p) =>
    `Sección omitida en familia ${p.prefix} (posición ${p.coord} mm): el plano no intersecta volumen útil.`,
  WARN_WAFFLE_W2_ISLAND_NO_CROSSING: (p) =>
    `Pieza ${p.pieceId} (isla #${p.islandIndex}): no tiene ningún cruce con la otra familia y quedará suelta al armar.`,
  WARN_WAFFLE_W3_WEAK_ENGAGE: (p) =>
    `Cruce ${p.p1PieceId}–${p.p2PieceId}: altura de encaje débil (${p.engageHeight} mm < 4.0 mm).`,
  WARN_WAFFLE_W4_SLOT_SPLITS_PIECE: (p) =>
    `Pieza ${p.pieceId}: la ranura del cruce con ${p.partners} parte la pieza en múltiples fragmentos. Sugerencia: ajusta el desfase de rejilla (δ) o la separación (p).`,
  WARN_WAFFLE_W5_THIN_WEB: (p) =>
    `Pieza ${p.pieceId}: cuello delgado (< 2.0 mm) junto a ranura. Riesgo de fractura en acrílico; considera ajustar δ o p.`,
};

export const UI_TEXTS_ES = {
  incompatibleProjectConfirm:
    'Los parámetros del archivo difieren de los actuales. Adaptar el proyecto implica volver a rebanar el modelo 3D. ¿Deseas rebanar y adaptar el proyecto, o cancelar?',
  discSheetSameNotice: 'Discos: misma lámina que placas',
  discSheetSeparateNotice: (gapMm: number) => `Discos: lámina aparte de ${gapMm.toFixed(1)} mm`,
  techniqueStackedLabel: 'Planos apilados',
  techniqueWaffleLabel: 'Waffle',
  jointNoneLabel: 'Sin separación',
  jointDiscsLabel: 'Discos conectores',
  jointSlotsLabel: 'Encaje por ranuras',
  jointRodLabel: 'Con varilla',
  jointRodUnavailableReason: 'Próximamente',
};

export function formatErrorMessageEs<K extends ErrorCode>(code: K, params: ErrorParamsMap[K]): string {
  const formatter = ERROR_MESSAGES_ES[code];
  return formatter ? (formatter as (p: unknown) => string)(params) : code;
}

export function formatWarningMessageEs<K extends WarningCode>(code: K, params: WarningParamsMap[K]): string {
  const formatter = WARNING_MESSAGES_ES[code];
  return formatter ? (formatter as (p: unknown) => string)(params) : code;
}
