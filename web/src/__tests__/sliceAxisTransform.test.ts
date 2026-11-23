import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  getSliceGroupRotation,
  intersectRayWithSlicePlane,
  worldPointToSliceLocal,
} from '../components/viewport/sliceAxisTransform';
import { isPointOnPlate } from '../core/joints/discs/discGeometry';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { DEFAULT_PARAMS } from '../core/params';
import { sliceMesh } from '../core/slicer';
import type { Axis, PlateContour, Point2D } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
}

function sliceLocalToWorld(
  local: THREE.Vector3,
  axis: Axis | null | undefined
): THREE.Vector3 {
  const euler = new THREE.Euler(...getSliceGroupRotation(axis), 'XYZ');
  return local.clone().applyEuler(euler);
}

function findInteriorPointOnPlate(plate: PlateContour): Point2D {
  const ring = plate[0].exterior;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const steps = 16;
  for (let ix = 1; ix < steps; ix++) {
    for (let iy = 1; iy < steps; iy++) {
      const px = minX + ((maxX - minX) * ix) / steps;
      const py = minY + ((maxY - minY) * iy) / steps;
      if (isPointOnPlate(px, py, plate, 0)) {
        return [px, py];
      }
    }
  }
  throw new Error('Could not find an interior point on plate');
}

