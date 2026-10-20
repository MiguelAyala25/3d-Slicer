import {
  distanceToPolygonBoundary,
  pointInPolygonWithHoles,
} from './geometry2d';
import { getDiscThickness, isDiscsSeparateSheet } from './params';
import { validateParams, ValidationError } from './validator';
import type {
  Disc,
  PlacedDisc,
  PlacedPlate,
  PlateContour,
  PlateEngraveDisc,
  Point2D,
  PolygonWithHoles,
  SculptureParams,
  SheetLayout,
  SliceResult,
} from '../types/sculpture';

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
 * Traducción 1:1 de _compute_plate_label (layout.py:190-263).
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
  const textWidthEst = labelText.length * textSize * 0.65;
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

function createEmptySheet(
  sheetIndex: number,
  sheetType: 'plates' | 'discs',
  materialThickness: number,
  params: SculptureParams
): SheetLayout {
  return {
    sheetIndex,
    sheetType,
    materialThickness,
    width: params.sheetW,
    height: params.sheetH,
    margin: params.sheetMargin,
    kerf: params.kerf,
    engraveClearance: params.engraveClearance,
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
 * Traducción 1:1 de calculate_used_dimensions (layout.py:110-144) y _compute_scrap_tags (layout.py:392-412).
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

  // ScrapTags (layout.py:392-412)
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

/**
 * Traducción 1:1 de _layout_discs_into_sheets (layout.py:434-648).
 */
function layoutDiscsIntoSheets(
  discs: Disc[],
  params: SculptureParams,
  sheets: SheetLayout[],
  currentSheet: SheetLayout,
  startCursorX: number,
  startCursorY: number,
  startRowHeight: number,
  sheetCounterStart: number,
  sheetTypeForNew: 'plates' | 'discs',
  discThickness: number
): { currentSheet: SheetLayout; sheetCounter: number } {
  const margin = params.sheetMargin;
  const effSpacing = params.partGap;
  const trayOffset = 4.0;
  const maxX = params.sheetW - margin;
  const maxY = params.sheetH - margin;
  const usableW = params.sheetW - 2.0 * margin;

  let cursorX = startCursorX;
  let cursorY = startCursorY;
  let rowHeight = startRowHeight;
  let sheetCounter = sheetCounterStart;

  const groupsByGap = new Map<number, Disc[]>();
  for (const d of discs) {
    const list = groupsByGap.get(d.gapIndex);
    if (list) list.push(d);
    else groupsByGap.set(d.gapIndex, [d]);
  }

  const sortedGapIndices = Array.from(groupsByGap.keys()).sort((a, b) => a - b);

  for (const gapIdx of sortedGapIndices) {
    const grpDiscs = groupsByGap.get(gapIdx)!;
    const nDiscs = grpDiscs.length;
    const grpLabel = `P${gapIdx}-P${gapIdx + 1}`;
    const labelW = Math.max(18.0, grpLabel.length * 3.5);
    const maxD = grpDiscs.reduce((m, d) => Math.max(m, d.diameter), 0);

    const discsSpanW =
      grpDiscs.reduce((s, d) => s + d.diameter, 0) +
      Math.max(0, nDiscs - 1) * effSpacing;
    const trayW = labelW + trayOffset + discsSpanW + trayOffset * 2.0;
    const trayH = maxD + trayOffset * 2.0;

    if (trayW <= usableW) {
      if (cursorX + trayW > maxX && cursorX > margin) {
        cursorX = margin;
        cursorY += rowHeight + effSpacing;
        rowHeight = 0.0;
      }
      if (cursorY + trayH > maxY) {
        if (currentSheet.plates.length > 0 || currentSheet.discs.length > 0) {
          sheets.push(currentSheet);
          sheetCounter += 1;
        }
        currentSheet = createEmptySheet(
          sheetCounter,
          sheetTypeForNew,
          discThickness,
          params
        );
        cursorX = margin;
        cursorY = margin;
        rowHeight = 0.0;
      }

      const trayX = cursorX;
      const trayY = cursorY;
      const labelSepX = trayX + labelW;
      let discCursorX = labelSepX + trayOffset;
      const placedInGroup: PlacedDisc[] = [];

      for (let idx = 0; idx < grpDiscs.length; idx++) {
        const d = grpDiscs[idx];
        const r = d.diameter * 0.5;
        const cx = discCursorX + r;
        const cy = trayY + trayH * 0.5;
        const pd: PlacedDisc = {
          discId: d.id,
          gapIndex: d.gapIndex,
          x: cx,
          y: cy,
          diameter: d.diameter,
          label: `D${d.gapIndex}-${idx + 1}`,
        };
        currentSheet.discs.push(pd);
        placedInGroup.push(pd);
        discCursorX += d.diameter + effSpacing;
      }

      currentSheet.discGroups.push({
        gapIndex: gapIdx,
        plateA: gapIdx,
        plateB: gapIdx + 1,
        label: grpLabel,
        trayX,
        trayY,
        trayW,
        trayH,
        labelSepX,
        discs: placedInGroup,
      });

      cursorX += trayW + effSpacing;
      rowHeight = Math.max(rowHeight, trayH);
    } else {
      // Bandeja multi-fila cuando el grupo supera el ancho útil de la hoja (layout.py:553-633)
      if (cursorX > margin) {
        cursorX = margin;
        cursorY += rowHeight + effSpacing;
        rowHeight = 0.0;
      }

      const availDiscW = usableW - labelW - trayOffset * 3.0;
      let subRows: Array<Array<{ idx: number; disc: Disc }>> = [];
      let curRow: Array<{ idx: number; disc: Disc }> = [];
      let curW = 0.0;

      for (let idx = 0; idx < grpDiscs.length; idx++) {
        const d = grpDiscs[idx];
        const needed = curRow.length === 0 ? d.diameter : d.diameter + effSpacing;
        if (curW + needed > availDiscW && curRow.length > 0) {
          subRows.push(curRow);
          curRow = [{ idx, disc: d }];
          curW = d.diameter;
        } else {
          curRow.push({ idx, disc: d });
          curW += needed;
        }
      }
      if (curRow.length > 0) subRows.push(curRow);

      let totalTrayH =
        subRows.length * maxD +
        Math.max(0, subRows.length - 1) * effSpacing +
        trayOffset * 2.0;

      if (cursorY + totalTrayH > maxY) {
        if (currentSheet.plates.length > 0 || currentSheet.discs.length > 0) {
          sheets.push(currentSheet);
          sheetCounter += 1;
        }
        currentSheet = createEmptySheet(
          sheetCounter,
          sheetTypeForNew,
          discThickness,
          params
        );
        cursorX = margin;
        cursorY = margin;
        rowHeight = 0.0;
      }

      const trayX = margin;
      const trayY = cursorY;
      const labelSepX = trayX + labelW;
      const placedInGroup: PlacedDisc[] = [];
      let maxRowEndX = labelSepX + trayOffset;

      for (let rIdx = 0; rIdx < subRows.length; rIdx++) {
        const rowDiscs = subRows[rIdx];
        let discCursorX = labelSepX + trayOffset;
        const rowCy =
          trayY + trayOffset + rIdx * (maxD + effSpacing) + maxD * 0.5;

        for (const { idx, disc: d } of rowDiscs) {
          const r = d.diameter * 0.5;
          const cx = discCursorX + r;
          const pd: PlacedDisc = {
            discId: d.id,
            gapIndex: d.gapIndex,
            x: cx,
            y: rowCy,
            diameter: d.diameter,
            label: `D${d.gapIndex}-${idx + 1}`,
          };
          currentSheet.discs.push(pd);
          placedInGroup.push(pd);
          discCursorX += d.diameter + effSpacing;
        }
        maxRowEndX = Math.max(maxRowEndX, discCursorX - effSpacing);
      }

      const actualTrayW = maxRowEndX - trayX + trayOffset;
      currentSheet.discGroups.push({
        gapIndex: gapIdx,
        plateA: gapIdx,
        plateB: gapIdx + 1,
        label: grpLabel,
        trayX,
        trayY,
        trayW: actualTrayW,
        trayH: totalTrayH,
        labelSepX,
        discs: placedInGroup,
      });

      cursorX = margin;
      cursorY += totalTrayH + effSpacing;
      rowHeight = 0.0;
    }
  }

  return { currentSheet, sheetCounter };
}

/**
 * Traducción 1:1 de generate_layouts (layout.py:266-389).
 */
export function generateLayouts(
  sliceResult: SliceResult,
  discs: Disc[],
  params: SculptureParams
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

  const sheets: SheetLayout[] = [];
  let sheetCounter = 0;
  let currentSheet = createEmptySheet(
    sheetCounter,
    'plates',
    params.thickness,
    params
  );

  let cursorX = margin;
  let cursorY = margin;
  let rowHeight = 0.0;

  for (let i = 0; i < sliceResult.plates.length; i++) {
    const platePolys = sliceResult.plates[i];
    if (!platePolys || platePolys.length === 0) continue;

    const bounds = getPlateBounds(platePolys);
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;

    // Verificación exacta de layout.py:183-187
    if (w > usableW || h > usableH) {
      throw new ValidationError(
        `La placa ${i} (${w.toFixed(1)} x ${h.toFixed(1)} mm) excede el área útil de la hoja (${usableW.toFixed(1)} x ${usableH.toFixed(1)} mm). Ajusta el tamaño de la hoja o escala el modelo 3D.`
      );
    }

    const plateDiscs = discs.filter(
      (d) => d.gapIndex === i || d.gapIndex === i - 1
    );
    const localPolys = shiftPlatePolygons(platePolys, -bounds.minX, -bounds.minY);
    const localDiscs: PlateEngraveDisc[] = plateDiscs.map((d) => ({
      id: d.id,
      x: d.x - bounds.minX,
      y: d.y - bounds.minY,
      diameter: Number((d.diameter + params.engraveClearance).toFixed(4)),
      nominalDiameter: d.diameter,
      gapIndex: d.gapIndex,
      isDashed: d.gapIndex === i - 1, // gapIndex === i -> SÓLIDO (false); gapIndex === i - 1 -> PUNTEADO (true)
    }));

    if (cursorX + w > maxX && cursorX > margin) {
      cursorX = margin;
      cursorY += rowHeight + effSpacing;
      rowHeight = 0.0;
    }

    if (cursorY + h > maxY) {
      if (currentSheet.plates.length > 0) {
        sheets.push(currentSheet);
        sheetCounter += 1;
      }
      currentSheet = createEmptySheet(
        sheetCounter,
        'plates',
        params.thickness,
        params
      );
      cursorX = margin;
      cursorY = margin;
      rowHeight = 0.0;
    }

    const plateYOffset = cursorY;
    const finalLabel = computePlateLabel(
      i,
      localPolys,
      localDiscs,
      w,
      h,
      cursorX,
      plateYOffset
    );

    const placed: PlacedPlate = {
      plateIndex: i,
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

  const separateDiscs = isDiscsSeparateSheet(params);
  const discThickness = getDiscThickness(params);

  if (discs.length > 0) {
    if (!separateDiscs) {
      const res = layoutDiscsIntoSheets(
        discs,
        params,
        sheets,
        currentSheet,
        cursorX,
        cursorY,
        rowHeight,
        sheetCounter,
        'plates',
        params.thickness
      );
      currentSheet = res.currentSheet;
      sheetCounter = res.sheetCounter;
      if (currentSheet.plates.length > 0 || currentSheet.discs.length > 0) {
        sheets.push(currentSheet);
      }
    } else {
      if (currentSheet.plates.length > 0) {
        sheets.push(currentSheet);
        sheetCounter += 1;
      }
      const discSheet = createEmptySheet(
        sheetCounter,
        'discs',
        discThickness,
        params
      );
      const res = layoutDiscsIntoSheets(
        discs,
        params,
        sheets,
        discSheet,
        margin,
        margin,
        0.0,
        sheetCounter,
        'discs',
        discThickness
      );
      if (res.currentSheet.discs.length > 0) {
        sheets.push(res.currentSheet);
      }
    }
  } else if (currentSheet.plates.length > 0) {
    sheets.push(currentSheet);
  }

  for (const s of sheets) {
    finalizeSheetStats(s, params.scrapTagEnabled);
  }

  return sheets;
}
