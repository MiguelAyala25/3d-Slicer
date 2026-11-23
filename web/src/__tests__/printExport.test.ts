// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import DxfParser from 'dxf-parser';
import { affineApply } from '../core/affine2d';
import { generateSheetDxf } from '../core/dxfExporter';
import { projectDecals } from '../core/imageProjection';
import { generateSheetLayouts } from '../core/layout';
import { DEFAULT_PARAMS } from '../core/params';
import {
  buildPrintSheets,
  computeRegistrationMarks,
} from '../core/printLayout';
import { generatePrintSheetSvg } from '../core/printSvgExporter';
import { generateSheetSvg } from '../core/svgExporter';
import { computeRasterPixelDims, injectPngDpi } from '../export/printRaster';
import type { ImageDecal, SliceResult } from '../types/sculpture';

// Minimal valid 1x1 PNG bytes (89 50 4E 47 ... + IHDR + IDAT + IEND)
const MINIMAL_1X1_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180,
  0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

function readPhysDpiFromPng(png: Uint8Array): { ppmX: number; ppmY: number; unit: number } | null {
  let offset = 8;
  while (offset + 12 <= png.length) {
    const len =
      ((png[offset] << 24) |
        (png[offset + 1] << 16) |
        (png[offset + 2] << 8) |
        png[offset + 3]) >>>
      0;
    const type = String.fromCharCode(
      png[offset + 4],
      png[offset + 5],
      png[offset + 6],
      png[offset + 7]
    );
    if (type === 'pHYs' && len === 9) {
      const dataOff = offset + 8;
      const ppmX =
        ((png[dataOff] << 24) |
          (png[dataOff + 1] << 16) |
          (png[dataOff + 2] << 8) |
          png[dataOff + 3]) >>>
        0;
      const ppmY =
        ((png[dataOff + 4] << 24) |
          (png[dataOff + 5] << 16) |
          (png[dataOff + 6] << 8) |
          png[dataOff + 7]) >>>
        0;
      const unit = png[dataOff + 8];
      return { ppmX, ppmY, unit };
    }
    offset += 12 + len;
  }
  return null;
}

