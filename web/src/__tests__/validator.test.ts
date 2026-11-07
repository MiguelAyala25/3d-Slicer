// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import {
  PARAM_BOUNDS,
  DEFAULT_PARAMS,
} from '../core/params';
import {
  getDiscThickness,
  isDiscsSeparateSheet,
  getDiscSheetNotice,
} from '../core/joints/discs/discParams';
import { validateBuildParams } from '../core/build/validateBuild';
import { DEFAULT_BUILD } from '../core/build/types';
import {
  validateFileExtension,
  validateParams,
  normalizeAndValidateGeometry,
  ValidationError,
} from '../core/validator';
import { loadMeshFromBuffer } from '../core/meshLoader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../web/fixtures');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createBoxGeometryWithWinding(
  min: [number, number, number],
  max: [number, number, number],
  invert = false
): THREE.BufferGeometry {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const p = [
    [x0, y0, z0], // 0
    [x1, y0, z0], // 1
    [x1, y1, z0], // 2
    [x0, y1, z0], // 3
    [x0, y0, z1], // 4
    [x1, y0, z1], // 5
    [x1, y1, z1], // 6
    [x0, y1, z1], // 7
  ];

  // 12 triangles CCW from outside
  const faceIndices = [
    // Bottom (-Z)
    [0, 2, 1], [0, 3, 2],
    // Top (+Z)
    [4, 5, 6], [4, 6, 7],
    // Front (-Y)
    [0, 1, 5], [0, 5, 4],
    // Back (+Y)
    [2, 3, 7], [2, 7, 6],
    // Left (-X)
    [0, 4, 7], [0, 7, 3],
    // Right (+X)
    [1, 2, 6], [1, 6, 5],
  ];

  const positions: number[] = [];
  for (const tri of faceIndices) {
    const [i0, i1, i2] = invert ? [tri[0], tri[2], tri[1]] : tri;
    positions.push(...p[i0], ...p[i1], ...p[i2]);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3)
  );
  return geom;
}

