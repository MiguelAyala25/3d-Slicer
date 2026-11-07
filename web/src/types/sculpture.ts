export type Axis = 'x' | 'y' | 'z';

export interface SculptureParams {
  plates: number;            // Número de placas [2..200], default 10
  thickness: number;         // Espesor del material en mm [0.1..100.0], default 3.0
  gap: number;               // Separación/hueco entre placas en mm [0.1..1000.0], default 3.0
  axis: Axis;                // Eje normal de corte ['x','y','z'], default 'z'
  sheetW: number;            // Ancho de la hoja de corte en mm [10.0..5000.0], default 600.0
  sheetH: number;            // Alto de la hoja de corte en mm [10.0..5000.0], default 400.0
  sheetMargin: number;       // Margen perimetral de hoja en mm [0.0..200.0], default 10.0
  partGap: number;           // Separación mínima entre piezas en mm [0.0..100.0], default 5.0
  kerf: number;              // Ancho de corte del láser/fresa en mm [0.0..5.0], default 0.15
  discDiameter: number;      // Diámetro nominal de discos conectores en mm [0.1..5000.0], default 6.0
  engraveClearance: number;  // Holgura radial/diametral para círculo grabado en mm [0.0..10.0], default 0.3
  scrapTagEnabled: boolean;  // Generación de etiquetas de retal sobrante, default true
}

export type CoreParams = Omit<SculptureParams, 'discDiameter' | 'engraveClearance'>;

export type Point2D = [number, number];

import type { WaffleParams, WaffleSliceResult } from '../core/waffle/types';

export interface PolygonWithHoles {
  exterior: Point2D[];
  holes: Point2D[][];
  area: number;
}

export type PlateContour = PolygonWithHoles[];

export interface Disc {
  id: number;
  x: number;
  y: number;
  diameter: number;
  gapIndex: number; // Índice físico k (JSON 'hueco'): une plates[k] con plates[k + 1]
}

export interface PlateEngraveDisc {
  id: number;
  x: number;               // Coordenada X local a la placa (mm CAD)
  y: number;               // Coordenada Y local a la placa (mm CAD)
  diameter: number;        // Diámetro final con holgura: d.diameter + params.engraveClearance
  nominalDiameter: number; // d.diameter sin holgura
  gapIndex: number;        // gapIndex === plateIndex -> sólido; gapIndex === plateIndex - 1 -> punteado
  isDashed: boolean;       // false: círculo SÓLIDO (gapIndex === i); true: PUNTEADO (gapIndex === i - 1)
}

export interface SliceWarning {
  floorIndex: number;
  openChainsDiscarded: number;
  openChainsRepaired: number;
  message: string;
}

export interface SliceResult {
  plates: PlateContour[];           // Longitud fija === params.plates (vacías son [])
  zPositions: number[];             // Longitud fija === params.plates
  scaleFactor: number;
  scaledBounds: [Point2D, Point2D]; // [[minX, minY], [maxX, maxY]]
  scaledHeight: number;
  warnings: SliceWarning[];
}

export interface MeshMetadata {
  fileName: string;
  vertexCount: number;
  faceCount: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  extents: [number, number, number];
  isWatertight: boolean;
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
  invertedComponentCount: number;
  openComponentCount: number;
  unitScaleApplied: number;
  warnings: string[];
}

export interface SlotLabel {
  crossingId: string; // p. ej. "X1-Y3"
  text: string;       // p. ej. "Y3"
  x: number;          // Coordenada X (mm CAD: local o en hoja)
  y: number;          // Coordenada Y (mm CAD: local o en hoja)
  fontSize: number;   // SLOT_LABEL_FONT_SIZE_MM (2.2 mm)
}

export interface PlacedPlate {
  plateIndex: number;           // Índice físico 0 .. plates-1
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
  polygons: PolygonWithHoles[]; // Coordenadas locales normalizadas a (0,0) en su bbox min
  discs: PlateEngraveDisc[];    // Discos de grabado locales con diameter = d.diameter + engraveClearance e isDashed
  slotLabels?: SlotLabel[];     // Etiquetas de ranura grabadas en GRABADO (opcional, técnica Waffle)
  labelText: string;
  labelX: number;               // Centro X de etiqueta en coordenadas de hoja (mm CAD)
  labelY: number;               // Centro Y de etiqueta en coordenadas de hoja (mm CAD)
  labelSize: number;
  labelOutside: boolean;
}

export interface PlacedDisc {
  discId: number;
  gapIndex: number;
  x: number;                    // Centro X en la hoja (mm CAD)
  y: number;                    // Centro Y en la hoja (mm CAD)
  diameter: number;
  label: string;                // p. ej. "D0-1"
}

export interface DiscGroup {
  gapIndex: number;
  plateA: number;
  plateB: number;
  label: string;                // p. ej. "P0-P1"
  trayX: number;
  trayY: number;
  trayW: number;
  trayH: number;
  labelSepX: number;
  discs: PlacedDisc[];
}

export interface ScrapTag {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];              // ["SOBRANTE", "{w} x {h} mm"]
}

export interface SheetLayout {
  sheetIndex: number;
  sheetType: 'plates' | 'discs';
  materialThickness: number;
  width: number;
  height: number;
  margin: number;
  kerf: number;
  engraveClearance: number;
  plates: PlacedPlate[];
  discs: PlacedDisc[];
  discGroups: DiscGroup[];
  scrapTags: ScrapTag[];
  usedWidth: number;
  usedHeight: number;
  usedAreaMm2: number;
  usableAreaMm2: number;
  occupancyPct: number;
  remnantWidth: number;
  remnantHeight: number;
  remnantAreaMm2: number;
}

export type WorkerRequest =
  | {
      type: 'LOAD_MESH';
      jobId: number;
      meshId: number;
      buffer: ArrayBuffer;
      fileName: string;
      upOrientation?: 'y-up' | 'z-up' | 'auto';
    }
  | {
      type: 'SET_MESH';
      meshId: number;
      positions: Float32Array;
    }
  | {
      type: 'SLICE';
      jobId: number;
      meshId: number;
      params: SculptureParams;
    }
  | {
      type: 'SLICE_WAFFLE';
      jobId: number;
      meshId: number;
      coreParams: CoreParams;
      waffleParams: WaffleParams;
    };

export type WorkerResponse =
  | {
      type: 'LOAD_MESH_SUCCESS';
      jobId: number;
      meshId: number;
      positions: Float32Array;
      metadata: MeshMetadata;
      durationMs: number;
    }
  | {
      type: 'LOAD_MESH_ERROR';
      jobId: number;
      meshId: number;
      error: string;
    }
  | {
      type: 'SLICE_SUCCESS';
      jobId: number;
      meshId: number;
      result: SliceResult;
      durationMs: number;
    }
  | {
      type: 'SLICE_WAFFLE_SUCCESS';
      jobId: number;
      meshId: number;
      result: WaffleSliceResult;
      durationMs: number;
    }
  | {
      type: 'SLICE_SKIPPED';
      jobId: number;
      meshId: number;
    }
  | {
      type: 'SLICE_ERROR';
      jobId: number;
      meshId: number;
      error: string;
    };
