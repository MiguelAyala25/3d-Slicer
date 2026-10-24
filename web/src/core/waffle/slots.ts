import {
  Clipper64,
  PolyTree64,
  ClipType,
  FillRule,
  Point64,
  Path64,
  Paths64,
} from 'clipper2-js';
import type { PolygonWithHoles, SlotLabel } from '../../types/sculpture';
import { distanceToPolygonBoundary, pointInPolygonWithHoles } from '../geometry2d';
import { CLIPPER_SCALE, polyTreeToPolygonsWithHoles } from '../polygonStitcher';
import { WAFFLE_CONSTANTS } from './constants';
import type { FamilyId } from './canonicalFrame';
import type { SlotRect, WaffleCrossing, WaffleSection } from './types';
import { intersectIntervals, intersectPolygonAtU } from './verticalSlice';

/**
 * Calcula el cruce y los rectángulos de ranura entre dos secciones ortogonales A (P1) y B (P2).
 * Devuelve null si no existe solape material (O vacío).
 */
export function computeCrossing(
  secA: Pick<WaffleSection, 'id' | 'planeCoord' | 'rawPolygons' | 'bounds2D'>,
  secB: Pick<WaffleSection, 'id' | 'planeCoord' | 'rawPolygons' | 'bounds2D'>,
  drawnSlotWidth: number
): WaffleCrossing | null {
  const aCoord = secA.planeCoord;
  const bCoord = secB.planeCoord;

  // En el plano de A (P1), la línea de cruce está en u = bCoord
  const intervalsP1 = intersectPolygonAtU(secA.rawPolygons, bCoord);
  if (intervalsP1.length === 0) return null;

  // En el plano de B (P2), la línea de cruce está en u = aCoord
  const intervalsP2 = intersectPolygonAtU(secB.rawPolygons, aCoord);
  if (intervalsP2.length === 0) return null;

  // O = S_A ∩ S_B
  const overlap = intersectIntervals(intervalsP1, intervalsP2);
  if (overlap.length === 0) return null;

  const minO = overlap[0].min;
  const maxO = overlap[overlap.length - 1].max;
  const vStar = (minO + maxO) * 0.5;
  const engageHeightMm = maxO - minO;

  let effectiveLowMm = 0;
  let effectiveHighMm = 0;
  for (const iv of overlap) {
    if (iv.max <= vStar) {
      effectiveLowMm += iv.max - iv.min;
    } else if (iv.min >= vStar) {
      effectiveHighMm += iv.max - iv.min;
    } else {
      effectiveLowMm += vStar - iv.min;
      effectiveHighMm += iv.max - vStar;
    }
  }

  // Ranura en A (P1): abre hacia arriba (+v) desde v* hasta vTop + overrun
  const slotOnP1: SlotRect = {
    crossingId: `${secA.id}-${secB.id}`,
    partnerPieceId: secB.id,
    uCenter: bCoord,
    width: drawnSlotWidth,
    vMin: vStar,
    vMax: secA.bounds2D.maxV + WAFFLE_CONSTANTS.SLOT_OVERRUN_MM,
    vStar,
  };

  // Ranura en B (P2): abre hacia abajo (-v) desde vBot - overrun hasta v*
  const slotOnP2: SlotRect = {
    crossingId: `${secA.id}-${secB.id}`,
    partnerPieceId: secA.id,
    uCenter: aCoord,
    width: drawnSlotWidth,
    vMin: secB.bounds2D.minV - WAFFLE_CONSTANTS.SLOT_OVERRUN_MM,
    vMax: vStar,
    vStar,
  };

  return {
    id: `${secA.id}-${secB.id}`,
    p1PieceId: secA.id,
    p2PieceId: secB.id,
    aCoord,
    bCoord,
    intervalsP1,
    intervalsP2,
    overlap,
    vStar,
    engageHeightMm,
    effectiveLowMm,
    effectiveHighMm,
    slotOnP1,
    slotOnP2,
  };
}

/**
 * Aplica todas las ranuras de una pieza en una única operación booleana de resta
 * (Clipper64 ClipType.Difference, FillRule.NonZero).
 */
