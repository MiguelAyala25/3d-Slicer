import { validateParams, ValidationError } from './validator';
import { stitchAndUnionSegments, type DirectedSegment2D } from './polygonStitcher';
import { assembledHeight } from './sizing';
import type {
  Axis,
  CoreParams,
  PlateContour,
  Point2D,
  SliceResult,
  SliceWarning,
} from '../types/sculpture';

const NUM_Z_BUCKETS = 128;

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
  readonly coords: Float32Array;   // 9 floats por triángulo (x0,y0,z0, x1,y1,z1, x2,y2,z2)
  readonly normalsXY: Float32Array; // 2 floats por triángulo (nx, ny) de (v1-v0)x(v2-v0)
  readonly triMinZ: Float32Array;
  readonly triMaxZ: Float32Array;
  readonly buckets: Int32Array[];
  readonly boundsMin: [number, number, number];
  readonly boundsMax: [number, number, number];
  readonly origHeight: number;

  constructor(rawPositions: Float32Array, axis: Axis) {
    this.axis = axis;
    this.triCount = Math.floor(rawPositions.length / 9);
    if (this.triCount < 4) {
      throw new ValidationError('La malla tiene menos de 4 triángulos.');
    }

    const rotated = new Float32Array(this.triCount * 9);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    // 1. Rotar para alinear el eje elegido con +Z (idéntico a slicer.py:134-156)
    const nVerts = this.triCount * 3;
    for (let i = 0; i < nVerts; i++) {
      const rx = rawPositions[i * 3];
      const ry = rawPositions[i * 3 + 1];
      const rz = rawPositions[i * 3 + 2];
      let x: number, y: number, z: number;
      if (axis === 'x') {
        // trimesh.transformations.rotation_matrix(-pi/2, [0, 1, 0])
        x = -rz;
        y = ry;
        z = rx;
      } else if (axis === 'y') {
        // trimesh.transformations.rotation_matrix(+pi/2, [1, 0, 0])
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

    // 2. Centrar en el origen usando bounds.mean(axis=0) (idéntico a slicer.py:159)
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

    const bucketLists: number[][] = Array.from({ length: NUM_Z_BUCKETS }, () => []);
    const zStart = this.boundsMin[2];
    const invSpan = NUM_Z_BUCKETS / this.origHeight;

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
        Math.min(NUM_Z_BUCKETS - 1, Math.floor((tMin - zStart) * invSpan))
      );
      const b1 = Math.max(
        0,
        Math.min(NUM_Z_BUCKETS - 1, Math.floor((tMax - zStart) * invSpan))
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
          NUM_Z_BUCKETS - 1,
          Math.floor(((zUnit - zStart) / this.origHeight) * NUM_Z_BUCKETS)
        )
      );
    const candidates = this.buckets[bucketIdx];
    const segments: DirectedSegment2D[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const t = candidates[i];
      // Con la regla above = (z >= zUnit), si triMaxZ < zUnit (todos abajo)
      // o triMinZ >= zUnit (todos arriba, incluyendo triángulos coplanares o que solo tocan desde arriba),
      // no hay cruce.
      if (this.triMaxZ[t] < zUnit || this.triMinZ[t] >= zUnit) {
        continue;
      }

      const base = t * 9;
      const vx = [this.coords[base], this.coords[base + 3], this.coords[base + 6]];
      const vy = [
        this.coords[base + 1],
        this.coords[base + 4],
        this.coords[base + 7],
      ];
      const vz = [
        this.coords[base + 2],
        this.coords[base + 5],
        this.coords[base + 8],
      ];
      const above = [vz[0] >= zUnit, vz[1] >= zUnit, vz[2] >= zUnit];

      const ptsX: number[] = [];
      const ptsY: number[] = [];

      for (let e = 0; e < 3; e++) {
        const a = e;
        const b = (e + 1) % 3;
        if (above[a] === above[b]) continue;

        // Orden canónico (pMin, pMax) por (z, x, y) para que triángulos adyacentes
        // evalúen los mismos operandos IEEE-754 en el mismo orden.
        let iMin = a;
        let iMax = b;
        if (
          vz[a] > vz[b] ||
          (vz[a] === vz[b] &&
            (vx[a] > vx[b] || (vx[a] === vx[b] && vy[a] > vy[b])))
        ) {
          iMin = b;
          iMax = a;
        }

        const zA = vz[iMin];
        const zB = vz[iMax];
        const dz = zB - zA;
        const alpha = dz === 0 ? 0 : (zUnit - zA) / dz;
        const ix = (vx[iMin] + alpha * (vx[iMax] - vx[iMin])) * scaleFactor;
        const iy = (vy[iMin] + alpha * (vy[iMax] - vy[iMin])) * scaleFactor;
        ptsX.push(ix);
        ptsY.push(iy);
      }

      if (ptsX.length !== 2) continue;

      let x0 = ptsX[0], y0 = ptsY[0];
      let x1 = ptsX[1], y1 = ptsY[1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (dx * dx + dy * dy <= 1e-16) continue;

      // Orientar el segmento para que la normal exterior quede a la derecha
      // y el interior sólido quede a la izquierda (contornos exteriores CCW, huecos CW):
      // det([d, n_xy]) = dx * ny - dy * nx < 0
      const nx = this.normalsXY[t * 2];
      const ny = this.normalsXY[t * 2 + 1];
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
  const plates: PlateContour[] = new Array(params.plates);
  const warnings: SliceWarning[] = [];

  for (let i = 0; i < params.plates; i++) {
    const zCut = zPositions[i];
    const zUnit = zCut / scaleFactor;
    const segments = cache.extractSegmentsAtZ(zUnit, scaleFactor);
    const stitched = stitchAndUnionSegments(segments);
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

  const scaledBounds: [Point2D, Point2D] = [
    [cache.boundsMin[0] * scaleFactor, cache.boundsMin[1] * scaleFactor],
    [cache.boundsMax[0] * scaleFactor, cache.boundsMax[1] * scaleFactor],
  ];

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
