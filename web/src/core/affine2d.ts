import type { Affine2D, Point2D, PolygonWithHoles } from '../types/sculpture';

/**
 * Transformaciones afines 2D en convención SVG `[a, b, c, d, e, f]`:
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 * Todas las unidades en mm. Headless.
 */

export const AFFINE_IDENTITY: Affine2D = [1, 0, 0, 1, 0, 0];

export function affineTranslate(dx: number, dy: number): Affine2D {
  return [1, 0, 0, 1, dx, dy];
}

export function affineScale(sx: number, sy: number = sx): Affine2D {
  return [sx, 0, 0, sy, 0, 0];
}

export function affineRotate(rad: number): Affine2D {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

/**
 * Rotación local de 90° CCW usada por el layout: (x, y) ↦ (h − y, x),
 * donde `h` es la altura de la pieza ANTES de rotar.
 */
export function affineLocalRot90(h: number): Affine2D {
  return [0, 1, -1, 0, h, 0];
}

/**
 * Reflexión horizontal a través de una hoja de ancho `sheetW`: (x, y) ↦ (sheetW - x, y).
 */
export function affineMirrorX(sheetW: number): Affine2D {
  return [-1, 0, 0, 1, sheetW, 0];
}

/** Composición `outer ∘ inner` (primero se aplica `inner`). */
export function affineCompose(outer: Affine2D, inner: Affine2D): Affine2D {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** Composición de varias transformaciones, aplicadas de derecha a izquierda. */
export function affineChain(...ts: Affine2D[]): Affine2D {
  return ts.reduce((acc, t) => affineCompose(acc, t), AFFINE_IDENTITY);
}

export function affineApply(t: Affine2D, p: Point2D): Point2D {
  const [a, b, c, d, e, f] = t;
  return [a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f];
}

export function affineDeterminant(t: Affine2D): number {
  return t[0] * t[3] - t[1] * t[2];
}

export function affineInvert(t: Affine2D): Affine2D {
  const [a, b, c, d, e, f] = t;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) {
    throw new Error('Affine2D no invertible');
  }
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/** Redondeo estable para serialización determinista. */
export function affineRound(t: Affine2D, digits = 6): Affine2D {
  return t.map((v) => {
    const r = Number(v.toFixed(digits));
    return Object.is(r, -0) ? 0 : r;
  }) as Affine2D;
}

/**
 * Transforma un conjunto de polígonos con huecos mediante una matriz afín 2D.
 * Si el determinante es negativo y `preserveWinding` es true, invierte el orden
 * de los vértices de cada anillo para mantener exteriores CCW y huecos CW.
 */
export function transformPolygons(
  polygons: PolygonWithHoles[],
  t: Affine2D,
  preserveWinding = true
): PolygonWithHoles[] {
  const det = affineDeterminant(t);
  const absDet = Math.abs(det);
  const flipWinding = preserveWinding && det < 0;

  return polygons.map((poly) => {
    const ext = poly.exterior.map((p) => affineApply(t, p));
    if (flipWinding) ext.reverse();
    const holes = poly.holes.map((hole) => {
      const hPts = hole.map((p) => affineApply(t, p));
      if (flipWinding) hPts.reverse();
      return hPts;
    });
    return {
      exterior: ext,
      holes,
      area: poly.area * absDet,
    };
  });
}
