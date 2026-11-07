import { validateParams, ValidationError } from './validator';
import {
  stitchAndUnionSegments,
  computeRepairGapMm,
  type DirectedSegment2D,
} from './polygonStitcher';
import { assembledHeight } from './sizing';
import type {
  Axis,
  CoreParams,
  PlateContour,
  Point2D,
  SliceResult,
  SliceWarning,
} from '../types/sculpture';

export const MIN_Z_BUCKETS = 128;
export const MAX_Z_BUCKETS = 4096;

/**
 * Calcula el número adaptativo de Z-buckets según el recuento de triángulos:
 * clamp(round(sqrt(triCount)), 128, 4096).
 */
export function computeNumZBuckets(triCount: number): number {
  return Math.max(
    MIN_Z_BUCKETS,
    Math.min(MAX_Z_BUCKETS, Math.round(Math.sqrt(triCount)))
  );
}

export function computeCutPositions(
  plates: number,
  thickness: number,
  gap: number
): { totalHeight: number; zPositions: number[] } {
  const step = thickness + gap;
  const totalHeight = assembledHeight(plates, thickness, gap);
  const zMin = -totalHeight / 2.0;
  const zPositions: number[] = [];
  for (let i = 0; i < plates; i++) {
    zPositions.push(zMin + i * step + thickness / 2.0);
  }
  return { totalHeight, zPositions };
}

/**
 * Cache de geometría rotada, centrada en su bounding box y particionada en Z-buckets
 * para un eje específico ('x', 'y' o 'z') ANTES de aplicar scaleFactor.
 */
export class AxisSliceCache {
  readonly axis: Axis;
  readonly triCount: number;
  /**
   * Coordenadas de los triángulos rotados y centrados en el origen.
   * Se utiliza Float32Array (precisión simple, ~7 dígitos significativos, error relativo ~1e-7).
   * Al centrar el modelo en su bounding box (restando cx, cy, cz), las magnitudes se mantienen
   * pequeñas y no se pierde precisión en los vértices. Durante el seccionado en extractSegmentsAtZ,
   * el scaleFactor y la interpolación se calculan en precisión doble (number de 64 bits de JS),
   * lo que evita acumulación de errores al proyectar los segmentos 2D.
   */
  readonly coords: Float32Array;   // 9 floats por triángulo (x0,y0,z0, x1,y1,z1, x2,y2,z2)
  readonly normalsXY: Float32Array; // 2 floats por triángulo (nx, ny) de (v1-v0)x(v2-v0)
  readonly triMinZ: Float32Array;
  readonly triMaxZ: Float32Array;
  readonly numBuckets: number;
  readonly buckets: Int32Array[];
  readonly boundsMin: [number, number, number];
  readonly boundsMax: [number, number, number];
  readonly origHeight: number;

