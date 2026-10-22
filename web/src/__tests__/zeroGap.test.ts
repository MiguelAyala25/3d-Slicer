import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import DxfParser from 'dxf-parser';
import { validateBuildParams } from '../core/build/validateBuild';
import { DEFAULT_BUILD } from '../core/build/types';
import { DEFAULT_PARAMS } from '../core/params';
import { ValidationError } from '../core/validator';
import { sliceMesh } from '../core/slicer';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { generateSheetLayouts } from '../core/layout';
import { generateSheetSvg } from '../core/svgExporter';
import { generateSheetDxf } from '../core/dxfExporter';
import {
  visualPlateDepth,
  buildPlateExtrudeGeometry,
} from '../components/viewport/plateGeometry';
import { useSculptureStore } from '../store/useSculptureStore';
import type { PlateContour, SculptureParams } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../web/fixtures');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('Zero gap & None joint (zeroGap.test.ts)', () => {
  const lBlockBuf = fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj'));
  const lBlockMesh = loadMeshFromBuffer(toArrayBuffer(lBlockBuf), 'test_l_block.obj');
  const lBlockPositions = lBlockMesh.geometry.getAttribute('position').array as Float32Array;

  it('1. validateBuildParams: none accepts gap = 0 and rejects gap = 0.5; discs rejects gap = 0', () => {
    const noneBuild = { techniqueId: 'stacked' as const, jointId: 'none' as const };
    expect(() => validateBuildParams({ ...DEFAULT_PARAMS, gap: 0 }, noneBuild)).not.toThrow();

    expect(() =>
      validateBuildParams({ ...DEFAULT_PARAMS, gap: 0.5 }, noneBuild)
    ).toThrow('La unión «Sin separación» requiere separación 0 mm (recibido: 0.5).');

    expect(() =>
      validateBuildParams({ ...DEFAULT_PARAMS, gap: 0 }, DEFAULT_BUILD)
    ).toThrow(ValidationError);
  });

  it('2. sliceMesh with gap = 0 produces assembledHeight = N * t and step = t', () => {
    const params: SculptureParams = {
      ...DEFAULT_PARAMS,
      plates: 10,
      thickness: 3.0,
      gap: 0,
      axis: 'z',
    };
    const result = sliceMesh(lBlockPositions, params);
    expect(result.scaledHeight).toBe(30.0);
    expect(result.plates.length).toBe(10);
    for (let i = 0; i < result.plates.length; i++) {
      expect(result.plates[i].length).toBeGreaterThan(0);
      if (i > 0) {
        expect(result.zPositions[i] - result.zPositions[i - 1]).toBeCloseTo(3.0, 10);
      }
    }
  });

  it('3. generateSheetLayouts with none has only plates sheets, thickness = 3, zero discs and zero discGroups', () => {
    const params: SculptureParams = {
      ...DEFAULT_PARAMS,
      plates: 10,
      thickness: 3.0,
      gap: 0,
      axis: 'z',
    };
    const result = sliceMesh(lBlockPositions, params);
    const sheets = generateSheetLayouts(result, params);

    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      expect(sheet.sheetType).toBe('plates');
      expect(sheet.materialThickness).toBe(3.0);
      expect(sheet.discGroups.length).toBe(0);
      expect(sheet.discs.length).toBe(0);
      for (const plate of sheet.plates) {
        expect(plate.discs.length).toBe(0);
      }
    }
  });

  it('4. SVG has no circles in #grabado and DXF has 0 circles/arcs in GRABADO and >= 10 LWPOLYLINE in CORTE', () => {
    const params: SculptureParams = {
      ...DEFAULT_PARAMS,
      plates: 10,
      thickness: 3.0,
      gap: 0,
      axis: 'z',
    };
    const result = sliceMesh(lBlockPositions, params);
    const sheets = generateSheetLayouts(result, params);

    for (const sheet of sheets) {
      const svgStr = generateSheetSvg(sheet, { includeReference: true });
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgStr, 'image/svg+xml');
      const grabadoGroup = doc.getElementById('grabado');
      const grabadoCircles = grabadoGroup?.querySelectorAll('circle') ?? [];
      expect(grabadoCircles.length).toBe(0);

      const dxfStr = generateSheetDxf(sheet);
      const dxfParser = new DxfParser();
      const parsedDxf = dxfParser.parseSync(dxfStr);

      const entities = parsedDxf?.entities ?? [];
      const circlesInGrabado = entities.filter(
        (e: any) => e.type === 'CIRCLE' && e.layer === 'GRABADO'
      );
      const arcsInGrabado = entities.filter(
        (e: any) => e.type === 'ARC' && e.layer === 'GRABADO'
      );
      const polylinesInCorte = entities.filter(
        (e: any) => e.type === 'LWPOLYLINE' && e.layer === 'CORTE'
      );

      expect(circlesInGrabado.length).toBe(0);
      expect(arcsInGrabado.length).toBe(0);
      expect(polylinesInCorte.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('5. plateGeometry: C-1 visualPlateDepth and bbox Z measurement', () => {
    const plate: PlateContour = [
      {
        exterior: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
        holes: [],
        area: 100,
      },
    ];

    const depthZero = visualPlateDepth(3, 0);
    expect(depthZero).toBeCloseTo(2.94, 9);
    const geomZero = buildPlateExtrudeGeometry(plate, depthZero);
    const bboxZero = geomZero.boundingBox!;
    expect(bboxZero.max.z - bboxZero.min.z).toBeCloseTo(2.94, 6);

    const depthGap = visualPlateDepth(3, 2);
    expect(depthGap).toBe(3);
    const geomGap = buildPlateExtrudeGeometry(plate, depthGap);
    const bboxGap = geomGap.boundingBox!;
    expect(bboxGap.max.z - bboxGap.min.z).toBeCloseTo(3, 6);
  });

  it('6. Store: with none, thickness change leaves gap = 0, disc actions no-op, openSheetPreviewModal produces no disc sheets', () => {
    useSculptureStore.setState({
      build: { techniqueId: 'stacked', jointId: 'none' },
      params: { ...DEFAULT_PARAMS, gap: 0, thickness: 3 },
      discs: [],
    });

    const store = useSculptureStore.getState();
    store.setParam('thickness', 5);
    expect(useSculptureStore.getState().params.thickness).toBe(5);
    expect(useSculptureStore.getState().params.gap).toBe(0);

    // Disc actions are guarded with none
    store.addDiscAtActiveFloor(1, 1);
    expect(useSculptureStore.getState().discs.length).toBe(0);
    store.undoDiscs();
    expect(useSculptureStore.getState().canUndo).toBe(false);
    store.deleteSelectedDisc();
    expect(useSculptureStore.getState().selectedDiscId).toBeNull();
  });

  it('7. Transitions discs -> none -> discs restores gap memory and gapManuallyEditedMemory', () => {
    useSculptureStore.setState({
      build: { techniqueId: 'stacked', jointId: 'discs' },
      params: { ...DEFAULT_PARAMS, thickness: 3, gap: 2 },
      gapManuallyEdited: true,
      discs: [],
    });

    // discs -> none
    useSculptureStore.getState().setJoint('none');
    expect(useSculptureStore.getState().build.jointId).toBe('none');
    expect(useSculptureStore.getState().params.gap).toBe(0);

    // none -> discs: restores memory 2
    useSculptureStore.getState().setJoint('discs');
    expect(useSculptureStore.getState().build.jointId).toBe('discs');
    expect(useSculptureStore.getState().params.gap).toBe(2);
    expect(useSculptureStore.getState().gapManuallyEdited).toBe(true);

    // Without previous memory:
    useSculptureStore.setState({
      build: { techniqueId: 'stacked', jointId: 'none' },
      params: { ...DEFAULT_PARAMS, thickness: 4, gap: 0 },
      discGapMemory: null,
      gapManuallyEdited: false,
    });
    useSculptureStore.getState().setJoint('discs');
    expect(useSculptureStore.getState().params.gap).toBe(4);
    expect(useSculptureStore.getState().gapManuallyEdited).toBe(false);
  });

  it('8. E.6 Confirmation when switching away from discs with placed discs, clearing undo stack', () => {
    useSculptureStore.setState({
      build: { techniqueId: 'stacked', jointId: 'discs' },
      params: { ...DEFAULT_PARAMS },
      discs: [{ id: 1, x: 0, y: 0, diameter: 5, gapIndex: 0 }],
      canUndo: true,
    });

    // 1. Without confirmed: returns needsConfirmation: true and doesn't change
    const check1 = useSculptureStore.getState().setJoint('none');
    expect(check1).toEqual({ needsConfirmation: true, discCount: 1 });
    expect(useSculptureStore.getState().build.jointId).toBe('discs');
    expect(useSculptureStore.getState().discs.length).toBe(1);

    // 2. With confirmed: true: clears discs and undo/redo stacks
    const check2 = useSculptureStore.getState().setJoint('none', { confirmed: true });
    expect(check2).toEqual({ needsConfirmation: false, discCount: 0 });
    expect(useSculptureStore.getState().build.jointId).toBe('none');
    expect(useSculptureStore.getState().discs.length).toBe(0);
    expect(useSculptureStore.getState().canUndo).toBe(false);

    // 3. Returning to discs: canUndo remains false
    useSculptureStore.getState().setJoint('discs');
    expect(useSculptureStore.getState().build.jointId).toBe('discs');
    expect(useSculptureStore.getState().canUndo).toBe(false);
  });
});
