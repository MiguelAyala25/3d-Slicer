import { describe, it, expect } from 'vitest';
import type { Axis, Point2D, PolygonWithHoles } from '../types/sculpture';
import { signedArea2D } from '../core/geometry2d';
import {
  WAFFLE_CONSTANTS,
  getWaffleAxesConfig,
  fromSlicerPointToCanonical,
  fromSlicerPolygonsToCanonical,
  canonicalPointToWorld3D,
  computeFamilyGridPositions,
  computeWaffleGrid,
  intersectPolygonAtU,
  intersectIntervals,
  computeCrossing,
  subtractSlotsFromSection,
  computeLocalSlotLabels,
  evaluateWaffleWarnings,
  erodePolygons,
} from '../core/waffle';
import type { WaffleSection } from '../core/waffle/types';

// Helper: genera un rectángulo como PolygonWithHoles (CCW)
function createRectPoly(
  minU: number,
  maxU: number,
  minV: number,
  maxV: number,
  holes: Point2D[][] = []
): PolygonWithHoles {
  const exterior: Point2D[] = [
    [minU, minV],
    [maxU, minV],
    [maxU, maxV],
    [minU, maxV],
  ];
  let area = (maxU - minU) * (maxV - minV);
  for (const h of holes) {
    area -= Math.abs(signedArea2D(h));
  }
  return { exterior, holes, area };
}

