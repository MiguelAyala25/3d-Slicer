import {
  ClipperOffset,
  EndType,
  JoinType,
  Path64,
  Paths64,
  Point64,
  PolyTree64,
} from 'clipper2-js';
import type { PolygonWithHoles } from '../../types/sculpture';
import { CLIPPER_SCALE, polyTreeToPolygonsWithHoles } from '../polygonStitcher';
import { WAFFLE_CONSTANTS } from './constants';
import type { FamilyId } from './canonicalFrame';
import { intersectIntervals, intersectPolygonAtU } from './verticalSlice';
import { subtractSlotsFromSection } from './slots';
import type {
  WaffleCrossing,
  WaffleSection,
  WaffleWarning,
} from './types';

/**
 * Aplica una erosión/encogimiento interno a polígonos con huecos mediante ClipperOffset.
 * deltaMm positivo encoge el sólido (delta negativo en Clipper).
 */
export function erodePolygons(
  polygons: PolygonWithHoles[],
  deltaMm: number
): PolygonWithHoles[] {
  if (polygons.length === 0 || deltaMm <= 0) return polygons;

  const offset = new ClipperOffset();
  const paths = new Paths64();

  for (const poly of polygons) {
    const ext = new Path64();
    for (const [u, v] of poly.exterior) {
      ext.push(new Point64(Math.round(u * CLIPPER_SCALE), Math.round(v * CLIPPER_SCALE)));
    }
    paths.push(ext);

    for (const hole of poly.holes) {
      const hPath = new Path64();
      for (const [u, v] of hole) {
        hPath.push(new Point64(Math.round(u * CLIPPER_SCALE), Math.round(v * CLIPPER_SCALE)));
      }
      paths.push(hPath);
    }
  }

  offset.addPaths(paths, JoinType.Miter, EndType.Polygon);
  const polyTree = new PolyTree64();
  offset.executePolytree(-deltaMm * CLIPPER_SCALE, polyTree);

  return polyTreeToPolygonsWithHoles(polyTree);
}

export interface EvaluateWaffleWarningsParams {
  omittedGridPositions: Array<{ family: FamilyId; prefix: string; coord: number }>;
  p1Sections: WaffleSection[];
  p2Sections: WaffleSection[];
  crossings: WaffleCrossing[];
  pitch: number;
  drawnSlotWidth: number;
}