describe('sliceAxisTransform', () => {
  it('worldPointToSliceLocal is the exact inverse of getSliceGroupRotation for all axes and null', () => {
    const sample = new THREE.Vector3(12.5, -7.25, 31.0);
    const axes: Array<Axis | null> = ['x', 'y', 'z', null];

    for (const axis of axes) {
      const world = sliceLocalToWorld(sample, axis);
      const recovered = worldPointToSliceLocal(world, axis);
      expect(recovered.x).toBeCloseTo(sample.x, 6);
      expect(recovered.y).toBeCloseTo(sample.y, 6);
      expect(recovered.z).toBeCloseTo(sample.z, 6);
    }
  });

  it('intersectRayWithSlicePlane hits local (lx, ly, zTop) from front, back, and isometric rays on x, y, and z axes', () => {
    const lx = 14.25;
    const ly = -8.5;
    const zTop = 19.5;
    const localHit = new THREE.Vector3(lx, ly, zTop);

    const cases: Array<{
      axis: Axis;
      frontCam: THREE.Vector3;
      backCam: THREE.Vector3;
    }> = [
      {
        axis: 'x',
        frontCam: new THREE.Vector3(250, 0, 0),
        backCam: new THREE.Vector3(-250, 0, 0),
      },
      {
        axis: 'y',
        frontCam: new THREE.Vector3(0, 250, 0),
        backCam: new THREE.Vector3(0, -250, 0),
      },
      {
        axis: 'z',
        frontCam: new THREE.Vector3(0, 0, 250),
        backCam: new THREE.Vector3(0, 0, -250),
      },
    ];

    const isoCam = new THREE.Vector3(250, -250, 200);

    for (const { axis, frontCam, backCam } of cases) {
      const worldHit = sliceLocalToWorld(localHit, axis);

      for (const camOrigin of [frontCam, backCam, isoCam]) {
        const dir = worldHit.clone().sub(camOrigin).normalize();
        const ray = new THREE.Ray(camOrigin, dir);
        const result = intersectRayWithSlicePlane(ray, axis, zTop);
        expect(result).not.toBeNull();
        expect(result![0]).toBeCloseTo(lx, 5);
        expect(result![1]).toBeCloseTo(ly, 5);
      }
    }
  });

  it('intersectRayWithSlicePlane returns null for parallel (edge-on) rays and rays pointing away', () => {
    const zTop = 12.0;

    // Parallel rays offset from zTop = 12 in slice-local space
    const parallelCases: Array<{
      axis: Axis;
      origin: THREE.Vector3;
      dir: THREE.Vector3;
    }> = [
      {
        axis: 'x',
        origin: new THREE.Vector3(0, 0, 0),
        dir: new THREE.Vector3(0, 1, 0),
      },
      {
        axis: 'y',
        origin: new THREE.Vector3(0, 0, 0),
        dir: new THREE.Vector3(1, 0, 0),
      },
      {
        axis: 'z',
        origin: new THREE.Vector3(0, 0, 0),
        dir: new THREE.Vector3(1, 0, 0),
      },
    ];

    for (const { axis, origin, dir } of parallelCases) {
      expect(
        intersectRayWithSlicePlane(new THREE.Ray(origin, dir), axis, zTop)
      ).toBeNull();
    }

    // Rays pointing away from the plane (t < 0)
    const awayCases: Array<{
      axis: Axis;
      origin: THREE.Vector3;
      dir: THREE.Vector3;
    }> = [
      {
        axis: 'x',
        origin: new THREE.Vector3(50, 0, 0),
        dir: new THREE.Vector3(1, 0, 0),
      },
      {
        axis: 'y',
        origin: new THREE.Vector3(0, 50, 0),
        dir: new THREE.Vector3(0, 1, 0),
      },
      {
        axis: 'z',
        origin: new THREE.Vector3(0, 0, 50),
        dir: new THREE.Vector3(0, 0, 1),
      },
    ];

    for (const { axis, origin, dir } of awayCases) {
      expect(
        intersectRayWithSlicePlane(new THREE.Ray(origin, dir), axis, zTop)
      ).toBeNull();
    }
  });

  it('recovers valid plate coordinates on test_l_block.obj across x, y, and z axes from front and back camera rays', () => {
    const objBuf = toArrayBuffer(
      fs.readFileSync(path.join(FIXTURES_DIR, 'test_l_block.obj'))
    );
    const { geometry } = loadMeshFromBuffer(objBuf, 'test_l_block.obj', {
      upOrientation: 'y-up',
    });
    const positions = geometry.getAttribute('position').array as Float32Array;

    const axisConfigs: Array<{
      axis: Axis;
      floorIndex: number;
      frontOrigin: THREE.Vector3;
      backOrigin: THREE.Vector3;
    }> = [
      {
        axis: 'x',
        floorIndex: 0,
        frontOrigin: new THREE.Vector3(300, 0, 0),
        backOrigin: new THREE.Vector3(-300, 0, 0),
      },
      {
        axis: 'y',
        floorIndex: 8,
        frontOrigin: new THREE.Vector3(0, 300, 0),
        backOrigin: new THREE.Vector3(0, -300, 0),
      },
      {
        axis: 'z',
        floorIndex: 0,
        frontOrigin: new THREE.Vector3(0, 0, 300),
        backOrigin: new THREE.Vector3(0, 0, -300),
      },
    ];

    for (const { axis, floorIndex, frontOrigin, backOrigin } of axisConfigs) {
      const sliceResult = sliceMesh(positions, {
        ...DEFAULT_PARAMS,
        axis,
      });
      const plate = sliceResult.plates[floorIndex];
      expect(plate.length).toBeGreaterThan(0);

      const [lx, ly] = findInteriorPointOnPlate(plate);
      const zTop =
        sliceResult.zPositions[floorIndex] + DEFAULT_PARAMS.thickness * 0.5;
      const worldTarget = sliceLocalToWorld(
        new THREE.Vector3(lx, ly, zTop),
        axis
      );

      for (const camOrigin of [frontOrigin, backOrigin]) {
        const dir = worldTarget.clone().sub(camOrigin).normalize();
        const hit = intersectRayWithSlicePlane(
          new THREE.Ray(camOrigin, dir),
          axis,
          zTop
        );
        expect(hit).not.toBeNull();
        expect(hit![0]).toBeCloseTo(lx, 5);
        expect(hit![1]).toBeCloseTo(ly, 5);
        expect(isPointOnPlate(hit![0], hit![1], plate)).toBe(true);
      }
    }
  });
});
