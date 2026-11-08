import {
  distanceToPolygonBoundary,
  pointInPolygonWithHoles,
} from './geometry2d';
import { estimateTextWidth } from './labelMetrics';
import { validateParams, ValidationError } from './validator';
import type {
  CoreParams,
  PlacedPlate,
  PlateContour,
  PlateEngraveDisc,
  Point2D,
  PolygonWithHoles,
  SculptureParams,
  SheetLayout,
  SliceResult,
  SlotLabel,
} from '../types/sculpture';
import type { JointLayoutCursor, JointLayoutHooks } from './build/types';
import type { WaffleSection, WaffleSliceResult } from './waffle/types';

const MIN_SCRAP_DIM = 50.0;

function computePolygonCentroid(ring: Point2D[]): Point2D {
  let cx = 0;
  let cy = 0;
  let signedArea2 = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    signedArea2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(signedArea2) < 1e-9) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / n, sy / n];
  }
  const factor = 1.0 / (3.0 * signedArea2);
  return [cx * factor, cy * factor];
}

function getPlateBounds(plate: PlateContour): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const poly of plate) {
    for (const [x, y] of poly.exterior) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function shiftPlatePolygons(
  plate: PlateContour,
  dx: number,
  dy: number
): PolygonWithHoles[] {
  return plate.map((poly) => ({
    exterior: poly.exterior.map(([x, y]) => [x + dx, y + dy]),
    holes: poly.holes.map((h) => h.map(([x, y]) => [x + dx, y + dy])),
    area: poly.area,
  }));
}

/**
 * Rota 90° en sentido antihorario una pieza planar en sus coordenadas locales [0, w] x [0, h],
 * remapeándola a [0, h] x [0, w] mediante (x, y) ↦ (h - y, x).
 * Es una isometría rígida (det = +1) que preserva la orientación CCW de exteriores y CW de agujeros,
 * y transforma congruentemente marcas grabadas (discos y etiquetas de ranura).
 */
export function rotatePlateLocal90(
  polygons: PolygonWithHoles[],
  discs: PlateEngraveDisc[],
  slotLabels: SlotLabel[] | undefined,
  w: number,
  h: number
): {
  polygons: PolygonWithHoles[];
  discs: PlateEngraveDisc[];
  slotLabels: SlotLabel[];
  width: number;
  height: number;
} {
  const newPolygons: PolygonWithHoles[] = polygons.map((poly) => ({
    exterior: poly.exterior.map(([x, y]) => [
      Number((h - y).toFixed(4)),
      Number(x.toFixed(4)),
    ]),
    holes: poly.holes.map((hole) =>
      hole.map(([x, y]) => [
        Number((h - y).toFixed(4)),
        Number(x.toFixed(4)),
      ])
    ),
    area: poly.area,
  }));

  const newDiscs: PlateEngraveDisc[] = discs.map((d) => ({
    ...d,
    x: Number((h - d.y).toFixed(4)),
    y: Number(d.x.toFixed(4)),
  }));

  const newSlotLabels: SlotLabel[] = (slotLabels ?? []).map((s) => ({
    ...s,
    x: Number((h - s.y).toFixed(4)),
    y: Number(s.x.toFixed(4)),
  }));

  return {
    polygons: newPolygons,
    discs: newDiscs,
    slotLabels: newSlotLabels,
    width: h,
    height: w,
  };
}

/**
 * Ordena piezas por altura descendente (First-Fit Decreasing / FFD) para acomodo en estantes,
 * manteniendo intacto el identificador / plateIndex original.
 */
export function orderPlatesForPacking<T extends { plateIndex: number; width: number; height: number }>(
  items: readonly T[]
): T[] {
  return [...items].sort((a, b) => {
    if (Math.abs(b.height - a.height) > 1e-4) {
      return b.height - a.height;
    }
    if (Math.abs(b.width - a.width) > 1e-4) {
      return b.width - a.width;
    }
    return a.plateIndex - b.plateIndex;
  });
}

/**
 * Determina el texto, tamaño y posición de la etiqueta de placa (ej. 'P0'),
 * ubicándola en el centroide del polígono mayor si hay suficiente despeje respecto a los bordes y discos,
 * o fuera de la pieza si no cabe internamente.
 */
export function computePlateLabel(
  plateIdx: number,
  localPolys: PolygonWithHoles[],
  localDiscs: PlateEngraveDisc[],
  w: number,
  h: number,
  xOffset: number,
  yOffset: number
): {
  labelText: string;
  labelX: number;
  labelY: number;
  labelSize: number;
  labelOutside: boolean;
} {
  const labelText = `P${plateIdx}`;
  const minDim = Math.min(w, h);
  const textSize = Math.max(2.0, Math.min(8.0, minDim * 0.12));
  const textWidthEst = estimateTextWidth(labelText, textSize);
  const requiredRadius = Math.max(textWidthEst * 0.5, textSize * 0.5) + 0.5;

  // Polígono de mayor área
  let largest = localPolys[0];
  for (const p of localPolys) {
    if (p.area > largest.area) largest = p;
  }

  const [cx, cy] = computePolygonCentroid(largest.exterior);
  let insideOk = pointInPolygonWithHoles(cx, cy, largest);
  let clearance = insideOk ? distanceToPolygonBoundary(cx, cy, largest) : 0;

  if (insideOk) {
    for (const d of localDiscs) {
      const distToDiscEdge = Math.hypot(cx - d.x, cy - d.y) - d.diameter * 0.5;
      if (distToDiscEdge <= 0) {
        insideOk = false;
        break;
      }
      if (distToDiscEdge < clearance) {
        clearance = distToDiscEdge;
      }
    }
  }

  if (insideOk && clearance >= requiredRadius) {
    return {
      labelText,
      labelX: xOffset + cx,
      labelY: yOffset + cy,
      labelSize: Number(textSize.toFixed(2)),
      labelOutside: false,
    };
  }

  const outsideSize = Math.max(2.0, Math.min(4.0, w * 0.15));
  return {
    labelText,
    labelX: xOffset + w * 0.5,
    labelY: yOffset - outsideSize - 1.0,
    labelSize: Number(outsideSize.toFixed(2)),
    labelOutside: true,
  };
}

export function createEmptySheet(
  sheetIndex: number,
  sheetType: 'plates' | 'discs',
  materialThickness: number,
  params: Pick<CoreParams, 'sheetW' | 'sheetH' | 'sheetMargin' | 'kerf'>,
  engraveClearance = 0
): SheetLayout {
  return {
    sheetIndex,
    sheetType,
    materialThickness,
    width: params.sheetW,
    height: params.sheetH,
    margin: params.sheetMargin,
    kerf: params.kerf,
    engraveClearance,
    plates: [],
    discs: [],
    discGroups: [],
    scrapTags: [],
    usedWidth: 0,
    usedHeight: 0,
    usedAreaMm2: 0,
    usableAreaMm2: 0,
    occupancyPct: 0,
    remnantWidth: 0,
    remnantHeight: 0,
    remnantAreaMm2: 0,
  };
}

/**
 * Calcula dimensiones utilizadas, áreas de ocupación porcentual y etiquetas de retales sobrantes reutilizables.
 */
function finalizeSheetStats(sheet: SheetLayout, scrapTagEnabled: boolean): void {
  let maxX = 0.0;
  let maxY = 0.0;

  for (const p of sheet.plates) {
    maxX = Math.max(maxX, p.xOffset + p.width);
    maxY = Math.max(maxY, p.yOffset + p.height);
  }
  for (const d of sheet.discs) {
    const r = d.diameter * 0.5;
    maxX = Math.max(maxX, d.x + r);
    maxY = Math.max(maxY, d.y + r);
  }
  for (const grp of sheet.discGroups) {
    maxX = Math.max(maxX, grp.trayX + grp.trayW);
    maxY = Math.max(maxY, grp.trayY + grp.trayH);
  }

  const usableW = Math.max(0.0, sheet.width - 2.0 * sheet.margin);
  const usableH = Math.max(0.0, sheet.height - 2.0 * sheet.margin);
  const usableArea = usableW * usableH;

  if (maxX > sheet.margin && maxY > sheet.margin) {
    sheet.usedWidth = Number((maxX - sheet.margin).toFixed(1));
    sheet.usedHeight = Number((maxY - sheet.margin).toFixed(1));
  } else {
    sheet.usedWidth = 0.0;
    sheet.usedHeight = 0.0;
  }

  sheet.usedAreaMm2 = Number((sheet.usedWidth * sheet.usedHeight).toFixed(1));
  sheet.usableAreaMm2 = Number(usableArea.toFixed(1));
  sheet.occupancyPct =
    usableArea > 0
      ? Number(Math.min(100.0, (sheet.usedAreaMm2 / usableArea) * 100.0).toFixed(1))
      : 0.0;

  sheet.remnantWidth = Number(Math.max(0.0, usableW - sheet.usedWidth).toFixed(1));
  sheet.remnantHeight = Number(Math.max(0.0, usableH - sheet.usedHeight).toFixed(1));
  sheet.remnantAreaMm2 = Number(Math.max(0.0, usableArea - sheet.usedAreaMm2).toFixed(1));

  // Etiquetas de retazos aprovechables (ScrapTags) si superan las dimensiones mínimas configuradas
  sheet.scrapTags = [];
  if (!scrapTagEnabled) return;
  if (sheet.usedWidth <= 0 && sheet.usedHeight <= 0) return;

  const remRightW = usableW - sheet.usedWidth;
  if (remRightW >= MIN_SCRAP_DIM && usableH >= MIN_SCRAP_DIM) {
    sheet.scrapTags.push({
      x: sheet.margin + sheet.usedWidth,
      y: sheet.margin,
      w: Number(remRightW.toFixed(1)),
      h: Number(usableH.toFixed(1)),
      lines: ['SOBRANTE', `${remRightW.toFixed(0)} x ${usableH.toFixed(0)} mm`],
    });
  }

  const remTopH = usableH - sheet.usedHeight;
  if (remTopH >= MIN_SCRAP_DIM && usableW >= MIN_SCRAP_DIM) {
    sheet.scrapTags.push({
      x: sheet.margin,
      y: sheet.margin + sheet.usedHeight,
      w: Number(usableW.toFixed(1)),
      h: Number(remTopH.toFixed(1)),
      lines: ['SOBRANTE', `${usableW.toFixed(0)} x ${remTopH.toFixed(0)} mm`],
    });
  }
}

export function isWithinUsableArea(
  w: number,
  h: number,
  params: Pick<CoreParams, 'sheetW' | 'sheetH' | 'sheetMargin'>
): boolean {
  const usableW = params.sheetW - 2.0 * params.sheetMargin;
  const usableH = params.sheetH - 2.0 * params.sheetMargin;
  return w <= usableW && h <= usableH;
}

/**
 * Acomodo planar de placas en hojas de corte (núcleo).
 * No conoce discos; delega marcas de grabado y piezas extra a hooks opcionales de la unión.
 */
export function generateSheetLayouts(
  sliceResult: SliceResult,
  params: CoreParams,
  hooks?: JointLayoutHooks,
  options?: { optimizeLayout?: boolean }
): SheetLayout[] {
  validateParams(params);

  const usableW = params.sheetW - 2.0 * params.sheetMargin;
  const usableH = params.sheetH - 2.0 * params.sheetMargin;
  if (usableW <= 0 || usableH <= 0) {
    throw new ValidationError(
      `El margen (${params.sheetMargin} mm) es demasiado grande para la hoja de ${params.sheetW} x ${params.sheetH} mm.`
    );
  }

  const effSpacing = params.partGap;
  const margin = params.sheetMargin;
  const maxX = params.sheetW - margin;
  const maxY = params.sheetH - margin;
  const shouldOptimize = options?.optimizeLayout ?? params.optimizeLayout ?? false;

  interface PlateCandidate {
    plateIndex: number;
    width: number;
    height: number;
    polygons: PolygonWithHoles[];
    discs: PlateEngraveDisc[];
  }

  const rawCandidates: PlateCandidate[] = [];

  for (let i = 0; i < sliceResult.plates.length; i++) {
    const platePolys = sliceResult.plates[i];
    if (!platePolys || platePolys.length === 0) continue;

    const bounds = getPlateBounds(platePolys);
    let w = bounds.maxX - bounds.minX;
    let h = bounds.maxY - bounds.minY;

    let localPolys = shiftPlatePolygons(platePolys, -bounds.minX, -bounds.minY);
    let localDiscs: PlateEngraveDisc[] =
      hooks?.plateEngraveMarks(i, bounds.minX, bounds.minY) ?? [];

    const fitsNormal = isWithinUsableArea(w, h, params);
    const fitsRotated = isWithinUsableArea(h, w, params);

    if (!fitsNormal) {
      if (fitsRotated) {
        const rot = rotatePlateLocal90(localPolys, localDiscs, undefined, w, h);
        localPolys = rot.polygons;
        localDiscs = rot.discs;
        w = rot.width;
        h = rot.height;
      } else {
        throw new ValidationError(
          `La placa ${i} (${w.toFixed(1)} x ${h.toFixed(1)} mm) excede el área útil de la hoja (${usableW.toFixed(1)} x ${usableH.toFixed(1)} mm). Ajusta el tamaño de la hoja o escala el modelo 3D.`
        );
      }
    } else if (shouldOptimize && fitsRotated && h > w) {
      const rot = rotatePlateLocal90(localPolys, localDiscs, undefined, w, h);
      localPolys = rot.polygons;
      localDiscs = rot.discs;
      w = rot.width;
      h = rot.height;
    }

    rawCandidates.push({
      plateIndex: i,
      width: w,
      height: h,
      polygons: localPolys,
      discs: localDiscs,
    });
  }

  const candidates = shouldOptimize
    ? orderPlatesForPacking(rawCandidates)
    : rawCandidates;

  const sheets: SheetLayout[] = [];
  let sheetCounter = 0;
  let currentSheet = createEmptySheet(
    sheetCounter,
    'plates',
    params.thickness,
    params,
    hooks?.sheetEngraveClearance ?? 0
  );

  let cursorX = margin;
  let cursorY = margin;
  let rowHeight = 0.0;

  for (const cand of candidates) {
    let w = cand.width;
    let h = cand.height;
    let localPolys = cand.polygons;
    let localDiscs = cand.discs;

    if (shouldOptimize && isWithinUsableArea(h, w, params)) {
      const fitsCurrentRowNormal = cursorX + w <= maxX;
      const fitsCurrentRowRotated = cursorX + h <= maxX && cursorY + w <= maxY;
      if (!fitsCurrentRowNormal && fitsCurrentRowRotated && cursorX > margin) {
        const rot = rotatePlateLocal90(localPolys, localDiscs, undefined, w, h);
        localPolys = rot.polygons;
        localDiscs = rot.discs;
        w = rot.width;
        h = rot.height;
      }
    }

    if (cursorX + w > maxX && cursorX > margin) {
      cursorX = margin;
      cursorY += rowHeight + effSpacing;
      rowHeight = 0.0;
    }

    if (cursorY + h > maxY) {
      if (shouldOptimize && isWithinUsableArea(h, w, params) && cursorY + w <= maxY) {
        const rot = rotatePlateLocal90(localPolys, localDiscs, undefined, w, h);
        localPolys = rot.polygons;
        localDiscs = rot.discs;
        w = rot.width;
        h = rot.height;
      } else {
        if (currentSheet.plates.length > 0) {
          sheets.push(currentSheet);
          sheetCounter += 1;
        }
        currentSheet = createEmptySheet(
          sheetCounter,
          'plates',
          params.thickness,
          params,
          hooks?.sheetEngraveClearance ?? 0
        );
        cursorX = margin;
        cursorY = margin;
        rowHeight = 0.0;
      }
    }

    const plateYOffset = cursorY;
    const finalLabel = computePlateLabel(
      cand.plateIndex,
      localPolys,
      localDiscs,
      w,
      h,
      cursorX,
      plateYOffset
    );

    const placed: PlacedPlate = {
      plateIndex: cand.plateIndex,
      xOffset: cursorX,
      yOffset: plateYOffset,
      width: w,
      height: h,
      polygons: localPolys,
      discs: localDiscs,
      labelText: finalLabel.labelText,
      labelX: finalLabel.labelX,
      labelY: finalLabel.labelY,
      labelSize: finalLabel.labelSize,
      labelOutside: finalLabel.labelOutside,
    };

    currentSheet.plates.push(placed);
    cursorX += w + effSpacing;
    rowHeight = Math.max(rowHeight, h);
  }

  const cursor: JointLayoutCursor = {
    sheets,
    currentSheet,
    cursorX,
    cursorY,
    rowHeight,
    sheetCounter,
  };

  const closed =
    hooks?.placeExtraParts(cursor, params as SculptureParams) ?? false;
  if (!closed && cursor.currentSheet.plates.length > 0) {
    cursor.sheets.push(cursor.currentSheet);
  }

  for (const s of cursor.sheets) {
    finalizeSheetStats(s, params.scrapTagEnabled);
  }

  return cursor.sheets;
}

export function computeWaffleSectionLabel(
  labelText: string,
  localPolys: PolygonWithHoles[],
  slotLabels: SlotLabel[],
  w: number,
  h: number,
  xOffset: number,
  yOffset: number
): {
  labelText: string;
  labelX: number;
  labelY: number;
  labelSize: number;
  labelOutside: boolean;
} {
  const minDim = Math.min(w, h);
  const textSize = Math.max(2.0, Math.min(8.0, minDim * 0.12));
  const textWidthEst = estimateTextWidth(labelText, textSize);
  const requiredRadius = Math.max(textWidthEst * 0.5, textSize * 0.5) + 0.5;

  let largest = localPolys[0];
  for (const p of localPolys) {
    if (p.area > largest.area) largest = p;
  }

  const isCandidateValid = (cx: number, cy: number): boolean => {
    if (!pointInPolygonWithHoles(cx, cy, largest)) return false;
    const clr = distanceToPolygonBoundary(cx, cy, largest);
    if (clr < requiredRadius) return false;

    // Check collision with slot labels
    const halfW = textWidthEst * 0.5;
    const halfH = textSize * 0.5;
    const labelMinX = cx - halfW;
    const labelMaxX = cx + halfW;
    const labelMinY = cy - halfH;
    const labelMaxY = cy + halfH;

    for (const s of slotLabels) {
      const sHalfW = estimateTextWidth(s.text, s.fontSize) * 0.5 + 0.25;
      const sHalfH = s.fontSize * 0.5 + 0.25;
      const margin = 0.8;

      const sMinX = s.x - sHalfW - margin;
      const sMaxX = s.x + sHalfW + margin;
      const sMinY = s.y - sHalfH - margin;
      const sMaxY = s.y + sHalfH + margin;

      if (
        labelMinX < sMaxX &&
        labelMaxX > sMinX &&
        labelMinY < sMaxY &&
        labelMaxY > sMinY
      ) {
        return false;
      }
    }
    return true;
  };

  // 1. Try centroid of largest polygon island
  const [cx, cy] = computePolygonCentroid(largest.exterior);
  if (isCandidateValid(cx, cy)) {
    return {
      labelText,
      labelX: xOffset + cx,
      labelY: yOffset + cy,
      labelSize: Number(textSize.toFixed(2)),
      labelOutside: false,
    };
  }

  // 2. Sample 9x9 grid inside bounding box of largest island
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of largest.exterior) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  let bestPoint: Point2D | null = null;
  let bestClearance = -1;

  for (let i = 1; i <= 9; i++) {
    const px = minX + (maxX - minX) * (i / 10);
    for (let j = 1; j <= 9; j++) {
      const py = minY + (maxY - minY) * (j / 10);
      if (isCandidateValid(px, py)) {
        const clr = distanceToPolygonBoundary(px, py, largest);
        if (clr > bestClearance) {
          bestClearance = clr;
          bestPoint = [px, py];
        }
      }
    }
  }

  if (bestPoint && bestClearance >= requiredRadius) {
    return {
      labelText,
      labelX: xOffset + bestPoint[0],
      labelY: yOffset + bestPoint[1],
      labelSize: Number(textSize.toFixed(2)),
      labelOutside: false,
    };
  }

  // 3. Fallback outside underneath piece
  const outsideSize = Math.max(2.0, Math.min(4.0, w * 0.15));
  return {
    labelText,
    labelX: xOffset + w * 0.5,
    labelY: yOffset - outsideSize - 1.0,
    labelSize: Number(outsideSize.toFixed(2)),
    labelOutside: true,
  };
}

