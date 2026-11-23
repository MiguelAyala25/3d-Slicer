import {
  Clipper,
  Clipper64,
  ClipType,
  EndType,
  FillRule,
  JoinType,
  Path64,
  Paths64,
  Point64,
  PolyTree64,
} from 'clipper2-js';
import {
  affineApply,
  affineChain,
  affineRotate,
  affineRound,
  affineScale,
  affineTranslate,
} from './affine2d';
import { CLIPPER_SCALE, polyTreeToPolygonsWithHoles } from './polygonStitcher';
import { applyClipperPatch } from './vendor/clipperPatch';
import type {
  Affine2D,
  DecalRegion,
  ImageDecal,
  Point2D,
  PolygonWithHoles,
  SliceResult,
} from '../types/sculpture';

applyClipperPatch();

function ringToPath64(ring: Point2D[]): Path64 {
  const path = new Path64();
  for (const [x, y] of ring) {
    path.push(
      new Point64(Math.round(x * CLIPPER_SCALE), Math.round(y * CLIPPER_SCALE))
    );
  }
  return path;
}

export function polygonsToPaths64(polys: PolygonWithHoles[]): Paths64 {
  const paths = new Paths64();
  for (const poly of polys) {
    if (poly.exterior.length >= 3) {
      paths.push(ringToPath64(poly.exterior));
    }
    for (const hole of poly.holes) {
      if (hole.length >= 3) {
        paths.push(ringToPath64(hole));
      }
    }
  }
  return paths;
}

function paths64ToPolygonsWithHoles(paths: Paths64): PolygonWithHoles[] {
  if (paths.length === 0) return [];
  const clipper = new Clipper64();
  clipper.preserveCollinear = false;
  clipper.addSubjectPaths(paths);
  const polyTree = new PolyTree64();
  clipper.executePolyTree(ClipType.Union, FillRule.NonZero, polyTree);
  return polyTreeToPolygonsWithHoles(polyTree);
}

export function clipperBoolean(
  subject: PolygonWithHoles[],
  clip: PolygonWithHoles[],
  clipType: ClipType
): PolygonWithHoles[] {
  if (subject.length === 0) return [];
  if (clip.length === 0) {
    return clipType === ClipType.Intersection ? [] : subject;
  }

  const subjectPaths = polygonsToPaths64(subject);
  const clipPaths = polygonsToPaths64(clip);
  if (subjectPaths.length === 0) return [];
  if (clipPaths.length === 0) {
    return clipType === ClipType.Intersection ? [] : subject;
  }

  const clipper = new Clipper64();
  clipper.preserveCollinear = false;
  clipper.addSubjectPaths(subjectPaths);
  clipper.addClipPaths(clipPaths);

  const polyTree = new PolyTree64();
  clipper.executePolyTree(clipType, FillRule.NonZero, polyTree);
  return polyTreeToPolygonsWithHoles(polyTree);
}

/**
 * Expande (deltaMm > 0) o contrae (deltaMm < 0) un conjunto de polígonos con huecos.
 * Positivo siempre agranda hacia fuera del material sólido (encoge huecos);
 * negativo siempre encoge hacia dentro del material sólido (agranda huecos).
 */
export function offsetPolygons(
  polys: PolygonWithHoles[],
  deltaMm: number
): PolygonWithHoles[] {
  if (polys.length === 0) return [];
  if (Math.abs(deltaMm) < 1e-6) return polys;

  const paths = polygonsToPaths64(polys);
  if (paths.length === 0) return [];

  const inflated = Clipper.InflatePaths(
    paths,
    deltaMm * CLIPPER_SCALE,
    JoinType.Round,
    EndType.Polygon
  );
  return paths64ToPolygonsWithHoles(inflated);
}

/**
 * Transformación afín 2D de píxel de imagen `(px, py)` (origen arriba-izquierda, +Y abajo)
 * a coordenadas slice-local `(x_s, y_s)` para `axis === 'y'` donde `x_s = x_w`, `y_s = -z_w`.
 * Determinante estrictamente positivo: preserva CCW.
 */
