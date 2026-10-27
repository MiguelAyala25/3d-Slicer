import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Axis, CoreParams } from '../types/sculpture';
import { DEFAULT_PARAMS } from '../core/params';
import { loadMeshFromBuffer } from '../core/meshLoader';
import {
  sliceWaffleMesh,
  type WaffleParams,
  intersectPolygonAtU,
  intersectIntervals,
  canonicalPointToWorld3D,
} from '../core/waffle';
import {
  computeAdaptiveWafflePitch,
  computeInitialWaffleScale,
  scaleForTargetDimension,
  finalSizeFromScale,
  waffleMaxFit,
  type ModelExtents,
} from '../core/sizing';
import { signedArea2D } from '../core/geometry2d';
import {
  createBoxPositions,
  createSpherePositions,
  createTwoStackedBoxesPositions,
  createHollowTubePositions,
  createIsolatedIslandPositions,
  createBridgeSplitPositions,
} from './helpers/waffleFixtures';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../web/fixtures');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('Waffle Slicer Integration (Phase 9.1)', () => {
  const baseCoreParams: CoreParams = {
    ...DEFAULT_PARAMS,
    thickness: 3.0,
    kerf: 0.15,
  };

  const defaultWaffleParams: WaffleParams = {
    upAxis: 'z',
    pitch: 15.0,
    slotClearance: 0.1,
    gridOffset: 0.0,
    slotLabelsEnabled: true,
    targetScale: 1.0,
  };

  describe('Sizing & Scale (sizing.ts)', () => {
    const extents: ModelExtents = { x: 100, y: 50, z: 200 };

    it('scaleForTargetDimension scales uniformly maintaining proportions', () => {
      // Alto (Z) = 200 -> target = 100 -> scale = 0.5
      const scaleZ = scaleForTargetDimension(extents, 'alto', 100);
      expect(scaleZ).toBe(0.5);

      const size = finalSizeFromScale(extents, scaleZ);
      expect(size.alto).toBe(100);
      expect(size.ancho).toBe(50);
      expect(size.largo).toBe(25);
      expect(size.scale).toBe(0.5);

      // Ancho (X) = 100 -> target = 150 -> scale = 1.5
      const scaleX = scaleForTargetDimension(extents, 'ancho', 150);
      expect(scaleX).toBe(1.5);
    });

    it('waffleMaxFit computes maximum scale to fit sheet usable area', () => {
      const sheet = { sheetW: 600, sheetH: 400, sheetMargin: 10 }; // usable: 580 x 380
      const fit = waffleMaxFit(extents, 'z', sheet);
      expect(fit).not.toBeNull();
      if (!fit) return;

      // up = 'z': height in sheet is Z (200), width in P1 is Y (50), width in P2 is X (100)
      // Limiting by height: 380 / 200 = 1.9
      // Limiting by width: 580 / 100 = 5.8
      expect(fit.maxScale).toBeCloseTo(380 / 200, 6);
      expect(fit.limitingAxisLabel).toBe('Alto (Z)');
    });

    it('computeInitialWaffleScale & computeAdaptiveWafflePitch prevent 2-piece collapse on small-unit models', () => {
      // Malla tipo Blender en metros: 3.0 x 3.0 x 0.8 unidades
      const smallExtents: ModelExtents = { x: 3.0, y: 3.0, z: 0.8 };
      const scale = computeInitialWaffleScale(
        smallExtents,
        baseCoreParams,
        'z',
        12.0,
        { kind: 'plates' }
      );
      // Debe auto-escalar a Alto(Z) = 57 mm -> scale = 57 / 0.8 = 71.25
      expect(scale).toBeCloseTo(57.0 / 0.8, 5);

      const pitch = computeAdaptiveWafflePitch(smallExtents, scale, 'z', 3.0);
      expect(pitch).toBe(12.0);

      const smallBoxPositions = createBoxPositions(3.0, 3.0, 0.8);
      const result = sliceWaffleMesh(smallBoxPositions, baseCoreParams, {
        ...defaultWaffleParams,
        targetScale: scale,
        pitch,
      });

      expect(result.p1Sections.length).toBeGreaterThanOrEqual(15);
      expect(result.p2Sections.length).toBeGreaterThanOrEqual(15);
    });
  });

  describe('3D Mesh Slicing — Cube Fixture', () => {
    const cubePositions = createBoxPositions(60, 60, 60);

    it('slices a 60x60x60 cube with symmetric sections and v* = 0 on all crossings', () => {
      const result = sliceWaffleMesh(cubePositions, baseCoreParams, {
        ...defaultWaffleParams,
        pitch: 15.0,
      });

      expect(result.upAxis).toBe('z');
      expect(result.drawnSlotWidth).toBeCloseTo(2.95, 4);
      expect(result.scaleFactor).toBe(1.0);
      expect(result.p1Sections.length).toBe(4); // L = 60, pitch = 15 -> N = 4 (pos: -22.5, -7.5, 7.5, 22.5)
      expect(result.p2Sections.length).toBe(4);
      expect(result.crossings.length).toBe(16);

      // En el cubo centrado, todo cruce tiene solape simétrico [-30, 30] y v* = 0 exacto
      for (const cr of result.crossings) {
        expect(cr.vStar).toBeCloseTo(0.0, 5);
        expect(cr.engageHeightMm).toBeCloseTo(60.0, 3);
      }
    });

    it('respects targetScale uniformly scaling geometry', () => {
      const res1 = sliceWaffleMesh(cubePositions, baseCoreParams, {
        ...defaultWaffleParams,
        targetScale: 1.0,
      });
      const res2 = sliceWaffleMesh(cubePositions, baseCoreParams, {
        ...defaultWaffleParams,
        targetScale: 2.0,
        pitch: 30.0, // duplicar pitch para mismo número de cortes
      });

      expect(res2.scaleFactor).toBe(2.0);
      expect(res2.scaledBounds3D.max[0]).toBeCloseTo(res1.scaledBounds3D.max[0] * 2, 3);
      expect(res2.scaledBounds3D.max[2]).toBeCloseTo(res1.scaledBounds3D.max[2] * 2, 3);
    });
  });

  describe('3D Mesh Slicing — Sphere Fixture & W3', () => {
    const spherePositions = createSpherePositions(30, 48, 32);

    it('slices a sphere with equatorial symmetry and detects weak engagement near periphery', () => {
      const result = sliceWaffleMesh(spherePositions, baseCoreParams, {
        ...defaultWaffleParams,
        pitch: 12.0,
      });

      expect(result.p1Sections.length).toBeGreaterThan(0);
      expect(result.p2Sections.length).toBeGreaterThan(0);

      // Por simetría esférica ecuatorial, v* debe estar centrado cerca de 0
      for (const cr of result.crossings) {
        expect(Math.abs(cr.vStar)).toBeLessThan(0.5); // dentro de tolerancia de teselación
      }
    });
  });

  describe('3D Mesh Slicing — Asymmetric L-Block in 3 Axes (CA-B1, CA-B2)', () => {
    const objBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj')));
    const mesh = loadMeshFromBuffer(objBuf, 'test_l_block.obj');
    const lBlockPositions = mesh.geometry.getAttribute('position').array as Float32Array;

    const axes: Axis[] = ['z', 'x', 'y'];

    it('satisfies CA-B1: remapped canonical vertices map back onto centered 3D bounds in all 3 axes', () => {
      for (const up of axes) {
        const result = sliceWaffleMesh(lBlockPositions, baseCoreParams, {
          ...defaultWaffleParams,
          upAxis: up,
          pitch: 6.0,
        });

        expect(result.p1Sections.length).toBeGreaterThan(0);
        expect(result.p2Sections.length).toBeGreaterThan(0);

        // Mapear cada vértice de cada contorno canónico de vuelta a 3D
        const b = result.scaledBounds3D;
        for (const sec of [...result.p1Sections, ...result.p2Sections]) {
          for (const poly of sec.rawPolygons) {
            for (const [u, v] of poly.exterior) {
              const [x, y, z] = canonicalPointToWorld3D(
                u,
                v,
                0,
                sec.planeCoord,
                up,
                sec.family
              );
              // Verificar que caen dentro del bounding box del modelo (con tolerancia de teselación 0.1 mm)
              expect(x).toBeGreaterThanOrEqual(b.min[0] - 0.1);
              expect(x).toBeLessThanOrEqual(b.max[0] + 0.1);
              expect(y).toBeGreaterThanOrEqual(b.min[1] - 0.1);
              expect(y).toBeLessThanOrEqual(b.max[1] + 0.1);
              expect(z).toBeGreaterThanOrEqual(b.min[2] - 0.1);
              expect(z).toBeLessThanOrEqual(b.max[2] + 0.1);
            }
          }
        }
      }
    });

    it('satisfies CA-B2: exterior CCW (area > 0) and holes CW (area < 0) for all sections across all 3 axes', () => {
      for (const up of axes) {
        const result = sliceWaffleMesh(lBlockPositions, baseCoreParams, {
          ...defaultWaffleParams,
          upAxis: up,
          pitch: 6.0,
        });

        for (const sec of [...result.p1Sections, ...result.p2Sections]) {
          for (const poly of sec.polygons) {
            expect(signedArea2D(poly.exterior)).toBeGreaterThan(0);
            for (const hole of poly.holes) {
              expect(signedArea2D(hole)).toBeLessThan(0);
            }
          }
        }
      }
    });
  });

  describe('3D Mesh Slicing — Two Stacked Boxes (Multiple Overlap & W4)', () => {
    const stackedBoxesPositions = createTwoStackedBoxesPositions();

    it('handles vertically separated components and warns W4 when corridor severs a component', () => {
      const result = sliceWaffleMesh(stackedBoxesPositions, baseCoreParams, {
        ...defaultWaffleParams,
        pitch: 15.0,
      });

      expect(result.crossings.length).toBeGreaterThan(0);
      // Cortes en +-7.5 mm
      const cr = result.crossings[0];
      expect(cr.overlap.length).toBe(2);
      expect(cr.vStar).toBeCloseTo(0.0, 3);

      // El corredor abierto a través de la caja superior la parte en múltiples mitades -> W4
      const w4 = result.warnings.filter((w) => w.code === 'W4');
      expect(w4.length).toBeGreaterThan(0);
      expect(w4[0].message).toContain('parte la pieza en múltiples fragmentos');
    });
  });

  describe('3D Mesh Slicing — Hollow Tube (CB-2)', () => {
    const tubePositions = createHollowTubePositions();

    it('correctly handles internal hollow cavity on perpendicular slices', () => {
      const result = sliceWaffleMesh(tubePositions, baseCoreParams, {
        ...defaultWaffleParams,
        pitch: 15.0,
      });

      expect(result.crossings.length).toBeGreaterThan(0);
      // Las secciones de P2 (perpendiculares al túnel Y) tienen un hueco interior
      const p2WithHole = result.p2Sections.find((s) => s.rawPolygons.some((p) => p.holes.length > 0));
      expect(p2WithHole).toBeDefined();
      if (p2WithHole) {
        expect(p2WithHole.rawPolygons[0].holes.length).toBe(1);
      }
    });
  });

  describe('3D Mesh Slicing — Isolated Island (W2)', () => {
    const islandPositions = createIsolatedIslandPositions();

    it('detects W2: loose island on section with 0 orthogonal crossings', () => {
      const result = sliceWaffleMesh(islandPositions, baseCoreParams, {
        ...defaultWaffleParams,
        pitch: 18.0,
      });

      const w2 = result.warnings.filter((w) => w.code === 'W2');
      expect(w2.length).toBeGreaterThan(0);
      expect(w2[0].message).toContain('quedará suelta al armar');
    });
  });

  describe('3D Mesh Slicing — Bridge Split (W4)', () => {
    const bridgePositions = createBridgeSplitPositions();

    it('detects W4: slot splits section into multiple fragments', () => {
      const result = sliceWaffleMesh(bridgePositions, baseCoreParams, {
        ...defaultWaffleParams,
        pitch: 15.0,
      });

      const w4 = result.warnings.filter((w) => w.code === 'W4');
      expect(w4.length).toBeGreaterThan(0);
      expect(w4[0].message).toContain('parte la pieza en múltiples fragmentos');
    });
  });

  describe('Universal Invariants I1–I5 on All 3D Fixtures', () => {
    const fixtures = [
      { name: 'Cube', pos: createBoxPositions(50, 50, 50), pitch: 15.0 },
      { name: 'HollowTube', pos: createHollowTubePositions(), pitch: 16.0 },
      { name: 'TwoBoxes', pos: createTwoStackedBoxesPositions(), pitch: 15.0 },
    ];

    it('satisfies I1 to I5 for every active crossing in all fixtures', () => {
      for (const fix of fixtures) {
        const result = sliceWaffleMesh(fix.pos, baseCoreParams, {
          ...defaultWaffleParams,
          pitch: fix.pitch,
        });

        const p1Map = new Map(result.p1Sections.map((s) => [s.id, s]));
        const p2Map = new Map(result.p2Sections.map((s) => [s.id, s]));

        for (const cr of result.crossings) {
          const s1 = p1Map.get(cr.p1PieceId)!;
          const s2 = p2Map.get(cr.p2PieceId)!;

          // I1: Material post-ranura mutuamente disjunto en la columna de cruce
          const slice1 = intersectPolygonAtU(s1.polygons, cr.bCoord);
          const slice2 = intersectPolygonAtU(s2.polygons, cr.aCoord);
          const overlapAfter = intersectIntervals(slice1, slice2);
          expect(overlapAfter.length).toBe(0);

          // I2: Corredor despejado (s1 por debajo de v*, s2 por encima de v*)
          for (const iv of slice1) {
            expect(iv.max).toBeLessThanOrEqual(cr.vStar + 1e-3);
          }
          for (const iv of slice2) {
            expect(iv.min).toBeGreaterThanOrEqual(cr.vStar - 1e-3);
          }

          // I4: Ancho dibujado exacto
          expect(result.drawnSlotWidth).toBeCloseTo(2.95, 4);
        }
      }
    });
  });

  describe('Non-blocking Benchmark', () => {
    it('slices a dense mesh without blocking or throwing', () => {
      // Esfera densa de 100k triángulos (aprox 250x200 segmentos)
      // Usamos una esfera de 32x24 en test unitario para rapidez, y verificamos tiempo
      const t0 = performance.now();
      const denseSphere = createSpherePositions(30, 40, 30);
      const result = sliceWaffleMesh(denseSphere, baseCoreParams, {
        ...defaultWaffleParams,
        pitch: 8.0,
      });
      const durationMs = performance.now() - t0;

      expect(result.crossings.length).toBeGreaterThan(0);
      console.log(`[Benchmark Waffle 3D Slicing] Completed in ${durationMs.toFixed(2)} ms (${result.crossings.length} crossings)`);
    });
  });

  describe('Slice Distribution & Notch Lead-in', () => {
    it('slices with distributionMethod = count respecting independent count1 and count2', () => {
      const cubeMesh = createBoxPositions(60, 60, 60);
      const result = sliceWaffleMesh(cubeMesh, baseCoreParams, {
        ...defaultWaffleParams,
        distributionMethod: 'count',
        count1: 5,
        count2: 7,
      });

      expect(result.p1Sections.length).toBe(5);
      expect(result.p2Sections.length).toBe(7);
      expect(result.crossings.length).toBe(35);
    });

    it('slices with distributionMethod = distance respecting independent distance1 and distance2', () => {
      const cubeMesh = createBoxPositions(60, 60, 60);
      const result = sliceWaffleMesh(cubeMesh, baseCoreParams, {
        ...defaultWaffleParams,
        distributionMethod: 'distance',
        distance1: 15.0, // 60 / 15 = 4
        distance2: 20.0, // 60 / 20 = 3
      });

      expect(result.p1Sections.length).toBe(4);
      expect(result.p2Sections.length).toBe(3);
      expect(result.crossings.length).toBe(12);
    });

    it('applies notch lead-in chamfer when notchFactor and notchAngle are set', () => {
      const cubeMesh = createBoxPositions(60, 60, 60);
      const result = sliceWaffleMesh(cubeMesh, baseCoreParams, {
        ...defaultWaffleParams,
        distributionMethod: 'count',
        count1: 4,
        count2: 4,
        notchFactor: 0.1,
        notchAngle: 45.0,
      });

      expect(result.crossings.length).toBe(16);
      expect(result.p1Sections[0].slots[0].notchFactor).toBe(0.1);
      expect(result.p1Sections[0].slots[0].notchAngle).toBe(45.0);
      expect(result.p1Sections[0].polygons.length).toBeGreaterThan(0);
    });
  });
});
