import * as THREE from 'three';

export function concatPositions(arrays: Float32Array[]): Float32Array {
  const totalLen = arrays.reduce((acc, a) => acc + a.length, 0);
  const result = new Float32Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * 1. Cubo centrado de wx x wy x wz
 */
export function createBoxPositions(wx: number, wy: number, wz: number): Float32Array {
  const geom = new THREE.BoxGeometry(wx, wy, wz).toNonIndexed();
  return geom.getAttribute('position').array as Float32Array;
}

/**
 * 2. Esfera centrada de radio R
 */
export function createSpherePositions(
  radius: number,
  widthSegs = 32,
  heightSegs = 24
): Float32Array {
  const geom = new THREE.SphereGeometry(radius, widthSegs, heightSegs).toNonIndexed();
  return geom.getAttribute('position').array as Float32Array;
}

/**
 * 4. Dos cubos separados en vertical (40 x 40 x 15 mm en z = -15 y z = +15)
 */
export function createTwoStackedBoxesPositions(): Float32Array {
  const g1 = new THREE.BoxGeometry(40, 40, 15).translate(0, 0, -15).toNonIndexed();
  const g2 = new THREE.BoxGeometry(40, 40, 15).translate(0, 0, 15).toNonIndexed();
  return concatPositions([
    g1.getAttribute('position').array as Float32Array,
    g2.getAttribute('position').array as Float32Array,
  ]);
}

/**
 * 5. Tubo prismático de 50 x 50 x 50 con túnel horizontal interior de 26 x 26 x 50 a lo largo de Y
 */
export function createHollowTubePositions(): Float32Array {
  // 4 paredes de 50 mm de largo en Y alrededor del túnel central de 26 x 26 mm (en X y Z)
  const left = new THREE.BoxGeometry(12, 50, 50).translate(-19, 0, 0).toNonIndexed();
  const right = new THREE.BoxGeometry(12, 50, 50).translate(19, 0, 0).toNonIndexed();
  const bottom = new THREE.BoxGeometry(26, 50, 12).translate(0, 0, -19).toNonIndexed();
  const top = new THREE.BoxGeometry(26, 50, 12).translate(0, 0, 19).toNonIndexed();

  return concatPositions([
    left.getAttribute('position').array as Float32Array,
    right.getAttribute('position').array as Float32Array,
    bottom.getAttribute('position').array as Float32Array,
    top.getAttribute('position').array as Float32Array,
  ]);
}

/**
 * 6. Malla con isla sin cruces: cubo principal 50 x 50 x 50 más satélite 4 x 30 x 20 en x = 36
 */
export function createIsolatedIslandPositions(): Float32Array {
  const main = new THREE.BoxGeometry(50, 50, 50).toNonIndexed();
  const satellite = new THREE.BoxGeometry(4, 30, 20).translate(36, 0, 0).toNonIndexed();

  return concatPositions([
    main.getAttribute('position').array as Float32Array,
    satellite.getAttribute('position').array as Float32Array,
  ]);
}

/**
 * 7. Bloque en C con brazo voladizo superior que se parte al ranurar (W4)
 */
export function createBridgeSplitPositions(): Float32Array {
  // Forma C: columna trasera en x in [-25, -15], z in [-20, 20]
  // Brazo inferior en x in [-15, 25], z in [-20, -10]
  // Brazo superior voladizo en x in [-15, 25], z in [10, 20]
  const post = new THREE.BoxGeometry(10, 30, 40).translate(-20, 0, 0).toNonIndexed();
  const armBottom = new THREE.BoxGeometry(40, 30, 10).translate(5, 0, -15).toNonIndexed();
  const armTop = new THREE.BoxGeometry(40, 30, 10).translate(5, 0, 15).toNonIndexed();

  return concatPositions([
    post.getAttribute('position').array as Float32Array,
    armBottom.getAttribute('position').array as Float32Array,
    armTop.getAttribute('position').array as Float32Array,
  ]);
}
