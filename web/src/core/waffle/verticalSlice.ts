import type { Point2D, PolygonWithHoles } from '../../types/sculpture';
import { WAFFLE_CONSTANTS } from './constants';
import type { Interval1D } from './types';

/**
 * Intersecta un conjunto de polígonos con huecos con la recta vertical u = uCut.
 * Aplica la regla semiabierta (u >= uCut) para evitar duplicados en vértices y aristas colineales.
 * Devuelve una lista ordenada de intervalos disjuntos [vMin, vMax] con material sólido.
 */
export function intersectPolygonAtU(
  polygons: PolygonWithHoles[],
  uCut: number
): Interval1D[] {
  const vHits: number[] = [];

  const processRing = (ring: Point2D[]) => {
    const n = ring.length;
    if (n < 3) return;

    for (let i = 0; i < n; i++) {
      const [u0, v0] = ring[i];
      const [u1, v1] = ring[(i + 1) % n];

      const right0 = u0 >= uCut;
      const right1 = u1 >= uCut;

      // Aristas que no cruzan uCut o colineales con uCut (ambos lados iguales) se ignoran
      if (right0 === right1) continue;

      // Orden canónico de extremos para evaluación determinista IEEE-754
      let uMin = u0, vMin = v0;
      let uMax = u1, vMax = v1;
      if (u0 > u1 || (u0 === u1 && v0 > v1)) {
        uMin = u1; vMin = v1;
        uMax = u0; vMax = v0;
      }

      const du = uMax - uMin;
      const alpha = du === 0 ? 0 : (uCut - uMin) / du;
      const vHit = vMin + alpha * (vMax - vMin);
      vHits.push(vHit);
    }
  };

  for (const poly of polygons) {
    processRing(poly.exterior);
    for (const hole of poly.holes) {
      processRing(hole);
    }
  }

  if (vHits.length < 2) return [];

  // Ordenar de menor a mayor
  vHits.sort((a, b) => a - b);

  const rawIntervals: Interval1D[] = [];
  const count = vHits.length - (vHits.length % 2); // Garantizar pares
  for (let i = 0; i < count; i += 2) {
    const min = vHits[i];
    const max = vHits[i + 1];
    if (max - min >= WAFFLE_CONSTANTS.MIN_INTERVAL_LEN_MM) {
      rawIntervals.push({ min, max });
    }
  }

  if (rawIntervals.length === 0) return [];

  // Fusionar intervalos contiguos o solapados
  const merged: Interval1D[] = [rawIntervals[0]];
  for (let i = 1; i < rawIntervals.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = rawIntervals[i];
    if (curr.min <= prev.max + WAFFLE_CONSTANTS.INTERVAL_MERGE_TOL_MM) {
      prev.max = Math.max(prev.max, curr.max);
    } else {
      merged.push({ ...curr });
    }
  }

  return merged;
}

/**
 * Calcula la intersección conjuntista de dos conjuntos de intervalos 1D disjuntos y ordenados.
 * O = A ∩ B
 */
export function intersectIntervals(
  aList: Interval1D[],
  bList: Interval1D[]
): Interval1D[] {
  if (aList.length === 0 || bList.length === 0) return [];

  const result: Interval1D[] = [];
  let i = 0;
  let j = 0;

  while (i < aList.length && j < bList.length) {
    const a = aList[i];
    const b = bList[j];

    const start = Math.max(a.min, b.min);
    const end = Math.min(a.max, b.max);

    if (end - start >= WAFFLE_CONSTANTS.MIN_INTERVAL_LEN_MM) {
      // Si se puede fusionar con el último intervalo resultante
      if (
        result.length > 0 &&
        start <= result[result.length - 1].max + WAFFLE_CONSTANTS.INTERVAL_MERGE_TOL_MM
      ) {
        result[result.length - 1].max = Math.max(result[result.length - 1].max, end);
      } else {
        result.push({ min: start, max: end });
      }
    }

    if (a.max < b.max) {
      i++;
    } else {
      j++;
    }
  }

  return result;
}
