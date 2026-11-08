import { formatErrorMessageEs, formatWarningMessageEs } from '../i18n/es';

export type ErrorCode =
  // Slicer / Mesh Geometry
  | 'MESH_TOO_FEW_TRIANGLES_FOR_SLICE'
  | 'MESH_ZERO_HEIGHT_ON_AXIS'
  | 'MESH_EMPTY'
  | 'MESH_BBOX_FAILED'
  | 'MESH_FLAT_OR_DEGENERATE'
  | 'MESH_INDEXING_FAILED'
  | 'MESH_TOO_FEW_FACES'
  | 'MESH_TOO_MANY_TRIANGLES'
  | 'MESH_ONLY_LINES_OR_POINTS'
  | 'MESH_NO_TRIANGLES_FOUND'
  | 'MESH_MERGE_FAILED'
  | 'PLY_POINT_CLOUD_NO_FACES'
  | 'PLY_NO_VALID_TRIANGLES'
  | 'FILE_EXTENSION_UNSUPPORTED'
  // Layout
  | 'SHEET_MARGIN_TOO_LARGE'
  | 'PLATE_EXCEEDS_USABLE_AREA'
  | 'WAFFLE_PIECE_EXCEEDS_USABLE_AREA'
  // Param Validation
  | 'FILE_PATH_EMPTY'
  | 'FILE_FORMAT_UNSUPPORTED'
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'PARAM_PLATES_OUT_OF_RANGE'
  | 'PARAM_THICKNESS_OUT_OF_RANGE'
  | 'PARAM_GAP_OUT_OF_RANGE'
  | 'PARAM_AXIS_INVALID'
  | 'PARAM_SHEET_DIM_OUT_OF_RANGE'
  | 'PARAM_SHEET_MARGIN_OUT_OF_RANGE'
  | 'PARAM_PART_GAP_OUT_OF_RANGE'
  | 'PARAM_KERF_OUT_OF_RANGE'
  | 'PARAM_SCRAP_TAG_NOT_BOOLEAN'
  // Project Parsing & Validation
  | 'PROJECT_INVALID_JSON'
  | 'PROJECT_INVALID_FORMAT'
  | 'PROJECT_UNSUPPORTED_VERSION'
  | 'PROJECT_MISSING_REQUIRED_FIELD'
  | 'PROJECT_UNRECOGNIZED_ROOT_FIELD'
  | 'PROJECT_FIELD_MUST_BE_OBJECT'
  | 'PROJECT_UNRECOGNIZED_SECTION_FIELD'
  | 'PROJECT_FIELD_MUST_BE_NUMERIC'
  | 'PROJECT_FIELD_MUST_BE_BOOLEAN'
  | 'PROJECT_WAFFLE_UP_AXIS_INVALID'
  | 'PROJECT_DISCS_LIST_INVALID'
  | 'PROJECT_DISC_ITEM_INVALID'
  | 'PROJECT_DISC_ID_INVALID'
  | 'PROJECT_DISC_ID_DUPLICATE'
  | 'PROJECT_DISC_COORDS_NON_NUMERIC'
  | 'PROJECT_DISC_DIAMETER_INVALID'
  | 'PROJECT_DISC_GAP_OUT_OF_RANGE'
  | 'PROJECT_SLOTS_NO_DISCS_ALLOWED'
  | 'PROJECT_NONE_JOINT_NO_DISCS_ALLOWED'
  | 'PROJECT_SCHEMA_ISSUE'
  // Build & Joints
  | 'BUILD_TECHNIQUE_REQUIRED'
  | 'BUILD_UNKNOWN_TECHNIQUE'
  | 'BUILD_JOINT_REQUIRED'
  | 'BUILD_WAFFLE_REQUIRES_SLOTS_JOINT'
  | 'BUILD_SLOTS_EXCLUSIVE_TO_WAFFLE'
  | 'BUILD_UNKNOWN_JOINT'
  | 'BUILD_ROD_JOINT_UNAVAILABLE'
  | 'BUILD_JOINT_UNAVAILABLE'
  | 'NONE_JOINT_REQUIRES_ZERO_GAP'
  // Discs
  | 'DISC_DEFAULT_DIAMETER_OUT_OF_RANGE'
  | 'DISC_GAP_INDEX_OUT_OF_RANGE'
  | 'DISC_POINT_OUTSIDE_PLATE'
  | 'DISC_DIAMETER_OUT_OF_RANGE'
  | 'DISC_DIAMETER_EXCEEDS_PLATE_BORDER'
  | 'DISC_PARAM_DIAMETER_OUT_OF_RANGE'
  | 'DISC_PARAM_CLEARANCE_OUT_OF_RANGE'
  // Waffle
  | 'WAFFLE_PITCH_TOO_SMALL'
  | 'WAFFLE_AXIS1_DIST_TOO_SMALL'
  | 'WAFFLE_AXIS2_DIST_TOO_SMALL'
  | 'WAFFLE_GRID_OFFSET_OUT_OF_RANGE'
  | 'WAFFLE_DRAWN_SLOT_TOO_NARROW'
  | 'WAFFLE_TARGET_SCALE_INVALID'
  | 'WAFFLE_TOO_MANY_SECTIONS';