export function computeImageToPlate(
  decal: Pick<
    ImageDecal,
    'pxW' | 'pxH' | 'centerX' | 'centerZ' | 'widthMm' | 'heightMm' | 'rotationDeg'
  >
): Affine2D {
  const rad = (decal.rotationDeg * Math.PI) / 180;
  return affineRound(
    affineChain(
      affineScale(1, -1),
      affineTranslate(decal.centerX, decal.centerZ),
      affineRotate(rad),
      affineScale(decal.widthMm / decal.pxW, -decal.heightMm / decal.pxH),
      affineTranslate(-decal.pxW * 0.5, -decal.pxH * 0.5)
    ),
    6
  );
}

/**
 * Polígono rectangular (CCW en slice-local) cubierto por un decal en el plano frontal.
 */
export function getDecalPlateRect(
  decal: Pick<
    ImageDecal,
    'pxW' | 'pxH' | 'centerX' | 'centerZ' | 'widthMm' | 'heightMm' | 'rotationDeg'
  >
): PolygonWithHoles {
  const imageToPlate = computeImageToPlate(decal);
  const cornersPx: Point2D[] = [
    [0, 0],
    [decal.pxW, 0],
    [decal.pxW, decal.pxH],
    [0, decal.pxH],
  ];
  // Con det(imageToPlate) > 0:
  // En mundo XZ: TL=(0,0) arriba-izq, TR=(W,0) arriba-der, BR=(W,H) abajo-der, BL=(0,H) abajo-izq.
  // Tras scale(1, -1), TL tiene y_s negativo y BL tiene y_s positivo -> orden TL->TR->BR->BL es CCW en (x_s, y_s).
  // De cualquier forma garantizamos área positiva CCW.
  const exterior = cornersPx.map((pt) => affineApply(imageToPlate, pt));
  let signed2 = 0;
  for (let i = 0; i < exterior.length; i++) {
    const [x0, y0] = exterior[i];
    const [x1, y1] = exterior[(i + 1) % exterior.length];
    signed2 += x0 * y1 - x1 * y0;
  }
  if (signed2 < 0) {
    exterior.reverse();
  }
  return {
    exterior,
    holes: [],
    area: decal.widthMm * decal.heightMm,
  };
}

function totalPolygonArea(polys: PolygonWithHoles[]): number {
  let sum = 0;
  for (const p of polys) {
    sum += p.area;
  }
  return sum;
}