export function generateWaffleSheetLayouts(
  waffleResult: WaffleSliceResult,
  params: CoreParams,
  options?: { optimizeLayout?: boolean }
): SheetLayout[] {
  validateParams(params);

  const usableW = params.sheetW - 2.0 * params.sheetMargin;
  const usableH = params.sheetH - 2.0 * params.sheetMargin;
  if (usableW <= 0 || usableH <= 0) {
    throw new ValidationError(
      `El margen (${params.sheetMargin} mm) es demasiado grande para la hoja de ${params.sheetW} x ${params.sheetH} mm.`
    );
  }

  const effSpacing = params.partGap;
  const margin = params.sheetMargin;
  const maxX = params.sheetW - margin;
  const maxY = params.sheetH - margin;
  const shouldOptimize = options?.optimizeLayout ?? params.optimizeLayout ?? false;

  const allSections: WaffleSection[] = [
    ...waffleResult.p1Sections.filter((s) => s.polygons.length > 0),
    ...waffleResult.p2Sections.filter((s) => s.polygons.length > 0),
  ];

  interface WaffleCandidate {
    plateIndex: number;
    sectionId: string;
    width: number;
    height: number;
    polygons: PolygonWithHoles[];
    slotLabels: SlotLabel[];
  }

  const rawCandidates: WaffleCandidate[] = [];

  for (let idx = 0; idx < allSections.length; idx++) {
    const section = allSections[idx];
    const bounds = section.bounds2D;
    let w = bounds.maxU - bounds.minU;
    let h = bounds.maxV - bounds.minV;

    let localPolys = shiftPlatePolygons(section.polygons, -bounds.minU, -bounds.minV);
    let localSlotLabels = section.slotLabels ?? [];

    const fitsNormal = isWithinUsableArea(w, h, params);
    const fitsRotated = isWithinUsableArea(h, w, params);

    if (!fitsNormal) {
      if (fitsRotated) {
        const rot = rotatePlateLocal90(localPolys, [], localSlotLabels, w, h);
        localPolys = rot.polygons;
        localSlotLabels = rot.slotLabels;
        w = rot.width;
        h = rot.height;
      } else {
        throw new ValidationError(
          `La pieza ${section.id} (${w.toFixed(1)} x ${h.toFixed(1)} mm) excede el área útil de la hoja (${usableW.toFixed(1)} x ${usableH.toFixed(1)} mm). Ajusta el tamaño de la hoja o reduce la escala del modelo.`
        );
      }
    } else if (shouldOptimize && fitsRotated && h > w) {
      const rot = rotatePlateLocal90(localPolys, [], localSlotLabels, w, h);
      localPolys = rot.polygons;
      localSlotLabels = rot.slotLabels;
      w = rot.width;
      h = rot.height;
    }

    rawCandidates.push({
      plateIndex: idx,
      sectionId: section.id,
      width: w,
      height: h,
      polygons: localPolys,
      slotLabels: localSlotLabels,
    });
  }

  const candidates = shouldOptimize
    ? orderPlatesForPacking(rawCandidates)
    : rawCandidates;

  const sheets: SheetLayout[] = [];
  let sheetCounter = 0;
  let currentSheet = createEmptySheet(
    sheetCounter,
    'plates',
    params.thickness,
    params,
    0
  );

  let cursorX = margin;
  let cursorY = margin;
  let rowHeight = 0.0;

  for (const cand of candidates) {
    let w = cand.width;
    let h = cand.height;
    let localPolys = cand.polygons;
    let localSlotLabels = cand.slotLabels;

    if (shouldOptimize && isWithinUsableArea(h, w, params)) {
      const fitsCurrentRowNormal = cursorX + w <= maxX;
      const fitsCurrentRowRotated = cursorX + h <= maxX && cursorY + w <= maxY;
      if (!fitsCurrentRowNormal && fitsCurrentRowRotated && cursorX > margin) {
        const rot = rotatePlateLocal90(localPolys, [], localSlotLabels, w, h);
        localPolys = rot.polygons;
        localSlotLabels = rot.slotLabels;
        w = rot.width;
        h = rot.height;
      }
    }

    if (cursorX + w > maxX && cursorX > margin) {
      cursorX = margin;
      cursorY += rowHeight + effSpacing;
      rowHeight = 0.0;
    }

    if (cursorY + h > maxY) {
      if (shouldOptimize && isWithinUsableArea(h, w, params) && cursorY + w <= maxY) {
        const rot = rotatePlateLocal90(localPolys, [], localSlotLabels, w, h);
        localPolys = rot.polygons;
        localSlotLabels = rot.slotLabels;
        w = rot.width;
        h = rot.height;
      } else {
        if (currentSheet.plates.length > 0) {
          sheets.push(currentSheet);
          sheetCounter += 1;
        }
        currentSheet = createEmptySheet(
          sheetCounter,
          'plates',
          params.thickness,
          params,
          0
        );
        cursorX = margin;
        cursorY = margin;
        rowHeight = 0.0;
      }
    }

    const plateYOffset = cursorY;
    const finalLabel = computeWaffleSectionLabel(
      cand.sectionId,
      localPolys,
      localSlotLabels,
      w,
      h,
      cursorX,
      plateYOffset
    );

    const placedSlotLabels: SlotLabel[] = localSlotLabels.map((lbl) => ({
      crossingId: lbl.crossingId,
      text: lbl.text,
      x: cursorX + lbl.x,
      y: plateYOffset + lbl.y,
      fontSize: lbl.fontSize,
    }));

    const placed: PlacedPlate = {
      plateIndex: cand.plateIndex,
      xOffset: cursorX,
      yOffset: plateYOffset,
      width: w,
      height: h,
      polygons: localPolys,
      discs: [],
      labelText: finalLabel.labelText,
      labelX: finalLabel.labelX,
      labelY: finalLabel.labelY,
      labelSize: finalLabel.labelSize,
      labelOutside: finalLabel.labelOutside,
      slotLabels: placedSlotLabels,
    };

    currentSheet.plates.push(placed);
    cursorX += w + effSpacing;
    rowHeight = Math.max(rowHeight, h);
  }

  if (currentSheet.plates.length > 0) {
    sheets.push(currentSheet);
  }

  for (const s of sheets) {
    finalizeSheetStats(s, params.scrapTagEnabled);
  }

  return sheets;
}