export function evaluateWaffleWarnings(
  params: EvaluateWaffleWarningsParams
): WaffleWarning[] {
  const warnings: WaffleWarning[] = [];
  const {
    omittedGridPositions,
    p1Sections,
    p2Sections,
    crossings,
    pitch,
    drawnSlotWidth,
  } = params;

  // W1: Secciones omitidas por vacías
  for (const omitted of omittedGridPositions) {
    warnings.push({
      code: 'W1',
      severity: 'info',
      pieceId: null,
      message: `Sección omitida en familia ${omitted.prefix} (posición ${omitted.coord.toFixed(2)} mm): el plano no intersecta volumen útil.`,
    });
  }

  // Mapa de cruces por pieza para búsquedas rápidas
  const crossingsByPiece = new Map<string, WaffleCrossing[]>();
  for (const c of crossings) {
    const list1 = crossingsByPiece.get(c.p1PieceId) ?? [];
    list1.push(c);
    crossingsByPiece.set(c.p1PieceId, list1);

    const list2 = crossingsByPiece.get(c.p2PieceId) ?? [];
    list2.push(c);
    crossingsByPiece.set(c.p2PieceId, list2);
  }

  const allSections = [...p1Sections, ...p2Sections];

  // W2: Isla o pieza sin ningún cruce (por cada isla en rawPolygons)
  for (const sec of allSections) {
    const pieceCrossings = crossingsByPiece.get(sec.id) ?? [];

    for (let k = 0; k < sec.rawPolygons.length; k++) {
      const island = sec.rawPolygons[k];
      let hasCrossing = false;

      for (const cr of pieceCrossings) {
        // En sec, la línea de cruce está en la coordenada de la otra pieza
        const partnerCoord = sec.family === 'P1' ? cr.bCoord : cr.aCoord;
        const islandIntervals = intersectPolygonAtU([island], partnerCoord);
        if (islandIntervals.length > 0) {
          const overlap = intersectIntervals(islandIntervals, cr.overlap);
          if (overlap.length > 0) {
            hasCrossing = true;
            break;
          }
        }
      }

      if (!hasCrossing) {
        warnings.push({
          code: 'W2',
          severity: 'warning',
          pieceId: sec.id,
          islandIndex: k,
          message: `Pieza ${sec.id} (isla #${k + 1}): no tiene ningún cruce con la otra familia y quedará suelta al armar.`,
        });
      }
    }
  }

  // W3: Cruce con altura de encaje débil (< MIN_ENGAGE_MM = 4.0 mm) o encaje efectivo asimétrico < 2.0 mm
  for (const cr of crossings) {
    if (
      cr.engageHeightMm < WAFFLE_CONSTANTS.MIN_ENGAGE_MM ||
      cr.effectiveLowMm < 2.0 ||
      cr.effectiveHighMm < 2.0
    ) {
      warnings.push({
        code: 'W3',
        severity: 'warning',
        pieceId: cr.p1PieceId,
        partnerPieceIds: [cr.p2PieceId],
        message: `Cruce ${cr.p1PieceId}–${cr.p2PieceId}: altura de encaje débil (${cr.engageHeightMm.toFixed(2)} mm < 4.0 mm).`,
      });
    }
  }

  // W4 & W5: Por pieza
  for (const sec of allSections) {
    let triggeredW4 = false;

    // W4: una ranura parte una pieza en más componentes conexas
    if (sec.polygons.length > sec.rawPolygons.length) {
      triggeredW4 = true;
      const culpritPartnerIds: string[] = [];

      for (const slot of sec.slots) {
        const testSub = subtractSlotsFromSection(sec.rawPolygons, [slot]);
        if (testSub.length > sec.rawPolygons.length) {
          culpritPartnerIds.push(slot.partnerPieceId);
        }
      }

      const partners = culpritPartnerIds.length > 0
        ? culpritPartnerIds
        : sec.slots.map((s) => s.partnerPieceId);

      warnings.push({
        code: 'W4',
        severity: 'warning',
        pieceId: sec.id,
        partnerPieceIds: partners,
        message: `Pieza ${sec.id}: la ranura del cruce con ${partners.join(', ')} parte la pieza en múltiples fragmentos. Sugerencia: ajusta el desfase de rejilla (δ) o la separación (p).`,
      });
    }

    // W5: Cuello delgado (< MIN_WEB_MM = 2.0 mm)
    // Condición (a): tabique entre ranuras consecutivas en la misma pieza
    let hasThinWeb = false;
    if (sec.slots.length >= 2) {
      if (pitch - drawnSlotWidth < WAFFLE_CONSTANTS.MIN_WEB_MM) {
        hasThinWeb = true;
      } else {
        const sortedSlots = [...sec.slots].sort((a, b) => a.uCenter - b.uCenter);
        for (let i = 0; i < sortedSlots.length - 1; i++) {
          const webBetween = (sortedSlots[i + 1].uCenter - sortedSlots[i].uCenter) - drawnSlotWidth;
          if (webBetween < WAFFLE_CONSTANTS.MIN_WEB_MM) {
            hasThinWeb = true;
            break;
          }
        }
      }
    }

    // Condición (b): cuello residual evaluado por erosión interior (solo si no disparó W4 y no detectó ya (a))
    if (!hasThinWeb && !triggeredW4 && sec.slots.length > 0) {
      try {
        const erosionR = WAFFLE_CONSTANTS.MIN_WEB_MM * 0.5; // 1.0 mm
        const erodedBefore = erodePolygons(sec.rawPolygons, erosionR);
        const erodedAfter = erodePolygons(sec.polygons, erosionR);

        if (erodedAfter.length > erodedBefore.length) {
          hasThinWeb = true;
        }
      } catch {
        // En caso de fallo geométrico en ClipperOffset, continuar sin falso positivo
      }
    }

    if (hasThinWeb) {
      warnings.push({
        code: 'W5',
        severity: 'warning',
        pieceId: sec.id,
        message: `Pieza ${sec.id}: cuello delgado (< 2.0 mm) junto a ranura. Riesgo de fractura en acrílico; considera ajustar δ o p.`,
      });
    }
  }

  return warnings;
}
