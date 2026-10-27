import type { Axis, PolygonWithHoles, SlotLabel } from '../../types/sculpture';
import type { FamilyId } from './canonicalFrame';

export type { FamilyId } from './canonicalFrame';

export interface WaffleParams {
  upAxis: Axis;
  pitch: number;              // p (mm), >= max(2 * thickness, drawnSlotWidth + 0.5)
  slotClearance: number;      // c (mm), [0, 1], default 0.1
  gridOffset: number;         // delta (mm), [-pitch/2, +pitch/2], default 0
  slotLabelsEnabled: boolean; // default true
  targetScale: number;        // factor de escala uniforme (> 0), default 1.0
}

export interface Interval1D {
  min: number;
  max: number;
}

export interface SlotRect {
  crossingId: string;
  partnerPieceId: string;
  uCenter: number;
  width: number;              // w = t + c - kerf
  vMin: number;
  vMax: number;
  vStar: number;
}

export interface WaffleCrossing {
  id: string;                 // p. ej. "X1-Y3"
  p1PieceId: string;          // p. ej. "X1"
  p2PieceId: string;          // p. ej. "Y3"
  aCoord: number;             // coordenada de P1 en mm
  bCoord: number;             // coordenada de P2 en mm
  intervalsP1: Interval1D[];  // S_A
  intervalsP2: Interval1D[];  // S_B
  overlap: Interval1D[];      // O = S_A ∩ S_B
  vStar: number;              // (min O + max O) / 2
  engageHeightMm: number;     // max O - min O
  effectiveLowMm: number;     // longitud(O ∩ (-inf, v*])
  effectiveHighMm: number;    // longitud(O ∩ [v*, +inf))
  slotOnP1: SlotRect;
  slotOnP2: SlotRect;
}

export type WaffleWarningCode = 'W1' | 'W2' | 'W3' | 'W4' | 'W5';

export interface WaffleWarning {
  code: WaffleWarningCode;
  severity: 'info' | 'warning';
  pieceId: string | null;
  partnerPieceIds?: string[];
  islandIndex?: number;
  message: string;
}

export interface WaffleSection {
  id: string;                        // "X1".."Xn" o "Y1".."Ym"
  family: FamilyId;                  // 'P1' | 'P2'
  indexInFamily: number;             // 0..n-1
  planeCoord: number;                // a_i o b_j en mm
  rawPolygons: PolygonWithHoles[];   // en marco canónico (u, v) ANTES de ranuras
  polygons: PolygonWithHoles[];      // en marco canónico (u, v) DESPUÉS de restar ranuras
  slots: SlotRect[];
  slotLabels: SlotLabel[];           // coordenadas locales a la sección (previas a xOffset/yOffset de hoja)
  bounds2D: { minU: number; minV: number; maxU: number; maxV: number };
}

export interface WaffleSliceResult {
  upAxis: Axis;
  drawnSlotWidth: number;            // w = t + c - kerf
  scaleFactor: number;
  scaledBounds3D: { min: [number, number, number]; max: [number, number, number] };
  p1Sections: WaffleSection[];
  p2Sections: WaffleSection[];
  crossings: WaffleCrossing[];
  warnings: WaffleWarning[];
}
