import * as THREE from 'three';
import type { PlateContour, Point2D } from '../../types/sculpture';

export const ZERO_GAP_VISUAL_INSET_RATIO = 0.02;

export function visualPlateDepth(thickness: number, gap: number): number {
  return gap === 0 ? thickness * (1 - ZERO_GAP_VISUAL_INSET_RATIO) : thickness;
}

export function buildPlateEdgesBufferGeometry(
  plate: PlateContour,
  halfDepth: number
): THREE.BufferGeometry {
  const positions: number[] = [];

  const addRingLines = (ring: Point2D[], z: number) => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % n];
      positions.push(x0, y0, z, x1, y1, z);
    }
  };

  for (const poly of plate) {
    addRingLines(poly.exterior, -halfDepth);
    addRingLines(poly.exterior, halfDepth);
    for (const hole of poly.holes) {
      addRingLines(hole, -halfDepth);
      addRingLines(hole, halfDepth);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  return geom;
}

export function buildPlateExtrudeGeometry(
  plate: PlateContour,
  depth: number
): THREE.BufferGeometry {
  const shapes: THREE.Shape[] = [];

  for (const poly of plate) {
    if (poly.exterior.length < 3) continue;
    const shape = new THREE.Shape();
    poly.exterior.forEach(([x, y], idx) => {
      if (idx === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();

    for (const hole of poly.holes) {
      if (hole.length < 3) continue;
      const holePath = new THREE.Path();
      hole.forEach(([x, y], idx) => {
        if (idx === 0) holePath.moveTo(x, y);
        else holePath.lineTo(x, y);
      });
      holePath.closePath();
      shape.holes.push(holePath);
    }
    shapes.push(shape);
  }

  const extrudeGeom = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  // Centrar extrusión en [-depth/2, +depth/2] alrededor de zCenter
  extrudeGeom.translate(0, 0, -depth * 0.5);
  extrudeGeom.computeBoundingBox();
  return extrudeGeom;
}
