import { describe, it, expect } from 'vitest';
import {
  AFFINE_IDENTITY,
  affineApply,
  affineChain,
  affineCompose,
  affineDeterminant,
  affineInvert,
  affineLocalRot90,
  affineMirrorX,
  affineRotate,
  affineScale,
  affineTranslate,
  transformPolygons,
} from '../core/affine2d';
import type { PolygonWithHoles } from '../types/sculpture';

describe('affine2d (headless 2D transforms)', () => {
  it('applies identity, translation, scale, and rotation accurately', () => {
    expect(affineApply(AFFINE_IDENTITY, [3, -4])).toEqual([3, -4]);
    expect(affineApply(affineTranslate(10, -2), [3, 4])).toEqual([13, 2]);
    expect(affineApply(affineScale(2, -3), [3, 4])).toEqual([6, -12]);
    const rot90 = affineRotate(Math.PI / 2);
    const [rx, ry] = affineApply(rot90, [5, 0]);
    expect(rx).toBeCloseTo(0, 6);
    expect(ry).toBeCloseTo(5, 6);
  });

  it('composes right-to-left and inverts invertible matrices exactly', () => {
    const t = affineChain(
      affineTranslate(12, 34),
      affineRotate(0.75),
      affineScale(2.5, -1.5),
      affineTranslate(-5, 8)
    );
    const inv = affineInvert(t);
    const p: [number, number] = [17.3, -9.2];
    const tp = affineApply(t, p);
    const back = affineApply(inv, tp);
    expect(back[0]).toBeCloseTo(p[0], 6);
    expect(back[1]).toBeCloseTo(p[1], 6);
    expect(affineDeterminant(affineCompose(t, inv))).toBeCloseTo(1, 6);
  });

  it('matches rotatePlateLocal90 formula (x, y) -> (h - y, x)', () => {
    const h = 20;
    const t = affineLocalRot90(h);
    expect(affineApply(t, [10, 5])).toEqual([15, 10]);
    expect(affineDeterminant(t)).toBe(1);
  });

  it('mirrors across sheet width and preserves polygon winding when requested', () => {
    const sheetW = 200;
    const poly: PolygonWithHoles[] = [
      {
        exterior: [
          [10, 10],
          [30, 10],
          [30, 20],
          [10, 20],
        ],
        holes: [
          [
            [15, 12],
            [15, 18],
            [25, 18],
            [25, 12],
          ],
        ],
        area: 140,
      },
    ];
    const mirrored = transformPolygons(poly, affineMirrorX(sheetW), true);
    // Exterior mirrored X: 170..190, reversed order keeps CCW orientation
    expect(mirrored[0].exterior).toEqual([
      [190, 20],
      [170, 20],
      [170, 10],
      [190, 10],
    ]);
    expect(mirrored[0].area).toBeCloseTo(140, 6);
  });
});
