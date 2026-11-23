import * as THREE from 'three';
import type { Axis } from '../../types/sculpture';

/**
 * Returns the Euler XYZ rotation `[rx, ry, rz]` applied to the sliced-plates / discs
 * group so the sculpture remains upright regardless of the slicing axis.
 */
export function getSliceGroupRotation(
  axis: Axis | null | undefined
): [number, number, number] {
  if (axis === 'x') {
    return [0, Math.PI * 0.5, 0];
  }
  if (axis === 'y') {
    return [-Math.PI * 0.5, 0, 0];
  }
  return [0, 0, 0];
}

/**
 * Transforms a world-space point or direction vector into the slice-local frame
 * by applying the exact inverse of `getSliceGroupRotation(axis)`.
 */
export function worldPointToSliceLocal(
  point: THREE.Vector3,
  axis: Axis | null | undefined,
  target = new THREE.Vector3()
): THREE.Vector3 {
  if (axis === 'x') {
    return target.set(-point.z, point.y, point.x);
  }
  if (axis === 'y') {
    return target.set(point.x, -point.z, point.y);
  }
  return target.set(point.x, point.y, point.z);
}

/**
 * Intersects a world-space ray with the slice-local plane `z = localZ` and
 * returns the hit coordinates `[x, y]` in slice-local space, or `null` if parallel/behind.
 */
export function intersectRayWithSlicePlane(
  ray: THREE.Ray,
  axis: Axis | null | undefined,
  localZ: number
): [number, number] | null {
  const localOrigin = worldPointToSliceLocal(ray.origin, axis);
  const localDir = worldPointToSliceLocal(ray.direction, axis);

  if (Math.abs(localDir.z) < 1e-8) {
    if (Math.abs(localOrigin.z - localZ) < 1e-8) {
      return [localOrigin.x, localOrigin.y];
    }
    return null;
  }

  const t = (localZ - localOrigin.z) / localDir.z;
  if (t < 0) {
    return null;
  }

  return [localOrigin.x + t * localDir.x, localOrigin.y + t * localDir.y];
}
