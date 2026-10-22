import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { sliceMesh } from '../core/slicer';
import { generateDiscsLayouts } from '../core/joints/discs/discLayout';
import { generateSheetSvg } from '../core/svgExporter';
import { generateSheetDxf, getSheetFileBaseName } from '../core/dxfExporter';
import { serializeProjectJson, parseProjectJson } from '../core/project';
import { DEFAULT_PARAMS } from '../core/params';
import type { Disc, SculptureParams, SheetLayout } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../web/fixtures');
const GOLDEN_DIR = path.resolve(__dirname, '../../../web/golden');
const BASELINE_DIR = path.resolve(__dirname, '__baseline__');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function verifyCaseSheets(caseDir: string, sheets: SheetLayout[]): void {
  const expectedLayoutJson = fs.readFileSync(path.join(caseDir, 'layout.json'), 'utf-8');
  const actualLayoutJson = JSON.stringify(sheets, null, 2);
  expect(normalizeLf(actualLayoutJson)).toBe(normalizeLf(expectedLayoutJson));

  for (const sheet of sheets) {
    const baseName = getSheetFileBaseName(sheet);
    const expectedSvg = fs.readFileSync(path.join(caseDir, `${baseName}.svg`), 'utf-8');
    const expectedDxf = fs.readFileSync(path.join(caseDir, `${baseName}.dxf`), 'utf-8');

    const actualSvg = generateSheetSvg(sheet, { includeReference: true });
    const actualDxf = generateSheetDxf(sheet);

    expect(normalizeLf(actualSvg)).toBe(normalizeLf(expectedSvg));
    expect(normalizeLf(actualDxf)).toBe(normalizeLf(expectedDxf));
  }
}

describe('Baseline 8.0 Outputs (deterministic byte-for-byte snapshots)', () => {
  const lBlockBuf = fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj'));
  const lBlockMesh = loadMeshFromBuffer(toArrayBuffer(lBlockBuf), 'test_l_block.obj');
  const lBlockPositions = lBlockMesh.geometry.getAttribute('position').array as Float32Array;

  const handBuf = fs.readFileSync(path.join(FIXTURES_DIR, 'Hand.OBJ'));
  const handMesh = loadMeshFromBuffer(toArrayBuffer(handBuf), 'Hand.OBJ');
  const handPositions = handMesh.geometry.getAttribute('position').array as Float32Array;

  const goldenProject = JSON.parse(
    fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_project.json'), 'utf-8')
  );
  const projectData = parseProjectJson(JSON.stringify(goldenProject));
  const case1Discs: Disc[] = projectData.discs;

  const case1Params: SculptureParams = {
    ...DEFAULT_PARAMS,
    axis: 'z',
    plates: 5,
    thickness: 3.0,
    gap: 2.0,
    scrapTagEnabled: true,
  };

  it('Case 1: Plates sheet + separate discs sheet (g != t), scrapTag ON', () => {
    const slice = sliceMesh(lBlockPositions, case1Params);
    const sheets = generateDiscsLayouts(slice, case1Discs, case1Params);
    expect(sheets.length).toBe(2);
    expect(sheets[0].sheetType).toBe('plates');
    expect(sheets[1].sheetType).toBe('discs');
    verifyCaseSheets(path.join(BASELINE_DIR, 'case1'), sheets);
  });

  it('Case 2: Same scenario with scrapTag OFF', () => {
    const case2Params: SculptureParams = {
      ...case1Params,
      scrapTagEnabled: false,
    };
    const slice = sliceMesh(lBlockPositions, case2Params);
    const sheets = generateDiscsLayouts(slice, case1Discs, case2Params);
    expect(sheets.length).toBe(2);
    expect(sheets[0].scrapTags.length).toBe(0);
    expect(sheets[1].scrapTags.length).toBe(0);
    verifyCaseSheets(path.join(BASELINE_DIR, 'case2'), sheets);
  });

  it('Case 3: Asymmetric Y axis with separate discs sheet', () => {
    const case3Params: SculptureParams = {
      ...DEFAULT_PARAMS,
      axis: 'y',
      plates: 5,
      thickness: 3.0,
      gap: 2.0,
      scrapTagEnabled: true,
    };
    const slice = sliceMesh(lBlockPositions, case3Params);
    const sheets = generateDiscsLayouts(slice, case1Discs, case3Params);
    expect(sheets.length).toBe(2);
    verifyCaseSheets(path.join(BASELINE_DIR, 'case3'), sheets);
  });

  it('Case 4: Multiple plate sheets + discs on same material sheet (g === t)', () => {
    const case4Params: SculptureParams = {
      ...DEFAULT_PARAMS,
      axis: 'z',
      plates: 12,
      thickness: 3.0,
      gap: 3.0,
      sheetW: 120.0,
      sheetH: 90.0,
      sheetMargin: 10.0,
      partGap: 5.0,
    };
    const case4Discs: Disc[] = [
      { id: 1, gapIndex: 0, x: -7.5, y: 0, diameter: 6 },
      { id: 2, gapIndex: 1, x: -7.5, y: 0, diameter: 6 },
    ];
    const slice = sliceMesh(lBlockPositions, case4Params);
    const sheets = generateDiscsLayouts(slice, case4Discs, case4Params);
    expect(sheets.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < sheets.length; i++) {
      expect(sheets[i].sheetType).toBe('plates');
    }
    verifyCaseSheets(path.join(BASELINE_DIR, 'case4'), sheets);
  });

  it('Case 5: Organic model without discs (Hand.OBJ, DEFAULT_PARAMS)', () => {
    const case5Params: SculptureParams = {
      ...DEFAULT_PARAMS,
    };
    const slice = sliceMesh(handPositions, case5Params);
    const sheets = generateDiscsLayouts(slice, [], case5Params);
    verifyCaseSheets(path.join(BASELINE_DIR, 'case5'), sheets);
  });

  it('Case 6: JSON project 1.0 serialization output for Case 1', () => {
    const expectedProject = fs.readFileSync(path.join(BASELINE_DIR, 'case6', 'project.json'), 'utf-8');
    const actualProject = serializeProjectJson(case1Params, case1Discs);
    expect(normalizeLf(actualProject)).toBe(normalizeLf(expectedProject));
  });
});
