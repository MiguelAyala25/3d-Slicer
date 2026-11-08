import { describe, it, expect } from 'vitest';
import {
  ValidationError,
  createValidationError,
  formatCoreWarning,
  type ErrorCode,
  type ErrorParamsMap,
  type WarningCode,
  type WarningParamsMap,
} from '../core/errors';
import {
  ERROR_MESSAGES_ES,
  WARNING_MESSAGES_ES,
  formatErrorMessageEs,
  formatWarningMessageEs,
  UI_TEXTS_ES,
} from '../i18n/es';

describe('i18n and typed errors (C12 / M6)', () => {
  it('covers every ErrorCode in ERROR_MESSAGES_ES catalog', () => {
    const sampleParams: { [K in ErrorCode]: ErrorParamsMap[K] } = {
      MESH_TOO_FEW_TRIANGLES_FOR_SLICE: {},
      MESH_ZERO_HEIGHT_ON_AXIS: { axis: 'Z' },
      MESH_EMPTY: {},
      MESH_BBOX_FAILED: {},
      MESH_FLAT_OR_DEGENERATE: { x: '0.0000', y: '0.0000', z: '10.0000' },
      MESH_INDEXING_FAILED: {},
      MESH_TOO_FEW_FACES: { faceCount: 2, minFaces: 4 },
      MESH_TOO_MANY_TRIANGLES: { faceCount: '1,500,000', maxTriangles: '1,000,000' },
      MESH_ONLY_LINES_OR_POINTS: {},
      MESH_NO_TRIANGLES_FOUND: {},
      MESH_MERGE_FAILED: {},
      PLY_POINT_CLOUD_NO_FACES: {},
      PLY_NO_VALID_TRIANGLES: {},
      FILE_EXTENSION_UNSUPPORTED: { ext: '.exe' },

      SHEET_MARGIN_TOO_LARGE: { sheetMargin: 250, sheetW: 400, sheetH: 300 },
      PLATE_EXCEEDS_USABLE_AREA: {
        plateIndex: 3,
        widthMm: '500.0',
        heightMm: '600.0',
        usableWMm: '380.0',
        usableHMm: '280.0',
      },
      WAFFLE_PIECE_EXCEEDS_USABLE_AREA: {
        sectionId: 'P1-0',
        widthMm: '500.0',
        heightMm: '600.0',
        usableWMm: '380.0',
        usableHMm: '280.0',
      },

      FILE_PATH_EMPTY: {},
      FILE_FORMAT_UNSUPPORTED: { ext: '.bmp' },
      FILE_EMPTY: { fileName: 'model.stl' },
      FILE_TOO_LARGE: { fileName: 'huge.obj' },
      PARAM_PLATES_OUT_OF_RANGE: { min: 2, max: 200, received: 1 },
      PARAM_THICKNESS_OUT_OF_RANGE: { min: 0.1, max: 100, received: 0 },
      PARAM_GAP_OUT_OF_RANGE: { min: 0, max: 1000, received: -1 },
      PARAM_AXIS_INVALID: { received: 'w' },
      PARAM_SHEET_DIM_OUT_OF_RANGE: { min: 10, max: 5000, sheetW: 5, sheetH: 5 },
      PARAM_SHEET_MARGIN_OUT_OF_RANGE: { min: 0, max: 200, received: -5 },
      PARAM_PART_GAP_OUT_OF_RANGE: { min: 0, max: 100, received: -1 },
      PARAM_KERF_OUT_OF_RANGE: { min: 0, max: 5, received: 10 },
      PARAM_SCRAP_TAG_NOT_BOOLEAN: {},

      PROJECT_INVALID_JSON: {},
      PROJECT_INVALID_FORMAT: {},
      PROJECT_UNSUPPORTED_VERSION: { version: '3.0' },
      PROJECT_MISSING_REQUIRED_FIELD: { field: 'plates' },
      PROJECT_UNRECOGNIZED_ROOT_FIELD: { field: 'unknownField' },
      PROJECT_FIELD_MUST_BE_OBJECT: { field: 'technique' },
      PROJECT_UNRECOGNIZED_SECTION_FIELD: { field: 'extra', section: 'material' },
      PROJECT_FIELD_MUST_BE_NUMERIC: { field: 'material.thickness' },
      PROJECT_FIELD_MUST_BE_BOOLEAN: { field: 'material.scrapTagEnabled' },
      PROJECT_WAFFLE_UP_AXIS_INVALID: {},
      PROJECT_DISCS_LIST_INVALID: {},
      PROJECT_DISC_ITEM_INVALID: { position: 0 },
      PROJECT_DISC_ID_INVALID: { index: 0, id: 'bad' },
      PROJECT_DISC_ID_DUPLICATE: { id: 1 },
      PROJECT_DISC_COORDS_NON_NUMERIC: { id: 1 },
      PROJECT_DISC_DIAMETER_INVALID: { id: 1, diameter: 0 },
      PROJECT_DISC_GAP_OUT_OF_RANGE: { id: 1, gapIndex: 5, maxAllowed: 4 },
      PROJECT_SLOTS_NO_DISCS_ALLOWED: {},
      PROJECT_NONE_JOINT_NO_DISCS_ALLOWED: {},
      PROJECT_SCHEMA_ISSUE: { message: 'Custom schema error' },

      BUILD_TECHNIQUE_REQUIRED: {},
      BUILD_UNKNOWN_TECHNIQUE: { id: 'origami' },
      BUILD_JOINT_REQUIRED: {},
      BUILD_WAFFLE_REQUIRES_SLOTS_JOINT: {},
      BUILD_SLOTS_EXCLUSIVE_TO_WAFFLE: {},
      BUILD_UNKNOWN_JOINT: { id: 'dovetail' },
      BUILD_ROD_JOINT_UNAVAILABLE: {},
      BUILD_JOINT_UNAVAILABLE: { label: 'Con varilla' },
      NONE_JOINT_REQUIRES_ZERO_GAP: { received: 3.0 },

      DISC_DEFAULT_DIAMETER_OUT_OF_RANGE: { min: 1, max: 50 },
      DISC_GAP_INDEX_OUT_OF_RANGE: { gapIndex: 10, maxRange: 8 },
      DISC_POINT_OUTSIDE_PLATE: { gapIndex: 2 },
      DISC_DIAMETER_OUT_OF_RANGE: { min: 1, max: 50 },
      DISC_DIAMETER_EXCEEDS_PLATE_BORDER: { diameter: 20, gapIndex: 1, nextGapIndex: 2 },
      DISC_PARAM_DIAMETER_OUT_OF_RANGE: { min: 1, max: 50, received: 0 },
      DISC_PARAM_CLEARANCE_OUT_OF_RANGE: { min: 0, max: 10, received: 15 },

      WAFFLE_PITCH_TOO_SMALL: { pitch: 4, minPitch: '6.00' },
      WAFFLE_AXIS1_DIST_TOO_SMALL: { dist: 4, minPitch: '6.00' },
      WAFFLE_AXIS2_DIST_TOO_SMALL: { dist: 4, minPitch: '6.00' },
      WAFFLE_GRID_OFFSET_OUT_OF_RANGE: { gridOffset: 20, maxOffset: '15.00' },
      WAFFLE_DRAWN_SLOT_TOO_NARROW: { drawnSlotWidth: '0.030', kerf: 0.15 },
      WAFFLE_TARGET_SCALE_INVALID: {},
      WAFFLE_TOO_MANY_SECTIONS: { totalSections: 450, maxSections: 400 },
    };

    for (const [code, params] of Object.entries(sampleParams) as Array<[ErrorCode, ErrorParamsMap[ErrorCode]]>) {
      expect(ERROR_MESSAGES_ES[code]).toBeDefined();
      const formatted = formatErrorMessageEs(code, params);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);

      const err = new ValidationError(code, params);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ValidationError');
      expect(err.code).toBe(code);
      expect(err.params).toEqual(params);
      expect(err.message).toBe(formatted);

      const helperErr = createValidationError(code, params);
      expect(helperErr.code).toBe(code);
      expect(helperErr.message).toBe(formatted);
    }
  });

  it('covers every WarningCode in WARNING_MESSAGES_ES catalog', () => {
    const sampleWarnings: { [K in WarningCode]: WarningParamsMap[K] } = {
      SLICE_FLOOR_OPEN_CHAINS: { floorIndex: 2, openChainsDiscarded: 1, openChainsRepaired: 3 },
      WARN_MESH_OPEN_EDGES: { count: 5 },
      WARN_MESH_NON_MANIFOLD_EDGES: { count: 2 },
      WARN_MESH_OPEN_COMPONENTS: { count: 1 },
      WARN_MESH_INVERTED_NORMALS_FIXED: { count: 2 },
      WARN_LOADER_IGNORED_LINES_OR_POINTS: { count: 3 },
      WARN_LOADER_Y_UP_TO_Z_UP: {},
      WARN_LOADER_3MF_UNIT_SCALE: { scale: 10 },
      WARN_WAFFLE_W1_OMITTED_SECTION: { prefix: 'P1', coord: '12.50' },
      WARN_WAFFLE_W2_ISLAND_NO_CROSSING: { pieceId: 'P1-2', islandIndex: 1 },
      WARN_WAFFLE_W3_WEAK_ENGAGE: { p1PieceId: 'P1-1', p2PieceId: 'P2-1', engageHeight: '3.20' },
      WARN_WAFFLE_W4_SLOT_SPLITS_PIECE: { pieceId: 'P1-3', partners: 'P2-1, P2-2' },
      WARN_WAFFLE_W5_THIN_WEB: { pieceId: 'P1-4' },
    };

    for (const [code, params] of Object.entries(sampleWarnings) as Array<[WarningCode, WarningParamsMap[WarningCode]]>) {
      expect(WARNING_MESSAGES_ES[code]).toBeDefined();
      const formatted = formatWarningMessageEs(code, params);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);

      const formattedHelper = formatCoreWarning(code, params);
      expect(formattedHelper).toBe(formatted);
    }
  });

  it('strictly requires ErrorCode and params in ValidationError constructor', () => {
    const err = new ValidationError('PROJECT_SCHEMA_ISSUE', { message: 'Custom schema issue' });
    expect(err.message).toBe('Custom schema issue');
    expect(err.code).toBe('PROJECT_SCHEMA_ISSUE');
    expect(err.name).toBe('ValidationError');
  });

  it('provides expected UI constants in UI_TEXTS_ES', () => {
    expect(UI_TEXTS_ES.incompatibleProjectConfirm).toContain('Los parámetros del archivo difieren');
    expect(UI_TEXTS_ES.discSheetSameNotice).toBe('Discos: misma lámina que placas');
    expect(UI_TEXTS_ES.discSheetSeparateNotice(4.5)).toBe('Discos: lámina aparte de 4.5 mm');
  });
});
