import type { Axis, Point2D, PolygonWithHoles } from '../../types/sculpture';
import { signedArea2D } from '../geometry2d';

export type FamilyId = 'P1' | 'P2';

export interface WaffleAxesConfig {
  upAxis: Axis;
  p1Axis: Axis;          // 'x' si up='z', 'y' si up='x', 'z' si up='y'
  p2Axis: Axis;          // 'y' si up='z', 'z' si up='x', 'x' si up='y'
  p1Prefix: 'X' | 'Y' | 'Z';
  p2Prefix: 'X' | 'Y' | 'Z';
}

export function getWaffleAxesConfig(upAxis: Axis): WaffleAxesConfig {
  switch (upAxis) {
    case 'z':
      return {
        upAxis: 'z',
        p1Axis: 'x',
        p2Axis: 'y',
        p1Prefix: 'X',
        p2Prefix: 'Y',
      };
    case 'x':
      return {
        upAxis: 'x',
        p1Axis: 'y',
        p2Axis: 'z',
        p1Prefix: 'Y',
        p2Prefix: 'Z',
      };
    case 'y':
      return {
        upAxis: 'y',
        p1Axis: 'z',
        p2Axis: 'x',
        p1Prefix: 'Z',
        p2Prefix: 'X',
      };
  }
}

/**
 * Transforma un punto 2D (x_s, y_s) generado por AxisSliceCache
 * al marco canónico 2D (u, v) de la sección.
 * v es la coordenada vertical (positivo hacia arriba en upAxis).
 * u es la coordenada horizontal en el plano de la pieza.
 */
export function fromSlicerPointToCanonical(
  pt: Point2D,
  upAxis: Axis,
  family: FamilyId
): Point2D {
  const [xs, ys] = pt;
  if (upAxis === 'z') {
    if (family === 'P1') {
      // P1: axis = 'x', (xs, ys) = (-Z, Y) -> (u, v) = (Y, Z) = (ys, -xs)
      return [ys, -xs];
    } else {
      // P2: axis = 'y', (xs, ys) = (X, -Z) -> (u, v) = (X, Z) = (xs, -ys)
      return [xs, -ys];
    }
  } else if (upAxis === 'x') {
    if (family === 'P1') {
      // P1: axis = 'y', (xs, ys) = (X, -Z) -> (u, v) = (Z, X) = (-ys, xs)
      return [-ys, xs];
    } else {
      // P2: axis = 'z', (xs, ys) = (X, Y) -> (u, v) = (Y, X) = (ys, xs)
      return [ys, xs];
    }
  } else {
    // upAxis === 'y'
    if (family === 'P1') {
      // P1: axis = 'z', (xs, ys) = (X, Y) -> (u, v) = (X, Y) = (xs, ys)
      return [xs, ys];
    } else {
      // P2: axis = 'x', (xs, ys) = (-Z, Y) -> (u, v) = (Z, Y) = (-xs, ys)
      return [-xs, ys];
    }
  }
}

/**
 * Transforma polígonos del slicer al marco canónico (u, v).
 * En la familia P2, como det(J) = -1, se invierte el orden de vértices
 * de cada contorno (exterior y huecos) para asegurar que el exterior sea CCW
 * (área con signo > 0) y los huecos CW (área con signo < 0).
 */
export function fromSlicerPolygonsToCanonical(
  polygons: PolygonWithHoles[],
  upAxis: Axis,
  family: FamilyId
): PolygonWithHoles[] {
  // En las 3 permutaciones cíclicas, P1 tiene det(J) = +1 y P2 tiene det(J) = -1
  const mustReverseRings = family === 'P2';

  return polygons.map((poly) => {
    const exterior = poly.exterior.map((pt) =>
      fromSlicerPointToCanonical(pt, upAxis, family)
    );
    if (mustReverseRings) {
      exterior.reverse();
    }
    // Asegurar CCW en exterior
    if (signedArea2D(exterior) < 0) {
      exterior.reverse();
    }

    const holes = poly.holes.map((h) => {
      const holeRing = h.map((pt) =>
        fromSlicerPointToCanonical(pt, upAxis, family)
      );
      if (mustReverseRings) {
        holeRing.reverse();
      }
      // Asegurar CW en huecos
      if (signedArea2D(holeRing) > 0) {
        holeRing.reverse();
      }
      return holeRing;
    });

    return {
      exterior,
      holes,
      area: poly.area,
    };
  });
}

/**
 * Mapea coordenadas locales (u, v, wLocal) de la pieza y la posición de su plano
 * al espacio tridimensional mundial (X, Y, Z).
 */
export function canonicalPointToWorld3D(
  u: number,
  v: number,
  wLocal: number,
  planeCoord: number,
  upAxis: Axis,
  family: FamilyId
): [number, number, number] {
  if (upAxis === 'z') {
    if (family === 'P1') {
      // P1: X = planeCoord, u = Y, v = Z
      return [planeCoord + wLocal, u, v];
    } else {
      // P2: Y = planeCoord, u = X, v = Z (n_vista = -Y)
      return [u, planeCoord - wLocal, v];
    }
  } else if (upAxis === 'x') {
    if (family === 'P1') {
      // P1: Y = planeCoord, u = Z, v = X
      return [v, planeCoord + wLocal, u];
    } else {
      // P2: Z = planeCoord, u = Y, v = X (n_vista = -Z)
      return [v, u, planeCoord - wLocal];
    }
  } else {
    // upAxis === 'y'
    if (family === 'P1') {
      // P1: Z = planeCoord, u = X, v = Y
      return [u, v, planeCoord + wLocal];
    } else {
      // P2: X = planeCoord, u = Z, v = Y (n_vista = -X)
      return [planeCoord - wLocal, v, u];
    }
  }
}
