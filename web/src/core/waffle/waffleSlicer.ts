import { AxisSliceCache } from '../slicer';
import { stitchAndUnionSegments } from '../polygonStitcher';
import { ValidationError } from '../validator';
import type { CoreParams, PolygonWithHoles } from '../../types/sculpture';
import { WAFFLE_CONSTANTS } from './constants';
import {
  fromSlicerPolygonsToCanonical,
  getWaffleAxesConfig,
} from './canonicalFrame';
import { computeFamilyGridPositions } from './grid';
import {
  computeCrossing,
  computeLocalSlotLabels,
  subtractSlotsFromSection,
} from './slots';
import type {
  FamilyId,
  SlotRect,
  WaffleCrossing,
  WaffleParams,
  WaffleSection,
  WaffleSliceResult,
} from './types';
import { evaluateWaffleWarnings } from './warnings';

function computeBounds2D(polygons: PolygonWithHoles[]): {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
} {
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const poly of polygons) {
    for (const [u, v] of poly.exterior) {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  if (!Number.isFinite(minU)) {
    return { minU: 0, maxU: 0, minV: 0, maxV: 0 };
  }
  return { minU, maxU, minV, maxV };
}

/**
 * Corta mallas tridimensionales a partir de dos caches ortogonales de ejes (cacheP1 y cacheP2),
 * aplicando el marco canónico, cálculo de ranuras de corredor abierto y avisos W1-W5.
 */
export function sliceWaffleFromCaches(
  cacheP1: AxisSliceCache,
  cacheP2: AxisSliceCache,
  coreParams: CoreParams,
  waffleParams: WaffleParams
): WaffleSliceResult {
  const { thickness, kerf } = coreParams;
  const {
    upAxis,
    pitch,
    slotClearance,
    gridOffset,
    slotLabelsEnabled,
    targetScale,
  } = waffleParams;

  const scaleFactor = targetScale > 0 ? targetScale : 1.0;

  // Validación de separación entre secciones (CA-C2)
  const minPitch = 2 * thickness;
  if (pitch < minPitch - 1e-9) {
    throw new ValidationError(
      `La separación entre secciones (${pitch} mm) debe ser al menos 2 veces el grosor de placa (${minPitch.toFixed(2)} mm).`
    );
  }

  // Validación de desfase de rejilla (CA-C3)
  const maxOffset = pitch * 0.5;
  if (Math.abs(gridOffset) > maxOffset + 1e-9) {
    throw new ValidationError(
      `El desfase de rejilla (${gridOffset} mm) debe estar entre -${maxOffset.toFixed(2)} y +${maxOffset.toFixed(2)} mm.`
    );
  }

  // Validación de ancho dibujado de ranura (CA-E1)
  const drawnSlotWidth = thickness + slotClearance - kerf;
  if (drawnSlotWidth < WAFFLE_CONSTANTS.MIN_DRAWN_SLOT_WIDTH_MM) {
    throw new ValidationError(
      `El ancho dibujado de ranura (t + holgura - kerf = ${drawnSlotWidth.toFixed(3)} mm) debe ser mayor a 0.05 mm. Reduce el kerf (${kerf} mm) o aumenta el grosor/holgura.`
    );
  }

  const cfg = getWaffleAxesConfig(upAxis);

  // Extensión escalada de cada familia
  const hMin1 = cacheP1.boundsMin[2] * scaleFactor;
  const hMax1 = cacheP1.boundsMax[2] * scaleFactor;
  const p1Positions = computeFamilyGridPositions(hMin1, hMax1, pitch, gridOffset);

  const hMin2 = cacheP2.boundsMin[2] * scaleFactor;
  const hMax2 = cacheP2.boundsMax[2] * scaleFactor;
  const p2Positions = computeFamilyGridPositions(hMin2, hMax2, pitch, gridOffset);

  // Cota superior de secciones totales
  const totalSections = p1Positions.length + p2Positions.length;
  if (totalSections > WAFFLE_CONSTANTS.MAX_SECTIONS_TOTAL) {
    throw new ValidationError(
      `El total de secciones de la rejilla (${totalSections}) excede el máximo permitido de 400. Aumenta la separación entre secciones (p) o reduce el tamaño del modelo.`
    );
  }

  const omittedGridPositions: Array<{
    family: FamilyId;
    prefix: string;
    coord: number;
  }> = [];

  // Cortar y remapear secciones de P1
  interface CandidateSection {
    planeCoord: number;
    rawPolygons: PolygonWithHoles[];
    bounds2D: { minU: number; minV: number; maxU: number; maxV: number };
  }

  const p1Candidates: CandidateSection[] = [];
  for (const pos of p1Positions) {
    const segments = cacheP1.extractSegmentsAtZ(pos / scaleFactor, scaleFactor);
    const stitchRes = stitchAndUnionSegments(segments);

    if (stitchRes.polygons.length === 0) {
      omittedGridPositions.push({
        family: 'P1',
        prefix: cfg.p1Prefix,
        coord: pos,
      });
    } else {
      const canonicalPolys = fromSlicerPolygonsToCanonical(
        stitchRes.polygons,
        upAxis,
        'P1'
      );
      const bounds2D = computeBounds2D(canonicalPolys);
      p1Candidates.push({
        planeCoord: pos,
        rawPolygons: canonicalPolys,
        bounds2D,
      });
    }
  }

  // Cortar y remapear secciones de P2
  const p2Candidates: CandidateSection[] = [];
  for (const pos of p2Positions) {
    const segments = cacheP2.extractSegmentsAtZ(pos / scaleFactor, scaleFactor);
    const stitchRes = stitchAndUnionSegments(segments);

    if (stitchRes.polygons.length === 0) {
      omittedGridPositions.push({
        family: 'P2',
        prefix: cfg.p2Prefix,
        coord: pos,
      });
    } else {
      const canonicalPolys = fromSlicerPolygonsToCanonical(
        stitchRes.polygons,
        upAxis,
        'P2'
      );
      const bounds2D = computeBounds2D(canonicalPolys);
      p2Candidates.push({
        planeCoord: pos,
        rawPolygons: canonicalPolys,
        bounds2D,
      });
    }
  }

  // Numeración consecutiva de secciones no vacías
  const p1Sections: WaffleSection[] = p1Candidates.map((cand, idx) => ({
    id: `${cfg.p1Prefix}${idx + 1}`,
    family: 'P1',
    indexInFamily: idx,
    planeCoord: cand.planeCoord,
    rawPolygons: cand.rawPolygons,
    polygons: [],
    slots: [],
    slotLabels: [],
    bounds2D: cand.bounds2D,
  }));

  const p2Sections: WaffleSection[] = p2Candidates.map((cand, idx) => ({
    id: `${cfg.p2Prefix}${idx + 1}`,
    family: 'P2',
    indexInFamily: idx,
    planeCoord: cand.planeCoord,
    rawPolygons: cand.rawPolygons,
    polygons: [],
    slots: [],
    slotLabels: [],
    bounds2D: cand.bounds2D,
  }));

  // Cruces ortogonales entre todas las piezas de P1 y P2
  const crossings: WaffleCrossing[] = [];
  const slotsP1ByPiece = new Map<string, SlotRect[]>();
  const slotsP2ByPiece = new Map<string, SlotRect[]>();

  for (const s1 of p1Sections) {
    for (const s2 of p2Sections) {
      const cr = computeCrossing(s1, s2, drawnSlotWidth);
      if (cr) {
        crossings.push(cr);

        const list1 = slotsP1ByPiece.get(s1.id) ?? [];
        list1.push(cr.slotOnP1);
        slotsP1ByPiece.set(s1.id, list1);

        const list2 = slotsP2ByPiece.get(s2.id) ?? [];
        list2.push(cr.slotOnP2);
        slotsP2ByPiece.set(s2.id, list2);
      }
    }
  }

  // Aplicar ranuras por pieza y calcular etiquetas locales
  for (const s1 of p1Sections) {
    s1.slots = slotsP1ByPiece.get(s1.id) ?? [];
    s1.polygons = subtractSlotsFromSection(s1.rawPolygons, s1.slots);
    if (slotLabelsEnabled) {
      const lblRes = computeLocalSlotLabels(s1.polygons, s1.bounds2D, s1.slots, 'P1');
      s1.slotLabels = lblRes.labels;
    } else {
      s1.slotLabels = [];
    }
  }

  for (const s2 of p2Sections) {
    s2.slots = slotsP2ByPiece.get(s2.id) ?? [];
    s2.polygons = subtractSlotsFromSection(s2.rawPolygons, s2.slots);
    if (slotLabelsEnabled) {
      const lblRes = computeLocalSlotLabels(s2.polygons, s2.bounds2D, s2.slots, 'P2');
      s2.slotLabels = lblRes.labels;
    } else {
      s2.slotLabels = [];
    }
  }

  // Evaluación de avisos W1 a W5
  const warnings = evaluateWaffleWarnings({
    omittedGridPositions,
    p1Sections,
    p2Sections,
    crossings,
    pitch,
    drawnSlotWidth,
  });

  // Cálculo de scaledBounds3D en coordenadas de mundo centradas
  let bMinX = 0, bMaxX = 0;
  let bMinY = 0, bMaxY = 0;
  let bMinZ = 0, bMaxZ = 0;

  if (upAxis === 'z') {
    // p1 = x, p2 = y, up = z
    bMinX = cacheP1.boundsMin[2] * scaleFactor;
    bMaxX = cacheP1.boundsMax[2] * scaleFactor;
    bMinY = cacheP2.boundsMin[2] * scaleFactor;
    bMaxY = cacheP2.boundsMax[2] * scaleFactor;
    bMinZ = -cacheP1.boundsMax[0] * scaleFactor;
    bMaxZ = -cacheP1.boundsMin[0] * scaleFactor;
  } else if (upAxis === 'x') {
    // p1 = y, p2 = z, up = x
    bMinY = cacheP1.boundsMin[2] * scaleFactor;
    bMaxY = cacheP1.boundsMax[2] * scaleFactor;
    bMinZ = cacheP2.boundsMin[2] * scaleFactor;
    bMaxZ = cacheP2.boundsMax[2] * scaleFactor;
    bMinX = cacheP2.boundsMin[0] * scaleFactor;
    bMaxX = cacheP2.boundsMax[0] * scaleFactor;
  } else {
    // upAxis === 'y': p1 = z, p2 = x, up = y
    bMinZ = cacheP1.boundsMin[2] * scaleFactor;
    bMaxZ = cacheP1.boundsMax[2] * scaleFactor;
    bMinX = cacheP2.boundsMin[2] * scaleFactor;
    bMaxX = cacheP2.boundsMax[2] * scaleFactor;
    bMinY = cacheP1.boundsMin[1] * scaleFactor;
    bMaxY = cacheP1.boundsMax[1] * scaleFactor;
  }

  return {
    upAxis,
    drawnSlotWidth,
    scaleFactor,
    scaledBounds3D: {
      min: [bMinX, bMinY, bMinZ],
      max: [bMaxX, bMaxY, bMaxZ],
    },
    p1Sections,
    p2Sections,
    crossings,
    warnings,
  };
}

/**
 * Reutilizable sin worker: genera los caches de corte y ejecuta el corte Waffle.
 */
export function sliceWaffleMesh(
  rawPositions: Float32Array,
  coreParams: CoreParams,
  waffleParams: WaffleParams
): WaffleSliceResult {
  const cfg = getWaffleAxesConfig(waffleParams.upAxis);
  const cacheP1 = new AxisSliceCache(rawPositions, cfg.p1Axis);
  const cacheP2 = new AxisSliceCache(rawPositions, cfg.p2Axis);
  return sliceWaffleFromCaches(cacheP1, cacheP2, coreParams, waffleParams);
}
