import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import DxfParser from 'dxf-parser';
import { generateSheetSvg } from '../core/svgExporter';
import { generateSheetDxf, exportAllSheetsZip } from '../core/dxfExporter';
import { generateDiscsLayouts } from '../core/joints/discs/discLayout';
import { sliceMesh } from '../core/slicer';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { DEFAULT_PARAMS } from '../core/params';
import type { Disc, SculptureParams } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../web/fixtures');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('exporters (SVG & DXF AC1015)', () => {
  const objBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj')));
  const mesh = loadMeshFromBuffer(objBuf, 'test_l_block.obj');
  const positions = mesh.geometry.getAttribute('position').array as Float32Array;

  const testParams: SculptureParams = {
    ...DEFAULT_PARAMS,
    plates: 5,
    thickness: 3.0,
    gap: 2.0,
    axis: 'y', // Asymmetric L-shape plates
    sheetW: 600.0,
    sheetH: 400.0,
    sheetMargin: 10.0,
    partGap: 5.0,
    kerf: 0.15,
    engraveClearance: 0.3,
  };

  const sliceResult = sliceMesh(positions, testParams);
  const testDiscs: Disc[] = [
    { id: 1, gapIndex: 0, x: -7.5, y: 0.0, diameter: 6.0 },
    { id: 2, gapIndex: 1, x: -7.5, y: 0.0, diameter: 6.0 },
  ];

  const sheets = generateDiscsLayouts(sliceResult, testDiscs, testParams);
  const sheet0 = sheets[0];

  it('chirality and CAD frame matching between SVG and DXF (Corrections #6 & A1)', () => {
    const svgStr = generateSheetSvg(sheet0, { includeReference: true });
    const dxfStr = generateSheetDxf(sheet0);

    // 1. Check SVG structure and IDs
    expect(svgStr).toContain('<g id="cad-frame"');
    expect(svgStr).toContain(`transform="translate(0, ${sheet0.height}) scale(1, -1)"`);
    expect(svgStr).toContain('<g id="corte">');
    expect(svgStr).toContain('<g id="grabado">');
    expect(svgStr).toContain('<g id="referencia">');

    // 2. Parse DXF with dxf-parser
    const parser = new DxfParser();
    const parsedDxf = parser.parseSync(dxfStr);
    expect(parsedDxf).not.toBeNull();

    // Check header variables for mm units (AC1015)
    expect(parsedDxf?.header?.$ACADVER).toBe('AC1015');
    expect(parsedDxf?.header?.$INSUNITS).toBe(4); // 4 = mm
    expect(parsedDxf?.header?.$MEASUREMENT).toBe(1); // 1 = metric

    // Find first polyline in CORTE layer
    const cortePolylines = (parsedDxf?.entities ?? []).filter(
      (e: any) => e.type === 'LWPOLYLINE' && e.layer === 'CORTE'
    );
    expect(cortePolylines.length).toBeGreaterThan(0);

    const firstPoly = cortePolylines[0] as any;
    const dxfVerts = firstPoly.vertices;
    expect(dxfVerts.length).toBeGreaterThanOrEqual(4);

    // 3. Parse SVG DOM and extract first path in #corte
    const parserDom = new DOMParser();
    const doc = parserDom.parseFromString(svgStr, 'image/svg+xml');
    const corteGroup = doc.getElementById('corte');
    expect(corteGroup).not.toBeNull();
    const firstPath = corteGroup?.querySelector('path');
    expect(firstPath).not.toBeNull();

    const dAttr = firstPath?.getAttribute('d') ?? '';
    // Extract M and L coordinates: M x y L x y ...
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
  });

  it('exports solid CIRCLE vs dashed ARC with engraveClearance (Correction #2)', () => {
    // Plate 1 has disc id 2 (gapIndex 1 === plate 1 -> solid) and disc id 1 (gapIndex 0 === plate 1 - 1 -> dashed)
    const dxfStr = generateSheetDxf(sheet0);
    const parser = new DxfParser();
    const parsedDxf = parser.parseSync(dxfStr);
    expect(parsedDxf).not.toBeNull();

    const grabadoCircles = (parsedDxf?.entities ?? []).filter(
      (e: any) => e.type === 'CIRCLE' && e.layer === 'GRABADO'
    );
    const grabadoArcs = (parsedDxf?.entities ?? []).filter(
      (e: any) => e.type === 'ARC' && e.layer === 'GRABADO'
    );

    // Expect at least 1 solid circle and multiple dashed arcs
    expect(grabadoCircles.length).toBeGreaterThanOrEqual(1);
    expect(grabadoArcs.length).toBeGreaterThanOrEqual(4);

    // Radius should be (diameter + engraveClearance) / 2 = (6.0 + 0.3) / 2 = 3.15
    const expectedRadius = (6.0 + 0.3) * 0.5;
    expect((grabadoCircles[0] as any).radius).toBeCloseTo(expectedRadius, 2);
    expect((grabadoArcs[0] as any).radius).toBeCloseTo(expectedRadius, 2);

    // Check SVG has solid and dashed circles
    const svgStr = generateSheetSvg(sheet0);
    const doc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
    const grabadoGroup = doc.getElementById('grabado');
    const circles = Array.from(grabadoGroup?.querySelectorAll('circle') ?? []);

    const solidSvg = circles.find((c) => !c.hasAttribute('stroke-dasharray'));
    const dashedSvg = circles.find((c) => c.hasAttribute('stroke-dasharray'));

    expect(solidSvg).toBeDefined();
    expect(dashedSvg).toBeDefined();
    expect(Number.parseFloat(solidSvg?.getAttribute('r') ?? '0')).toBeCloseTo(expectedRadius, 2);
    expect(Number.parseFloat(dashedSvg?.getAttribute('r') ?? '0')).toBeCloseTo(expectedRadius, 2);
  });

  it('exports all sheets into a valid ZIP blob', async () => {
    const zipBlob = await exportAllSheetsZip(sheets);
    expect(zipBlob).toBeDefined();
    expect(zipBlob.size).toBeGreaterThan(0);
    expect(zipBlob.type).toContain('zip');
  });
});
