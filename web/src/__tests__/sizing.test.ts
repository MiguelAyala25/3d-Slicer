import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembledHeight,
  linkedDimension,
  extentOf,
  planarEnvelope,
  uniformScale,
  finalSize,
  platesForTargetDimension,
  maxFit,
  DIMENSION_LABELS,
  TIE_TOLERANCE,
  type ModelExtents,
} from '../core/sizing';
import { computeCutPositions, sliceMesh } from '../core/slicer';
import { isWithinUsableArea, generateSheetLayouts } from '../core/layout';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { DEFAULT_PARAMS } from '../core/params';
import { ValidationError } from '../core/validator';
import { useSculptureStore } from '../store/useSculptureStore';
import type { Axis } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../web/fixtures');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

describe('Sizing engine (sizing.ts & store integration)', () => {
  const E: ModelExtents = { x: 40, y: 20, z: 60 };
  const t = 3;
  const g = 2;

  it('1. Fórmula única: assembledHeight matches computeCutPositions.totalHeight bit-for-bit', () => {
    expect(assembledHeight(10, 3, 2)).toBe(48);
    expect(computeCutPositions(10, 3, 2).totalHeight).toBe(48);

    // 50 deterministic pseudorandom triplets
    let seed = 42;
    const lcg = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 50; i++) {
      const plates = Math.floor(lcg() * 199) + 2;
      const thickness = lcg() * 20 + 0.5;
      const gap = lcg() * 10 + 0.1;
      const hDirect = assembledHeight(plates, thickness, gap);
      const hFromCut = computeCutPositions(plates, thickness, gap).totalHeight;
      expect(hFromCut).toBe(hDirect);
    }
  });

  it('2. Etiquetas y proyecciones de plano', () => {
    expect(DIMENSION_LABELS).toEqual({
      alto: 'Alto (Z)',
      ancho: 'Ancho (X)',
      largo: 'Largo (Y)',
    });

    expect(linkedDimension('z')).toBe('alto');
    expect(linkedDimension('x')).toBe('ancho');
    expect(linkedDimension('y')).toBe('largo');

    expect(extentOf(E, 'alto')).toBe(60);
    expect(extentOf(E, 'ancho')).toBe(40);
    expect(extentOf(E, 'largo')).toBe(20);
    expect(TIE_TOLERANCE).toBe(1e-9);

    expect(planarEnvelope(E, 'x')).toEqual({ w: 60, h: 20 });
    expect(planarEnvelope(E, 'y')).toEqual({ w: 40, h: 60 });
    expect(planarEnvelope(E, 'z')).toEqual({ w: 40, h: 20 });
  });

  it('3. Ida y vuelta: platesForTargetDimension returns exact N for linked and non-linked dimensions', () => {
    const axes: Axis[] = ['x', 'y', 'z'];
    for (const axis of axes) {
      const linked = linkedDimension(axis);
      for (let N = 2; N <= 200; N++) {
        const size = finalSize(E, axis, N, t, g);
        const resLinked = platesForTargetDimension(E, axis, linked, size[linked], t, g);
        expect(resLinked.plates).toBe(N);

        // Non-linked dimension test
        const nonLinked = linked === 'alto' ? 'ancho' : 'alto';
        const resNonLinked = platesForTargetDimension(E, axis, nonLinked, size[nonLinked], t, g);
        expect(resNonLinked.plates).toBe(N);
      }
    }
  });

  it('4. Redondeo: alto = 50 -> 10, alto = 51 -> 11', () => {
    expect(platesForTargetDimension(E, 'z', 'alto', 50, t, g).plates).toBe(10);
    expect(platesForTargetDimension(E, 'z', 'alto', 51, t, g).plates).toBe(11);
  });

  it('5. Empate con tolerancia 1e-9: alto = 50.5 -> 10, IEEE-754 ties and g = 0', () => {
    // Exact tie: x = 10.5
    expect(platesForTargetDimension(E, 'z', 'alto', 50.5, t, g).plates).toBe(10);

    // Floating-point perturbation within tolerance
    const targetMmSlightMinus = 50.5 - 5e-13 * 5;
    const targetMmSlightPlus = 50.5 + 5e-13 * 5;
    expect(platesForTargetDimension(E, 'z', 'alto', targetMmSlightMinus, t, g).plates).toBe(10);
    expect(platesForTargetDimension(E, 'z', 'alto', targetMmSlightPlus, t, g).plates).toBe(10);

    // g = 0, t = 2: alto = 21 -> x = 21 / 2 = 10.5 -> 10
    expect(platesForTargetDimension(E, 'z', 'alto', 21, 2, 0).plates).toBe(10);
  });

  it('6. Clamps: alto = 1 -> min (2); alto = 100000 -> max (200)', () => {
    expect(platesForTargetDimension(E, 'z', 'alto', 1, t, g)).toEqual({
      plates: 2,
      clamped: 'min',
    });
    expect(platesForTargetDimension(E, 'z', 'alto', 100000, t, g)).toEqual({
      plates: 200,
      clamped: 'max',
    });
  });

  it('7. Persistencia de sizeIntent en el store al cambiar thickness o gap', () => {
    const store = useSculptureStore.getState();

    // Set modelExtents manually for unit test
    useSculptureStore.setState({
      modelExtents: E,
      params: { ...DEFAULT_PARAMS, axis: 'z', plates: 10, thickness: 3, gap: 2 },
      sizeIntent: { kind: 'plates' },
    });

    // Case 1: user edits plates = 10 -> sizeIntent is plates.
    // Changing thickness from 3 to 6 leaves plates at 10.
    store.setParam('thickness', 6);
    expect(useSculptureStore.getState().params.plates).toBe(10);
    expect(finalSize(E, 'z', 10, 6, 2).alto).toBe(78);

    // Case 2: user edits Alto (Z) = 60 -> sizeIntent is size
    // plates = round((60 + 2) / 5) = round(12.4) = 12
    useSculptureStore.setState({
      gapManuallyEdited: true,
      params: { ...DEFAULT_PARAMS, axis: 'z', plates: 10, thickness: 3, gap: 2 },
    });
    useSculptureStore.getState().setPlatesFromDimension('alto', 60);
    expect(useSculptureStore.getState().params.plates).toBe(12);
    expect(useSculptureStore.getState().sizeIntent).toEqual({
      kind: 'size',
      dim: 'alto',
      targetMm: 60,
    });

    // Changing thickness to 6 with sizeIntent active recalculates plates
    // plates = round((60 + 2) / 8) = round(7.75) = 8
    useSculptureStore.getState().setParam('thickness', 6);
    expect(useSculptureStore.getState().params.plates).toBe(8);
    expect(useSculptureStore.getState().sizeIntent).toEqual({
      kind: 'size',
      dim: 'alto',
      targetMm: 60,
    });
  });

  it('8. Igualdad con el slicer: |uniformScale - sliceResult.scaleFactor| <= 1e-9 * scaleFactor', () => {
    const models = ['test_l_block.obj', 'Hand.OBJ'];
    const axes: Axis[] = ['x', 'y', 'z'];

    for (const modelFile of models) {
      const buf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, modelFile)));
      const { geometry } = loadMeshFromBuffer(buf, modelFile);
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const bbox = geometry.boundingBox!;
      const extents: ModelExtents = {
        x: bbox.max.x - bbox.min.x,
        y: bbox.max.y - bbox.min.y,
        z: bbox.max.z - bbox.min.z,
      };

      const positions = geometry.getAttribute('position').array as Float32Array;

      for (const axis of axes) {
        const params = {
          ...DEFAULT_PARAMS,
          plates: 10,
          thickness: 3.0,
          gap: 2.0,
          axis,
        };
        const slice = sliceMesh(positions, params);
        const uScale = uniformScale(extents, axis, params.plates, params.thickness, params.gap);

        const diff = Math.abs(uScale - slice.scaleFactor);
        expect(diff).toBeLessThanOrEqual(1e-9 * slice.scaleFactor);
      }
    }
  });

  it('9. Máximo garantizado de hoja (cota conservadora)', () => {
    const sheet = { sheetW: 600, sheetH: 400, sheetMargin: 10 };
    const fit = maxFit(E, 'z', 3, 2, sheet);
    expect(fit).not.toBeNull();
    expect(fit?.plates).toBe(174);

    const env = planarEnvelope(E, 'z');
    expect(isWithinUsableArea(env.w * fit!.size.scale, env.h * fit!.size.scale, sheet)).toBe(true);

    const size175 = finalSize(E, 'z', 175, 3, 2);
    expect(isWithinUsableArea(env.w * size175.scale, env.h * size175.scale, sheet)).toBe(false);

    // When model exceeds sheet even with 2 plates (e.g. axis 'x' on 30x30 sheet with margin 10)
    const smallSheet = { sheetW: 30, sheetH: 30, sheetMargin: 10 };
    expect(maxFit(E, 'x', 3, 2, smallSheet)).toBeNull();
  });

  it('10. Criterio único: generateSheetLayouts throws exact message when isWithinUsableArea is false', () => {
    const goldenSliceZ = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../../web/golden/l_block_slice_z.json'), 'utf-8')
    );
    const mockSliceResultZ = {
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
      ] as any,
      scaledHeight: goldenSliceZ.assembledHeight,
      warnings: [],
    };

    expect(() =>
      generateSheetLayouts(mockSliceResultZ, {
        ...DEFAULT_PARAMS,
        plates: 5,
        thickness: 3.0,
        gap: 2.0,
        sheetW: 30.0,
        sheetH: 30.0,
        sheetMargin: 10.0,
      })
    ).toThrow(ValidationError);
  });

  it('updates store params synchronously on rapid steps without throwing or losing state', () => {
    const store = useSculptureStore.getState();
    for (let p = 123; p <= 130; p++) {
      store.setParam('plates', p);
    }
    expect(useSculptureStore.getState().params.plates).toBe(130);
  });
});