describe('print export pipeline (printLayout, printSvgExporter, DXF REGISTRO, PNG pHYs)', () => {
  const simpleSlice: SliceResult = {
    plates: [
      [
        {
          exterior: [
            [-20, -10],
            [20, -10],
            [20, 10],
            [-20, 10],
          ],
          holes: [],
          area: 800,
        },
      ],
    ],
    zPositions: [0],
    scaleFactor: 1,
    scaledBounds: [[-20, -10], [20, 10]],
    scaledHeight: 3,
    warnings: [],
  };

  const decal: ImageDecal = {
    id: 'd1',
    name: 'test.png',
    imageKey: 'img-1',
    pxW: 400,
    pxH: 200,
    centerX: 0,
    centerZ: 0,
    widthMm: 40,
    heightMm: 20,
    rotationDeg: 0,
    mode: 'plane',
    plateIndex: 0,
    order: 1,
    visible: true,
  };

  it('builds registered PrintSheet & Print SVG aligned 1:1 with DXF cut layer and REGISTRO marks', () => {
    const sheets = generateSheetLayouts(simpleSlice, {
      ...DEFAULT_PARAMS,
      axis: 'y',
      plates: 2,
      sheetW: 200,
      sheetH: 100,
      sheetMargin: 10,
    });
    const regions = projectDecals(simpleSlice, [decal], { bleedMm: 1.0 });
    const printSheets = buildPrintSheets(sheets, regions, {
      mirrorHorizontal: false,
      includeRegistrationMarks: true,
      includePrintedLabels: true,
    });

    expect(printSheets).toHaveLength(1);
    const ps = printSheets[0];
    expect(ps.registrationMarks).toHaveLength(4);
    expect(ps.regions).toHaveLength(1);
    expect(ps.labels).toHaveLength(1);

    // Check top-left pixel (0, 0) in print sheet maps to sheet coordinates (10, 10)
    // Wait: slice (-20, -10) shifts by (-minX=+20, -minY=+10) + offset (10, 10) -> (10, 10)
    const tlSheet = affineApply(ps.regions[0].imageToSheet, [0, 0]);
    expect(tlSheet[0]).toBeCloseTo(10, 4);
    expect(tlSheet[1]).toBeCloseTo(10, 4);

    const dataUrls = { 'img-1': 'data:image/png;base64,AAAA' };
    const printSvg = generatePrintSheetSvg(ps, dataUrls, {
      cutOverlaySheet: sheets[0],
    });
    expect(printSvg).toContain('width="200mm" height="100mm"');
    expect(printSvg).toContain('<clipPath id="print-clip-0-0" clipPathUnits="userSpaceOnUse">');
    expect(printSvg).toContain('transform="matrix(');
    expect(printSvg).toContain('<g id="etiquetas-impresas">');
    expect(printSvg).toContain('<g id="registro">');
    expect(printSvg).toContain('<g id="corte-guia">');

    // DXF with REGISTRO + omitted engraved plate label
    const dxfStr = generateSheetDxf(sheets[0], {
      includeRegistrationMarks: true,
      omitEngravedPlateLabels: true,
    });
    const parsedDxf = new DxfParser().parseSync(dxfStr);
    expect(parsedDxf).not.toBeNull();
    const regEntities = (parsedDxf?.entities ?? []).filter(
      (e: { layer?: string }) => e.layer === 'REGISTRO'
    );
    expect(regEntities.length).toBeGreaterThanOrEqual(12); // 4*(2 lines + 1 circle) + origin ring + 0,0 text

    const grabadoTexts = (parsedDxf?.entities ?? []).filter(
      (e: { layer?: string; type?: string }) =>
        e.layer === 'GRABADO' && e.type === 'TEXT'
    ) as Array<{ text?: string }>;
    expect(grabadoTexts.some((t) => t.text === 'P0')).toBe(false);

    // SVG cut with REGISTRO
    const cutSvg = generateSheetSvg(sheets[0], {
      includeReference: true,
      includeRegistrationMarks: true,
    });
    expect(cutSvg).toContain('<g id="registro">');
    expect(cutSvg).toContain('#00AA00');
  });

  it('mirrors both cut DXF and print sheet horizontally when mirrorHorizontal is true', () => {
    const sheets = generateSheetLayouts(simpleSlice, {
      ...DEFAULT_PARAMS,
      axis: 'y',
      plates: 2,
      sheetW: 200,
      sheetH: 100,
      sheetMargin: 10,
    });
    const regions = projectDecals(simpleSlice, [decal], { bleedMm: 0 });
    const printSheets = buildPrintSheets(sheets, regions, {
      mirrorHorizontal: true,
      includeRegistrationMarks: true,
    });

    // Normal plate was at x=[10..50]. Mirrored on 200mm sheet -> x=[150..190].
    const tlMirrored = affineApply(printSheets[0].regions[0].imageToSheet, [0, 0]);
    expect(tlMirrored[0]).toBeCloseTo(190, 4);

    const marks = computeRegistrationMarks(200, 100, 10, true);
    expect(marks.find((m) => m.id === 'BR')?.isOrigin).toBe(true);
    expect(marks.find((m) => m.id === 'BL')?.isOrigin).toBe(false);

    const dxfMirrored = generateSheetDxf(sheets[0], {
      mirrorHorizontal: true,
      includeRegistrationMarks: true,
    });
    const parsedDxf = new DxfParser().parseSync(dxfMirrored);
    const poly = (parsedDxf?.entities ?? []).find(
      (e: { type?: string; layer?: string }) =>
        e.type === 'LWPOLYLINE' && e.layer === 'CORTE'
    ) as unknown as { vertices: Array<{ x: number; y: number }> };
    const xs = poly.vertices.map((v) => v.x);
    expect(Math.min(...xs)).toBeCloseTo(150, 3);
    expect(Math.max(...xs)).toBeCloseTo(190, 3);
  });

  it('injects exact pHYs DPI metadata into PNG without duplicates and enforces 16384 px raster guard', () => {
    const png300 = injectPngDpi(MINIMAL_1X1_PNG, 300);
    const phys = readPhysDpiFromPng(png300);
    expect(phys).not.toBeNull();
    expect(phys!.unit).toBe(1);
    expect(phys!.ppmX).toBe(Math.round(300 / 0.0254));
    expect(phys!.ppmY).toBe(Math.round(300 / 0.0254));

    // Re-injecting 600 DPI replaces existing pHYs instead of duplicating
    const png600 = injectPngDpi(png300, 600);
    const phys600 = readPhysDpiFromPng(png600);
    expect(phys600!.ppmX).toBe(Math.round(600 / 0.0254));

    const safeDims = computeRasterPixelDims(600, 400, 300);
    expect(safeDims.exceedsMax).toBe(false);
    expect(safeDims.pxW).toBe(Math.round((600 * 300) / 25.4));

    const hugeDims = computeRasterPixelDims(2000, 1500, 600);
    expect(hugeDims.exceedsMax).toBe(true);
    expect(hugeDims.maxSafeDpi).toBeLessThan(600);
  });
});
