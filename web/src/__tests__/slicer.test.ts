import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PARAMS } from '../core/params';
import { loadMeshFromBuffer } from '../core/meshLoader';
import {
  sliceMesh,
  computeCutPositions,
  AxisSliceCache,
  computeNumZBuckets,
  MIN_Z_BUCKETS,
  MAX_Z_BUCKETS,
} from '../core/slicer';
import {
  stitchAndUnionSegments,
  cellKey,
  CELL_OFFSET,
  CELL_STRIDE,
  type DirectedSegment2D,
} from '../core/polygonStitcher';
import type { SculptureParams } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../web/fixtures');
const GOLDEN_DIR = path.resolve(__dirname, '../../../web/golden');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('slicer & polygon stitcher', () => {
  describe('computeCutPositions', () => {
    it('computes symmetric cut positions centered at z = 0', () => {
      const { totalHeight, zPositions } = computeCutPositions(5, 3.0, 2.0);
      expect(totalHeight).toBe(23.0);
      expect(zPositions.length).toBe(5);
      expect(zPositions[0]).toBeCloseTo(-10.0, 6);
      expect(zPositions[1]).toBeCloseTo(-5.0, 6);
      expect(zPositions[2]).toBeCloseTo(0.0, 6);
      expect(zPositions[3]).toBeCloseTo(5.0, 6);
      expect(zPositions[4]).toBeCloseTo(10.0, 6);
    });
  });

  describe('Golden equivalence with Python (Correction A8)', () => {
    const objBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj')));
    const mesh = loadMeshFromBuffer(objBuf, 'test_l_block.obj');
    const positions = mesh.geometry.getAttribute('position').array as Float32Array;

    const baseParams: SculptureParams = {
      ...DEFAULT_PARAMS,
      plates: 5,
      thickness: 3.0,
      gap: 2.0,
    };

    it('matches golden/l_block_slice_z.json', () => {
      const golden = JSON.parse(
        fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_slice_z.json'), 'utf-8')
      );
      const result = sliceMesh(positions, { ...baseParams, axis: 'z' });

      expect(result.scaleFactor).toBeCloseTo(golden.autoScale, 4);
      expect(result.scaledHeight).toBeCloseTo(golden.assembledHeight, 4);
      expect(result.plates.length).toBe(golden.polygons.length);

      for (let i = 0; i < result.plates.length; i++) {
        const plate = result.plates[i];
        const goldenPlate = golden.polygons[i];
        expect(plate.length).toBe(goldenPlate.length);
        if (plate.length > 0) {
          const areaDiff = Math.abs(plate[0].area - goldenPlate[0].area);
          const relDiff = areaDiff / goldenPlate[0].area;
          expect(relDiff).toBeLessThan(0.005); // < 0.5%
        }
      }
    });

    it('matches golden/l_block_slice_x.json', () => {
      const golden = JSON.parse(
        fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_slice_x.json'), 'utf-8')
      );
      const result = sliceMesh(positions, { ...baseParams, axis: 'x' });

      expect(result.scaleFactor).toBeCloseTo(golden.autoScale, 4);
      expect(result.scaledHeight).toBeCloseTo(golden.assembledHeight, 4);
      expect(result.plates.length).toBe(golden.polygons.length);

      for (let i = 0; i < result.plates.length; i++) {
        const plate = result.plates[i];
        const goldenPlate = golden.polygons[i];
        expect(plate.length).toBe(goldenPlate.length);
        if (plate.length > 0) {
          const areaDiff = Math.abs(plate[0].area - goldenPlate[0].area);
          const relDiff = areaDiff / goldenPlate[0].area;
          expect(relDiff).toBeLessThan(0.005);
        }
      }
    });

    it('matches golden/l_block_slice_y.json', () => {
      const golden = JSON.parse(
        fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_slice_y.json'), 'utf-8')
      );
      const result = sliceMesh(positions, { ...baseParams, axis: 'y' });

      expect(result.scaleFactor).toBeCloseTo(golden.autoScale, 4);
      expect(result.scaledHeight).toBeCloseTo(golden.assembledHeight, 4);
      expect(result.plates.length).toBe(golden.polygons.length);

      for (let i = 0; i < result.plates.length; i++) {
        const plate = result.plates[i];
        const goldenPlate = golden.polygons[i];
        expect(plate.length).toBe(goldenPlate.length);
        if (plate.length > 0) {
          const areaDiff = Math.abs(plate[0].area - goldenPlate[0].area);
          const relDiff = areaDiff / goldenPlate[0].area;
          expect(relDiff).toBeLessThan(0.005);
        }
      }
    });
  });

  describe('Degenerate plane-triangle intersection cases (Correction A6)', () => {
    it('handles vertex, horizontal edge, or face exactly on cut plane without duplicates or NaN', () => {
      // Prism with top face at z = 0, bottom face at z = -10
      // Cut plane at z = 0 (half-open rule: z >= 0 is above, z < 0 is below)
      const p = [
        [-10, -10, -10],
        [10, -10, -10],
        [10, 10, -10],
        [-10, 10, -10],
        [-10, -10, 0],
        [10, -10, 0],
        [10, 10, 0],
        [-10, 10, 0],
        [0, 0, 10], // Apex at z = 10
      ];

      // Triangles crossing z = 0
      const tris = [
        // Side walls crossing z = 0
        [0, 1, 5], [0, 5, 4],
        [1, 2, 6], [1, 6, 5],
        [2, 3, 7], [2, 7, 6],
        [3, 0, 4], [3, 4, 7],
        // Top pyramid from z = 0 to apex z = 10
        [4, 5, 8],
        [5, 6, 8],
        [6, 7, 8],
        [7, 4, 8],
        // Bottom cap at z = -10
        [0, 2, 1], [0, 3, 2],
      ];

      const raw = new Float32Array(tris.length * 9);
      for (let t = 0; t < tris.length; t++) {
        for (let k = 0; k < 3; k++) {
          const vi = tris[t][k];
          raw[t * 9 + k * 3] = p[vi][0];
          raw[t * 9 + k * 3 + 1] = p[vi][1];
          raw[t * 9 + k * 3 + 2] = p[vi][2];
        }
      }

      const cache = new AxisSliceCache(raw, 'z');
      const segments = cache.extractSegmentsAtZ(0.0, 1.0);
      expect(segments.length).toBeGreaterThanOrEqual(4);

      const stitched = stitchAndUnionSegments(segments);
      expect(stitched.polygons.length).toBe(1);
      expect(stitched.polygons[0].exterior.length).toBeGreaterThanOrEqual(4);
      expect(Number.isFinite(stitched.polygons[0].area)).toBe(true);
    });
  });

  describe('Boolean union ClipType.Union + FillRule.NonZero (Corrections A2 & A3)', () => {
    it('merges two overlapping boxes into 1 polygon without inner hole (no XOR)', () => {
      // Box 1: [-10, 10] x [-10, 10]
      const segs1: DirectedSegment2D[] = [
        { x0: -10, y0: -10, x1: 10, y1: -10 },
        { x0: 10, y0: -10, x1: 10, y1: 10 },
        { x0: 10, y0: 10, x1: -10, y1: 10 },
        { x0: -10, y0: 10, x1: -10, y1: -10 },
      ];
      // Box 2: [0, 20] x [-10, 10] (overlaps [0, 10])
      const segs2: DirectedSegment2D[] = [
        { x0: 0, y0: -10, x1: 20, y1: -10 },
        { x0: 20, y0: -10, x1: 20, y1: 10 },
        { x0: 20, y0: 10, x1: 0, y1: 10 },
        { x0: 0, y0: 10, x1: 0, y1: -10 },
      ];

      const stitched = stitchAndUnionSegments([...segs1, ...segs2]);
      expect(stitched.polygons.length).toBe(1);
      expect(stitched.polygons[0].holes.length).toBe(0);
      // Expected merged area: 30 x 20 = 600
      expect(stitched.polygons[0].area).toBeCloseTo(600, 1);
    });

    it('preserves deep nesting: exterior -> hole -> island -> hole', () => {
      // Outer box 40x40 (CCW)
      const outer: DirectedSegment2D[] = [
        { x0: -20, y0: -20, x1: 20, y1: -20 },
        { x0: 20, y0: -20, x1: 20, y1: 20 },
        { x0: 20, y0: 20, x1: -20, y1: 20 },
        { x0: -20, y0: 20, x1: -20, y1: -20 },
      ];
      // Hole 30x30 (CW)
      const hole: DirectedSegment2D[] = [
        { x0: -15, y0: -15, x1: -15, y1: 15 },
        { x0: -15, y0: 15, x1: 15, y1: 15 },
        { x0: 15, y0: 15, x1: 15, y1: -15 },
        { x0: 15, y0: -15, x1: -15, y1: -15 },
      ];
      // Island 20x20 inside hole (CCW)
      const island: DirectedSegment2D[] = [
        { x0: -10, y0: -10, x1: 10, y1: -10 },
        { x0: 10, y0: -10, x1: 10, y1: 10 },
        { x0: 10, y0: 10, x1: -10, y1: 10 },
        { x0: -10, y0: 10, x1: -10, y1: -10 },
      ];
      // Second hole 10x10 inside island (CW)
      const hole2: DirectedSegment2D[] = [
        { x0: -5, y0: -5, x1: -5, y1: 5 },
        { x0: -5, y0: 5, x1: 5, y1: 5 },
        { x0: 5, y0: 5, x1: 5, y1: -5 },
        { x0: 5, y0: -5, x1: -5, y1: -5 },
      ];

      const stitched = stitchAndUnionSegments([...outer, ...hole, ...island, ...hole2]);
      // Two exterior polygons: outer frame (40x40 minus 30x30 hole) and inner island (20x20 minus 10x10 hole)
      expect(stitched.polygons.length).toBe(2);
      expect(stitched.polygons[0].holes.length).toBe(1);
      expect(stitched.polygons[1].holes.length).toBe(1);
    });
  });

  describe('Open chains repair & discard (Corrections #4 & A5)', () => {
    it('repairs micro-gap in 100-segment loop regardless of start segment (100 rotations)', () => {
      const N = 100;
      const R = 25.0;
      const fullSegments: DirectedSegment2D[] = [];

      for (let i = 0; i < N; i++) {
        const th0 = (i * 2 * Math.PI) / N;
        const th1 = ((i + 1) * 2 * Math.PI) / N;
        const x0 = R * Math.cos(th0);
        const y0 = R * Math.sin(th0);
        let x1 = R * Math.cos(th1);
        let y1 = R * Math.sin(th1);

        // Introduce 0.01 mm micro-gap at segment 50 (gap <= 0.05 mm MAX_REPAIR_GAP_MM)
        if (i === 50) {
          x1 += 0.007;
          y1 += 0.007;
        }
        fullSegments.push({ x0, y0, x1, y1 });
      }

      // Test across multiple rotation starting positions
      for (const startIdx of [0, 25, 49, 50, 51, 75, 99]) {
        const rotated = [
          ...fullSegments.slice(startIdx),
          ...fullSegments.slice(0, startIdx),
        ];
        const res = stitchAndUnionSegments(rotated);
        expect(res.polygons.length).toBe(1);
        expect(res.openChainsRepaired).toBe(1);
        expect(res.openChainsDiscarded).toBe(0);
      }
    });

    it('discards open chain when gap > 0.05 mm (no diagonal bridge)', () => {
      // 3 sides of a 20x20 square (gap = 20 mm > 0.05 mm)
      const openC: DirectedSegment2D[] = [
        { x0: -10, y0: -10, x1: 10, y1: -10 },
        { x0: 10, y0: -10, x1: 10, y1: 10 },
        { x0: 10, y0: 10, x1: -10, y1: 10 },
      ];

      const res = stitchAndUnionSegments(openC);
      expect(res.polygons.length).toBe(0);
      expect(res.openChainsDiscarded).toBe(1);
    });
  });

  describe('Non-blocking benchmark O(n) (Corrections #8, A7, B3)', () => {
    it('stitches 10,000 segments efficiently (< 50 ms target)', () => {
      const N = 10_000;
      const segs: DirectedSegment2D[] = new Array(N);
      const R = 100.0;
      for (let i = 0; i < N; i++) {
        const a0 = (i * 2 * Math.PI) / N;
        const a1 = ((i + 1) * 2 * Math.PI) / N;
        segs[i] = {
          x0: R * Math.cos(a0),
          y0: R * Math.sin(a0),
          x1: R * Math.cos(a1),
          y1: R * Math.sin(a1),
        };
      }

      const t0 = performance.now();
      const res = stitchAndUnionSegments(segs);
      const durationMs = performance.now() - t0;

      expect(res.polygons.length).toBe(1);
      // Non-blocking log for performance inspection
      console.log(`[Benchmark] 10,000 segments stitched in ${durationMs.toFixed(2)} ms (target < 50 ms)`);
    });
  });

  describe('Float32 precision across extreme mesh scales (D3)', () => {
    const objBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj')));
    const mesh = loadMeshFromBuffer(objBuf, 'test_l_block.obj');
    const basePositions = mesh.geometry.getAttribute('position').array as Float32Array;

    const baseParams: SculptureParams = {
      ...DEFAULT_PARAMS,
      plates: 5,
      thickness: 3.0,
      gap: 2.0,
      axis: 'z',
    };

    it('slices extreme scale meshes without open chains or polygon loss', () => {
      const baseResult = sliceMesh(basePositions, baseParams);

      for (const scale of [1e-3, 1e3]) {
        const scaledPositions = new Float32Array(basePositions.length);
        for (let i = 0; i < basePositions.length; i++) {
          scaledPositions[i] = basePositions[i] * scale;
        }

        const result = sliceMesh(scaledPositions, baseParams);

        // Sin advertencias de cadenas abiertas descartadas
        const totalDiscarded = result.warnings.reduce(
          (sum, w) => sum + w.openChainsDiscarded,
          0
        );
        expect(totalDiscarded).toBe(0);
        for (const warning of result.warnings) {
          expect(warning.openChainsDiscarded).toBe(0);
        }

        // Mismo número de placas y mismo número de polígonos por placa que en escala base
        expect(result.plates.length).toBe(baseResult.plates.length);
        for (let i = 0; i < result.plates.length; i++) {
          expect(result.plates[i].length).toBe(baseResult.plates[i].length);
          if (baseResult.plates[i].length > 0) {
            const baseArea = baseResult.plates[i][0].area;
            const scaledArea = result.plates[i][0].area;
            expect(Math.abs(scaledArea - baseArea) / baseArea).toBeLessThan(0.005);
          }
        }
      }
    });
  });

  describe('Numeric cellKey collision resistance and extreme coordinates (L4)', () => {
    it('produces unique keys across negative, positive, swapped, and extreme +/-5000mm coordinates', () => {
      // 5000 mm with SNAP_TOLERANCE 1e-3 gives cell coordinates of +/-5,000,000
      const testCoords: [number, number][] = [
        [0, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
        [-1, -1],
        [1, 1],
        [-100, 250],
        [250, -100],
        [-5_000_000, -5_000_000],
        [5_000_000, 5_000_000],
        [-5_000_000, 5_000_000],
        [5_000_000, -5_000_000],
        [-4_999_999, 4_999_999],
        [4_999_999, -4_999_999],
      ];

      const keys = new Set<number>();
      for (const [cx, cy] of testCoords) {
        const k = cellKey(cx, cy);
        expect(Number.isSafeInteger(k)).toBe(true);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(keys.has(k)).toBe(false);
        keys.add(k);

        // Verify mathematical inverse
        const offset = CELL_OFFSET;
        const stride = CELL_STRIDE;
        const cyRecovered = (k % stride) - offset;
        const cxRecovered = Math.floor(k / stride) - offset;
        expect(cxRecovered).toBe(cx);
        expect(cyRecovered).toBe(cy);
      }
    });

    it('stitches closed square loops at extreme coordinates (+/-5000 mm) without quadrant cross-merging', () => {
      // 3 squares: one around (-5000, -5000), one at (0, 0), one at (+5000, +5000)
      const segments: DirectedSegment2D[] = [
        // Square 1: around -5000 mm (side 10 mm)
        { x0: -5000, y0: -5000, x1: -4990, y1: -5000 },
        { x0: -4990, y0: -5000, x1: -4990, y1: -4990 },
        { x0: -4990, y0: -4990, x1: -5000, y1: -4990 },
        { x0: -5000, y0: -4990, x1: -5000, y1: -5000 },

        // Square 2: around (0, 0) (side 10 mm)
        { x0: 0, y0: 0, x1: 10, y1: 0 },
        { x0: 10, y0: 0, x1: 10, y1: 10 },
        { x0: 10, y0: 10, x1: 0, y1: 10 },
        { x0: 0, y0: 10, x1: 0, y1: 0 },

        // Square 3: around +5000 mm (side 10 mm)
        { x0: 4990, y0: 4990, x1: 5000, y1: 4990 },
        { x0: 5000, y0: 4990, x1: 5000, y1: 5000 },
        { x0: 5000, y0: 5000, x1: 4990, y1: 5000 },
        { x0: 4990, y0: 5000, x1: 4990, y1: 4990 },
      ];

      const res = stitchAndUnionSegments(segments);
      expect(res.openChainsDiscarded).toBe(0);
      expect(res.openChainsRepaired).toBe(0);
      expect(res.polygons.length).toBe(3);

      for (const poly of res.polygons) {
        expect(poly.area).toBeCloseTo(100, 1);
      }
    });
  });

  describe('Broken mesh characterization with 5000+ open chains (O4)', () => {
    it('characterizes open chain repair and discard behavior on 5000+ open chains synthetic test', () => {
      // Deterministic PRNG (LCG)
      let seed = 123456789;
      function nextRand() {
        seed = (1103515245 * seed + 12345) % 2147483648;
        return seed / 2147483648;
      }

      const segments: DirectedSegment2D[] = [];

      // 1250 square rings, each split into 4 edges with micro-gaps of 0.02 mm (< 0.05 mm repair limit)
      // This produces 5000 open chains to be repaired and closed.
      const RING_COUNT = 1250;
      for (let r = 0; r < RING_COUNT; r++) {
        const cx = (r % 50) * 20;
        const cy = Math.floor(r / 50) * 20;
        const size = 10;
        const gap = 0.02; // Micro-gap bridgeable by MAX_REPAIR_GAP_MM (0.05 mm)

        // Bottom edge: (cx, cy) to (cx + size - gap, cy)
        segments.push({ x0: cx, y0: cy, x1: cx + size - gap, y1: cy });
        // Right edge: (cx + size, cy) to (cx + size, cy + size - gap)
        segments.push({ x0: cx + size, y0: cy, x1: cx + size, y1: cy + size - gap });
        // Top edge: (cx + size, cy + size) to (cx + gap, cy + size)
        segments.push({ x0: cx + size, y0: cy + size, x1: cx + gap, y1: cy + size });
        // Left edge: (cx, cy + size) to (cx, cy + gap)
        segments.push({ x0: cx, y0: cy + size, x1: cx, y1: cy + gap });
      }

      // Add 200 isolated segments with large gaps (1.0 mm) that will not be repairable and must be discarded
      const DISCARD_COUNT = 200;
      for (let d = 0; d < DISCARD_COUNT; d++) {
        const x = 2000 + d * 5;
        const y = 2000;
        segments.push({ x0: x, y0: y, x1: x + 2.0, y1: y });
      }

      // Shuffle segments deterministically with Fisher-Yates
      for (let i = segments.length - 1; i > 0; i--) {
        const j = Math.floor(nextRand() * (i + 1));
        const temp = segments[i];
        segments[i] = segments[j];
        segments[j] = temp;
      }

      const res = stitchAndUnionSegments(segments);

      // Characterization baselines:
      // All 1250 square rings have 4 micro-gaps repaired: 1250 * 4 = 5000 repaired gaps
      expect(res.openChainsRepaired).toBe(5000);
      // All 200 isolated chains are discarded
      expect(res.openChainsDiscarded).toBe(200);
      // 1250 clean closed polygons generated
      expect(res.polygons.length).toBe(1250);

      // Verify area consistency (each square is approximately 10x10 = 100 mm²)
      let totalArea = 0;
      for (const p of res.polygons) {
        totalArea += p.area;
      }
      expect(totalArea).toBeCloseTo(1250 * 100, -2);
    });
  });

  describe('extractSegmentsAtZ oracle bit-for-bit & boundary characterization (C4-1, C4-2)', () => {
    function referenceExtractSegmentsAtZ(
      cache: AxisSliceCache,
      zUnit: number,
      scaleFactor: number
    ): DirectedSegment2D[] {
      const zStart = cache.boundsMin[2];
      const bucketIdx = Math.max(
        0,
        Math.min(
          cache.numBuckets - 1,
          Math.floor(((zUnit - zStart) / cache.origHeight) * cache.numBuckets)
        )
      );
      const candidates = cache.buckets[bucketIdx];
      const segments: DirectedSegment2D[] = [];

      for (let i = 0; i < candidates.length; i++) {
        const t = candidates[i];
        if (cache.triMaxZ[t] < zUnit || cache.triMinZ[t] >= zUnit) {
          continue;
        }

        const base = t * 9;
        const vx = [cache.coords[base], cache.coords[base + 3], cache.coords[base + 6]];
        const vy = [
          cache.coords[base + 1],
          cache.coords[base + 4],
          cache.coords[base + 7],
        ];
        const vz = [
          cache.coords[base + 2],
          cache.coords[base + 5],
          cache.coords[base + 8],
        ];
        const above = [vz[0] >= zUnit, vz[1] >= zUnit, vz[2] >= zUnit];

        const ptsX: number[] = [];
        const ptsY: number[] = [];

        for (let e = 0; e < 3; e++) {
          const a = e;
          const b = (e + 1) % 3;
          if (above[a] === above[b]) continue;

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

        const nx = cache.normalsXY[t * 2];
        const ny = cache.normalsXY[t * 2 + 1];
        if (dx * ny - dy * nx > 0) {
          const tx = x0, ty = y0;
          x0 = x1; y0 = y1;
          x1 = tx; y1 = ty;
        }

        segments.push({ x0, y0, x1, y1 });
      }

      return segments;
    }

    it('matches reference oracle bit-for-bit across axes and heights on L-block fixture', () => {
      const objBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj')));
      const mesh = loadMeshFromBuffer(objBuf, 'test_l_block.obj');
      const positions = mesh.geometry.getAttribute('position').array as Float32Array;

      for (const axis of ['x', 'y', 'z'] as const) {
        const cache = new AxisSliceCache(positions, axis);
        const zMin = cache.boundsMin[2];
        const zMax = cache.boundsMax[2];
        const span = zMax - zMin;

        // Sample 9 heights across the model
        for (let step = 1; step <= 9; step++) {
          const zUnit = zMin + (span * step) / 10;
          const scaleFactor = 1.75;
          const actual = cache.extractSegmentsAtZ(zUnit, scaleFactor);
          const expected = referenceExtractSegmentsAtZ(cache, zUnit, scaleFactor);

          expect(actual.length).toBe(expected.length);
          expect(actual).toEqual(expected);
        }
      }
    });

    it('matches reference oracle bit-for-bit on torus STL and dense synthetic sphere', () => {
      const stlBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_torus.stl')));
      const mesh = loadMeshFromBuffer(stlBuf, 'test_torus.stl');
      const torusPos = mesh.geometry.getAttribute('position').array as Float32Array;
      const torusCache = new AxisSliceCache(torusPos, 'z');

      for (const fraction of [0.15, 0.35, 0.5, 0.65, 0.85]) {
        const zUnit = torusCache.boundsMin[2] + fraction * torusCache.origHeight;
        const actual = torusCache.extractSegmentsAtZ(zUnit, 2.5);
        const expected = referenceExtractSegmentsAtZ(torusCache, zUnit, 2.5);
        expect(actual).toEqual(expected);
      }

      // Dense synthetic sphere (lat/lon grid, 20,000+ triangles)
      const latBands = 100;
      const lonBands = 100;
      const sphereTris: number[] = [];
      const R = 30;

      for (let lat = 0; lat < latBands; lat++) {
        const theta1 = (lat * Math.PI) / latBands;
        const theta2 = ((lat + 1) * Math.PI) / latBands;

        for (let lon = 0; lon < lonBands; lon++) {
          const phi1 = (lon * 2 * Math.PI) / lonBands;
          const phi2 = ((lon + 1) * 2 * Math.PI) / lonBands;

          const v0 = [R * Math.sin(theta1) * Math.cos(phi1), R * Math.sin(theta1) * Math.sin(phi1), R * Math.cos(theta1)];
          const v1 = [R * Math.sin(theta2) * Math.cos(phi1), R * Math.sin(theta2) * Math.sin(phi1), R * Math.cos(theta2)];
          const v2 = [R * Math.sin(theta2) * Math.cos(phi2), R * Math.sin(theta2) * Math.sin(phi2), R * Math.cos(theta2)];
          const v3 = [R * Math.sin(theta1) * Math.cos(phi2), R * Math.sin(theta1) * Math.sin(phi2), R * Math.cos(theta1)];

          sphereTris.push(...v0, ...v1, ...v2);
          sphereTris.push(...v0, ...v2, ...v3);
        }
      }

      const spherePos = new Float32Array(sphereTris);
      const sphereCache = new AxisSliceCache(spherePos, 'z');
      expect(sphereCache.triCount).toBe(20000);

      for (const fraction of [0.2, 0.4, 0.5, 0.6, 0.8]) {
        const zUnit = sphereCache.boundsMin[2] + fraction * sphereCache.origHeight;
        const actual = sphereCache.extractSegmentsAtZ(zUnit, 1.0);
        const expected = referenceExtractSegmentsAtZ(sphereCache, zUnit, 1.0);
        expect(actual.length).toBeGreaterThan(0);
        expect(actual).toEqual(expected);
      }
    });

    it('handles strictly coplanar horizontal faces at cut plane without generating NaN or duplicates', () => {
      // Cylinder / prism with flat horizontal top at z = 10, bottom at z = -10, and middle plateau at z = 0
      const p = [
        // Bottom ring (z = -10)
        [-10, -10, -10], [10, -10, -10], [10, 10, -10], [-10, 10, -10],
        // Middle flat plateau (z = 0)
        [-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0],
        // Smaller inner island on plateau extending up to z = 10
        [-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0],
        [-5, -5, 10], [5, -5, 10], [5, 5, 10], [-5, 5, 10],
      ];

      const tris = [
        // Bottom walls (-10 to 0)
        [0, 1, 5], [0, 5, 4],
        [1, 2, 6], [1, 6, 5],
        [2, 3, 7], [2, 7, 6],
        [3, 0, 4], [3, 4, 7],
        // Coplanar flat face at z = 0 with hole for inner island
        // Triangles strictly coplanar at z = 0:
        [4, 5, 9], [4, 9, 8],
        [5, 6, 10], [5, 10, 9],
        [6, 7, 11], [6, 11, 10],
        [7, 4, 8], [7, 8, 11],
        // Top island walls (0 to 10)
        [8, 9, 13], [8, 13, 12],
        [9, 10, 14], [9, 14, 13],
        [10, 11, 15], [10, 15, 14],
        [11, 8, 12], [11, 12, 15],
        // Top cap at z = 10 (coplanar)
        [12, 13, 14], [12, 14, 15],
        // Bottom cap at z = -10
        [0, 2, 1], [0, 3, 2],
      ];

      const raw = new Float32Array(tris.length * 9);
      for (let t = 0; t < tris.length; t++) {
        for (let k = 0; k < 3; k++) {
          const vi = tris[t][k];
          raw[t * 9 + k * 3] = p[vi][0];
          raw[t * 9 + k * 3 + 1] = p[vi][1];
          raw[t * 9 + k * 3 + 2] = p[vi][2];
        }
      }

      const cache = new AxisSliceCache(raw, 'z');

      // Cut exactly at plateau z = 0 (transformed into cache local coords)
      // Since model is centered: minZ = -10, maxZ = 10, cz = 0. So zUnit = 0 is exactly the plateau.
      const segs = cache.extractSegmentsAtZ(0.0, 1.0);
      const expected = referenceExtractSegmentsAtZ(cache, 0.0, 1.0);
      expect(segs).toEqual(expected);

      // Verify no NaN or infinite values
      for (const s of segs) {
        expect(Number.isFinite(s.x0)).toBe(true);
        expect(Number.isFinite(s.y0)).toBe(true);
        expect(Number.isFinite(s.x1)).toBe(true);
        expect(Number.isFinite(s.y1)).toBe(true);
      }

      const stitched = stitchAndUnionSegments(segs);
      expect(stitched.openChainsDiscarded).toBe(0);
      expect(stitched.polygons.length).toBeGreaterThan(0);
    });

    it('handles cut plane passing exactly through isolated peak, bottom, and saddle vertices', () => {
      // Octahedron centered at (0, 0, 0): vertices at (+/-10, 0, 0), (0, +/-10, 0), (0, 0, +/-10)
      const v = [
        [10, 0, 0],   // 0
        [-10, 0, 0],  // 1
        [0, 10, 0],   // 2
        [0, -10, 0],  // 3
        [0, 0, 10],   // 4 (top apex)
        [0, 0, -10],  // 5 (bottom apex)
      ];

      const tris = [
        // Top pyramid
        [4, 0, 2],
        [4, 2, 1],
        [4, 1, 3],
        [4, 3, 0],
        // Bottom pyramid
        [5, 2, 0],
        [5, 1, 2],
        [5, 3, 1],
        [5, 0, 3],
      ];

      const raw = new Float32Array(tris.length * 9);
      for (let t = 0; t < tris.length; t++) {
        for (let k = 0; k < 3; k++) {
          const vi = tris[t][k];
          raw[t * 9 + k * 3] = v[vi][0];
          raw[t * 9 + k * 3 + 1] = v[vi][1];
          raw[t * 9 + k * 3 + 2] = v[vi][2];
        }
      }

      const cache = new AxisSliceCache(raw, 'z');

      // 1. Cut exactly at z = 0 (passes through vertices 0, 1, 2, 3)
      const segsMid = cache.extractSegmentsAtZ(0.0, 1.0);
      const expMid = referenceExtractSegmentsAtZ(cache, 0.0, 1.0);
      expect(segsMid).toEqual(expMid);
      const midStitched = stitchAndUnionSegments(segsMid);
      expect(midStitched.polygons.length).toBe(1);
      expect(midStitched.openChainsDiscarded).toBe(0);

      // 2. Cut at apex z = 10 (top vertex 4). Should produce 0 segments (above rule z >= zUnit means triMinZ >= 10, skipped)
      const segsApex = cache.extractSegmentsAtZ(10.0, 1.0);
      expect(segsApex.length).toBe(0);

      // 3. Cut at bottom apex z = -10 (bottom vertex 5).
      const segsBottom = cache.extractSegmentsAtZ(-10.0, 1.0);
      const expBottom = referenceExtractSegmentsAtZ(cache, -10.0, 1.0);
      expect(segsBottom).toEqual(expBottom);
    });

    it('computes clamped adaptive bucket count correctly (C4-4)', () => {
      expect(computeNumZBuckets(4)).toBe(MIN_Z_BUCKETS);
      expect(computeNumZBuckets(400)).toBe(MIN_Z_BUCKETS);
      expect(computeNumZBuckets(16384)).toBe(128);
      expect(computeNumZBuckets(100_000)).toBe(316);
      expect(computeNumZBuckets(500_000)).toBe(707);
      expect(computeNumZBuckets(998_000)).toBe(999);
      expect(computeNumZBuckets(20_000_000)).toBe(MAX_Z_BUCKETS);
    });

    it('produces bit-for-bit identical segments between 128 buckets and adaptive buckets (C4-1)', () => {
      // Test on 20k triangles sphere
      const latBands = 100;
      const lonBands = 100;
      const sphereTris: number[] = [];
      const R = 30;

      for (let lat = 0; lat < latBands; lat++) {
        const theta1 = (lat * Math.PI) / latBands;
        const theta2 = ((lat + 1) * Math.PI) / latBands;

        for (let lon = 0; lon < lonBands; lon++) {
          const phi1 = (lon * 2 * Math.PI) / lonBands;
          const phi2 = ((lon + 1) * 2 * Math.PI) / lonBands;

          const v0 = [R * Math.sin(theta1) * Math.cos(phi1), R * Math.sin(theta1) * Math.sin(phi1), R * Math.cos(theta1)];
          const v1 = [R * Math.sin(theta2) * Math.cos(phi1), R * Math.sin(theta2) * Math.sin(phi1), R * Math.cos(theta2)];
          const v2 = [R * Math.sin(theta2) * Math.cos(phi2), R * Math.sin(theta2) * Math.sin(phi2), R * Math.cos(theta2)];
          const v3 = [R * Math.sin(theta1) * Math.cos(phi2), R * Math.sin(theta1) * Math.sin(phi2), R * Math.cos(theta1)];

          sphereTris.push(...v0, ...v1, ...v2);
          sphereTris.push(...v0, ...v2, ...v3);
        }
      }

      const spherePos = new Float32Array(sphereTris);
      const cache128 = new AxisSliceCache(spherePos, 'z', 128);
      const cacheAdaptive = new AxisSliceCache(spherePos, 'z'); // sqrt(20000) = 141 buckets

      expect(cache128.numBuckets).toBe(128);
      expect(cacheAdaptive.numBuckets).toBe(141);

      for (let step = 1; step <= 9; step++) {
        const zUnit = cache128.boundsMin[2] + (cache128.origHeight * step) / 10;
        const segs128 = cache128.extractSegmentsAtZ(zUnit, 1.0);
        const segsAdaptive = cacheAdaptive.extractSegmentsAtZ(zUnit, 1.0);

        expect(segsAdaptive.length).toBe(segs128.length);
        expect(segsAdaptive).toEqual(segs128);
      }
    });
  });
});