export function subtractSlotsFromSection(
  rawPolygons: PolygonWithHoles[],
  slots: SlotRect[]
): PolygonWithHoles[] {
  if (slots.length === 0 || rawPolygons.length === 0) {
    return rawPolygons;
  }

  const subjectPaths = new Paths64();
  for (const poly of rawPolygons) {
    const extPath = new Path64();
    for (const [u, v] of poly.exterior) {
      extPath.push(
        new Point64(
          Math.round(u * CLIPPER_SCALE),
          Math.round(v * CLIPPER_SCALE)
        )
      );
    }
    subjectPaths.push(extPath);

    for (const hole of poly.holes) {
      const holePath = new Path64();
      for (const [u, v] of hole) {
        holePath.push(
          new Point64(
            Math.round(u * CLIPPER_SCALE),
            Math.round(v * CLIPPER_SCALE)
          )
        );
      }
      subjectPaths.push(holePath);
    }
  }

  const clipPaths = new Paths64();
  for (const slot of slots) {
    const halfW = slot.width * 0.5;
    const uMin = slot.uCenter - halfW;
    const uMax = slot.uCenter + halfW;
    const vMin = slot.vMin;
    const vMax = slot.vMax;

    // Rectángulo CCW
    const rectPath = new Path64();
    rectPath.push(new Point64(Math.round(uMin * CLIPPER_SCALE), Math.round(vMin * CLIPPER_SCALE)));
    rectPath.push(new Point64(Math.round(uMax * CLIPPER_SCALE), Math.round(vMin * CLIPPER_SCALE)));
    rectPath.push(new Point64(Math.round(uMax * CLIPPER_SCALE), Math.round(vMax * CLIPPER_SCALE)));
    rectPath.push(new Point64(Math.round(uMin * CLIPPER_SCALE), Math.round(vMax * CLIPPER_SCALE)));
    clipPaths.push(rectPath);
  }

  const clipper = new Clipper64();
  clipper.preserveCollinear = false;
  clipper.addSubjectPaths(subjectPaths);
  clipper.addClipPaths(clipPaths);

  const polyTree = new PolyTree64();
  clipper.executePolyTree(ClipType.Difference, FillRule.NonZero, polyTree);

  return polyTreeToPolygonsWithHoles(polyTree);
}

/**
 * Calcula las posiciones de las etiquetas de ranura locales para una sección.
 * En P1: centradas en u, justo debajo de v* (en el material restante).
 * En P2: centradas en u, justo encima de v* (en el material restante).
 * Verifica que la caja de texto quepa completa dentro del material; de lo contrario se omite.
 */
export function computeLocalSlotLabels(
  slottedPolygons: PolygonWithHoles[],
  bounds2D: WaffleSection['bounds2D'],
  slots: SlotRect[],
  family: FamilyId
): { labels: SlotLabel[]; omittedSlotPartnerIds: string[] } {
  const labels: SlotLabel[] = [];
  const omittedSlotPartnerIds: string[] = [];

  const fontSize = WAFFLE_CONSTANTS.SLOT_LABEL_FONT_SIZE_MM;
  const offset = WAFFLE_CONSTANTS.SLOT_LABEL_OFFSET_MM;
  const halfFont = fontSize * 0.5;

  for (const slot of slots) {
    const text = slot.partnerPieceId;
    const uLocal = slot.uCenter - bounds2D.minU;

    let vLocal: number;
    if (family === 'P1') {
      // P1: material debajo de v*
      vLocal = (slot.vStar - bounds2D.minV) - offset - halfFont;
    } else {
      // P2: material sobre v*
      vLocal = (slot.vStar - bounds2D.minV) + offset + halfFont;
    }

    // Coordenada en marco canónico (u, v) para evaluar contención en slottedPolygons
    const uTest = slot.uCenter;
    const vTest = vLocal + bounds2D.minV;

    // Semiancho y semialto de la caja
    const halfBoxW = Math.max(1.0, text.length * fontSize * 0.35) + WAFFLE_CONSTANTS.SLOT_LABEL_MARGIN_MM;
    const halfBoxH = halfFont + WAFFLE_CONSTANTS.SLOT_LABEL_MARGIN_MM;

    const testPoints: [number, number][] = [
      [uTest, vTest],
      [uTest - halfBoxW, vTest - halfBoxH],
      [uTest + halfBoxW, vTest - halfBoxH],
      [uTest + halfBoxW, vTest + halfBoxH],
      [uTest - halfBoxW, vTest + halfBoxH],
      [uTest, vTest - halfBoxH],
      [uTest, vTest + halfBoxH],
    ];

    let fits = true;
    for (const [px, py] of testPoints) {
      let inSolid = false;
      for (const poly of slottedPolygons) {
        if (pointInPolygonWithHoles(px, py, poly) && distanceToPolygonBoundary(px, py, poly) >= 0.1) {
          inSolid = true;
          break;
        }
      }
      if (!inSolid) {
        fits = false;
        break;
      }
    }

    if (fits) {
      labels.push({
        crossingId: slot.crossingId,
        text,
        x: Number(uLocal.toFixed(3)),
        y: Number(vLocal.toFixed(3)),
        fontSize,
      });
    } else {
      omittedSlotPartnerIds.push(slot.partnerPieceId);
    }
  }

  return { labels, omittedSlotPartnerIds };
}
