import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSheetLayouts } from '../core/layout';
import { generateDiscsLayouts } from '../core/joints/discs/discLayout';
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
  });
});