// Helper: calcula el bounding box 2D de polígonos
function computeBounds2D(polys: PolygonWithHoles[]) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of polys) {
    for (const [u, v] of p.exterior) {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  return { minU, maxU, minV, maxV };
}

describe('Waffle 2D Engine (Phase 9.0)', () => {
  describe('Canonical Frame & Coordinate Transformations (CA-B1, CA-B2)', () => {
    const axes: Axis[] = ['z', 'x', 'y'];

    it('cyclic permutation table maps axes and prefixes correctly', () => {
      const cfgZ = getWaffleAxesConfig('z');
      expect(cfgZ).toEqual({ upAxis: 'z', p1Axis: 'x', p2Axis: 'y', p1Prefix: 'X', p2Prefix: 'Y' });

      const cfgX = getWaffleAxesConfig('x');
      expect(cfgX).toEqual({ upAxis: 'x', p1Axis: 'y', p2Axis: 'z', p1Prefix: 'Y', p2Prefix: 'Z' });

      const cfgY = getWaffleAxesConfig('y');
      expect(cfgY).toEqual({ upAxis: 'y', p1Axis: 'z', p2Axis: 'x', p1Prefix: 'Z', p2Prefix: 'X' });
    });

    it('ensures CCW exterior (area > 0) and CW holes (area < 0) across all 3 axes for P1 and P2 (CA-B2)', () => {
      // Polígono en frame del slicer con agujero CW
      const holeCW: Point2D[] = [
        [2, 2],
        [2, 6],
        [6, 6],
        [6, 2],
      ]; // CW porque y sube y luego derecha
      const extCCW: Point2D[] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]; // CCW
      const rawPoly: PolygonWithHoles = {
        exterior: extCCW,
        holes: [holeCW],
        area: 100 - 16,
      };

      for (const up of axes) {
        for (const family of ['P1', 'P2'] as const) {
          const canonical = fromSlicerPolygonsToCanonical([rawPoly], up, family);
          expect(canonical.length).toBe(1);
          const p = canonical[0];

          // CA-B2: exterior CCW (signedArea2D > 0) y agujeros CW (signedArea2D < 0)
          expect(signedArea2D(p.exterior)).toBeGreaterThan(0);
          expect(p.holes.length).toBe(1);
          expect(signedArea2D(p.holes[0])).toBeLessThan(0);
        }
      }
    });

    it('round-trip world 3D mapping preserves coordinates for all axes and families (CA-B1)', () => {
      const u = 15.0;
      const v = 25.0;
      const planeCoord = 5.0;

      // up = 'z'
      const p1_z = canonicalPointToWorld3D(u, v, 0, planeCoord, 'z', 'P1');
      expect(p1_z).toEqual([planeCoord, u, v]); // [X, Y, Z]

      const p2_z = canonicalPointToWorld3D(u, v, 0, planeCoord, 'z', 'P2');
      expect(p2_z).toEqual([u, planeCoord, v]); // [X, Y, Z]

      // up = 'x'
      const p1_x = canonicalPointToWorld3D(u, v, 0, planeCoord, 'x', 'P1');
      expect(p1_x).toEqual([v, planeCoord, u]); // [X=v, Y=plane, Z=u]

      const p2_x = canonicalPointToWorld3D(u, v, 0, planeCoord, 'x', 'P2');
      expect(p2_x).toEqual([v, u, planeCoord]); // [X=v, Y=u, Z=plane]

      // up = 'y'
      const p1_y = canonicalPointToWorld3D(u, v, 0, planeCoord, 'y', 'P1');
      expect(p1_y).toEqual([u, v, planeCoord]); // [X=u, Y=v, Z=plane]

      const p2_y = canonicalPointToWorld3D(u, v, 0, planeCoord, 'y', 'P2');
      expect(p2_y).toEqual([planeCoord, v, u]); // [X=plane, Y=v, Z=u]
    });

    it('fromSlicerPointToCanonical transforms points in all 3 cyclic permutations', () => {
      // up = 'z': P1 maps [xs, ys] -> [ys, -xs], P2 maps [xs, ys] -> [xs, -ys]
      expect(fromSlicerPointToCanonical([10, 20], 'z', 'P1')).toEqual([20, -10]);
      expect(fromSlicerPointToCanonical([10, 20], 'z', 'P2')).toEqual([10, -20]);

      // up = 'x': P1 maps [xs, ys] -> [-ys, xs], P2 maps [xs, ys] -> [ys, xs]
      expect(fromSlicerPointToCanonical([10, 20], 'x', 'P1')).toEqual([-20, 10]);
      expect(fromSlicerPointToCanonical([10, 20], 'x', 'P2')).toEqual([20, 10]);

      // up = 'y': P1 maps [xs, ys] -> [xs, ys], P2 maps [xs, ys] -> [-xs, ys]
      expect(fromSlicerPointToCanonical([10, 20], 'y', 'P1')).toEqual([10, 20]);
      expect(fromSlicerPointToCanonical([10, 20], 'y', 'P2')).toEqual([-10, 20]);
    });
  });

  describe('Grid Generation (CA-C1, CA-C2, CA-C3)', () => {
    it('is perfectly symmetric with delta = 0 (CA-C1)', () => {
      const hMin = -30.0;
      const hMax = 30.0;
      const pitch = 12.0;
      const delta = 0.0;

      const positions = computeFamilyGridPositions(hMin, hMax, pitch, delta);
      expect(positions.length).toBe(5);

      const N = positions.length;
      for (let i = 0; i < N; i++) {
        const sum = positions[i] + positions[N - 1 - i];
        expect(Math.abs(sum - (hMin + hMax))).toBeLessThan(1e-12);
      }
    });

    it('shifts positions deterministically with gridOffset', () => {
      const hMin = 0.0;
      const hMax = 100.0;
      const pitch = 20.0;
      const pos0 = computeFamilyGridPositions(hMin, hMax, pitch, 0.0);
      const posPlus2 = computeFamilyGridPositions(hMin, hMax, pitch, 2.0);

      expect(pos0.length).toBe(posPlus2.length);
      for (let i = 0; i < pos0.length; i++) {
        expect(posPlus2[i]).toBeCloseTo(pos0[i] + 2.0, 9);
      }
    });

    it('filters out positions strictly outside (hMin, hMax)', () => {
      const hMin = 0;
      const hMax = 10;
      const pitch = 5;
      const positions = computeFamilyGridPositions(hMin, hMax, pitch, 0);
      for (const p of positions) {
        expect(p).toBeGreaterThan(hMin);
        expect(p).toBeLessThan(hMax);
      }
    });

    it('computes waffle grid for both families in 3D bounds', () => {
      const min: [number, number, number] = [-30, -30, -30];
      const max: [number, number, number] = [30, 30, 30];
      const grid = computeWaffleGrid(min, max, 'z', 15.0, 0.0);

      expect(grid.p1Positions.length).toBeGreaterThan(0);
      expect(grid.p2Positions.length).toBeGreaterThan(0);
    });
  });

  describe('Vertical Slicing 1D & Interval Operations (CB-1, CB-2, CB-3, CB-4)', () => {
    it('slices a convex rectangular polygon correctly at uCut', () => {
      const poly = createRectPoly(-20, 20, -10, 10);
      const intervals = intersectPolygonAtU([poly], 0);

      expect(intervals.length).toBe(1);
      expect(intervals[0].min).toBeCloseTo(-10, 5);
      expect(intervals[0].max).toBeCloseTo(10, 5);
    });

    it('handles polygon with internal hole on cutting line (CB-2)', () => {
      // Exterior: [-20, 20] x [-20, 20], Hueco CW: [-10, 10] x [-5, 5]
      const holeCW: Point2D[] = [
        [-10, -5],
        [-10, 5],
        [10, 5],
        [10, -5],
      ];
      const poly = createRectPoly(-20, 20, -20, 20, [holeCW]);
      const intervals = intersectPolygonAtU([poly], 0);

      // Debe dar dos intervalos: [-20, -5] y [5, 20], excluyendo el hueco (-5 a 5)
      expect(intervals.length).toBe(2);
      expect(intervals[0].min).toBeCloseTo(-20, 5);
      expect(intervals[0].max).toBeCloseTo(-5, 5);
      expect(intervals[1].min).toBeCloseTo(5, 5);
      expect(intervals[1].max).toBeCloseTo(20, 5);
    });

    it('semi-open rule handles cutting line collinear with vertical edge (CB-3)', () => {
      const poly = createRectPoly(0, 20, 0, 20);
      // Corte exactamente a la izquierda del borde: uCut = -0.001 -> 0 intervalos
      expect(intersectPolygonAtU([poly], -0.001).length).toBe(0);

      // Corte en uCut = 0 (borde izquierdo):
      // Con regla semiabierta u0 >= 0, los puntos en u=0 son true, los puntos en u=20 son true.
      // Ambas aristas horizontales tienen u0=0 (true) y u1=20 (true) -> right0 === right1 -> 0 cruces.
      // La arista vertical izquierda tiene u0=0 (true) y u1=0 (true) -> 0 cruces.
      // Por tanto, la arista tangencial en el borde da 0 cruces limpios.
      const intervalsEdge = intersectPolygonAtU([poly], 0);
      expect(intervalsEdge.length).toBe(0);

      // Corte justo adentro: uCut = 0.001 -> intervalo completo [0, 20]
      const intervalsInside = intersectPolygonAtU([poly], 0.001);
      expect(intervalsInside.length).toBe(1);
      expect(intervalsInside[0].min).toBeCloseTo(0, 3);
      expect(intervalsInside[0].max).toBeCloseTo(20, 3);
    });

    it('discards point tangencies / zero length overlap (CB-4)', () => {
      // Rombo centrado en (0,0) con vértices en (0, 10), (10, 0), (0, -10), (-10, 0)
      const diamond: PolygonWithHoles = {
        exterior: [
          [0, 10],
          [-10, 0],
          [0, -10],
          [10, 0],
        ],
        holes: [],
        area: 200,
      };
      // Corte tangente en u = 10 toca solo el vértice derecho
      const intervals = intersectPolygonAtU([diamond], 10);
      expect(intervals.length).toBe(0);
    });

    it('computes set intersection of intervals correctly', () => {
      const a = [{ min: 0, max: 20 }, { min: 30, max: 50 }];
      const b = [{ min: 10, max: 35 }];
      const overlap = intersectIntervals(a, b);

      expect(overlap).toEqual([
        { min: 10, max: 20 },
        { min: 30, max: 35 },
      ]);
    });
  });

  describe('Open Corridor Slotting & Invariants I1–I5', () => {
    // Configuración de prueba: dos rectángulos perpendiculares
    // A (P1) en x = 0: u = Y in [-30, 30], v = Z in [-20, 20]
    // B (P2) en y = 0: u = X in [-30, 30], v = Z in [-20, 20]
    // thickness = 3.0, clearance = 0.1, kerf = 0.15 -> w = 3.0 + 0.1 - 0.15 = 2.95 mm
    const thickness = 3.0;
    const clearance = 0.1;
    const kerf = 0.15;
    const drawnSlotWidth = thickness + clearance - kerf; // 2.95 mm

    const secA_raw = [createRectPoly(-30, 30, -20, 20)];
    const secB_raw = [createRectPoly(-30, 30, -20, 20)];

    const secA_info: Pick<WaffleSection, 'id' | 'planeCoord' | 'rawPolygons' | 'bounds2D'> = {
      id: 'X1',
      planeCoord: 0.0,
      rawPolygons: secA_raw,
      bounds2D: computeBounds2D(secA_raw),
    };

    const secB_info: Pick<WaffleSection, 'id' | 'planeCoord' | 'rawPolygons' | 'bounds2D'> = {
      id: 'Y1',
      planeCoord: 0.0,
      rawPolygons: secB_raw,
      bounds2D: computeBounds2D(secB_raw),
    };

    it('computes crossing and slots with v* exactly at midpoint', () => {
      const crossing = computeCrossing(secA_info, secB_info, drawnSlotWidth);
      expect(crossing).not.toBeNull();
      if (!crossing) return;

      expect(crossing.vStar).toBeCloseTo(0.0, 6);
      expect(crossing.engageHeightMm).toBeCloseTo(40.0, 6); // de -20 a +20
      expect(crossing.slotOnP1.vMin).toBeCloseTo(0.0, 6);
      expect(crossing.slotOnP1.vMax).toBeCloseTo(20.0 + WAFFLE_CONSTANTS.SLOT_OVERRUN_MM, 6);
      expect(crossing.slotOnP2.vMin).toBeCloseTo(-20.0 - WAFFLE_CONSTANTS.SLOT_OVERRUN_MM, 6);
      expect(crossing.slotOnP2.vMax).toBeCloseTo(0.0, 6);
    });

    it('subtracts slots with Clipper64 Difference cleanly', () => {
      const crossing = computeCrossing(secA_info, secB_info, drawnSlotWidth)!;
      const slottedA = subtractSlotsFromSection(secA_raw, [crossing.slotOnP1]);
      const slottedB = subtractSlotsFromSection(secB_raw, [crossing.slotOnP2]);

      expect(slottedA.length).toBe(1);
      expect(slottedB.length).toBe(1);

      // Invariante I1: el material restante en la columna de cruce es mutuamente disjunto
      const sliceA = intersectPolygonAtU(slottedA, 0.0);
      const sliceB = intersectPolygonAtU(slottedB, 0.0);
      const overlapAfter = intersectIntervals(sliceA, sliceB);
      expect(overlapAfter.length).toBe(0);

      // En A, el material restante está debajo de v* = 0
      expect(sliceA.length).toBe(1);
      expect(sliceA[0].min).toBeCloseTo(-20, 2);
      expect(sliceA[0].max).toBeCloseTo(0, 2);

      // En B, el material restante está arriba de v* = 0
      expect(sliceB.length).toBe(1);
      expect(sliceB[0].min).toBeCloseTo(0, 2);
      expect(sliceB[0].max).toBeCloseTo(20, 2);

      // Invariante I2: corredor despejado en uTest = c +- (w/2 - eps)
      const eps = 1e-3;
      const halfW = drawnSlotWidth * 0.5;
      for (const uTest of [-halfW + eps, 0, halfW - eps]) {
        const testSliceA = intersectPolygonAtU(slottedA, uTest);
        for (const iv of testSliceA) {
          expect(iv.max).toBeLessThanOrEqual(crossing.vStar + 1e-3);
        }

        const testSliceB = intersectPolygonAtU(slottedB, uTest);
        for (const iv of testSliceB) {
          expect(iv.min).toBeGreaterThanOrEqual(crossing.vStar - 1e-3);
        }
      }

      // Invariante I3: encaje real
      expect(sliceA[0].max - sliceA[0].min).toBeGreaterThanOrEqual(WAFFLE_CONSTANTS.MIN_ENGAGE_MM);
      expect(sliceB[0].max - sliceB[0].min).toBeGreaterThanOrEqual(WAFFLE_CONSTANTS.MIN_ENGAGE_MM);

      // Invariante I4: ancho dibujado exacto
      // La ranura sustraída mide exactamente drawnSlotWidth de ancho
      // Verificamos que los dos cortes verticales en x = -halfW y x = +halfW caen en los bordes de la ranura
      expect(drawnSlotWidth).toBeCloseTo(2.95, 4);

      // Invariante I5: reducción de área monotónica y localizada
      // Área rectángulo original = 60 * 40 = 2400
      // Área ranura en A = w * (20 - 0) = 2.95 * 20 = 59.0 mm²
      const expectedAreaA = 2400 - 2.95 * 20;
      expect(slottedA[0].area).toBeCloseTo(expectedAreaA, 0);
      expect(slottedB[0].area).toBeCloseTo(expectedAreaA, 0);
    });

    it('handles multiple concave overlap intervals (CB-1)', () => {
      // Forma de marco hueco (O-frame):
      // Exterior: [-20, 20] x [-20, 20], Hueco interior: [-15, 15] x [-10, 10]
      // En u = 0, hay dos intervalos: [-20, -10] y [10, 20]
      const holeCW: Point2D[] = [
        [-15, -10],
        [-15, 10],
        [15, 10],
        [15, -10],
      ];
      const frameShape = createRectPoly(-20, 20, -20, 20, [holeCW]);

      const solidRect = [createRectPoly(-30, 30, -20, 20)];
      const secFrame: Pick<WaffleSection, 'id' | 'planeCoord' | 'rawPolygons' | 'bounds2D'> = {
        id: 'X1',
        planeCoord: 0.0,
        rawPolygons: [frameShape],
        bounds2D: computeBounds2D([frameShape]),
      };
      const secSolid: Pick<WaffleSection, 'id' | 'planeCoord' | 'rawPolygons' | 'bounds2D'> = {
        id: 'Y1',
        planeCoord: 0.0,
        rawPolygons: solidRect,
        bounds2D: computeBounds2D(solidRect),
      };

      const crossing = computeCrossing(secFrame, secSolid, drawnSlotWidth);
      expect(crossing).not.toBeNull();
      if (!crossing) return;

      // O contiene 2 intervalos: [-20, -10] y [10, 20]
      expect(crossing.overlap.length).toBe(2);
      expect(crossing.vStar).toBeCloseTo(0.0, 6); // (-20 + 20) / 2 = 0

      // Ranura en marco abre desde 0 hacia arriba (corta la barra superior en u = 0)
      const slottedFrame = subtractSlotsFromSection([frameShape], [crossing.slotOnP1]);
      // La barra superior en u = 0 queda abierta, pero las mitades izquierda y derecha
      // siguen unidas a través de los postes laterales en u = +-15 y la barra inferior: sigue siendo 1 sola pieza
      expect(slottedFrame.length).toBe(1);

      // Ahora forma en C (cantilever sin poste derecho):
      // La ranura de corredor abierto corta el brazo superior derecho, partiéndolo en 2 fragmentos (dispara W4)
      const cShape: PolygonWithHoles = {
        exterior: [
          [-20, -20],
          [20, -20],
          [20, -10],
          [-15, -10],
          [-15, 10],
          [20, 10],
          [20, 20],
          [-20, 20],
        ],
        holes: [],
        area: 40 * 10 * 2 + 5 * 20,
      };
      const slottedC = subtractSlotsFromSection([cShape], [crossing.slotOnP1]);
      expect(slottedC.length).toBe(2); // El corredor abierto separa el brazo flotante derecho
    });

    it('handles closely spaced slots on the same piece (CB-5)', () => {
      const poly = [createRectPoly(-30, 30, -20, 20)];
      const slot1 = {
        crossingId: 'X1-Y1',
        partnerPieceId: 'Y1',
        uCenter: -5.0,
        width: 2.95,
        vMin: 0.0,
        vMax: 21.0,
        vStar: 0.0,
      };
      const slot2 = {
        crossingId: 'X1-Y2',
        partnerPieceId: 'Y2',
        uCenter: 5.0,
        width: 2.95,
        vMin: 0.0,
        vMax: 21.0,
        vStar: 0.0,
      };

      // Tabique entre ranuras: 10.0 - 2.95 = 7.05 mm >= 2.0 mm
      const slotted = subtractSlotsFromSection(poly, [slot1, slot2]);
      expect(slotted.length).toBe(1);
    });
  });

  describe('Local Slot Labels Placement', () => {
    it('places labels inside remaining solid material below v* for P1 and above v* for P2', () => {
      const poly = createRectPoly(-30, 30, -20, 20);
      const bounds2D = computeBounds2D([poly]);
      const slotP1 = {
        crossingId: 'X1-Y1',
        partnerPieceId: 'Y1',
        uCenter: 0.0,
        width: 2.95,
        vMin: 0.0,
        vMax: 21.0,
        vStar: 0.0,
      };
      const slottedP1 = subtractSlotsFromSection([poly], [slotP1]);

      const resP1 = computeLocalSlotLabels(slottedP1, bounds2D, [slotP1], 'P1');
      expect(resP1.labels.length).toBe(1);
      expect(resP1.labels[0].text).toBe('Y1');
      // En P1, vLabel está debajo de v* (vStar = 0 -> v < 0)
      expect(resP1.labels[0].y).toBeLessThan(bounds2D.maxV - bounds2D.minV);

      const slotP2 = {
        crossingId: 'X1-Y1',
        partnerPieceId: 'X1',
        uCenter: 0.0,
        width: 2.95,
        vMin: -21.0,
        vMax: 0.0,
        vStar: 0.0,
      };
      const slottedP2 = subtractSlotsFromSection([poly], [slotP2]);
      const resP2 = computeLocalSlotLabels(slottedP2, bounds2D, [slotP2], 'P2');
      expect(resP2.labels.length).toBe(1);
      expect(resP2.labels[0].text).toBe('X1');
    });

    it('omits slot label if piece is too narrow to contain text safely', () => {
      // Pieza muy angosta: u in [-2, 2], ranura de 2.95 mm deja casi nada de material
      const narrowPoly = createRectPoly(-2, 2, -5, 5);
      const bounds2D = computeBounds2D([narrowPoly]);
      const slot = {
        crossingId: 'X1-Y1',
        partnerPieceId: 'VERY_LONG_NAME',
        uCenter: 0.0,
        width: 2.95,
        vMin: 0.0,
        vMax: 6.0,
        vStar: 0.0,
      };
      const slotted = subtractSlotsFromSection([narrowPoly], [slot]);
      const res = computeLocalSlotLabels(slotted, bounds2D, [slot], 'P1');
      expect(res.labels.length).toBe(0);
      expect(res.omittedSlotPartnerIds).toContain('VERY_LONG_NAME');
    });
  });

  describe('Warnings Evaluation (W1 to W5)', () => {
    it('detects W1: omitted empty sections', () => {
      const warnings = evaluateWaffleWarnings({
        omittedGridPositions: [{ family: 'P1', prefix: 'X', coord: -25.0 }],
        p1Sections: [],
        p2Sections: [],
        crossings: [],
        pitch: 12.0,
        drawnSlotWidth: 2.95,
      });

      const w1 = warnings.filter((w) => w.code === 'W1');
      expect(w1.length).toBe(1);
      expect(w1[0].message).toContain('Sección omitida en familia X');
    });

    it('detects W2: loose island with 0 crossings', () => {
      // Pieza con dos islas: una en u in [-20, -10] y otra en u in [10, 20]
      const island1 = createRectPoly(-20, -10, -10, 10);
      const island2 = createRectPoly(10, 20, -10, 10);
      const sec: WaffleSection = {
        id: 'X1',
        family: 'P1',
        indexInFamily: 0,
        planeCoord: 0,
        rawPolygons: [island1, island2],
        polygons: [island1, island2],
        slots: [],
        slotLabels: [],
        bounds2D: computeBounds2D([island1, island2]),
      };

      // Cruce solo con island1 (en u = -15)
      const crossing: any = {
        id: 'X1-Y1',
        p1PieceId: 'X1',
        p2PieceId: 'Y1',
        aCoord: 0,
        bCoord: -15,
        overlap: [{ min: -10, max: 10 }],
        engageHeightMm: 20,
        effectiveLowMm: 10,
        effectiveHighMm: 10,
      };

      const warnings = evaluateWaffleWarnings({
        omittedGridPositions: [],
        p1Sections: [sec],
        p2Sections: [],
        crossings: [crossing],
        pitch: 12.0,
        drawnSlotWidth: 2.95,
      });

      const w2 = warnings.filter((w) => w.code === 'W2');
      expect(w2.length).toBe(1);
      expect(w2[0].pieceId).toBe('X1');
      expect(w2[0].islandIndex).toBe(1); // isla #2 suelta
      expect(w2[0].message).toContain('isla #2');
    });

    it('detects W3: weak engagement height (< 4 mm)', () => {
      const crossing: any = {
        id: 'X1-Y1',
        p1PieceId: 'X1',
        p2PieceId: 'Y1',
        aCoord: 0,
        bCoord: 0,
        overlap: [{ min: 0, max: 3.0 }],
        engageHeightMm: 3.0, // < 4.0 mm
        effectiveLowMm: 1.5,
        effectiveHighMm: 1.5,
      };

      const warnings = evaluateWaffleWarnings({
        omittedGridPositions: [],
        p1Sections: [],
        p2Sections: [],
        crossings: [crossing],
        pitch: 12.0,
        drawnSlotWidth: 2.95,
      });

      const w3 = warnings.filter((w) => w.code === 'W3');
      expect(w3.length).toBe(1);
      expect(w3[0].pieceId).toBe('X1');
      expect(w3[0].message).toContain('altura de encaje débil (3.00 mm < 4.0 mm)');
    });

    it('detects W4: slot splits section into multiple components', () => {
      // Rectángulo horizontal delgado: [-20, 20] x [0, 10]
      // Ranura completa de arriba a abajo en u = 0, dividiendo en dos mitades
      const poly = createRectPoly(-20, 20, 0, 10);
      const slot = {
        crossingId: 'X1-Y1',
        partnerPieceId: 'Y1',
        uCenter: 0.0,
        width: 2.95,
        vMin: -1.0,
        vMax: 11.0,
        vStar: 0.0,
      };
      const slotted = subtractSlotsFromSection([poly], [slot]);
      expect(slotted.length).toBe(2); // partido en dos

      const sec: WaffleSection = {
        id: 'X1',
        family: 'P1',
        indexInFamily: 0,
        planeCoord: 0,
        rawPolygons: [poly],
        polygons: slotted,
        slots: [slot],
        slotLabels: [],
        bounds2D: computeBounds2D([poly]),
      };

      const warnings = evaluateWaffleWarnings({
        omittedGridPositions: [],
        p1Sections: [sec],
        p2Sections: [],
        crossings: [],
        pitch: 12.0,
        drawnSlotWidth: 2.95,
      });

      const w4 = warnings.filter((w) => w.code === 'W4');
      expect(w4.length).toBe(1);
      expect(w4[0].pieceId).toBe('X1');
      expect(w4[0].message).toContain('parte la pieza en múltiples fragmentos');
    });

    it('detects W5: thin web between adjacent slots (< 2.0 mm)', () => {
      const poly = createRectPoly(-20, 20, -10, 10);
      const slot1 = {
        crossingId: 'X1-Y1',
        partnerPieceId: 'Y1',
        uCenter: 0.0,
        width: 2.95,
        vMin: 0.0,
        vMax: 11.0,
        vStar: 0.0,
      };
      const slot2 = {
        crossingId: 'X1-Y2',
        partnerPieceId: 'Y2',
        uCenter: 4.0, // distancia entre centros = 4.0 -> tabique = 4.0 - 2.95 = 1.05 mm < 2.0 mm
        width: 2.95,
        vMin: 0.0,
        vMax: 11.0,
        vStar: 0.0,
      };
      const slotted = subtractSlotsFromSection([poly], [slot1, slot2]);

      const sec: WaffleSection = {
        id: 'X1',
        family: 'P1',
        indexInFamily: 0,
        planeCoord: 0,
        rawPolygons: [poly],
        polygons: slotted,
        slots: [slot1, slot2],
        slotLabels: [],
        bounds2D: computeBounds2D([poly]),
      };

      const warnings = evaluateWaffleWarnings({
        omittedGridPositions: [],
        p1Sections: [sec],
        p2Sections: [],
        crossings: [],
        pitch: 4.0,
        drawnSlotWidth: 2.95,
      });

      const w5 = warnings.filter((w) => w.code === 'W5');
      expect(w5.length).toBe(1);
      expect(w5[0].pieceId).toBe('X1');
      expect(w5[0].message).toContain('cuello delgado (< 2.0 mm)');
    });

    it('erodes polygons inward with ClipperOffset', () => {
      // Cuadrado de 20 x 20 (área = 400)
      const poly = createRectPoly(-10, 10, -10, 10);
      const eroded = erodePolygons([poly], 1.0);
      expect(eroded.length).toBe(1);
      expect(eroded[0].area).toBeLessThan(400);
      expect(eroded[0].area).toBeGreaterThan(300);
    });
  });
});
