import type { Point2D, PolygonWithHoles } from '../types/sculpture';

export function signedArea2D(ring: Point2D[]): number {
  let sum = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    sum += x0 * y1 - x1 * y0;
  }
  return 0.5 * sum;
}

export function closestPointOnSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [number, number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-18) {
    return [x0, y0, Math.hypot(px - x0, py - y0)];
  }
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
  const projX = x0 + t * dx;
  const projY = y0 + t * dy;
  return [projX, projY, Math.hypot(px - projX, py - projY)];
}

export function pointToSegmentDistance(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  return closestPointOnSegment(px, py, x0, y0, x1, y1)[2];
}

export function closestPointOnRing(
  px: number,
  py: number,
  ring: Point2D[]
): [number, number, number] {
  let bestX = px;
  let bestY = py;
  let minDist = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const [qx, qy, d] = closestPointOnSegment(px, py, x0, y0, x1, y1);
    if (d < minDist) {
      minDist = d;
      bestX = qx;
      bestY = qy;
    }
  }
  return [bestX, bestY, minDist];
}

export function distanceToRing(px: number, py: number, ring: Point2D[]): number {
  return closestPointOnRing(px, py, ring)[2];
}

export function pointInRing(px: number, py: number, ring: Point2D[]): boolean {
  if (distanceToRing(px, py, ring) <= 1e-7) {
    return true;
  }
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygonWithHoles(
  px: number,
  py: number,
  poly: PolygonWithHoles
): boolean {
  if (!pointInRing(px, py, poly.exterior)) {
    return false;
  }
  for (const hole of poly.holes) {
    // Si está estrictamente dentro del hueco (no sobre el borde), está fuera del material
    if (pointInRing(px, py, hole) && distanceToRing(px, py, hole) > 1e-7) {
      return false;
    }
  }
  return true;
}

export function distanceToPolygonBoundary(
  px: number,
  py: number,
  poly: PolygonWithHoles
): number {
  let minDist = distanceToRing(px, py, poly.exterior);
  for (const hole of poly.holes) {
    const d = distanceToRing(px, py, hole);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

