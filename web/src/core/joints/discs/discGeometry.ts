import {
  pointInPolygonWithHoles,
  distanceToPolygonBoundary,
  pointInRing,
  distanceToRing,
  closestPointOnRing,
  closestPointOnSegment,
} from '../../geometry2d';
import type { PlateContour, Point2D } from '../../../types/sculpture';

/**
 * Verifica que el disco completo de centro (x, y) y diámetro `diameter`
 * caiga íntegramente dentro del material de al menos un polígono de la placa.
 */
export function isDiscInsidePlate(
  x: number,
  y: number,
  diameter: number,
  plate: PlateContour
): boolean {
  if (!plate || plate.length === 0 || diameter <= 0) return false;
  const radius = diameter * 0.5;
  for (const poly of plate) {
    if (
      pointInPolygonWithHoles(x, y, poly) &&
      distanceToPolygonBoundary(x, y, poly) >= radius - 1e-5
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Un disco en el hueco `gapIndex` une `plates[gapIndex]` y `plates[gapIndex + 1]`.
 * Es válido sí y solo si el disco completo cabe dentro de AMBAS placas.
 */
export function isDiscValidForGap(
  x: number,
  y: number,
  diameter: number,
  gapIndex: number,
  plates: PlateContour[]
): boolean {
  if (gapIndex < 0 || gapIndex >= plates.length - 1) return false;
  const lowerPlate = plates[gapIndex];
  const upperPlate = plates[gapIndex + 1];
  if (!lowerPlate || lowerPlate.length === 0) return false;
  if (!upperPlate || upperPlate.length === 0) return false;
  return (
    isDiscInsidePlate(x, y, diameter, lowerPlate) &&
    isDiscInsidePlate(x, y, diameter, upperPlate)
  );
}

/**
 * Proyecta un punto (cx, cy) hacia adentro del polígono de `plate` que contiene
 * a (refX, refY) para que respete una distancia mínima `radius` a todos los bordes.
 */
function projectPointIntoPlate(
  cx: number,
  cy: number,
  refX: number,
  refY: number,
  radius: number,
  plate: PlateContour
): Point2D {
  const targetPoly =
    plate.find((p) => pointInPolygonWithHoles(refX, refY, p)) ?? plate[0];
  if (!targetPoly) return [cx, cy];

  let x = cx;
  let y = cy;
  const safeR = radius + 1e-4;
  const rings = [targetPoly.exterior, ...targetPoly.holes];

  // 1. Si el punto salió fuera del exterior o entró en un hueco, empujarlo al lado válido del anillo
  if (!pointInRing(x, y, targetPoly.exterior)) {
    const [qx, qy, dist] = closestPointOnRing(x, y, targetPoly.exterior);
    if (dist > 1e-9) {
      x = qx - ((x - qx) / dist) * safeR;
      y = qy - ((y - qy) / dist) * safeR;
    }
  }
  for (const hole of targetPoly.holes) {
    if (pointInRing(x, y, hole) && distanceToRing(x, y, hole) > 1e-7) {
      const [qx, qy, dist] = closestPointOnRing(x, y, hole);
      if (dist > 1e-9) {
        x = qx - ((x - qx) / dist) * safeR;
        y = qy - ((y - qy) / dist) * safeR;
      }
    }
  }

  // 2. Empujar perpendicularmente de cualquier segmento a distancia < safeR
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % n];
      const [qx, qy, dist] = closestPointOnSegment(x, y, x0, y0, x1, y1);
      if (dist < safeR) {
        let vx = x - qx;
        let vy = y - qy;
        let vLen = Math.hypot(vx, vy);
        if (vLen <= 1e-9) {
          vx = refX - qx;
          vy = refY - qy;
          vLen = Math.hypot(vx, vy);
        }
        if (vLen > 1e-9) {
          const push = safeR - dist;
          x += (vx / vLen) * push;
          y += (vy / vLen) * push;
        }
      }
    }
  }

  return [x, y];
}

/**
 * Proyecta (targetX, targetY) al punto válido más cercano dentro de la intersección
 * de `plates[gapIndex]` y `plates[gapIndex + 1]` para evitar que el disco se congele
 * al arrastrarlo rápidamente pegado al borde.
 */
export function clampDiscPositionToGap(
  targetX: number,
  targetY: number,
  prevValidX: number,
  prevValidY: number,
  diameter: number,
  gapIndex: number,
  plates: PlateContour[]
): Point2D {
  if (isDiscValidForGap(targetX, targetY, diameter, gapIndex, plates)) {
    return [targetX, targetY];
  }
  if (gapIndex < 0 || gapIndex >= plates.length - 1) {
    return [prevValidX, prevValidY];
  }

  const lowerPlate = plates[gapIndex];
  const upperPlate = plates[gapIndex + 1];
  const radius = diameter * 0.5;

  // Proyección alternante sobre ambas placas (converge en 1-4 pasos en bordes y esquinas)
  let cx = targetX;
  let cy = targetY;
  for (let iter = 0; iter < 4; iter++) {
    [cx, cy] = projectPointIntoPlate(cx, cy, prevValidX, prevValidY, radius, lowerPlate);
    [cx, cy] = projectPointIntoPlate(cx, cy, prevValidX, prevValidY, radius, upperPlate);
    if (isDiscValidForGap(cx, cy, diameter, gapIndex, plates)) {
      return [cx, cy];
    }
  }

  // Candidatos de deslizamiento axial y bisección hacia el punto proyectado o target
  const candidates: Point2D[] = [];
  if (isDiscValidForGap(targetX, prevValidY, diameter, gapIndex, plates)) {
    candidates.push([targetX, prevValidY]);
  }
  if (isDiscValidForGap(prevValidX, targetY, diameter, gapIndex, plates)) {
    candidates.push([prevValidX, targetY]);
  }

  for (const [endX, endY] of [
    [cx, cy],
    [targetX, targetY],
  ] as Point2D[]) {
    let lo = 0;
    let hi = 1;
    let bestX = prevValidX;
    let bestY = prevValidY;
    for (let step = 0; step < 12; step++) {
      const mid = 0.5 * (lo + hi);
      const mx = prevValidX + (endX - prevValidX) * mid;
      const my = prevValidY + (endY - prevValidY) * mid;
      if (isDiscValidForGap(mx, my, diameter, gapIndex, plates)) {
        bestX = mx;
        bestY = my;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    candidates.push([bestX, bestY]);
  }

  let bestCandidate: Point2D = [prevValidX, prevValidY];
  let bestDistSq = Infinity;
  for (const [px, py] of candidates) {
    if (!isDiscValidForGap(px, py, diameter, gapIndex, plates)) continue;
    const dSq = (px - targetX) * (px - targetX) + (py - targetY) * (py - targetY);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestCandidate = [px, py];
    }
  }

  return bestCandidate;
}
