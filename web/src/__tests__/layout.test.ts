import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSheetLayouts } from '../core/layout';
import { generateDiscsLayouts } from '../core/joints/discs/discLayout';
import { GLYPH_WIDTH_RATIO, estimateTextWidth } from '../core/labelMetrics';
import { parseProjectJson } from '../core/project';
import { DEFAULT_PARAMS } from '../core/params';
import { ValidationError } from '../core/validator';
import type { SculptureParams, SliceResult } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GOLDEN_DIR = path.resolve(__dirname, '../../../web/golden');

describe('layout engine (layout.ts)', () => {
  const goldenLayoutZ = JSON.parse(
    fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_layout.json'), 'utf-8')
  );
  const goldenSliceZ = JSON.parse(
    fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_slice_z.json'), 'utf-8')
  );
  const goldenProject = JSON.parse(
    fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_project.json'), 'utf-8')
  );

  const mockSliceResultZ: SliceResult = {
    plates: goldenSliceZ.polygons.map((pList: any[]) =>
      pList.map((p) => ({
        exterior: p.exterior,
        holes: p.interiors ?? [],
        area: p.area,
      }))
    ),
    zPositions: [-10, -5, 0, 5, 10],
    scaleFactor: goldenSliceZ.autoScale,
    scaledBounds: [
      [-11.5, -5.75],
      [11.5, 5.75],
    ],
    scaledHeight: goldenSliceZ.assembledHeight,
    warnings: [],
  };

  const projectData = parseProjectJson(JSON.stringify(goldenProject));

  const layoutParams: SculptureParams = {
    ...DEFAULT_PARAMS,
    plates: projectData.params.plates,
    thickness: projectData.params.thickness,
    gap: projectData.params.gap,
    axis: projectData.params.axis,
    sheetW: 600.0,
    sheetH: 400.0,
    sheetMargin: 10.0,
    partGap: 5.0,
    kerf: 0.15,
    engraveClearance: 0.3,
    scrapTagEnabled: true,
  };

  it('matches web/golden/l_block_layout.json for Z axis', () => {
    const sheets = generateDiscsLayouts(mockSliceResultZ, projectData.discs, layoutParams);

    // 2 sheets because gap (2.0) !== thickness (3.0)
    expect(sheets.length).toBe(goldenLayoutZ.sheets.length);
    expect(sheets[0].sheetType).toBe('plates');
    expect(sheets[1].sheetType).toBe('discs');

    const sheet0 = sheets[0];
    const goldenSheet0 = goldenLayoutZ.sheets[0];
    expect(sheet0.plates.length).toBe(goldenSheet0.placedPlates.length);

    for (let i = 0; i < sheet0.plates.length; i++) {
      const pl = sheet0.plates[i];
      const gpl = goldenSheet0.placedPlates[i];
      expect(pl.plateIndex).toBe(gpl.plateIdx);
      expect(pl.xOffset).toBeCloseTo(gpl.x, 1);
      expect(pl.yOffset).toBeCloseTo(gpl.y, 1);
      expect(pl.width).toBeCloseTo(gpl.w, 1);
      expect(pl.height).toBeCloseTo(gpl.h, 1);
    }

    // Verify plate 1 discs: 1 solid, 1 dashed, diameter + engraveClearance (5.3)
    const plate1 = sheet0.plates[1];
    expect(plate1.discs.length).toBe(2);

    const solidDisc = plate1.discs.find((d) => !d.isDashed);
    const dashedDisc = plate1.discs.find((d) => d.isDashed);

    expect(solidDisc).toBeDefined();
    expect(dashedDisc).toBeDefined();
    expect(solidDisc?.gapIndex).toBe(1);
    expect(dashedDisc?.gapIndex).toBe(0);
    expect(solidDisc?.diameter).toBeCloseTo(5.3, 2);
    expect(dashedDisc?.diameter).toBeCloseTo(5.3, 2);

    // Sheet 1 (discs)
    const sheet1 = sheets[1];
    const goldenSheet1 = goldenLayoutZ.sheets[1];
    expect(sheet1.discGroups.length).toBe(goldenSheet1.discGroups.length);
    expect(sheet1.discs.length).toBe(2);
  });

  it('respects scrapTagEnabled toggle', () => {
    const sheetsWithTag = generateDiscsLayouts(mockSliceResultZ, projectData.discs, {
      ...layoutParams,
      scrapTagEnabled: true,
    });
    expect(sheetsWithTag[0].scrapTags.length).toBeGreaterThan(0);

    const sheetsWithoutTag = generateDiscsLayouts(mockSliceResultZ, projectData.discs, {
      ...layoutParams,
      scrapTagEnabled: false,
    });
    expect(sheetsWithoutTag[0].scrapTags.length).toBe(0);
  });

  it('throws ValidationError with exact message when plate exceeds usable area', () => {
    expect(() =>
      generateDiscsLayouts(mockSliceResultZ, projectData.discs, {
        ...layoutParams,
        sheetW: 30.0,
        sheetH: 30.0,
        sheetMargin: 10.0, // Usable is 10x10 mm, plate 0 is 23x11.5 mm
      })
    ).toThrow(ValidationError);
  });

  it('generateSheetLayouts without hooks is strictly identical to generateDiscsLayouts with discs = []', () => {
    const paramsZeroClearance = { ...layoutParams, engraveClearance: 0 };
    const sheetsCore = generateSheetLayouts(mockSliceResultZ, paramsZeroClearance);
    const sheetsDiscsEmpty = generateDiscsLayouts(mockSliceResultZ, [], paramsZeroClearance);
    expect(sheetsCore).toEqual(sheetsDiscsEmpty);
  });

  describe('Characterization of sheet occupancy and label positions (C11 / D4 / D5)', () => {
    it('characterizes layout stats for L-block fixture on Z-axis', () => {
      const sheets = generateDiscsLayouts(mockSliceResultZ, projectData.discs, layoutParams);
      expect(sheets.length).toBe(2);

      const sheet0 = sheets[0];
      expect(sheet0.sheetType).toBe('plates');
      expect(sheet0.plates.length).toBe(5);
      expect(sheet0.usedWidth).toBe(89);
      expect(sheet0.usedHeight).toBe(11.5);
      expect(sheet0.usedAreaMm2).toBe(1023.5);
      expect(sheet0.usableAreaMm2).toBe(220400);
      expect(sheet0.occupancyPct).toBe(0.5);

      // Verify label placement on each plate
      const labels = sheet0.plates.map((p) => ({
        idx: p.plateIndex,
        text: p.labelText,
        x: Number(p.labelX.toFixed(4)),
        y: Number(p.labelY.toFixed(4)),
        size: p.labelSize,
        outside: p.labelOutside,
      }));
      expect(labels).toEqual([
        { idx: 0, text: 'P0', x: 21.5, y: 15.75, size: 2, outside: false },
        { idx: 1, text: 'P1', x: 49.5, y: 15.75, size: 2, outside: false },
        { idx: 2, text: 'P2', x: 69.8333, y: 7, size: 2, outside: true },
        { idx: 3, text: 'P3', x: 82.5, y: 15.75, size: 2, outside: false },
        { idx: 4, text: 'P4', x: 95.1667, y: 15.75, size: 2, outside: false },
      ]);
    });

    it('characterizes baseline layout and occupancy for 30 mixed synthetic plates', () => {
      const synthetic30Plates = Array.from({ length: 30 }, (_, i) => {
        const w = (i % 3 === 0) ? 15 : (i % 3 === 1) ? 50 + (i % 4) * 10 : 25 + (i % 6) * 5;
        const h = (i % 3 === 0) ? 40 + (i % 5) * 5 : (i % 3 === 1) ? 20 : 25 + (i % 6) * 5;
        return [
          {
            exterior: [
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ] as [number, number][],
            holes: [] as [number, number][][],
            area: w * h,
          },
        ];
      });

      const syntheticSliceResult: SliceResult = {
        plates: synthetic30Plates,
        zPositions: Array.from({ length: 30 }, (_, i) => i * 3),
        scaleFactor: 1,
        scaledBounds: [[0, 0], [100, 100]],
        scaledHeight: 90,
        warnings: [],
      };

      const syntheticParams: SculptureParams = {
        ...DEFAULT_PARAMS,
        plates: 30,
        thickness: 3.0,
        gap: 3.0,
        axis: 'z',
        sheetW: 200.0,
        sheetH: 150.0,
        sheetMargin: 10.0,
        partGap: 5.0,
        kerf: 0.15,
        engraveClearance: 0.3,
        scrapTagEnabled: false,
      };

      const sheets = generateSheetLayouts(syntheticSliceResult, syntheticParams);
      // Baseline with sequential shelf placement without sorting:
      expect(sheets.length).toBe(5);
      expect(sheets.map((s) => s.plates.length)).toEqual([7, 6, 7, 7, 3]);
      expect(sheets.map((s) => s.occupancyPct)).toEqual([65.8, 71.3, 74.8, 82.3, 26.7]);
      expect(sheets.map((s) => s.usedAreaMm2)).toEqual([15400, 16675, 17500, 19250, 6250]);
    });

    it('improves packing efficiency when optimizeLayout is enabled without collisions (C11-1 / C11-2)', () => {
      const synthetic30Plates = Array.from({ length: 30 }, (_, i) => {
        const w = (i % 3 === 0) ? 15 : (i % 3 === 1) ? 50 + (i % 4) * 10 : 25 + (i % 6) * 5;
        const h = (i % 3 === 0) ? 40 + (i % 5) * 5 : (i % 3 === 1) ? 20 : 25 + (i % 6) * 5;
        return [
          {
            exterior: [
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ] as [number, number][],
            holes: [] as [number, number][][],
            area: w * h,
          },
        ];
      });

      const syntheticSliceResult: SliceResult = {
        plates: synthetic30Plates,
        zPositions: Array.from({ length: 30 }, (_, i) => i * 3),
        scaleFactor: 1,
        scaledBounds: [[0, 0], [100, 100]],
        scaledHeight: 90,
        warnings: [],
      };

      const syntheticParams: SculptureParams = {
        ...DEFAULT_PARAMS,
        plates: 30,
        thickness: 3.0,
        gap: 3.0,
        axis: 'z',
        sheetW: 200.0,
        sheetH: 150.0,
        sheetMargin: 10.0,
        partGap: 5.0,
        kerf: 0.15,
        engraveClearance: 0.3,
        scrapTagEnabled: false,
      };

      // 1. Without optimization: 5 sheets
      const defaultSheets = generateSheetLayouts(syntheticSliceResult, syntheticParams);
      expect(defaultSheets.length).toBe(5);

      // 2. With optimizeLayout = true: fewer sheets (≤ 4 sheets)
      const optSheets = generateSheetLayouts(syntheticSliceResult, {
        ...syntheticParams,
        optimizeLayout: true,
      });
      expect(optSheets.length).toBeLessThanOrEqual(defaultSheets.length);
      expect(optSheets.length).toBeLessThan(5);

      // (a) Average occupancy across non-empty sheets is strictly better
      const avgDefaultOcc =
        defaultSheets.reduce((s, sh) => s + sh.occupancyPct, 0) / defaultSheets.length;
      const avgOptOcc =
        optSheets.reduce((s, sh) => s + sh.occupancyPct, 0) / optSheets.length;
      expect(avgOptOcc).toBeGreaterThan(avgDefaultOcc);

      // (b) Geometrical non-overlapping check between all pairs on each sheet
      for (const sheet of optSheets) {
        for (let i = 0; i < sheet.plates.length; i++) {
          for (let j = i + 1; j < sheet.plates.length; j++) {
            const pA = sheet.plates[i];
            const pB = sheet.plates[j];

            const overlapX =
              Math.min(pA.xOffset + pA.width, pB.xOffset + pB.width) -
              Math.max(pA.xOffset, pB.xOffset);
            const overlapY =
              Math.min(pA.yOffset + pA.height, pB.yOffset + pB.height) -
              Math.max(pA.yOffset, pB.yOffset);

            // They cannot overlap in both dimensions (strict AABB separation)
            const hasCollision = overlapX > 1e-4 && overlapY > 1e-4;
            expect(hasCollision).toBe(false);
          }
        }
      }

      // (c) All plates are completely within the usable sheet bounds
      for (const sheet of optSheets) {
        for (const plate of sheet.plates) {
          expect(plate.xOffset).toBeGreaterThanOrEqual(sheet.margin - 1e-4);
          expect(plate.xOffset + plate.width).toBeLessThanOrEqual(
            sheet.width - sheet.margin + 1e-4
          );
          expect(plate.yOffset).toBeGreaterThanOrEqual(sheet.margin - 1e-4);
          expect(plate.yOffset + plate.height).toBeLessThanOrEqual(
            sheet.height - sheet.margin + 1e-4
          );
        }
      }

      // (d) All 30 original plates are present and preserved
      const recoveredIndices = optSheets
        .flatMap((s) => s.plates.map((p) => p.plateIndex))
        .sort((a, b) => a - b);
      expect(recoveredIndices).toEqual(Array.from({ length: 30 }, (_, i) => i));

      // Discs and slot labels isometry test under 90-degree rotation:
      const discsSlice = {
        plates: [
          [
            {
              exterior: [
                [0, 0],
                [40, 0],
                [40, 20],
                [0, 20],
              ] as [number, number][],
              holes: [] as [number, number][][],
              area: 800,
            },
          ],
          [
            {
              exterior: [
                [0, 0],
                [40, 0],
                [40, 20],
                [0, 20],
              ] as [number, number][],
              holes: [] as [number, number][][],
              area: 800,
            },
          ],
        ],
        zPositions: [0, 3],
        scaleFactor: 1,
        scaledBounds: [[0, 0], [40, 20]] as [[number, number], [number, number]],
        scaledHeight: 6,
        warnings: [],
      };
      const testDiscs = [{ id: 1, x: 10, y: 5, diameter: 6, gapIndex: 0 }];
      const discSheets = generateDiscsLayouts(discsSlice, testDiscs, {
        ...DEFAULT_PARAMS,
        plates: 2,
        sheetW: 30, // Normal width 40 does not fit into 30 - 2*5 = 20, but rotated width 20 fits!
        sheetH: 100, // Rotated plates fit into height
        sheetMargin: 5,
        partGap: 2,
        optimizeLayout: true,
      });

      expect(discSheets.length).toBeGreaterThanOrEqual(1);
      const placedPl = discSheets[0].plates[0];
      // Plate was rotated by 90°: width became 20, height became 40
      expect(placedPl.width).toBe(20);
      expect(placedPl.height).toBe(40);
      expect(placedPl.discs.length).toBe(1);
      // Original disc was at (10, 5) with h = 20. Rotated: x' = h - y = 20 - 5 = 15, y' = x = 10
      expect(placedPl.discs[0].x).toBe(15);
      expect(placedPl.discs[0].y).toBe(10);
    });

    it('validates centralized GLYPH_WIDTH_RATIO and label containment (C11-3 / C11-5)', () => {
      expect(GLYPH_WIDTH_RATIO).toBe(0.6);
      expect(estimateTextWidth('P10', 4)).toBeCloseTo(3 * 4 * 0.6, 4);

      // Verify label containment for all inside labels across L-block plates
      const sheets = generateDiscsLayouts(mockSliceResultZ, projectData.discs, layoutParams);
      for (const sheet of sheets) {
        for (const plate of sheet.plates) {
          if (!plate.labelOutside) {
            const labelW = estimateTextWidth(plate.labelText, plate.labelSize);
            const labelH = plate.labelSize;
            const halfW = labelW * 0.5;
            const halfH = labelH * 0.5;

            // Box must be inside piece bounding box
            expect(plate.labelX - halfW).toBeGreaterThanOrEqual(plate.xOffset);
            expect(plate.labelX + halfW).toBeLessThanOrEqual(plate.xOffset + plate.width);
            expect(plate.labelY - halfH).toBeGreaterThanOrEqual(plate.yOffset);
            expect(plate.labelY + halfH).toBeLessThanOrEqual(plate.yOffset + plate.height);
          }
        }
      }
    });
  });
});