  constructor(rawPositions: Float32Array, axis: Axis, numBucketsOverride?: number) {
    this.axis = axis;
    this.triCount = Math.floor(rawPositions.length / 9);
    if (this.triCount < 4) {
      throw new ValidationError('La malla tiene menos de 4 triángulos.');
    }
    this.numBuckets = numBucketsOverride ?? computeNumZBuckets(this.triCount);

    const rotated = new Float32Array(this.triCount * 9);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    // 1. Rotar para alinear el eje elegido con +Z
    const nVerts = this.triCount * 3;
    for (let i = 0; i < nVerts; i++) {
      const rx = rawPositions[i * 3];
      const ry = rawPositions[i * 3 + 1];
      const rz = rawPositions[i * 3 + 2];
      let x: number, y: number, z: number;
      if (axis === 'x') {
        // Rotación de -90° sobre el eje Y: X -> +Z, Z -> -X
        x = -rz;
        y = ry;
        z = rx;
      } else if (axis === 'y') {
        // Rotación de +90° sobre el eje X: Y -> +Z, Z -> -Y
        x = rx;
        y = -rz;
        z = ry;
      } else {
        x = rx;
        y = ry;
        z = rz;
      }
      rotated[i * 3] = x;
      rotated[i * 3 + 1] = y;
      rotated[i * 3 + 2] = z;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    // 2. Centrar en el origen restando el centroide del AABB (bounding box)
    const cx = 0.5 * (minX + maxX);
    const cy = 0.5 * (minY + maxY);
    const cz = 0.5 * (minZ + maxZ);

    for (let i = 0; i < nVerts; i++) {
      rotated[i * 3] -= cx;
      rotated[i * 3 + 1] -= cy;
      rotated[i * 3 + 2] -= cz;
    }

    this.boundsMin = [minX - cx, minY - cy, minZ - cz];
    this.boundsMax = [maxX - cx, maxY - cy, maxZ - cz];
    this.origHeight = this.boundsMax[2] - this.boundsMin[2];
    if (this.origHeight < 1e-6) {
      throw new ValidationError(
        `La malla tiene altura 0 en el eje '${axis.toUpperCase()}'.`
      );
    }

    this.coords = rotated;
    this.normalsXY = new Float32Array(this.triCount * 2);
    this.triMinZ = new Float32Array(this.triCount);
    this.triMaxZ = new Float32Array(this.triCount);

    const bucketLists: number[][] = Array.from({ length: this.numBuckets }, () => []);
    const zStart = this.boundsMin[2];
    const invSpan = this.numBuckets / this.origHeight;

    for (let t = 0; t < this.triCount; t++) {
      const base = t * 9;
      const x0 = rotated[base], y0 = rotated[base + 1], z0 = rotated[base + 2];
      const x1 = rotated[base + 3], y1 = rotated[base + 4], z1 = rotated[base + 5];
      const x2 = rotated[base + 6], y2 = rotated[base + 7], z2 = rotated[base + 8];

      // Normal del triángulo n = (v1 - v0) x (v2 - v0)
      const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
      const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
      this.normalsXY[t * 2] = uy * vz - uz * vy;
      this.normalsXY[t * 2 + 1] = uz * vx - ux * vz;

      const tMin = Math.min(z0, z1, z2);
      const tMax = Math.max(z0, z1, z2);
      this.triMinZ[t] = tMin;
      this.triMaxZ[t] = tMax;

      const b0 = Math.max(
        0,
        Math.min(this.numBuckets - 1, Math.floor((tMin - zStart) * invSpan))
      );
      const b1 = Math.max(
        0,
        Math.min(this.numBuckets - 1, Math.floor((tMax - zStart) * invSpan))
      );
      for (let b = b0; b <= b1; b++) {
        bucketLists[b].push(t);
      }
    }

    this.buckets = bucketLists.map((arr) => Int32Array.from(arr));
  }

  /**
   * Intersecta todos los triángulos que cruzan `zUnit` (en coordenadas pre-escala)
   * y multiplica los segmentos 2D resultantes por `scaleFactor`.
   */
  extractSegmentsAtZ(zUnit: number, scaleFactor: number): DirectedSegment2D[] {
    const zStart = this.boundsMin[2];
    const bucketIdx = Math.max(
        0,
        Math.min(
          this.numBuckets - 1,
          Math.floor(((zUnit - zStart) / this.origHeight) * this.numBuckets)
        )
      );
    const candidates = this.buckets[bucketIdx];
    const segments: DirectedSegment2D[] = [];
    const coords = this.coords;
    const normalsXY = this.normalsXY;
    const triMinZ = this.triMinZ;
    const triMaxZ = this.triMaxZ;

    for (let i = 0; i < candidates.length; i++) {
      const t = candidates[i];
      // Con la regla above = (z >= zUnit), si triMaxZ < zUnit (todos abajo)
      // o triMinZ >= zUnit (todos arriba, incluyendo triángulos coplanares o que solo tocan desde arriba),
      // no hay cruce.
      if (triMaxZ[t] < zUnit || triMinZ[t] >= zUnit) {
        continue;
      }

      const base = t * 9;
      const vx0 = coords[base],     vy0 = coords[base + 1], vz0 = coords[base + 2];
      const vx1 = coords[base + 3], vy1 = coords[base + 4], vz1 = coords[base + 5];
      const vx2 = coords[base + 6], vy2 = coords[base + 7], vz2 = coords[base + 8];

      const a0 = vz0 >= zUnit;
      const a1 = vz1 >= zUnit;
      const a2 = vz2 >= zUnit;

      let p0x = 0, p0y = 0;
      let p1x = 0, p1y = 0;
      let ptCount = 0;

      // Arista 0: (v0, v1)
      if (a0 !== a1) {
        let minVx: number, minVy: number, minVz: number;
        let maxVx: number, maxVy: number, maxVz: number;
        if (
          vz0 > vz1 ||
          (vz0 === vz1 && (vx0 > vx1 || (vx0 === vx1 && vy0 > vy1)))
        ) {
          minVx = vx1; minVy = vy1; minVz = vz1;
          maxVx = vx0; maxVy = vy0; maxVz = vz0;
        } else {
          minVx = vx0; minVy = vy0; minVz = vz0;
          maxVx = vx1; maxVy = vy1; maxVz = vz1;
        }
        const dz = maxVz - minVz;
        const alpha = dz === 0 ? 0 : (zUnit - minVz) / dz;
        p0x = (minVx + alpha * (maxVx - minVx)) * scaleFactor;
        p0y = (minVy + alpha * (maxVy - minVy)) * scaleFactor;
        ptCount = 1;
      }

      // Arista 1: (v1, v2)
      if (a1 !== a2) {
        let minVx: number, minVy: number, minVz: number;
        let maxVx: number, maxVy: number, maxVz: number;
        if (
          vz1 > vz2 ||
          (vz1 === vz2 && (vx1 > vx2 || (vx1 === vx2 && vy1 > vy2)))
        ) {
          minVx = vx2; minVy = vy2; minVz = vz2;
          maxVx = vx1; maxVy = vy1; maxVz = vz1;
        } else {
          minVx = vx1; minVy = vy1; minVz = vz1;
          maxVx = vx2; maxVy = vy2; maxVz = vz2;
        }
        const dz = maxVz - minVz;
        const alpha = dz === 0 ? 0 : (zUnit - minVz) / dz;
        const ix = (minVx + alpha * (maxVx - minVx)) * scaleFactor;
        const iy = (minVy + alpha * (maxVy - minVy)) * scaleFactor;
        if (ptCount === 0) {
          p0x = ix;
          p0y = iy;
          ptCount = 1;
        } else {
          p1x = ix;
          p1y = iy;
          ptCount = 2;
        }
      }

      // Arista 2: (v2, v0)
      if (a2 !== a0) {
        let minVx: number, minVy: number, minVz: number;
        let maxVx: number, maxVy: number, maxVz: number;
        if (
          vz2 > vz0 ||
          (vz2 === vz0 && (vx2 > vx0 || (vx2 === vx0 && vy2 > vy0)))
        ) {
          minVx = vx0; minVy = vy0; minVz = vz0;
          maxVx = vx2; maxVy = vy2; maxVz = vz2;
        } else {
          minVx = vx2; minVy = vy2; minVz = vz2;
          maxVx = vx0; maxVy = vy0; maxVz = vz0;
        }
        const dz = maxVz - minVz;
        const alpha = dz === 0 ? 0 : (zUnit - minVz) / dz;
        const ix = (minVx + alpha * (maxVx - minVx)) * scaleFactor;
        const iy = (minVy + alpha * (maxVy - minVy)) * scaleFactor;
        if (ptCount === 0) {
          p0x = ix;
          p0y = iy;
          ptCount = 1;
        } else {
          p1x = ix;
          p1y = iy;
          ptCount = 2;
        }
      }

      if (ptCount !== 2) continue;

      let x0 = p0x, y0 = p0y;
      let x1 = p1x, y1 = p1y;
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (dx * dx + dy * dy <= 1e-16) continue;

      // Orientar el segmento para que la normal exterior quede a la derecha
      // y el interior sólido quede a la izquierda (contornos exteriores CCW, huecos CW):
      // det([d, n_xy]) = dx * ny - dy * nx < 0
      const nx = normalsXY[t * 2];
      const ny = normalsXY[t * 2 + 1];
      if (dx * ny - dy * nx > 0) {
        const tx = x0, ty = y0;
        x0 = x1; y0 = y1;
        x1 = tx; y1 = ty;
      }

      segments.push({ x0, y0, x1, y1 });
    }

    return segments;
  }
}

export function sliceMeshFromCache(
  cache: AxisSliceCache,
  params: CoreParams
): SliceResult {
  validateParams(params);
  const { totalHeight, zPositions } = computeCutPositions(
    params.plates,
    params.thickness,
    params.gap
  );

  const scaleFactor = totalHeight / cache.origHeight;
  const scaledBounds: [Point2D, Point2D] = [
    [cache.boundsMin[0] * scaleFactor, cache.boundsMin[1] * scaleFactor],
    [cache.boundsMax[0] * scaleFactor, cache.boundsMax[1] * scaleFactor],
  ];
  const scaledDiag = Math.hypot(
    scaledBounds[1][0] - scaledBounds[0][0],
    scaledBounds[1][1] - scaledBounds[0][1],
    totalHeight
  );
  const repairGapMm = computeRepairGapMm(scaledDiag);

  const plates: PlateContour[] = new Array(params.plates);
  const warnings: SliceWarning[] = [];

  for (let i = 0; i < params.plates; i++) {
    const zCut = zPositions[i];
    const zUnit = zCut / scaleFactor;
    const segments = cache.extractSegmentsAtZ(zUnit, scaleFactor);
    const stitched = stitchAndUnionSegments(segments, repairGapMm);
    plates[i] = stitched.polygons;

    if (stitched.openChainsDiscarded > 0 || stitched.openChainsRepaired > 0) {
      warnings.push({
        floorIndex: i,
        openChainsDiscarded: stitched.openChainsDiscarded,
        openChainsRepaired: stitched.openChainsRepaired,
        message: `Piso ${i}: ${stitched.openChainsDiscarded} cadena(s) abierta(s) descartada(s), ${stitched.openChainsRepaired} micro-brecha(s) cerrada(s).`,
      });
    }
  }

  return {
    plates,
    zPositions,
    scaleFactor,
    scaledBounds,
    scaledHeight: totalHeight,
    warnings,
  };
}

/**
 * Función pura síncrona para tests y uso directo sin Web Worker.
 */
export function sliceMesh(
  rawPositions: Float32Array,
  params: CoreParams
): SliceResult {
  validateParams(params);
  const cache = new AxisSliceCache(rawPositions, params.axis);
  return sliceMeshFromCache(cache, params);
}

export interface DiscardedChainsSummary {
  totalDiscarded: number;
  affectedFloors: number[];
}

/**
 * Agrega el total de cadenas abiertas descartadas y lista los pisos afectados (DEC-2 / D2).
 */
export function getDiscardedChainsSummary(
  sliceResult: SliceResult | null
): DiscardedChainsSummary {
  if (!sliceResult || !sliceResult.warnings || sliceResult.warnings.length === 0) {
    return { totalDiscarded: 0, affectedFloors: [] };
  }
  let totalDiscarded = 0;
  const affectedFloors: number[] = [];
  for (const w of sliceResult.warnings) {
    if (w.openChainsDiscarded > 0) {
      totalDiscarded += w.openChainsDiscarded;
      if (!affectedFloors.includes(w.floorIndex)) {
        affectedFloors.push(w.floorIndex);
      }
    }
  }
  affectedFloors.sort((a, b) => a - b);
  return { totalDiscarded, affectedFloors };
}
