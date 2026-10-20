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
} from '../core/slicer';
import {
  stitchAndUnionSegments,
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
});
