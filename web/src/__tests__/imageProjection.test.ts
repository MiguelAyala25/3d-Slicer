import { describe, it, expect } from 'vitest';
import { affineApply, affineInvert } from '../core/affine2d';
import {
  computeImageToPlate,
  getSurfaceVisibility,
  offsetPolygons,
  pickBestPlaneForDecal,
  projectDecals,
} from '../core/imageProjection';
import type { ImageDecal, PolygonWithHoles, SliceResult } from '../types/sculpture';

function makeRect(x0: number, y0: number, x1: number, y1: number): PolygonWithHoles {
  return {
    exterior: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    holes: [],
    area: (x1 - x0) * (y1 - y0),
  };
}

function makeSquareWithHole(): PolygonWithHoles {
  // 20x20 square centered at (0,0) with 6x6 CW hole
  return {
    exterior: [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ],
    holes: [
      [
        [-3, -3],
        [-3, 3],
        [3, 3],
        [3, -3],
      ],
    ],
    area: 400 - 36,
  };
}

function totalArea(polys: PolygonWithHoles[]): number {
  return polys.reduce((acc, p) => acc + p.area, 0);
}

describe('imageProjection (headless front decal projection)', () => {
  it('verifies Clipper2 InflatePaths sign: positive expands outward & shrinks holes, negative shrinks inward & enlarges holes', () => {
    const sq10 = [makeRect(-5, -5, 5, 5)];
    const expanded = offsetPolygons(sq10, 1.0);
    // Expected ~12x12 minus small round corners = 100 + 40 + pi*1 ≈ 143.14
    expect(totalArea(expanded)).toBeGreaterThan(138);
    expect(totalArea(expanded)).toBeLessThan(145);

    const shrunk = offsetPolygons(sq10, -1.0);
    // Expected 8x8 = 64
    expect(totalArea(shrunk)).toBeCloseTo(64, 1);

    const withHole = [makeSquareWithHole()];
    const holeExpandedOut = offsetPolygons(withHole, 0.5);
    // Hole shrinks from 6x6 (36) to 5x5 (25)
    expect(holeExpandedOut[0].holes).toHaveLength(1);
    const holeAreaOut = holeExpandedOut[0].holes[0].reduce((sum, pt, idx, arr) => {
      const next = arr[(idx + 1) % arr.length];
      return sum + (pt[0] * next[1] - next[0] * pt[1]);
    }, 0) * -0.5;
    expect(holeAreaOut).toBeCloseTo(25, 1);

    const holeInset = offsetPolygons(withHole, -0.5);
    // Hole enlarges from 6x6 (36) to 7x7 with 0.5mm round corners: 36 + 4*(6*0.5) + pi*(0.5^2) ≈ 48.785
    expect(holeInset[0].holes).toHaveLength(1);
    const holeAreaIn = holeInset[0].holes[0].reduce((sum, pt, idx, arr) => {
      const next = arr[(idx + 1) % arr.length];
      return sum + (pt[0] * next[1] - next[0] * pt[1]);
    }, 0) * -0.5;
    expect(holeAreaIn).toBeCloseTo(36 + 12 + Math.PI * 0.25, 1);
  });

  it('maps world top-left image corner to negative slice-local Y and preserves det > 0', () => {
    const decal: ImageDecal = {
      id: 'd1',
      name: 'test.png',
      imageKey: 'k1',
      pxW: 200,
      pxH: 100,
      centerX: 0,
      centerZ: 0,
      widthMm: 40,
      heightMm: 20,
      rotationDeg: 0,
      mode: 'plane',
      plateIndex: 0,
      order: 1,
      visible: true,
    };

    const m = computeImageToPlate(decal);
    // Top-left (0, 0) -> world (-20, +10) -> slice (-20, -10)
    const tl = affineApply(m, [0, 0]);
    expect(tl[0]).toBeCloseTo(-20, 5);
    expect(tl[1]).toBeCloseTo(-10, 5);

    // Bottom-right (200, 100) -> world (+20, -10) -> slice (+20, +10)
    const br = affineApply(m, [200, 100]);
    expect(br[0]).toBeCloseTo(20, 5);
    expect(br[1]).toBeCloseTo(10, 5);

    const inv = affineInvert(m);
    expect(affineApply(inv, tl)[0]).toBeCloseTo(0, 5);
    expect(affineApply(inv, tl)[1]).toBeCloseTo(0, 5);
  });

  it('clips decal against plate with hole in plane mode', () => {
    const slice: SliceResult = {
      plates: [[makeSquareWithHole()]],
      zPositions: [0],
      scaleFactor: 1,
      scaledBounds: [[-10, -10], [10, 10]],
      scaledHeight: 3,
      warnings: [],
    };
    const decal: ImageDecal = {
      id: 'd1',
      name: 'hole.png',
      imageKey: 'k1',
      pxW: 100,
      pxH: 100,
      centerX: 0,
      centerZ: 0,
      widthMm: 16,
      heightMm: 16,
      rotationDeg: 0,
      mode: 'plane',
      plateIndex: 0,
      order: 1,
      visible: true,
    };

    const regions = projectDecals(slice, [decal], { bleedMm: 0 });
    expect(regions).toHaveLength(1);
    expect(regions[0].previewClip).toHaveLength(1);
    expect(regions[0].previewClip[0].holes).toHaveLength(1);
    expect(totalArea(regions[0].previewClip)).toBeCloseTo(16 * 16 - 36, 1);
  });

  it('projects surface mode onto front plate center and back plate outer ring only', () => {
    // Plate 0 (front): 10x10; Plate 1 (back): 20x20
    const slice: SliceResult = {
      plates: [
        [makeRect(-5, -5, 5, 5)],
        [makeRect(-10, -10, 10, 10)],
      ],
      zPositions: [-3, 3],
      scaleFactor: 1,
      scaledBounds: [[-10, -10], [10, 10]],
      scaledHeight: 9,
      warnings: [],
    };

    const decal: ImageDecal = {
      id: 'd1',
      name: 'surf.png',
      imageKey: 'k1',
      pxW: 200,
      pxH: 200,
      centerX: 0,
      centerZ: 0,
      widthMm: 20,
      heightMm: 20,
      rotationDeg: 0,
      mode: 'surface',
      order: 1,
      visible: true,
    };

    const regions = projectDecals(slice, [decal], { bleedMm: 0 });
    expect(regions).toHaveLength(2);
    expect(regions[0].plateIndex).toBe(0);
    expect(totalArea(regions[0].previewClip)).toBeCloseTo(100, 1);

    expect(regions[1].plateIndex).toBe(1);
    expect(regions[1].previewClip[0].holes).toHaveLength(1);
    expect(totalArea(regions[1].previewClip)).toBeCloseTo(400 - 100, 1);
  });

  it('handles 90-degree rotation, out-of-bounds decals, positive bleed bounded by rect, and negative inset bleed', () => {
    const slice: SliceResult = {
      plates: [[makeRect(-10, -10, 10, 10)]],
      zPositions: [0],
      scaleFactor: 1,
      scaledBounds: [[-10, -10], [10, 10]],
      scaledHeight: 3,
      warnings: [],
    };

    const rotatedDecal: ImageDecal = {
      id: 'rot',
      name: 'rot.png',
      imageKey: 'k1',
      pxW: 200,
      pxH: 100,
      centerX: 0,
      centerZ: 0,
      widthMm: 10,
      heightMm: 4,
      rotationDeg: 90,
      mode: 'plane',
      plateIndex: 0,
      order: 2,
      visible: true,
    };

    const outsideDecal: ImageDecal = {
      ...rotatedDecal,
      id: 'out',
      centerX: 100,
      order: 1,
    };

    const regionsRot = projectDecals(slice, [rotatedDecal, outsideDecal], { bleedMm: 1.0 });
    expect(regionsRot).toHaveLength(1);
    expect(regionsRot[0].decalId).toBe('rot');
    expect(totalArea(regionsRot[0].previewClip)).toBeCloseTo(40, 1);
    // Because decal rect is strictly inside plate AND printClip is clamped to decal rect,
    // bleed cannot exceed the decal's own 40 mm² rectangle
    expect(totalArea(regionsRot[0].printClip)).toBeCloseTo(40, 1);

    // When plate is smaller than decal, +1mm bleed expands printClip past previewClip but stays inside decal rect
    const smallPlateDecal: ImageDecal = {
      ...rotatedDecal,
      id: 'big',
      widthMm: 30,
      heightMm: 30,
      rotationDeg: 0,
    };
    const bleedRes = projectDecals(slice, [smallPlateDecal], { bleedMm: 1.0 });
    expect(totalArea(bleedRes[0].previewClip)).toBeCloseTo(400, 1);
    expect(totalArea(bleedRes[0].printClip)).toBeGreaterThan(totalArea(bleedRes[0].previewClip));
    expect(totalArea(bleedRes[0].printClip)).toBeLessThanOrEqual(30 * 30);

    // Negative inset bleed (-1.5 mm) shrinks 20x20 plate to 17x17 = 289 mm²
    const insetRes = projectDecals(slice, [smallPlateDecal], { bleedMm: -1.5 });
    expect(totalArea(insetRes[0].printClip)).toBeCloseTo(17 * 17, 1);
  });

  it('picks best plane and preserves multi-decal order', () => {
    const slice: SliceResult = {
      plates: [
        [makeRect(-2, -2, 2, 2)],
        [makeRect(-10, -10, 10, 10)],
      ],
      zPositions: [-3, 3],
      scaleFactor: 1,
      scaledBounds: [[-10, -10], [10, 10]],
      scaledHeight: 9,
      warnings: [],
    };
    const dTop: ImageDecal = {
      id: 'b',
      name: 'top.png',
      imageKey: 'k2',
      pxW: 100,
      pxH: 100,
      centerX: 0,
      centerZ: 0,
      widthMm: 18,
      heightMm: 18,
      rotationDeg: 0,
      mode: 'plane',
      order: 5,
      visible: true,
    };
    const dBottom: ImageDecal = { ...dTop, id: 'a', imageKey: 'k1', order: 2 };

    expect(pickBestPlaneForDecal(slice, dTop)).toBe(1);

    const regions = projectDecals(slice, [dTop, dBottom], { bleedMm: 0 });
    expect(regions.map((r) => r.decalId)).toEqual(['a', 'b']);
  });

  it('caches surface visibility per SliceResult instance and matches occlusion across repeated projectDecals calls', () => {
    const slice: SliceResult = {
      plates: [
        [makeRect(-4, -4, 4, 4)],
        [makeRect(-8, -8, 8, 8)],
        [makeRect(-12, -12, 12, 12)],
      ],
      zPositions: [-4, 0, 4],
      scaleFactor: 1,
      scaledBounds: [[-12, -12], [12, 12]],
      scaledHeight: 11,
      warnings: [],
    };

    const vis1 = getSurfaceVisibility(slice);
    const vis2 = getSurfaceVisibility(slice);
    expect(vis1).toBe(vis2);
    expect(vis1.visibleSurfacePlates).toHaveLength(3);

    const baseDecal: ImageDecal = {
      id: 'd-cache',
      name: 'c.png',
      imageKey: 'k-cache',
      pxW: 200,
      pxH: 200,
      centerX: 0,
      centerZ: 0,
      widthMm: 24,
      heightMm: 24,
      rotationDeg: 0,
      mode: 'surface',
      order: 1,
      visible: true,
    };

    const first = projectDecals(slice, [baseDecal], { bleedMm: -0.5 });
    const shifted = projectDecals(
      slice,
      [{ ...baseDecal, centerX: 2, centerZ: -2, widthMm: 20, heightMm: 20 }],
      { bleedMm: -0.5 }
    );

    expect(first).toHaveLength(3);
    expect(totalArea(first[0].previewClip)).toBeCloseTo(64, 1);
    expect(totalArea(first[1].previewClip)).toBeCloseTo(256 - 64, 1);
    expect(totalArea(first[2].previewClip)).toBeCloseTo(576 - 256, 1);
    expect(shifted.length).toBeGreaterThan(0);
    expect(getSurfaceVisibility(slice)).toBe(vis1);
  });
});