export interface BBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function computePolygonsBBox(polys: readonly PolygonWithHoles[]): BBox2D | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoint = false;

  for (const poly of polys) {
    for (const [x, y] of poly.exterior) {
      hasPoint = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  return hasPoint ? { minX, minY, maxX, maxY } : null;
}

export function bboxesOverlap(a: BBox2D | null, b: BBox2D | null, eps = 1e-4): boolean {
  if (!a || !b) return false;
  return (
    a.minX <= b.maxX + eps &&
    a.maxX >= b.minX - eps &&
    a.minY <= b.maxY + eps &&
    a.maxY >= b.minY - eps
  );
}

export interface SurfaceVisibilityCache {
  visibleSurfacePlates: PolygonWithHoles[][];
  visibleBBoxes: Array<BBox2D | null>;
  rawBBoxes: Array<BBox2D | null>;
  occluderPathsBefore: Paths64[];
}

const surfaceVisibilityCache = new WeakMap<SliceResult, SurfaceVisibilityCache>();

/**
 * Calcula y memoriza (por instancia de `SliceResult`) la cara visible acumulada
 * en proyección frontal (`axis === 'y'`) junto con sus AABBs para filtrado O(1).
 */
export function getSurfaceVisibility(slice: SliceResult): SurfaceVisibilityCache {
  const existing = surfaceVisibilityCache.get(slice);
  if (existing) return existing;

  const plateCount = slice.plates.length;
  const visibleSurfacePlates: PolygonWithHoles[][] = new Array(plateCount);
  const visibleBBoxes: Array<BBox2D | null> = new Array(plateCount);
  const rawBBoxes: Array<BBox2D | null> = new Array(plateCount);
  const occluderPathsBefore: Paths64[] = new Array(plateCount);

  let occluderPaths = new Paths64();

  for (let i = 0; i < plateCount; i++) {
    occluderPathsBefore[i] = occluderPaths;
    const plate = slice.plates[i];
    if (!plate || plate.length === 0) {
      visibleSurfacePlates[i] = [];
      visibleBBoxes[i] = null;
      rawBBoxes[i] = null;
      continue;
    }

    rawBBoxes[i] = computePolygonsBBox(plate);
    const platePaths = polygonsToPaths64(plate);

    if (platePaths.length === 0) {
      visibleSurfacePlates[i] = [];
      visibleBBoxes[i] = null;
      continue;
    }

    if (occluderPaths.length === 0) {
      visibleSurfacePlates[i] = plate;
      visibleBBoxes[i] = rawBBoxes[i];
      occluderPaths = platePaths;
    } else {
      const diffClipper = new Clipper64();
      diffClipper.preserveCollinear = false;
      diffClipper.addSubjectPaths(platePaths);
      diffClipper.addClipPaths(occluderPaths);
      const diffTree = new PolyTree64();
      diffClipper.executePolyTree(ClipType.Difference, FillRule.NonZero, diffTree);
      const visible = polyTreeToPolygonsWithHoles(diffTree);
      visibleSurfacePlates[i] = visible;
      visibleBBoxes[i] = computePolygonsBBox(visible);

      const unionClipper = new Clipper64();
      unionClipper.preserveCollinear = false;
      unionClipper.addSubjectPaths(occluderPaths);
      unionClipper.addClipPaths(platePaths);
      const nextOccluder = new Paths64();
      unionClipper.execute(ClipType.Union, FillRule.NonZero, nextOccluder);
      occluderPaths = nextOccluder;
    }
  }

  const cache: SurfaceVisibilityCache = {
    visibleSurfacePlates,
    visibleBBoxes,
    rawBBoxes,
    occluderPathsBefore,
  };
  surfaceVisibilityCache.set(slice, cache);
  return cache;
}

/**
 * Elige el índice de placa con mayor área de intersección bajo el decal (fallback: primera placa no vacía o 0).
 */
export function pickBestPlaneForDecal(
  slice: SliceResult,
  decal: Pick<
    ImageDecal,
    'pxW' | 'pxH' | 'centerX' | 'centerZ' | 'widthMm' | 'heightMm' | 'rotationDeg'
  >
): number {
  const rect = [getDecalPlateRect(decal)];
  const rectBBox = computePolygonsBBox(rect);
  const { rawBBoxes } = getSurfaceVisibility(slice);
  let bestIndex = -1;
  let bestArea = 0;
  let firstNonEmpty = -1;

  for (let i = 0; i < slice.plates.length; i++) {
    const plate = slice.plates[i];
    if (!plate || plate.length === 0) continue;
    if (firstNonEmpty === -1) firstNonEmpty = i;
    if (!bboxesOverlap(rectBBox, rawBBoxes[i])) continue;
    const clipped = clipperBoolean(rect, plate, ClipType.Intersection);
    const area = totalPolygonArea(clipped);
    if (area > bestArea) {
      bestArea = area;
      bestIndex = i;
    }
  }

  if (bestIndex !== -1) return bestIndex;
  return firstNonEmpty !== -1 ? firstNonEmpty : 0;
}

export interface ProjectDecalsOptions {
  bleedMm?: number;
}

/**
 * Proyecta los decals frontales sobre las placas cortadas (axis === 'y').
 * Calcula regiones de recorte exactas en mm (`previewClip` nominal y `printClip` con sangrado/reducción).
 * Completamente headless.
 */
export function projectDecals(
  slice: SliceResult,
  decals: readonly ImageDecal[],
  options?: ProjectDecalsOptions
): DecalRegion[] {
  const bleedMm = options?.bleedMm ?? 1.0;
  const plateCount = slice.plates.length;
  if (plateCount === 0) return [];

  const activeDecals = decals
    .filter(
      (d) =>
        d.visible &&
        d.widthMm > 0 &&
        d.heightMm > 0 &&
        d.pxW > 0 &&
        d.pxH > 0
    )
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id.localeCompare(b.id)));

  if (activeDecals.length === 0) return [];

  const {
    visibleSurfacePlates,
    visibleBBoxes,
    rawBBoxes,
    occluderPathsBefore,
  } = getSurfaceVisibility(slice);

  const expandedPlateCache = new Map<string, PolygonWithHoles[]>();
  const getOffsetPlate = (
    plateIndex: number,
    isSurface: boolean,
    delta: number
  ): PolygonWithHoles[] => {
    const key = `${plateIndex}:${isSurface ? 's' : 'p'}:${delta.toFixed(4)}`;
    const cached = expandedPlateCache.get(key);
    if (cached) return cached;

    let res: PolygonWithHoles[];
    if (delta > 0) {
      const source = isSurface
        ? visibleSurfacePlates[plateIndex]
        : slice.plates[plateIndex];
      res = offsetPolygons(source, delta);
    } else {
      const insetPlate = offsetPolygons(slice.plates[plateIndex], delta);
      const occluderPaths = occluderPathsBefore[plateIndex];
      if (isSurface && insetPlate.length > 0 && occluderPaths.length > 0) {
        const subjectPaths = polygonsToPaths64(insetPlate);
        const clipper = new Clipper64();
        clipper.preserveCollinear = false;
        clipper.addSubjectPaths(subjectPaths);
        clipper.addClipPaths(occluderPaths);
        const polyTree = new PolyTree64();
        clipper.executePolyTree(ClipType.Difference, FillRule.NonZero, polyTree);
        res = polyTreeToPolygonsWithHoles(polyTree);
      } else {
        res = insetPlate;
      }
    }
    expandedPlateCache.set(key, res);
    return res;
  };

  const regions: DecalRegion[] = [];

  for (const decal of activeDecals) {
    const imageToPlate = computeImageToPlate(decal);
    const rectPoly = [getDecalPlateRect(decal)];
    const rectBBox = computePolygonsBBox(rectPoly);

    const targetIndices: number[] = [];
    if (decal.mode === 'plane') {
      const idx =
        decal.plateIndex !== undefined &&
        decal.plateIndex >= 0 &&
        decal.plateIndex < plateCount
          ? decal.plateIndex
          : pickBestPlaneForDecal(slice, decal);
      targetIndices.push(idx);
    } else {
      for (let i = 0; i < plateCount; i++) {
        targetIndices.push(i);
      }
    }

    for (const plateIndex of targetIndices) {
      const rawPlate = slice.plates[plateIndex];
      if (!rawPlate || rawPlate.length === 0) continue;

      const isSurface = decal.mode === 'surface';
      const nominalSource = isSurface
        ? visibleSurfacePlates[plateIndex]
        : rawPlate;
      if (!nominalSource || nominalSource.length === 0) continue;

      const nominalBBox = isSurface
        ? visibleBBoxes[plateIndex]
        : rawBBoxes[plateIndex];
      if (!bboxesOverlap(rectBBox, nominalBBox)) continue;

      const previewClip = clipperBoolean(
        rectPoly,
        nominalSource,
        ClipType.Intersection
      );
      if (previewClip.length === 0) continue;

      let printClip: PolygonWithHoles[];
      if (Math.abs(bleedMm) < 1e-6) {
        printClip = previewClip;
      } else {
        const offsetSource = getOffsetPlate(plateIndex, isSurface, bleedMm);
        printClip = clipperBoolean(rectPoly, offsetSource, ClipType.Intersection);
      }

      if (printClip.length === 0 && bleedMm >= 0) continue;

      regions.push({
        decalId: decal.id,
        imageKey: decal.imageKey,
        pxW: decal.pxW,
        pxH: decal.pxH,
        plateIndex,
        order: decal.order,
        previewClip,
        printClip,
        imageToPlate,
      });
    }
  }

  regions.sort((a, b) =>
    a.plateIndex !== b.plateIndex
      ? a.plateIndex - b.plateIndex
      : a.order - b.order
  );

  return regions;
}