export interface ErrorParamsMap {
  MESH_TOO_FEW_TRIANGLES_FOR_SLICE: Record<string, never>;
  MESH_ZERO_HEIGHT_ON_AXIS: { axis: string };
  MESH_EMPTY: Record<string, never>;
  MESH_BBOX_FAILED: Record<string, never>;
  MESH_FLAT_OR_DEGENERATE: { x: string; y: string; z: string };
  MESH_INDEXING_FAILED: Record<string, never>;
  MESH_TOO_FEW_FACES: { faceCount: number; minFaces: number };
  MESH_TOO_MANY_TRIANGLES: { faceCount: string; maxTriangles: string };
  MESH_ONLY_LINES_OR_POINTS: Record<string, never>;
  MESH_NO_TRIANGLES_FOUND: Record<string, never>;
  MESH_MERGE_FAILED: Record<string, never>;
  PLY_POINT_CLOUD_NO_FACES: Record<string, never>;
  PLY_NO_VALID_TRIANGLES: Record<string, never>;
  FILE_EXTENSION_UNSUPPORTED: { ext: string };

  SHEET_MARGIN_TOO_LARGE: { sheetMargin: number; sheetW: number; sheetH: number };
  PLATE_EXCEEDS_USABLE_AREA: {
    plateIndex: number;
    widthMm: string;
    heightMm: string;
    usableWMm: string;
    usableHMm: string;
  };
  WAFFLE_PIECE_EXCEEDS_USABLE_AREA: {
    sectionId: string;
    widthMm: string;
    heightMm: string;
    usableWMm: string;
    usableHMm: string;
  };

  FILE_PATH_EMPTY: Record<string, never>;
  FILE_FORMAT_UNSUPPORTED: { ext: string };
  FILE_EMPTY: { fileName: string };
  FILE_TOO_LARGE: { fileName: string; maxMb?: number };
  PARAM_PLATES_OUT_OF_RANGE: { min: number; max: number; received: number };
  PARAM_THICKNESS_OUT_OF_RANGE: { min: number; max: number; received: number };
  PARAM_GAP_OUT_OF_RANGE: { min: number; max: number; received: number };
  PARAM_AXIS_INVALID: { received: string };
  PARAM_SHEET_DIM_OUT_OF_RANGE: { min: number; max: number; sheetW: number; sheetH: number };
  PARAM_SHEET_MARGIN_OUT_OF_RANGE: { min: number; max: number; received: number };
  PARAM_PART_GAP_OUT_OF_RANGE: { min: number; max: number; received: number };
  PARAM_KERF_OUT_OF_RANGE: { min: number; max: number; received: number };
  PARAM_SCRAP_TAG_NOT_BOOLEAN: Record<string, never>;

  PROJECT_INVALID_JSON: Record<string, never>;
  PROJECT_INVALID_FORMAT: Record<string, never>;
  PROJECT_UNSUPPORTED_VERSION: { version: string };
  PROJECT_MISSING_REQUIRED_FIELD: { field: string };
  PROJECT_UNRECOGNIZED_ROOT_FIELD: { field: string };
  PROJECT_FIELD_MUST_BE_OBJECT: { field: string };
  PROJECT_UNRECOGNIZED_SECTION_FIELD: { field: string; section: string };
  PROJECT_FIELD_MUST_BE_NUMERIC: { field: string };
  PROJECT_FIELD_MUST_BE_BOOLEAN: { field: string };
  PROJECT_WAFFLE_UP_AXIS_INVALID: Record<string, never>;
  PROJECT_DISCS_LIST_INVALID: Record<string, never>;
  PROJECT_DISC_ITEM_INVALID: { position: number };
  PROJECT_DISC_ID_INVALID: { index: number; id: string };
  PROJECT_DISC_ID_DUPLICATE: { id: number };
  PROJECT_DISC_COORDS_NON_NUMERIC: { id: number };
  PROJECT_DISC_DIAMETER_INVALID: { id: number; diameter: number };
  PROJECT_DISC_GAP_OUT_OF_RANGE: { id: number; gapIndex: number; maxAllowed: number };
  PROJECT_SLOTS_NO_DISCS_ALLOWED: Record<string, never>;
  PROJECT_NONE_JOINT_NO_DISCS_ALLOWED: Record<string, never>;
  PROJECT_SCHEMA_ISSUE: { message: string };

