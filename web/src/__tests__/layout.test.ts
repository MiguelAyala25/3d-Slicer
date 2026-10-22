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
});