describe('validator & params', () => {
  it('DEFAULT_PARAMS and PARAM_BOUNDS match §0.0 single source of truth', () => {
    expect(DEFAULT_PARAMS).toEqual({
      plates: 10,
      thickness: 3.0,
      gap: 3.0,
      axis: 'z',
      sheetW: 600.0,
      sheetH: 400.0,
      sheetMargin: 10.0,
      partGap: 5.0,
      kerf: 0.15,
      discDiameter: 6.0,
      engraveClearance: 0.3,
      scrapTagEnabled: true,
    });

    expect(PARAM_BOUNDS.plates).toEqual({ min: 2, max: 200, step: 1 });
    expect(PARAM_BOUNDS.thickness).toEqual({ min: 0.1, max: 100.0, step: 0.5 });
    expect(PARAM_BOUNDS.gap).toEqual({ min: 0.1, max: 1000.0, step: 0.5 });
    expect(PARAM_BOUNDS.sheetW).toEqual({ min: 10.0, max: 5000.0, step: 10.0 });
    expect(PARAM_BOUNDS.sheetH).toEqual({ min: 10.0, max: 5000.0, step: 10.0 });
    expect(PARAM_BOUNDS.sheetMargin).toEqual({ min: 0.0, max: 200.0, step: 1.0 });
    expect(PARAM_BOUNDS.partGap).toEqual({ min: 0.0, max: 100.0, step: 1.0 });
    expect(PARAM_BOUNDS.kerf).toEqual({ min: 0.0, max: 5.0, step: 0.01 });
    expect(PARAM_BOUNDS.discDiameter).toEqual({ min: 0.1, max: 5000.0, step: 0.1 });
    expect(PARAM_BOUNDS.engraveClearance).toEqual({ min: 0.0, max: 10.0, step: 0.1 });

    expect(getDiscThickness(DEFAULT_PARAMS)).toBe(3.0);
    expect(isDiscsSeparateSheet(DEFAULT_PARAMS)).toBe(false);
    expect(getDiscSheetNotice(DEFAULT_PARAMS)).toBe('Discos: misma lámina que placas');
    expect(getDiscSheetNotice({ gap: 4.0, thickness: 3.0 })).toBe('Discos: lámina aparte de 4.0 mm');
  });

  it('validateParams validates boundaries and throws ValidationError for invalid inputs', () => {
    expect(() => validateParams(DEFAULT_PARAMS)).not.toThrow();

    // gap = 0 is accepted in core (CH-1)
    expect(() => validateParams({ ...DEFAULT_PARAMS, gap: 0 })).not.toThrow();
    // gap = -1 in core is rejected
    expect(() => validateParams({ ...DEFAULT_PARAMS, gap: -1 })).toThrow(ValidationError);
    // validateBuildParams with discs rejects gap = 0 (CH-1)
    expect(() =>
      validateBuildParams({ ...DEFAULT_PARAMS, gap: 0 }, DEFAULT_BUILD)
    ).toThrow(ValidationError);
    // validateBuildParams with none accepts gap = 0 (CH-1)
    expect(() =>
      validateBuildParams(
        { ...DEFAULT_PARAMS, gap: 0 },
        { techniqueId: 'stacked', jointId: 'none' }
      )
    ).not.toThrow();
    expect(() => validateParams({ ...DEFAULT_PARAMS, plates: 1 })).toThrow(ValidationError);
    expect(() => validateParams({ ...DEFAULT_PARAMS, plates: 201 })).toThrow(ValidationError);
    expect(() => validateParams({ ...DEFAULT_PARAMS, thickness: 0.05 })).toThrow(ValidationError);
    expect(() => validateParams({ ...DEFAULT_PARAMS, axis: 'w' as any })).toThrow(ValidationError);
    expect(() => validateParams({ ...DEFAULT_PARAMS, sheetMargin: 350 })).toThrow(ValidationError);
  });

  it('validateFileExtension rejects unsupported extensions and empty files', () => {
    expect(validateFileExtension('model.stl', 100)).toBe('.stl');
    expect(validateFileExtension('model.OBJ', 100)).toBe('.obj');
    expect(validateFileExtension('model.3mf', 100)).toBe('.3mf');
    expect(validateFileExtension('model.ply', 100)).toBe('.ply');

    expect(() => validateFileExtension('', 100)).toThrow(ValidationError);
    expect(() => validateFileExtension('model.fbx', 100)).toThrow(ValidationError);
    expect(() => validateFileExtension('model.stl', 0)).toThrow(ValidationError);
    expect(() => validateFileExtension('model.stl', 200 * 1024 * 1024)).toThrow(ValidationError);
  });

  describe('validateParams & validateFileExtension exact message characterization (M4 / C6-2)', () => {
    it('accepts valid parameter boundary extremes (min and max)', () => {
      // plates min / max
      expect(() => validateParams({ ...DEFAULT_PARAMS, plates: 2 })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, plates: 200 })).not.toThrow();

      // thickness min / max
      expect(() => validateParams({ ...DEFAULT_PARAMS, thickness: 0.1 })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, thickness: 100.0 })).not.toThrow();

      // gap min (0 in core) / max (1000.0)
      expect(() => validateParams({ ...DEFAULT_PARAMS, gap: 0 })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, gap: 1000.0 })).not.toThrow();

      // axis 'x', 'y', 'z'
      expect(() => validateParams({ ...DEFAULT_PARAMS, axis: 'x' })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, axis: 'y' })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, axis: 'z' })).not.toThrow();

      // sheetW & sheetH min / max
      expect(() => validateParams({ ...DEFAULT_PARAMS, sheetW: 10.0, sheetH: 10.0, sheetMargin: 0.0 })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, sheetW: 5000.0, sheetH: 5000.0 })).not.toThrow();

      // sheetMargin min / max
      expect(() => validateParams({ ...DEFAULT_PARAMS, sheetMargin: 0.0 })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, sheetW: 1000.0, sheetH: 1000.0, sheetMargin: 200.0 })).not.toThrow();

      // partGap min / max
      expect(() => validateParams({ ...DEFAULT_PARAMS, partGap: 0.0 })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, partGap: 100.0 })).not.toThrow();

      // kerf min / max
      expect(() => validateParams({ ...DEFAULT_PARAMS, kerf: 0.0 })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, kerf: 5.0 })).not.toThrow();

      // scrapTagEnabled boolean true / false
      expect(() => validateParams({ ...DEFAULT_PARAMS, scrapTagEnabled: true })).not.toThrow();
      expect(() => validateParams({ ...DEFAULT_PARAMS, scrapTagEnabled: false })).not.toThrow();
    });

    it('throws exact ValidationError messages for each invalid field', () => {
      // plates
      expect(() => validateParams({ ...DEFAULT_PARAMS, plates: 2.5 }))
        .toThrowError('El número de placas debe ser un entero entre 2 y 200 (recibido: 2.5).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, plates: 1 }))
        .toThrowError('El número de placas debe ser un entero entre 2 y 200 (recibido: 1).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, plates: 201 }))
        .toThrowError('El número de placas debe ser un entero entre 2 y 200 (recibido: 201).');

      // thickness
      expect(() => validateParams({ ...DEFAULT_PARAMS, thickness: 0.05 }))
        .toThrowError('El grosor debe estar entre 0.1 y 100 mm (recibido: 0.05).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, thickness: 100.5 }))
        .toThrowError('El grosor debe estar entre 0.1 y 100 mm (recibido: 100.5).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, thickness: NaN }))
        .toThrowError('El grosor debe estar entre 0.1 y 100 mm (recibido: NaN).');

      // gap
      expect(() => validateParams({ ...DEFAULT_PARAMS, gap: -0.1 }))
        .toThrowError('La separación debe ser mayor o igual a 0 mm y menor o igual a 1000 mm (recibido: -0.1).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, gap: 1000.1 }))
        .toThrowError('La separación debe ser mayor o igual a 0 mm y menor o igual a 1000 mm (recibido: 1000.1).');

      // axis
      expect(() => validateParams({ ...DEFAULT_PARAMS, axis: 'w' as any }))
        .toThrowError("El eje de corte debe ser 'x', 'y' o 'z' (recibido: 'w').");

      // sheetW & sheetH
      expect(() => validateParams({ ...DEFAULT_PARAMS, sheetW: 9.9 }))
        .toThrowError('Las dimensiones de la hoja deben estar entre 10 y 5000 mm (recibido: 9.9 x 400).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, sheetH: 5000.1 }))
        .toThrowError('Las dimensiones de la hoja deben estar entre 10 y 5000 mm (recibido: 600 x 5000.1).');

      // sheetMargin
      expect(() => validateParams({ ...DEFAULT_PARAMS, sheetMargin: -0.1 }))
        .toThrowError('El margen de la hoja debe estar entre 0 y 200 mm (recibido: -0.1).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, sheetMargin: 200.1 }))
        .toThrowError('El margen de la hoja debe estar entre 0 y 200 mm (recibido: 200.1).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, sheetW: 100, sheetH: 100, sheetMargin: 50 }))
        .toThrowError('El margen (50 mm) es demasiado grande para la hoja de 100 x 100 mm.');

      // partGap
      expect(() => validateParams({ ...DEFAULT_PARAMS, partGap: -0.1 }))
        .toThrowError('La separación entre piezas debe estar entre 0 y 100 mm (recibido: -0.1).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, partGap: 100.1 }))
        .toThrowError('La separación entre piezas debe estar entre 0 y 100 mm (recibido: 100.1).');

      // kerf
      expect(() => validateParams({ ...DEFAULT_PARAMS, kerf: -0.01 }))
        .toThrowError('El kerf debe estar entre 0 y 5 mm (recibido: -0.01).');
      expect(() => validateParams({ ...DEFAULT_PARAMS, kerf: 5.01 }))
        .toThrowError('El kerf debe estar entre 0 y 5 mm (recibido: 5.01).');

      // scrapTagEnabled
      expect(() => validateParams({ ...DEFAULT_PARAMS, scrapTagEnabled: 'yes' as any }))
        .toThrowError('scrapTagEnabled debe ser un valor booleano.');
    });

    it('throws exact ValidationError messages for validateFileExtension', () => {
      expect(() => validateFileExtension('   ', 100))
        .toThrowError('La ruta del archivo está vacía.');
      expect(() => validateFileExtension('model.dxf', 100))
        .toThrowError("Formato de archivo no soportado: '.dxf'. Formatos válidos: .3mf, .obj, .ply, .stl");
      expect(() => validateFileExtension('modelNoExt', 100))
        .toThrowError("Formato de archivo no soportado: '(sin extensión)'. Formatos válidos: .3mf, .obj, .ply, .stl");
      expect(() => validateFileExtension('model.stl', 0))
        .toThrowError("El archivo 'model.stl' está vacío (0 bytes).");
      expect(() => validateFileExtension('model.stl', 151 * 1024 * 1024))
        .toThrowError("El archivo 'model.stl' excede el tamaño máximo permitido de 150 MB.");
    });
  });

  it('welds relative vertices and detects watertightness on test_l_block.stl and test_torus.stl', () => {
    const lBlockBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.stl')));
    const lBlock = loadMeshFromBuffer(lBlockBuf, 'test_l_block.stl');
    expect(lBlock.metadata.isWatertight).toBe(true);
    expect(lBlock.metadata.openEdgeCount).toBe(0);
    expect(lBlock.metadata.nonManifoldEdgeCount).toBe(0);

    const torusBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_torus.stl')));
    const torus = loadMeshFromBuffer(torusBuf, 'test_torus.stl');
    expect(torus.metadata.isWatertight).toBe(true);
    expect(torus.metadata.openEdgeCount).toBe(0);
    expect(torus.metadata.nonManifoldEdgeCount).toBe(0);
  });

  it('detects open edges and non-manifold edges', () => {
    // Cube missing 1 triangle (11 triangles instead of 12)
    const box = createBoxGeometryWithWinding([0, 0, 0], [10, 10, 10]);
    const pos = box.getAttribute('position');
    const cutPos = new Float32Array(pos.array.slice(0, 11 * 9));
    const cutGeom = new THREE.BufferGeometry();
    cutGeom.setAttribute('position', new THREE.BufferAttribute(cutPos, 3));

    const { metadata } = normalizeAndValidateGeometry(cutGeom, 'open_box.stl');
    expect(metadata.isWatertight).toBe(false);
    expect(metadata.openEdgeCount).toBeGreaterThan(0);

    // Non-manifold: box + 1 extra triangle sharing an edge
    const extraTri = new Float32Array([...pos.array, 0, 0, 0, 10, 0, 0, 5, -5, 5]);
    const nmGeom = new THREE.BufferGeometry();
    nmGeom.setAttribute('position', new THREE.BufferAttribute(extraTri, 3));
    const { metadata: nmMeta } = normalizeAndValidateGeometry(nmGeom, 'non_manifold.stl');
    expect(nmMeta.nonManifoldEdgeCount).toBeGreaterThanOrEqual(1);
  });

  describe('three mandatory winding & nesting depth tests (Corrections #3 & A3)', () => {
    it('1) hollow box preserves inner cavity (nesting depth 1, negative volume preserved)', () => {
      const outerBox = createBoxGeometryWithWinding([-20, -20, -20], [20, 20, 20], false);
      const innerCavity = createBoxGeometryWithWinding([-10, -10, -10], [10, 10, 10], true); // normal points inward

      const mergedPos = new Float32Array([
        ...outerBox.getAttribute('position').array,
        ...innerCavity.getAttribute('position').array,
      ]);
      const hollowGeom = new THREE.BufferGeometry();
      hollowGeom.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));

      const { metadata } = normalizeAndValidateGeometry(hollowGeom, 'hollow_box.stl');
      expect(metadata.invertedComponentCount).toBe(0);
      expect(metadata.openComponentCount).toBe(0);
    });

    it('2) inverted closed STL is corrected (depth 0, negative volume inverted)', () => {
      const invertedBox = createBoxGeometryWithWinding([-10, -10, -10], [10, 10, 10], true);
      const { metadata } = normalizeAndValidateGeometry(invertedBox, 'inverted_box.stl');
      expect(metadata.invertedComponentCount).toBe(1);
    });

    it('3) open mesh translated far from origin is NOT inverted and produces warning', () => {
      // 5 faces of a cube (open box) translated to (+5000, +5000, +5000)
      const box = createBoxGeometryWithWinding([5000, 5000, 5000], [5010, 5010, 5010], false);
      const pos = box.getAttribute('position');
      const openPos = new Float32Array(pos.array.slice(0, 10 * 9)); // 10 triangles (5 faces)
      const openGeom = new THREE.BufferGeometry();
      openGeom.setAttribute('position', new THREE.BufferAttribute(openPos, 3));

      const { metadata } = normalizeAndValidateGeometry(openGeom, 'open_far.stl');
      expect(metadata.invertedComponentCount).toBe(0);
      expect(metadata.openComponentCount).toBe(1);
      expect(metadata.warnings.some((w) => w.includes('abierta'))).toBe(true);
    });
  });

  it('rejects point-cloud PLY without element face', () => {
    const plyHeader = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 0
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
`;
    const buf = new TextEncoder().encode(plyHeader).buffer;
    expect(() => loadMeshFromBuffer(buf, 'cloud.ply')).toThrow(/nube de puntos/);
  });

  it('rejects OBJ with only lines and no triangles', () => {
    const objText = `v 0 0 0
v 1 1 1
l 1 2
`;
    const buf = new TextEncoder().encode(objText).buffer;
    expect(() => loadMeshFromBuffer(buf, 'lines.obj')).toThrow(ValidationError);
  });

  it('handles 3MF unit scale correctly', () => {
    const mfBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.3mf')));
    const mesh = loadMeshFromBuffer(mfBuf, 'test_l_block.3mf');
    expect(mesh.metadata.faceCount).toBeGreaterThan(0);
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  describe('loadMeshFromBuffer position buffer checksum & metadata characterization (O1 / C2-1)', () => {
    it('fixture position buffer checksum and metadata match characterization baselines', () => {
      const fixtures = [
        'test_l_block.stl',
        'test_l_block.obj',
        'test_l_block.3mf',
        'test_torus.stl',
      ];

      for (const f of fixtures) {
        const buf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, f)));
        const { geometry, metadata } = loadMeshFromBuffer(buf, f);
        const pos = geometry.getAttribute('position').array as Float32Array;

        let sampleSum = 0;
        for (let i = 0; i < pos.length; i++) {
          sampleSum = (sampleSum + pos[i] * (i + 1)) % 1000000007;
        }

        if (f === 'test_l_block.stl' || f === 'test_l_block.obj' || f === 'test_l_block.3mf') {
          expect(pos.length).toBe(180);
          expect(sampleSum).toBe(99290);
          expect(metadata.vertexCount).toBe(12);
          expect(metadata.faceCount).toBe(20);
          expect(metadata.isWatertight).toBe(true);
          expect(metadata.openEdgeCount).toBe(0);
          expect(metadata.nonManifoldEdgeCount).toBe(0);
          expect(metadata.invertedComponentCount).toBe(0);
          expect(metadata.openComponentCount).toBe(0);
          expect(metadata.unitScaleApplied).toBe(1);
          expect(metadata.extents).toEqual([30, 15, 30]);
        } else if (f === 'test_torus.stl') {
          expect(pos.length).toBe(9216);
          expect(sampleSum).toBeCloseTo(-90940720.30664, 4);
          expect(metadata.vertexCount).toBe(512);
          expect(metadata.faceCount).toBe(1024);
          expect(metadata.isWatertight).toBe(true);
          expect(metadata.openEdgeCount).toBe(0);
          expect(metadata.nonManifoldEdgeCount).toBe(0);
          expect(metadata.invertedComponentCount).toBe(0);
          expect(metadata.openComponentCount).toBe(0);
          expect(metadata.unitScaleApplied).toBe(1);
          expect(metadata.extents).toEqual([56, 56, 16]);
        }
      }
    });

    it('worker buffer ownership: transferred buffer and worker buffer are distinct and not detached (C2-2)', () => {
      const buf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.stl')));
      const { geometry } = loadMeshFromBuffer(buf, 'test_l_block.stl');
      const posAttr = geometry.getAttribute('position');
      const rawPositions = posAttr.array as Float32Array;

      // Single copy for transfer
      const transferPositions = new Float32Array(rawPositions);

      // Verify they are different instances and have distinct ArrayBuffers
      expect(rawPositions).not.toBe(transferPositions);
      expect(rawPositions.buffer).not.toBe(transferPositions.buffer);
      expect(rawPositions.byteLength).toBe(transferPositions.byteLength);
      expect(rawPositions.byteLength).toBeGreaterThan(0);

      // Verify that detaching transferPositions (as happens during transferable postMessage)
      // leaves rawPositions intact
      const structuredTransfer = new WorkerMessagePortSimulation();
      structuredTransfer.transfer(transferPositions.buffer);

      expect(transferPositions.buffer.byteLength).toBe(0); // detached
      expect(rawPositions.buffer.byteLength).toBeGreaterThan(0); // intact in worker
      expect(rawPositions.length).toBe(180);
    });
  });
});

class WorkerMessagePortSimulation {
  transfer(ab: ArrayBuffer) {
    // In Node / browser transferable objects, transferring causes the buffer to detach.
    // Node.js MessageChannel / MessagePort transfers detaches the ArrayBuffer.
    const { port1, port2 } = new MessageChannel();
    port1.postMessage(ab, [ab]);
    port1.close();
    port2.close();
  }
}