  BUILD_TECHNIQUE_REQUIRED: Record<string, never>;
  BUILD_UNKNOWN_TECHNIQUE: { id: string };
  BUILD_JOINT_REQUIRED: Record<string, never>;
  BUILD_WAFFLE_REQUIRES_SLOTS_JOINT: { withCode?: boolean };
  BUILD_SLOTS_EXCLUSIVE_TO_WAFFLE: Record<string, never>;
  BUILD_UNKNOWN_JOINT: { id: string };
  BUILD_ROD_JOINT_UNAVAILABLE: Record<string, never>;
  BUILD_JOINT_UNAVAILABLE: { label: string };
  NONE_JOINT_REQUIRES_ZERO_GAP: { received: number };

  DISC_DEFAULT_DIAMETER_OUT_OF_RANGE: { min: number; max: number };
  DISC_GAP_INDEX_OUT_OF_RANGE: { gapIndex: number; maxRange: number };
  DISC_POINT_OUTSIDE_PLATE: { gapIndex: number };
  DISC_DIAMETER_OUT_OF_RANGE: { min: number; max: number };
  DISC_DIAMETER_EXCEEDS_PLATE_BORDER: {
    diameter: number;
    gapIndex: number;
    nextGapIndex: number;
  };
  DISC_PARAM_DIAMETER_OUT_OF_RANGE: { min: number; max: number; received: number };
  DISC_PARAM_CLEARANCE_OUT_OF_RANGE: { min: number; max: number; received: number };

  WAFFLE_PITCH_TOO_SMALL: { pitch: number; minPitch: string };
  WAFFLE_AXIS1_DIST_TOO_SMALL: { dist: number; minPitch: string };
  WAFFLE_AXIS2_DIST_TOO_SMALL: { dist: number; minPitch: string };
  WAFFLE_GRID_OFFSET_OUT_OF_RANGE: { gridOffset: number; maxOffset: string };
  WAFFLE_DRAWN_SLOT_TOO_NARROW: { drawnSlotWidth: string; kerf: number };
  WAFFLE_TARGET_SCALE_INVALID: Record<string, never>;
  WAFFLE_TOO_MANY_SECTIONS: { totalSections: number; maxSections: number };
}

export type WarningCode =
  | 'SLICE_FLOOR_OPEN_CHAINS'
  | 'WARN_MESH_OPEN_EDGES'
  | 'WARN_MESH_NON_MANIFOLD_EDGES'
  | 'WARN_MESH_OPEN_COMPONENTS'
  | 'WARN_MESH_INVERTED_NORMALS_FIXED'
  | 'WARN_LOADER_IGNORED_LINES_OR_POINTS'
  | 'WARN_LOADER_Y_UP_TO_Z_UP'
  | 'WARN_LOADER_3MF_UNIT_SCALE'
  | 'WARN_WAFFLE_W1_OMITTED_SECTION'
  | 'WARN_WAFFLE_W2_ISLAND_NO_CROSSING'
  | 'WARN_WAFFLE_W3_WEAK_ENGAGE'
  | 'WARN_WAFFLE_W4_SLOT_SPLITS_PIECE'
  | 'WARN_WAFFLE_W5_THIN_WEB';

export interface WarningParamsMap {
  SLICE_FLOOR_OPEN_CHAINS: {
    floorIndex: number;
    openChainsDiscarded: number;
    openChainsRepaired: number;
  };
  WARN_MESH_OPEN_EDGES: { count: number };
  WARN_MESH_NON_MANIFOLD_EDGES: { count: number };
  WARN_MESH_OPEN_COMPONENTS: { count: number };
  WARN_MESH_INVERTED_NORMALS_FIXED: { count: number };
  WARN_LOADER_IGNORED_LINES_OR_POINTS: { count: number };
  WARN_LOADER_Y_UP_TO_Z_UP: Record<string, never>;
  WARN_LOADER_3MF_UNIT_SCALE: { scale: number };
  WARN_WAFFLE_W1_OMITTED_SECTION: { prefix: string; coord: string };
  WARN_WAFFLE_W2_ISLAND_NO_CROSSING: { pieceId: string; islandIndex: number };
  WARN_WAFFLE_W3_WEAK_ENGAGE: { p1PieceId: string; p2PieceId: string; engageHeight: string };
  WARN_WAFFLE_W4_SLOT_SPLITS_PIECE: { pieceId: string; partners: string };
  WARN_WAFFLE_W5_THIN_WEB: { pieceId: string };
}

export class ValidationError<K extends ErrorCode = ErrorCode> extends Error {
  readonly code: K;
  readonly params: ErrorParamsMap[K];

  constructor(code: K, params: ErrorParamsMap[K]) {
    super(formatErrorMessageEs(code, params));
    this.name = 'ValidationError';
    this.code = code;
    this.params = params;
  }
}

export function createValidationError<K extends ErrorCode>(
  code: K,
  params: ErrorParamsMap[K]
): ValidationError<K> {
  return new ValidationError(code, params);
}

export function formatCoreWarning<K extends WarningCode>(
  code: K,
  params: WarningParamsMap[K]
): string {
  return formatWarningMessageEs(code, params);
}
