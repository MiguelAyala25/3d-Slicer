import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import DxfParser from 'dxf-parser';
import { loadMeshFromBuffer } from '../src/core/meshLoader';
import { sliceMesh } from '../src/core/slicer';
import { generateLayouts } from '../src/core/layout';
import { generateSheetSvg } from '../src/core/svgExporter';
import { generateSheetDxf, getSheetFileBaseName } from '../src/core/dxfExporter';
import { serializeProjectJson, parseProjectJson } from '../src/core/project';
import { DEFAULT_PARAMS } from '../src/core/params';
import type { Disc, SculptureParams, SheetLayout } from '../src/types/sculpture';

if (!process.argv.includes('--confirm-regenerate')) {
  console.error(
    'Error: Acceso denegado. Para generar o regenerar la línea base debes pasar explícitamente el flag --confirm-regenerate.'
  );
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const GOLDEN_DIR = path.resolve(__dirname, '../golden');
const BASELINE_DIR = path.resolve(__dirname, '../src/__tests__/__baseline__');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function writeCaseSheets(caseDir: string, sheets: SheetLayout[]): void {
  fs.mkdirSync(caseDir, { recursive: true });
  const layoutJson = JSON.stringify(sheets, null, 2);
  fs.writeFileSync(path.join(caseDir, 'layout.json'), normalizeLf(layoutJson), 'utf-8');

  for (const sheet of sheets) {
    const baseName = getSheetFileBaseName(sheet);
    const svgStr = generateSheetSvg(sheet, { includeReference: true });
    const dxfStr = generateSheetDxf(sheet);

    fs.writeFileSync(path.join(caseDir, `${baseName}.svg`), normalizeLf(svgStr), 'utf-8');
    fs.writeFileSync(path.join(caseDir, `${baseName}.dxf`), normalizeLf(dxfStr), 'utf-8');
  }
}

// 1. Load meshes
const lBlockBuf = fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj'));
const lBlockMesh = loadMeshFromBuffer(toArrayBuffer(lBlockBuf), 'test_l_block.obj');
const lBlockPositions = lBlockMesh.geometry.getAttribute('position').array as Float32Array;

const handBuf = fs.readFileSync(path.join(FIXTURES_DIR, 'Hand.OBJ'));
const handMesh = loadMeshFromBuffer(toArrayBuffer(handBuf), 'Hand.OBJ');
const handPositions = handMesh.geometry.getAttribute('position').array as Float32Array;

// 2. Load golden project discs
const goldenProject = JSON.parse(
  fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_project.json'), 'utf-8')
);
const projectData = parseProjectJson(JSON.stringify(goldenProject));
const case1Discs: Disc[] = projectData.discs;

// Case 1
const case1Params: SculptureParams = {
  ...DEFAULT_PARAMS,
  axis: 'z',
  plates: 5,
  thickness: 3.0,
  gap: 2.0,
  scrapTagEnabled: true,
};
const case1Slice = sliceMesh(lBlockPositions, case1Params);
const case1Sheets = generateLayouts(case1Slice, case1Discs, case1Params);
writeCaseSheets(path.join(BASELINE_DIR, 'case1'), case1Sheets);

// Case 2
const case2Params: SculptureParams = {
  ...case1Params,
  scrapTagEnabled: false,
};
const case2Slice = sliceMesh(lBlockPositions, case2Params);
const case2Sheets = generateLayouts(case2Slice, case1Discs, case2Params);
writeCaseSheets(path.join(BASELINE_DIR, 'case2'), case2Sheets);

// Case 3
const case3Params: SculptureParams = {
  ...DEFAULT_PARAMS,
  axis: 'y',
  plates: 5,
  thickness: 3.0,
  gap: 2.0,
  scrapTagEnabled: true,
};
const case3Slice = sliceMesh(lBlockPositions, case3Params);
const case3Sheets = generateLayouts(case3Slice, case1Discs, case3Params);
writeCaseSheets(path.join(BASELINE_DIR, 'case3'), case3Sheets);

// Case 4
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
const case4Slice = sliceMesh(lBlockPositions, case4Params);
const case4Sheets = generateLayouts(case4Slice, case4Discs, case4Params);
writeCaseSheets(path.join(BASELINE_DIR, 'case4'), case4Sheets);

// Case 5
const case5Params: SculptureParams = {
  ...DEFAULT_PARAMS,
};
const case5Slice = sliceMesh(handPositions, case5Params);
const case5Sheets = generateLayouts(case5Slice, [], case5Params);
writeCaseSheets(path.join(BASELINE_DIR, 'case5'), case5Sheets);

// Case 6
const case6Dir = path.join(BASELINE_DIR, 'case6');
fs.mkdirSync(case6Dir, { recursive: true });
const case6Project = serializeProjectJson(case1Params, case1Discs);
fs.writeFileSync(path.join(case6Dir, 'project.json'), normalizeLf(case6Project), 'utf-8');

console.log('Baseline snapshot files successfully written.');

// 8.0-M Metrics comparison for commit documentation
function inspectDxf(dxfContent: string) {
  const parser = new DxfParser();
  const parsed = parser.parseSync(dxfContent);
  const entities = parsed?.entities ?? [];
  const cortePolys = entities.filter((e: any) => e.type === 'LWPOLYLINE' && e.layer === 'CORTE');
  const grabadoCircles = entities.filter((e: any) => e.type === 'CIRCLE' && e.layer === 'GRABADO');
  const grabadoArcs = entities.filter((e: any) => e.type === 'ARC' && e.layer === 'GRABADO');
  const corteCircles = entities.filter((e: any) => e.type === 'CIRCLE' && e.layer === 'CORTE');

  return {
    extMin: parsed?.header?.$EXTMIN,
    extMax: parsed?.header?.$EXTMAX,
    cortePolylines: cortePolys.length,
    grabadoCircles: grabadoCircles.length,
    grabadoArcs: grabadoArcs.length,
    corteCircles: corteCircles.length,
    grabadoCircleRadii: grabadoCircles.map((c: any) => Number(c.radius.toFixed(3))),
    grabadoArcRadii: [...new Set(grabadoArcs.map((a: any) => Number(a.radius.toFixed(3))))],
    corteCircleRadii: corteCircles.map((c: any) => Number(c.radius.toFixed(3))),
  };
}

console.log('\n--- 8.0-M MANUAL COMPARISON METRICS ---');

const pySheet1 = fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_hoja_1_placas_python.dxf'), 'utf-8');
const pySheet2 = fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_hoja_2_discos_python.dxf'), 'utf-8');

const tsSheet1 = fs.readFileSync(path.join(BASELINE_DIR, 'case1', 'hoja_1_placas.dxf'), 'utf-8');
const tsSheet2 = fs.readFileSync(path.join(BASELINE_DIR, 'case1', 'hoja_2_discos.dxf'), 'utf-8');

console.log('Sheet 1 (Plates) Python DXF:', inspectDxf(pySheet1));
console.log('Sheet 1 (Plates) TypeScript DXF:', inspectDxf(tsSheet1));
console.log('Sheet 2 (Discs) Python DXF:', inspectDxf(pySheet2));
console.log('Sheet 2 (Discs) TypeScript DXF:', inspectDxf(tsSheet2));
