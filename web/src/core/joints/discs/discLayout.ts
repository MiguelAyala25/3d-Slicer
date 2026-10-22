import { createEmptySheet, generateSheetLayouts } from '../../layout';
import { getDiscThickness, isDiscsSeparateSheet } from './discParams';
import type { JointLayoutCursor, JointLayoutHooks } from '../../build/types';
import type {
  Disc,
  PlacedDisc,
  PlateEngraveDisc,
  SculptureParams,
  SheetLayout,
  SliceResult,
} from '../../../types/sculpture';

/**
 * Traducción 1:1 de _layout_discs_into_sheets (layout.py:434-648).
 */
export function layoutDiscsIntoSheets(
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
          params,
          params.engraveClearance
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
          params,
          params.engraveClearance
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

export function createDiscsLayoutHooks(
  discs: Disc[],
  params: SculptureParams
): JointLayoutHooks {
  return {
    sheetEngraveClearance: params.engraveClearance,
    plateEngraveMarks(plateIndex: number, boundsMinX: number, boundsMinY: number): PlateEngraveDisc[] {
      const plateDiscs = discs.filter(
        (d) => d.gapIndex === plateIndex || d.gapIndex === plateIndex - 1
      );
      return plateDiscs.map((d) => ({
        id: d.id,
        x: d.x - boundsMinX,
        y: d.y - boundsMinY,
        diameter: Number((d.diameter + params.engraveClearance).toFixed(4)),
        nominalDiameter: d.diameter,
        gapIndex: d.gapIndex,
        isDashed: d.gapIndex === plateIndex - 1,
      }));
    },
    placeExtraParts(cursor: JointLayoutCursor, p: SculptureParams): boolean {
      if (discs.length === 0) {
        return false;
      }
      const separateDiscs = isDiscsSeparateSheet(p);
      const discThickness = getDiscThickness(p);

      if (!separateDiscs) {
        const res = layoutDiscsIntoSheets(
          discs,
          p,
          cursor.sheets,
          cursor.currentSheet,
          cursor.cursorX,
          cursor.cursorY,
          cursor.rowHeight,
          cursor.sheetCounter,
          'plates',
          p.thickness
        );
        cursor.currentSheet = res.currentSheet;
        cursor.sheetCounter = res.sheetCounter;
        if (cursor.currentSheet.plates.length > 0 || cursor.currentSheet.discs.length > 0) {
          cursor.sheets.push(cursor.currentSheet);
        }
      } else {
        if (cursor.currentSheet.plates.length > 0) {
          cursor.sheets.push(cursor.currentSheet);
          cursor.sheetCounter += 1;
        }
        const discSheet = createEmptySheet(
          cursor.sheetCounter,
          'discs',
          discThickness,
          p,
          p.engraveClearance
        );
        const res = layoutDiscsIntoSheets(
          discs,
          p,
          cursor.sheets,
          discSheet,
          p.sheetMargin,
          p.sheetMargin,
          0.0,
          cursor.sheetCounter,
          'discs',
          discThickness
        );
        if (res.currentSheet.discs.length > 0) {
          cursor.sheets.push(res.currentSheet);
        }
      }
      return true;
    },
  };
}

export function generateDiscsLayouts(
  sliceResult: SliceResult,
  discs: Disc[],
  params: SculptureParams
): SheetLayout[] {
  return generateSheetLayouts(sliceResult, params, createDiscsLayoutHooks(discs, params));
}
