import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import DxfParser from 'dxf-parser';
import { generateWaffleSheetLayouts } from '../core/layout';
import { generateSheetSvg } from '../core/svgExporter';
import { generateSheetDxf } from '../core/dxfExporter';
import { sliceWaffleMesh } from '../core/waffle/waffleSlicer';
import {
  computeCalibrationClearances,
  generateSlotCalibrationSheet,
} from '../core/waffle/calibrationSheet';
import { createBoxPositions } from './helpers/waffleFixtures';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { DEFAULT_PARAMS } from '../core/params';
import { ValidationError } from '../core/validator';
import type { CoreParams } from '../types/sculpture';
import type { WaffleParams } from '../core/waffle/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../web/fixtures');

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; i++) {
    view[i] = buf[i];
  }
  return ab;
}

describe('Waffle Exporter & Layout (Phase 9.3)', () => {
  const coreParams: CoreParams = {
    ...DEFAULT_PARAMS,
    thickness: 3.0,
    kerf: 0.15,
    sheetW: 600.0,
    sheetH: 400.0,
    sheetMargin: 10.0,
    partGap: 5.0,
    scrapTagEnabled: true,
  };

  const waffleParams: WaffleParams = {
    upAxis: 'z',
    pitch: 15.0,
    slotClearance: 0.1,
    gridOffset: 0.0,
    slotLabelsEnabled: true,
    targetScale: 1.0,
  };

  it('generates sheet layouts for waffle with deterministic order and zero discs', () => {
    const rawPositions = createBoxPositions(40, 40, 40);
    const waffleResult = sliceWaffleMesh(rawPositions, coreParams, waffleParams);

    expect(waffleResult.p1Sections.length).toBeGreaterThan(0);
    expect(waffleResult.p2Sections.length).toBeGreaterThan(0);

    const sheets = generateWaffleSheetLayouts(waffleResult, coreParams);
    expect(sheets.length).toBeGreaterThan(0);

    const sheet0 = sheets[0];
    expect(sheet0.sheetType).toBe('plates');
    expect(sheet0.discs).toEqual([]);
    expect(sheet0.discGroups).toEqual([]);

    // Check plates ordering: P1 pieces ('X...') before P2 pieces ('Y...')
    const labels = sheet0.plates.map((p) => p.labelText);
    const firstYIndex = labels.findIndex((l) => l.startsWith('Y'));
    if (firstYIndex !== -1) {
      for (let i = 0; i < firstYIndex; i++) {
        expect(labels[i].startsWith('X')).toBe(true);
      }
      for (let i = firstYIndex; i < labels.length; i++) {
        expect(labels[i].startsWith('Y')).toBe(true);
      }
    }
  });

  it('throws ValidationError with suggested dimension if a piece exceeds usable sheet area', () => {
    const rawPositions = createBoxPositions(200, 200, 200);
    const waffleResult = sliceWaffleMesh(rawPositions, coreParams, waffleParams);

    const smallSheetParams: CoreParams = {
      ...coreParams,
      sheetW: 100,
      sheetH: 100,
      sheetMargin: 10, // usable 80 x 80 mm
    };

    expect(() => generateWaffleSheetLayouts(waffleResult, smallSheetParams)).toThrow(
      ValidationError
    );
    expect(() => generateWaffleSheetLayouts(waffleResult, smallSheetParams)).toThrow(
      /excede el área útil de la hoja/
    );
    expect(() => generateWaffleSheetLayouts(waffleResult, smallSheetParams)).toThrow(
      /Ajusta el tamaño de la hoja o reduce la escala del modelo/
    );
  });

  it('exports SVG without any circles/arcs and with exact drawn slot width w = t + c - kerf (DoD-4)', () => {
    const rawPositions = createBoxPositions(40, 40, 40);
    const waffleResult = sliceWaffleMesh(rawPositions, coreParams, waffleParams);
    const sheets = generateWaffleSheetLayouts(waffleResult, coreParams);
    expect(sheets.length).toBeGreaterThan(0);

    const svgStr = generateSheetSvg(sheets[0]);

    // Zero circles in SVG
    expect(svgStr).not.toContain('<circle');

    // Parse SVG DOM
    const parserDom = new DOMParser();
    const doc = parserDom.parseFromString(svgStr, 'image/svg+xml');

    const corteGroup = doc.getElementById('corte');
    expect(corteGroup).not.toBeNull();
    const paths = corteGroup?.querySelectorAll('path') ?? [];
    expect(paths.length).toBe(sheets[0].plates.length);

    // Grabado group contains texts for labels and slotLabels
    const grabadoGroup = doc.getElementById('grabado');
    expect(grabadoGroup).not.toBeNull();
    const textEls = grabadoGroup?.querySelectorAll('text') ?? [];
    expect(textEls.length).toBeGreaterThan(0);

    // Verify drawn slot width: w = t + c - kerf = 3.0 + 0.1 - 0.15 = 2.95 mm
    const expectedDrawnWidth = coreParams.thickness + waffleParams.slotClearance - coreParams.kerf;
    expect(waffleResult.drawnSlotWidth).toBeCloseTo(expectedDrawnWidth, 3);

    // Check presence of piece ID texts and slot partner texts
    const textContents = Array.from(textEls).map((el) => el.textContent);
    expect(textContents.some((t) => t?.startsWith('X'))).toBe(true);
    expect(textContents.some((t) => t?.startsWith('Y'))).toBe(true);
  });

  it('exports DXF with zero CIRCLE or ARC entities and matching LWPOLYLINE geometry (DoD-1, DoD-4)', () => {
    const rawPositions = createBoxPositions(40, 40, 40);
    const waffleResult = sliceWaffleMesh(rawPositions, coreParams, waffleParams);
    const sheets = generateWaffleSheetLayouts(waffleResult, coreParams);
    const dxfStr = generateSheetDxf(sheets[0]);

    const parser = new DxfParser();
    const parsedDxf = parser.parseSync(dxfStr);
    expect(parsedDxf).not.toBeNull();

    // Verify AC1015 metric units
    expect(parsedDxf?.header?.$ACADVER).toBe('AC1015');
    expect(parsedDxf?.header?.$INSUNITS).toBe(4); // mm
    expect(parsedDxf?.header?.$MEASUREMENT).toBe(1); // metric

    const entities = parsedDxf?.entities ?? [];

    // Zero CIRCLE or ARC entities in Waffle DXF
    const circleEntities = entities.filter((e: any) => e.type === 'CIRCLE');
    const arcEntities = entities.filter((e: any) => e.type === 'ARC');
    expect(circleEntities.length).toBe(0);
    expect(arcEntities.length).toBe(0);

    // Check CORTE layer contains LWPOLYLINE
    const cortePolylines = entities.filter(
      (e: any) => e.type === 'LWPOLYLINE' && e.layer === 'CORTE'
    );
    expect(cortePolylines.length).toBe(sheets[0].plates.length);

    // Check GRABADO layer contains TEXT entities
    const grabadoTexts = entities.filter(
      (e: any) => e.type === 'TEXT' && e.layer === 'GRABADO'
    );
    expect(grabadoTexts.length).toBeGreaterThan(0);
  });

  it('preserves identical chirality of L-block fixture in SVG and DXF (DoD-3)', () => {
    const objBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj')));
    const mesh = loadMeshFromBuffer(objBuf, 'test_l_block.obj');
    const lBlockPositions = mesh.geometry.getAttribute('position').array as Float32Array;

    const waffleResult = sliceWaffleMesh(lBlockPositions, coreParams, {
      ...waffleParams,
      pitch: 8.0,
    });
    const sheets = generateWaffleSheetLayouts(waffleResult, coreParams);
    const sheet0 = sheets[0];

    const svgStr = generateSheetSvg(sheet0);
    const dxfStr = generateSheetDxf(sheet0);

    const parser = new DxfParser();
    const parsedDxf = parser.parseSync(dxfStr);
    const cortePolylines = (parsedDxf?.entities ?? []).filter(
      (e: any) => e.type === 'LWPOLYLINE' && e.layer === 'CORTE'
    );
    expect(cortePolylines.length).toBeGreaterThan(0);

    const parserDom = new DOMParser();
    const doc = parserDom.parseFromString(svgStr, 'image/svg+xml');
    const corteGroup = doc.getElementById('corte');
    const paths = corteGroup?.querySelectorAll('path') ?? [];
    expect(paths.length).toBe(cortePolylines.length);

    // For each plate, verify SVG path vertices and DXF polyline vertices match 1:1
    for (let pIdx = 0; pIdx < cortePolylines.length; pIdx++) {
      const dxfVerts = (cortePolylines[pIdx] as any).vertices;
      const dAttr = paths[pIdx].getAttribute('d') ?? '';
      const commands = dAttr.match(/[ML]\s+([-\d.]+)\s+([-\d.]+)/g) ?? [];
      expect(commands.length).toBe(dxfVerts.length);

      for (let i = 0; i < commands.length; i++) {
        const match = commands[i].match(/[ML]\s+([-\d.]+)\s+([-\d.]+)/);
        expect(match).not.toBeNull();
        const svgX = Number.parseFloat(match![1]);
        const svgY = Number.parseFloat(match![2]);

        expect(svgX).toBeCloseTo(dxfVerts[i].x, 3);
        expect(svgY).toBeCloseTo(dxfVerts[i].y, 3);
      }
    }
  });

  it('guarantees bit-for-bit idempotence on consecutive exports', () => {
    const rawPositions = createBoxPositions(40, 40, 40);
    const waffleResult = sliceWaffleMesh(rawPositions, coreParams, waffleParams);
    const sheets = generateWaffleSheetLayouts(waffleResult, coreParams);

    const svg1 = generateSheetSvg(sheets[0]);
    const svg2 = generateSheetSvg(sheets[0]);
    expect(svg1).toBe(svg2);

    const dxf1 = generateSheetDxf(sheets[0]);
    const dxf2 = generateSheetDxf(sheets[0]);
    expect(dxf1).toBe(dxf2);
  });

  describe('Slot Calibration Comb Sheet (Phase 9.6)', () => {
    it('computes exactly 7 test clearances centered around slotClearance and clamped to >= 0', () => {
      // Centered at 0.15 -> [0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]
      const c1 = computeCalibrationClearances(0.15);
      expect(c1).toEqual([0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]);

      // Centered at 0.10 -> clamped to 0 for delta <= -0.10
      const c2 = computeCalibrationClearances(0.10);
      expect(c2).toEqual([0.00, 0.00, 0.05, 0.10, 0.15, 0.20, 0.25]);

      // Centered at 0.05 -> clamped to 0 for negative deltas
      const c3 = computeCalibrationClearances(0.05);
      expect(c3).toEqual([0.00, 0.00, 0.00, 0.05, 0.10, 0.15, 0.20]);
    });

    it('generates a compact sheet layout with 2 test combs and 7 slots each', () => {
      const calSheet = generateSlotCalibrationSheet(3.0, 0.15, 0.10);
      expect(calSheet.width).toBe(120);
      expect(calSheet.height).toBe(80);
      expect(calSheet.plates.length).toBe(2);

      const combA = calSheet.plates[0];
      const combB = calSheet.plates[1];
      expect(combA.labelText).toBe('Peine A');
      expect(combB.labelText).toBe('Peine B');
      expect(combA.width).toBe(90);
      expect(combA.height).toBe(25);

      // 7 slot labels + 1 info text = 8 labels per comb
      expect(combA.slotLabels?.length).toBe(8);
      expect(combB.slotLabels?.length).toBe(8);
    });

    it('exports calibration sheet to SVG and DXF with zero circles and accurate slot widths', () => {
      const thickness = 3.0;
      const kerf = 0.15;
      const clearance = 0.10;
      const calSheet = generateSlotCalibrationSheet(thickness, kerf, clearance);

      // SVG
      const svgStr = generateSheetSvg(calSheet);
      expect(svgStr).not.toContain('<circle');
      expect(svgStr).toContain('Peine A');
      expect(svgStr).toContain('Peine B');
      expect(svgStr).toContain('c=0.10');
      expect(svgStr).toContain('PRUEBA t=3.00 kerf=0.15');

      const parserDom = new DOMParser();
      const doc = parserDom.parseFromString(svgStr, 'image/svg+xml');
      const corteGroup = doc.getElementById('corte');
      const paths = corteGroup?.querySelectorAll('path') ?? [];
      expect(paths.length).toBe(2);

      // DXF
      const dxfStr = generateSheetDxf(calSheet);
      const parser = new DxfParser();
      const parsedDxf = parser.parseSync(dxfStr);
      expect(parsedDxf).not.toBeNull();

      const entities = parsedDxf?.entities ?? [];
      const circles = entities.filter((e: any) => e.type === 'CIRCLE' || e.type === 'ARC');
      expect(circles.length).toBe(0);

      const cortePolylines = entities.filter(
        (e: any) => e.type === 'LWPOLYLINE' && e.layer === 'CORTE'
      );
      expect(cortePolylines.length).toBe(2);

      const texts = entities.filter(
        (e: any) => e.type === 'TEXT' && e.layer === 'GRABADO'
      );
      expect(texts.length).toBeGreaterThanOrEqual(16);

      // Check center slot width on first comb:
      // clearances[3] = 0.10 -> w_3 = 3.0 + 0.10 - 0.15 = 2.95 mm
      const expectedCenterW = thickness + 0.10 - kerf; // 2.95 mm
      const firstPoly = cortePolylines[0] as any;
      const verts = firstPoly.vertices;
      // Vertices around center slot (slot k=3):
      // The comb vertices trace all 7 slots. Let's verify width of top edge notch
      // for k=3: xRight - xLeft should equal expectedCenterW
      let foundMatchingSlot = false;
      for (let i = 0; i < verts.length - 1; i++) {
        // Vertical step down, then horizontal step, then vertical step up
        if (Math.abs(verts[i].y - (combA_yBottom(calSheet))) < 0.01 &&
            Math.abs(verts[i + 1].y - (combA_yBottom(calSheet))) < 0.01) {
          const slotW = Math.abs(verts[i + 1].x - verts[i].x);
          if (Math.abs(slotW - expectedCenterW) < 0.01) {
            foundMatchingSlot = true;
            break;
          }
        }
      }
      expect(foundMatchingSlot).toBe(true);
    });
  });
});

function combA_yBottom(sheet: any): number {
  return sheet.plates[0].yOffset + 25 - 12.5; // yOffset + H - slotDepth
}
