import { describe, it, expect } from 'vitest';
import {
  computeTilingPlan,
  generateTileMapSvg,
  PAPER_PRESETS,
} from '../core/printTiling';
import { DEFAULT_PARAMS } from '../core/params';
import { generateSheetLayouts } from '../core/layout';
import { ValidationError } from '../core/validator';
import type { PrintTilingConfig, SliceResult } from '../types/sculpture';

describe('printTiling (adhesive film tiling)', () => {
  const baseTiling: PrintTilingConfig = {
    enabled: true,
    preset: 'letter',
    customW: 215.9,
    customH: 279.4,
    orientation: 'auto',
    overlapMm: 10,
    printerMarginMm: 3,
  };

  it('auto orientation picks optimal grid covering full sheet with exact overlap', () => {
    // 600x400 sheet on Letter (215.9x279.4, margin 3 -> printable 209.9x273.4 portrait or 273.4x209.9 landscape)
    // Portrait: cols = 1 + ceil((600 - 209.9)/(209.9-10)) = 3, rows = 1 + ceil((400 - 273.4)/(273.4-10)) = 2 -> 6 tiles
    // Landscape: cols = 1 + ceil((600 - 273.4)/(273.4-10)) = 3, rows = 1 + ceil((400 - 209.9)/(209.9-10)) = 2 -> 6 tiles
    const plan = computeTilingPlan(0, 600, 400, baseTiling);
    expect(plan.cols).toBe(3);
    expect(plan.rows).toBe(2);
    expect(plan.tiles).toHaveLength(6);

    // Adjacent columns overlap by exactly 10 mm
    const t0 = plan.tiles[0];
    const t1 = plan.tiles[1];
    expect(t0.sheetMaxX - t1.sheetMinX).toBeCloseTo(10, 4);

    // Adjacent rows overlap by exactly 10 mm
    const r0 = plan.tiles[0];
    const r1 = plan.tiles[plan.cols];
    expect(r1.sheetMaxY - r0.sheetMinY).toBeCloseTo(10, 4);

    // Labels and 4 corner marks
    expect(t0.label).toBe('H1 · F1C1');
    expect(t0.marks).toHaveLength(4);
    expect(Math.hypot(t0.originDirX, t0.originDirY)).toBeCloseTo(1, 3);
  });

  it('auto orientation prefers fewer sheets on rectangular sheets', () => {
    // 500x260 sheet on A4 (210x297, margin 5 -> printable 200x287 portrait vs 287x200 landscape)
    // Portrait fits height 260 in 1 row! cols = 3 -> 3 tiles.
    // Landscape needs rows = 2, cols = 2 -> 4 tiles.
    const plan = computeTilingPlan(1, 500, 260, {
      ...baseTiling,
      preset: 'a4',
      printerMarginMm: 5,
    });
    expect(plan.orientationUsed).toBe('portrait');
    expect(plan.rows).toBe(1);
    expect(plan.cols).toBe(3);
    expect(plan.tiles).toHaveLength(3);
    expect(PAPER_PRESETS.a4.widthMm).toBe(210);
  });

  it('throws ValidationError PRINT_TILE_PAPER_TOO_SMALL when custom paper cannot fit step', () => {
    expect(() =>
      computeTilingPlan(0, 600, 400, {
        ...baseTiling,
        preset: 'custom',
        customW: 25,
        customH: 25,
        printerMarginMm: 8,
        overlapMm: 5,
      })
    ).toThrow(ValidationError);
  });

  it('generates tile map SVG with all tile identifiers', () => {
    const slice: SliceResult = {
      plates: [
        [
          {
            exterior: [
              [0, 0],
              [100, 0],
              [100, 80],
              [0, 80],
            ],
            holes: [],
            area: 8000,
          },
        ],
      ],
      zPositions: [0],
      scaleFactor: 1,
      scaledBounds: [[0, 0], [100, 80]],
      scaledHeight: 3,
      warnings: [],
    };
    const sheets = generateSheetLayouts(slice, {
      ...DEFAULT_PARAMS,
      plates: 2,
      sheetW: 600,
      sheetH: 400,
    });
    const plan = computeTilingPlan(0, 600, 400, baseTiling);
    const svg = generateTileMapSvg(sheets[0], plan);
    expect(svg).toContain('F1C1');
    expect(svg).toContain('F2C3');
    expect(svg).toContain('width="600mm" height="400mm"');
  });
});
