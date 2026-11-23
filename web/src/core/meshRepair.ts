import * as THREE from 'three';
import { mergeVertices } from 'three-stdlib';
import { ValidationError, formatCoreWarning } from './errors';
import type {
  MeshMetadata,
  MeshRepairDiagnosis,
  MeshRepairOptions,
} from '../types/sculpture';

export const MAX_TRIANGLES = 1_000_000;

export type NormalizeMeshOptions = MeshRepairOptions;

/**
 * Intersección rayo-triángulo (Möller–Trumbore) para determinar si el punto origen
 * está dentro de otra componente conexa cerrada.
 */
function rayIntersectsTriangle(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number
): boolean {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return false;
  const invDet = 1.0 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0.0 || u > 1.0) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0.0 || u + v > 1.0) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t > 1e-7;
}

interface ClosedComponentInfo {
  faces: number[];
  signedVol6: number;
  sampleVertex: [number, number, number];
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

function computeFaceNormal(
  indices: Uint32Array,
  posArray: Float32Array,
  f: number
): { nx: number; ny: number; nz: number; len: number } {
  const fBase = f * 3;
  const i0 = indices[fBase] * 3;
  const i1 = indices[fBase + 1] * 3;
  const i2 = indices[fBase + 2] * 3;
  const ux = posArray[i1] - posArray[i0];
  const uy = posArray[i1 + 1] - posArray[i0 + 1];
  const uz = posArray[i1 + 2] - posArray[i0 + 2];
  const vx = posArray[i2] - posArray[i0];
  const vy = posArray[i2 + 1] - posArray[i0 + 1];
  const vz = posArray[i2 + 2] - posArray[i0 + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return { nx, ny, nz, len: Math.hypot(nx, ny, nz) };
}

interface EdgeTopology {
  edgeCounts: Map<number, number>;
  edgeFirstFace: Map<number, number>;
  edgeFirstDir: Map<number, number>;
  edgeSecondFace: Map<number, number>;
  edgeSecondDir: Map<number, number>;
  adjFaces: number[][];
  faceEdgeKeys: [number, number, number][];
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
  inconsistentManifoldEdgeCount: number;
  isWatertight: boolean;
}

function buildEdgeTopology(
  indices: Uint32Array,
  faceCount: number,
  vertexCount: number
): EdgeTopology {
  // Mapa de aristas sin dirección: key = minV * vertexCount + maxV (-1 si degenerada)
  const edgeCounts = new Map<number, number>();
  const edgeFirstFace = new Map<number, number>();
  const edgeFirstDir = new Map<number, number>();
  const edgeSecondFace = new Map<number, number>();
  const edgeSecondDir = new Map<number, number>();
  const adjFaces: number[][] = Array.from({ length: faceCount }, () => []);
  const faceEdgeKeys: [number, number, number][] = new Array(faceCount);

  for (let f = 0; f < faceCount; f++) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    const pairs: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    const keys: [number, number, number] = [-1, -1, -1];
    for (let p = 0; p < 3; p++) {
      const u = pairs[p][0];
      const v = pairs[p][1];
      if (u === v) continue;
      const minV = u < v ? u : v;
      const maxV = u < v ? v : u;
      const key = minV * vertexCount + maxV;
      keys[p] = key;
      const dir = u < v ? 1 : -1;
      const prevCount = edgeCounts.get(key) ?? 0;
      edgeCounts.set(key, prevCount + 1);
      if (prevCount === 0) {
        edgeFirstFace.set(key, f);
        edgeFirstDir.set(key, dir);
      } else {
        if (prevCount === 1) {
          edgeSecondFace.set(key, f);
          edgeSecondDir.set(key, dir);
        }
        const otherFace = edgeFirstFace.get(key)!;
        if (otherFace !== f) {
          adjFaces[f].push(otherFace);
          adjFaces[otherFace].push(f);
        }
      }
    }
    faceEdgeKeys[f] = keys;
  }

  let openEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let inconsistentManifoldEdgeCount = 0;
  for (const [key, count] of edgeCounts.entries()) {
    if (count === 1) {
      openEdgeCount++;
    } else if (count > 2) {
      nonManifoldEdgeCount++;
    } else if (count === 2 && edgeFirstDir.get(key) === edgeSecondDir.get(key)) {
      inconsistentManifoldEdgeCount++;
    }
  }

  return {
    edgeCounts,
    edgeFirstFace,
    edgeFirstDir,
    edgeSecondFace,
    edgeSecondDir,
    adjFaces,
    faceEdgeKeys,
    openEdgeCount,
    nonManifoldEdgeCount,
    inconsistentManifoldEdgeCount,
    isWatertight: openEdgeCount === 0 && nonManifoldEdgeCount === 0,
  };
}

/**
 * Pass 1: Poda iterativamente triángulos rebaba/aleta coplanares no-manifold
 * (2 aristas abiertas y 1 arista no-manifold compartida con al menos una cara coplanar).
 * No elimina aletas no coplanares.
 */
function pruneCoplanarDanglingFlaps(
  indices: Uint32Array,
  posArray: Float32Array,
  faceCount: number,
  faceEdgeKeys: [number, number, number][],
  initialEdgeCounts: Map<number, number>,
  diag: number
): { activeIndices: Uint32Array; finalFaceCount: number; prunedFlapCount: number } {
  const edgeFaces = new Map<number, number[]>();
  const edgeActiveCount = new Map<number, number>(initialEdgeCounts);

  for (let f = 0; f < faceCount; f++) {
    const keys = faceEdgeKeys[f];
    for (let p = 0; p < 3; p++) {
      const key = keys[p];
      if (key < 0) continue;
      let list = edgeFaces.get(key);
      if (!list) {
        list = [];
        edgeFaces.set(key, list);
      }
      list.push(f);
    }
  }

  const activeFace = new Uint8Array(faceCount);
  activeFace.fill(1);
  const inQueue = new Uint8Array(faceCount);
  const queue: number[] = [];

  for (const [key, count] of edgeActiveCount.entries()) {
    if (count >= 3) {
      const facesOnEdge = edgeFaces.get(key);
      if (!facesOnEdge) continue;
      for (let i = 0; i < facesOnEdge.length; i++) {
        const f = facesOnEdge[i];
        if (!inQueue[f]) {
          inQueue[f] = 1;
          queue.push(f);
        }
      }
    }
  }

  const zeroAreaThreshold = 1e-12 * diag * diag;
  let activeFaceCount = faceCount;
  let prunedFlapCount = 0;
  let qHead = 0;

  while (qHead < queue.length && activeFaceCount > 4) {
    const f = queue[qHead++];
    inQueue[f] = 0;
    if (!activeFace[f]) continue;

    const keys = faceEdgeKeys[f];
    let hasDegenerateEdge = false;
    let openCnt = 0;
    let nmCnt = 0;
    let nmKey = -1;

    for (let p = 0; p < 3; p++) {
      const k = keys[p];
      if (k < 0) {
        hasDegenerateEdge = true;
        break;
      }
      const cnt = edgeActiveCount.get(k) ?? 0;
      if (cnt === 1) {
        openCnt++;
      } else if (cnt >= 3) {
        nmCnt++;
        nmKey = k;
      }
    }

    let shouldPrune = false;
    if (hasDegenerateEdge) {
      shouldPrune = true;
    } else if (openCnt === 2 && nmCnt === 1 && nmKey >= 0) {
      const nf = computeFaceNormal(indices, posArray, f);
      if (nf.len <= zeroAreaThreshold) {
        shouldPrune = true;
      } else {
        const candidates = edgeFaces.get(nmKey);
        if (candidates) {
          for (let i = 0; i < candidates.length; i++) {
            const of = candidates[i];
            if (of === f || !activeFace[of]) continue;
            const no = computeFaceNormal(indices, posArray, of);
            if (no.len <= zeroAreaThreshold) continue;
            const dot = nf.nx * no.nx + nf.ny * no.ny + nf.nz * no.nz;
            if (Math.abs(dot / (nf.len * no.len)) >= 0.999) {
              shouldPrune = true;
              break;
            }
          }
        }
      }
    }

    if (!shouldPrune) continue;

    activeFace[f] = 0;
    activeFaceCount--;
    prunedFlapCount++;

    for (let p = 0; p < 3; p++) {
      const k = keys[p];
      if (k < 0) continue;
      edgeActiveCount.set(k, (edgeActiveCount.get(k) ?? 1) - 1);
    }

    const notifyKeys = nmKey >= 0 ? [nmKey] : keys;
    for (let e = 0; e < notifyKeys.length; e++) {
      const k = notifyKeys[e];
      if (k < 0) continue;
      const neighbors = edgeFaces.get(k);
      if (!neighbors) continue;
      for (let i = 0; i < neighbors.length; i++) {
        const of = neighbors[i];
        if (activeFace[of] && !inQueue[of]) {
          inQueue[of] = 1;
          queue.push(of);
        }
      }
    }
  }

  if (prunedFlapCount === 0) {
    return { activeIndices: indices, finalFaceCount: faceCount, prunedFlapCount: 0 };
  }

  const activeIndices = new Uint32Array(activeFaceCount * 3);
  let dst = 0;
  for (let f = 0; f < faceCount; f++) {
    if (!activeFace[f]) continue;
    const src = f * 3;
    activeIndices[dst++] = indices[src];
    activeIndices[dst++] = indices[src + 1];
    activeIndices[dst++] = indices[src + 2];
  }

  return { activeIndices, finalFaceCount: activeFaceCount, prunedFlapCount };
}

/**
 * Pass 2: Armoniza el winding cara-a-cara por BFS sobre aristas manifold (count === 2)
 * invirtiendo el grupo minoritario de cada hoja conexa.
 */
function harmonizeManifoldWinding(
  indices: Uint32Array,
  faceCount: number,
  topo: EdgeTopology
): number {
  const manifoldAdj: number[][] = Array.from({ length: faceCount }, () => []);
  for (const [key, count] of topo.edgeCounts.entries()) {
    if (count !== 2) continue;
    const f0 = topo.edgeFirstFace.get(key)!;
    const f1 = topo.edgeSecondFace.get(key)!;
    if (f0 === f1) continue;
    const sameDir = topo.edgeFirstDir.get(key)! === topo.edgeSecondDir.get(key)! ? 1 : 0;
    manifoldAdj[f0].push(f1 * 2 + sameDir);
    manifoldAdj[f1].push(f0 * 2 + sameDir);
  }

  const bfsVisited = new Uint8Array(faceCount);
  const parity = new Uint8Array(faceCount);
  const queue = new Int32Array(faceCount);
  let harmonizedFaceCount = 0;

  for (let startF = 0; startF < faceCount; startF++) {
    if (bfsVisited[startF]) continue;
    let qHead = 0;
    let qTail = 0;
    bfsVisited[startF] = 1;
    parity[startF] = 0;
    queue[qTail++] = startF;
    let count0 = 1;
    let count1 = 0;

    while (qHead < qTail) {
      const f = queue[qHead++];
      const pF = parity[f];
      const neighbors = manifoldAdj[f];
      for (let i = 0; i < neighbors.length; i++) {
        const packed = neighbors[i];
        const nf = packed >> 1;
        if (!bfsVisited[nf]) {
          const expectedParity = pF ^ (packed & 1);
          bfsVisited[nf] = 1;
          parity[nf] = expectedParity;
          if (expectedParity === 0) count0++;
          else count1++;
          queue[qTail++] = nf;
        }
      }
    }

    if (count0 > 0 && count1 > 0) {
      const flipParity = count1 <= count0 ? 1 : 0;
      for (let i = 0; i < qTail; i++) {
        const f = queue[i];
        if (parity[f] === flipParity) {
          const tmp = indices[f * 3 + 1];
          indices[f * 3 + 1] = indices[f * 3 + 2];
          indices[f * 3 + 2] = tmp;
          harmonizedFaceCount++;
        }
      }
    }
  }

  return harmonizedFaceCount;
}

interface FillHolesResult {
  posArray: Float32Array;
  indices: Uint32Array;
  faceCount: number;
  vertexCount: number;
  filledHoleCount: number;
  addedCapTriangles: number;
}

/**
 * Pass 2.5: Cierra automáticamente lazos de borde abiertos (p. ej. base abierta en escaneos Polycam)
 * proyectando cada lazo simple sobre su plano de Newell y triangulando por ear-clipping (Earcut).
 * Divide mediante vértices Steiner las diagonales internas que colisionan con aristas existentes.
 */
function fillOpenBoundaryLoops(
  indices: Uint32Array,
  posArray: Float32Array,
  faceCount: number,
  origVertexCount: number,
  topo: EdgeTopology,
  diag: number
): FillHolesResult {
  const existingEdgeSet = new Set<number>(topo.edgeCounts.keys());
  const outBound = new Map<number, Array<{ to: number; used: boolean }>>();

  for (let f = 0; f < faceCount; f++) {
    const fBase = f * 3;
    const a = indices[fBase];
    const b = indices[fBase + 1];
    const c = indices[fBase + 2];
    const pairs: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    const keys = topo.faceEdgeKeys[f];
    for (let p = 0; p < 3; p++) {
      const k = keys[p];
      if (k < 0 || topo.edgeCounts.get(k) !== 1) continue;
      const u = pairs[p][0];
      const v = pairs[p][1];
      // La cara existente recorre u -> v; la tapa recorre v -> u para conservar winding coherente
      let list = outBound.get(v);
      if (!list) {
        list = [];
        outBound.set(v, list);
      }
      list.push({ to: u, used: false });
    }
  }

  const simpleLoops: number[][] = [];
  const maxWalkSteps = topo.openEdgeCount + 1;

  for (const [startV, outs] of outBound.entries()) {
    for (let eIdx = 0; eIdx < outs.length; eIdx++) {
      const startEdge = outs[eIdx];
      if (startEdge.used) continue;
      startEdge.used = true;

      const walk: number[] = [startV];
      const posInWalk = new Map<number, number>([[startV, 0]]);
      let cur = startEdge.to;

      for (let step = 0; step < maxWalkSteps; step++) {
        if (cur === startV) {
          if (walk.length >= 3) {
            simpleLoops.push(walk.slice());
          }
          break;
        }

        const prev = posInWalk.get(cur);
        if (prev !== undefined) {
          const sub = walk.slice(prev);
          if (sub.length >= 3) {
            simpleLoops.push(sub);
          }
          for (let r = prev + 1; r < walk.length; r++) {
            posInWalk.delete(walk[r]);
          }
          walk.length = prev + 1;
        } else {
          posInWalk.set(cur, walk.length);
          walk.push(cur);
        }

        const nextList = outBound.get(cur);
        if (!nextList) break;

        let chosen: { to: number; used: boolean } | null = null;
        for (let n = 0; n < nextList.length; n++) {
          const cand = nextList[n];
          if (cand.used) continue;
          if (posInWalk.has(cand.to)) {
            chosen = cand;
            break;
          }
          if (!chosen) chosen = cand;
        }
        if (!chosen) break;

        chosen.used = true;
        cur = chosen.to;
      }
    }
  }

  const zeroAreaThreshold = 1e-12 * diag * diag;
  const capTris: [number, number, number][] = [];
  const extraPositions: number[] = [];
  let nextVertId = origVertexCount;
  let filledHoleCount = 0;

  for (let lIdx = 0; lIdx < simpleLoops.length; lIdx++) {
    const loop = simpleLoops[lIdx];
    const k = loop.length;
    if (k < 3) continue;

    if (k === 3) {
      if (faceCount + capTris.length + 1 > MAX_TRIANGLES) continue;
      capTris.push([loop[0], loop[1], loop[2]]);
      filledHoleCount++;
      continue;
    }

    let cx = 0;
    let cy = 0;
    let cz = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;

    for (let i = 0; i < k; i++) {
      const v0 = loop[i] * 3;
      const v1 = loop[(i + 1) % k] * 3;
      const x0 = posArray[v0];
      const y0 = posArray[v0 + 1];
      const z0 = posArray[v0 + 2];
      const x1 = posArray[v1];
      const y1 = posArray[v1 + 1];
      const z1 = posArray[v1 + 2];
      cx += x0;
      cy += y0;
      cz += z0;
      nx += (y0 - y1) * (z0 + z1);
      ny += (z0 - z1) * (x0 - x1);
      nz += (x0 - x1) * (y0 + y1);
    }

    cx /= k;
    cy /= k;
    cz /= k;
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen <= zeroAreaThreshold) continue;

    nx /= nLen;
    ny /= nLen;
    nz /= nLen;

    // Base ortonormal dextrógira (T1, T2, N) donde T1 x T2 = +N
    const refX = Math.abs(nx) < 0.9 ? 1 : 0;
    const refY = Math.abs(nx) < 0.9 ? 0 : 1;
    let t1x = refY * nz;
    let t1y = -refX * nz;
    let t1z = refX * ny - refY * nx;
    const t1Len = Math.hypot(t1x, t1y, t1z);
    if (t1Len <= 1e-12) continue;
    t1x /= t1Len;
    t1y /= t1Len;
    t1z /= t1Len;

    const t2x = ny * t1z - nz * t1y;
    const t2y = nz * t1x - nx * t1z;
    const t2z = nx * t1y - ny * t1x;

    const pts2D: THREE.Vector2[] = new Array(k);
    for (let i = 0; i < k; i++) {
      const vi = loop[i] * 3;
      const dx = posArray[vi] - cx;
      const dy = posArray[vi + 1] - cy;
      const dz = posArray[vi + 2] - cz;
      pts2D[i] = new THREE.Vector2(
        dx * t1x + dy * t1y + dz * t1z,
        dx * t2x + dy * t2y + dz * t2z
      );
    }

    let sArea2 = 0;
    for (let i = 0; i < k; i++) {
      const a = pts2D[i];
      const b = pts2D[(i + 1) % k];
      sArea2 += a.x * b.y - b.x * a.y;
    }
    if (0.5 * sArea2 <= zeroAreaThreshold) continue;

    const tris = THREE.ShapeUtils.triangulateShape(pts2D.slice(), []);
    if (tris.length !== k - 2) continue;

    let loopTris: [number, number, number][] = new Array(tris.length);
    for (let t = 0; t < tris.length; t++) {
      const [ia, ib, ic] = tris[t];
      const pa = pts2D[ia];
      const pb = pts2D[ib];
      const pc = pts2D[ic];
      const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      loopTris[t] =
        cross >= 0
          ? [loop[ia], loop[ib], loop[ic]]
          : [loop[ia], loop[ic], loop[ib]];
    }

    const boundEdgeSet = new Set<number>();
    for (let i = 0; i < k; i++) {
      const u = loop[i];
      const v = loop[(i + 1) % k];
      const mn = u < v ? u : v;
      const mx = u < v ? v : u;
      boundEdgeSet.add(mn * origVertexCount + mx);
    }

    const collidingEdges = new Set<number>();
    for (let t = 0; t < loopTris.length; t++) {
      const [a, b, c] = loopTris[t];
      const triPairs: [number, number][] = [
        [a, b],
        [b, c],
        [c, a],
      ];
      for (let p = 0; p < 3; p++) {
        const u = triPairs[p][0];
        const v = triPairs[p][1];
        if (u >= origVertexCount || v >= origVertexCount) continue;
        const mn = u < v ? u : v;
        const mx = u < v ? v : u;
        const ek = mn * origVertexCount + mx;
        if (!boundEdgeSet.has(ek) && existingEdgeSet.has(ek)) {
          collidingEdges.add(ek);
        }
      }
    }

    if (faceCount + capTris.length + loopTris.length + collidingEdges.size * 2 > MAX_TRIANGLES) {
      continue;
    }

    for (const ek of collidingEdges) {
      const u = Math.floor(ek / origVertexCount);
      const v = ek % origVertexCount;
      const m = nextVertId++;
      extraPositions.push(
        0.5 * (posArray[u * 3] + posArray[v * 3]),
        0.5 * (posArray[u * 3 + 1] + posArray[v * 3 + 1]),
        0.5 * (posArray[u * 3 + 2] + posArray[v * 3 + 2])
      );

      const nextTris: [number, number, number][] = [];
      for (let t = 0; t < loopTris.length; t++) {
        const [a, b, c] = loopTris[t];
        if ((a === u && b === v) || (a === v && b === u)) {
          nextTris.push([a, m, c], [m, b, c]);
        } else if ((b === u && c === v) || (b === v && c === u)) {
          nextTris.push([a, b, m], [a, m, c]);
        } else if ((c === u && a === v) || (c === v && a === u)) {
          nextTris.push([a, b, m], [m, b, c]);
        } else {
          nextTris.push([a, b, c]);
        }
      }
      loopTris = nextTris;
    }

    for (let t = 0; t < loopTris.length; t++) {
      const [a, b, c] = loopTris[t];
      const triPairs: [number, number][] = [
        [a, b],
        [b, c],
        [c, a],
      ];
      for (let p = 0; p < 3; p++) {
        const u = triPairs[p][0];
        const v = triPairs[p][1];
        if (u >= origVertexCount || v >= origVertexCount) continue;
        const mn = u < v ? u : v;
        const mx = u < v ? v : u;
        existingEdgeSet.add(mn * origVertexCount + mx);
      }
    }

    for (let t = 0; t < loopTris.length; t++) {
      capTris.push(loopTris[t]);
    }
    filledHoleCount++;
  }

  if (capTris.length === 0) {
    return {
      posArray,
      indices,
      faceCount,
      vertexCount: origVertexCount,
      filledHoleCount: 0,
      addedCapTriangles: 0,
    };
  }

  let nextPos = posArray;
  if (extraPositions.length > 0) {
    nextPos = new Float32Array(posArray.length + extraPositions.length);
    nextPos.set(posArray, 0);
    nextPos.set(extraPositions, posArray.length);
  }

  const nextFaceCount = faceCount + capTris.length;
  const nextIndices = new Uint32Array(nextFaceCount * 3);
  nextIndices.set(indices, 0);
  let dst = faceCount * 3;
  for (let t = 0; t < capTris.length; t++) {
    const tri = capTris[t];
    nextIndices[dst++] = tri[0];
    nextIndices[dst++] = tri[1];
    nextIndices[dst++] = tri[2];
  }

  return {
    posArray: nextPos,
    indices: nextIndices,
    faceCount: nextFaceCount,
    vertexCount: nextVertId,
    filledHoleCount,
    addedCapTriangles: capTris.length,
  };
}

interface PreparedWeldedMesh {
  indices: Uint32Array;
  posArray: Float32Array;
  vertexCount: number;
  faceCount: number;
  bb: THREE.Box3;
  extents: [number, number, number];
  diag: number;
}

function prepareWeldedMesh(rawGeometry: THREE.BufferGeometry): PreparedWeldedMesh {
  const posAttr = rawGeometry.getAttribute('position');
  if (!posAttr || posAttr.count < 3) {
    throw new ValidationError('MESH_EMPTY', {});
  }

  rawGeometry.computeBoundingBox();
  const bb = rawGeometry.boundingBox;
  if (!bb) {
    throw new ValidationError('MESH_BBOX_FAILED', {});
  }

  const extents: [number, number, number] = [
    bb.max.x - bb.min.x,
    bb.max.y - bb.min.y,
    bb.max.z - bb.min.z,
  ];
  const diag = Math.hypot(extents[0], extents[1], extents[2]);
  if (extents[0] < 1e-6 || extents[1] < 1e-6 || extents[2] < 1e-6) {
    throw new ValidationError('MESH_FLAT_OR_DEGENERATE', {
      x: extents[0].toFixed(4),
      y: extents[1].toFixed(4),
      z: extents[2].toFixed(4),
    });
  }

  // Soldado con tolerancia relativa a la diagonal (1e-6 * diag)
  // Construir geometría liviana solo con position para evitar clonar atributos innecesarios (normal, uv, color)
  const cleanForWeld = new THREE.BufferGeometry();
  cleanForWeld.setAttribute('position', posAttr);
  if (rawGeometry.index) {
    cleanForWeld.setIndex(rawGeometry.index);
  }
  const weldTolerance = Math.max(1e-9, diag * 1e-6);
  const indexedGeom = mergeVertices(cleanForWeld, weldTolerance);

  const indexAttr = indexedGeom.getIndex();
  const weldedPos = indexedGeom.getAttribute('position');
  if (!indexAttr || !weldedPos) {
    throw new ValidationError('MESH_INDEXING_FAILED', {});
  }

  const faceCount = Math.floor(indexAttr.count / 3);
  if (faceCount < 4) {
    throw new ValidationError('MESH_TOO_FEW_FACES', {
      faceCount,
      minFaces: 4,
    });
  }
  if (faceCount > MAX_TRIANGLES) {
    throw new ValidationError('MESH_TOO_MANY_TRIANGLES', {
      faceCount: faceCount.toLocaleString(),
      maxTriangles: MAX_TRIANGLES.toLocaleString(),
    });
  }

  const indices =
    indexAttr.array instanceof Uint32Array
      ? indexAttr.array
      : new Uint32Array(indexAttr.array);

  return {
    indices,
    posArray: weldedPos.array as Float32Array,
    vertexCount: weldedPos.count,
    faceCount,
    bb,
    extents,
    diag,
  };
}

/**
 * Inspecciona la topología de la malla sin modificar la escena para reportar defectos reparables
 * (rebabas coplanares no-manifold, normales localmente invertidas y huecos abiertos).
 */
export function diagnoseGeometry(
  rawGeometry: THREE.BufferGeometry,
  fileName: string
): MeshRepairDiagnosis {
  const { indices, posArray, vertexCount, faceCount, diag } = prepareWeldedMesh(rawGeometry);
  const topo = buildEdgeTopology(indices, faceCount, vertexCount);

  let activeIndices: Uint32Array = indices;
  let finalFaceCount = faceCount;
  let prunableFlapCount = 0;
  let postPruneTopo = topo;

  if (topo.nonManifoldEdgeCount > 0) {
    const pruneResult = pruneCoplanarDanglingFlaps(
      indices,
      posArray,
      faceCount,
      topo.faceEdgeKeys,
      topo.edgeCounts,
      diag
    );
    activeIndices = pruneResult.activeIndices;
    finalFaceCount = pruneResult.finalFaceCount;
    prunableFlapCount = pruneResult.prunedFlapCount;
    if (prunableFlapCount > 0) {
      postPruneTopo = buildEdgeTopology(activeIndices, finalFaceCount, vertexCount);
    }
  }

  const inconsistentWindingEdgeCount = postPruneTopo.inconsistentManifoldEdgeCount;
  let harmonizedOrActiveIndices = activeIndices;
  let invertedFaceEstimate = 0;
  if (inconsistentWindingEdgeCount > 0) {
    harmonizedOrActiveIndices = new Uint32Array(activeIndices);
    invertedFaceEstimate = harmonizeManifoldWinding(
      harmonizedOrActiveIndices,
      finalFaceCount,
      postPruneTopo
    );
  }

  let openHoleLoopCount = 0;
  let estimatedCapTriangles = 0;
  if (postPruneTopo.openEdgeCount > 0) {
    const fillResult = fillOpenBoundaryLoops(
      harmonizedOrActiveIndices,
      posArray,
      finalFaceCount,
      vertexCount,
      postPruneTopo,
      diag
    );
    openHoleLoopCount = fillResult.filledHoleCount;
    estimatedCapTriangles = fillResult.addedCapTriangles;
  }

  const hasRepairableIssues =
    prunableFlapCount > 0 || invertedFaceEstimate > 0 || openHoleLoopCount > 0;

  return {
    fileName,
    vertexCount,
    faceCount,
    openEdgeCount: postPruneTopo.openEdgeCount,
    openHoleLoopCount,
    estimatedCapTriangles,
    nonManifoldEdgeCount: postPruneTopo.nonManifoldEdgeCount,
    prunableFlapCount,
    inconsistentWindingEdgeCount,
    invertedFaceEstimate,
    hasRepairableIssues,
  };
}

/**
 * Suelda vértices con tolerancia relativa a la diagonal del bounding box,
 * verifica estanqueidad en el 100% de las aristas, evalúa el volumen firmado
 * restando el centroide SOLO en componentes 100% cerradas y decide la inversión
 * por profundidad de anidamiento (par -> positivo, impar -> negativo).
 * Las componentes abiertas no se tocan y generan una advertencia explícita.
 */
export function normalizeAndValidateGeometry(
  rawGeometry: THREE.BufferGeometry,
  fileName: string,
  unitScaleApplied = 1.0,
  loaderWarnings: string[] = [],
  options?: NormalizeMeshOptions
): { geometry: THREE.BufferGeometry; metadata: MeshMetadata } {
  const { indices, posArray, vertexCount, faceCount, bb, extents, diag } =
    prepareWeldedMesh(rawGeometry);

  let workingPos = posArray;
  let workingVertexCount = vertexCount;

  let topo = buildEdgeTopology(indices, faceCount, workingVertexCount);
  let activeIndices: Uint32Array = indices;
  let finalFaceCount = faceCount;
  let prunedFlapCount = 0;

  // Pass 1: Podar triángulos rebaba coplanares no-manifold si existen aristas con count > 2
  if (options?.pruneFlaps !== false && topo.nonManifoldEdgeCount > 0) {
    const pruneResult = pruneCoplanarDanglingFlaps(
      indices,
      workingPos,
      faceCount,
      topo.faceEdgeKeys,
      topo.edgeCounts,
      diag
    );
    activeIndices = pruneResult.activeIndices;
    finalFaceCount = pruneResult.finalFaceCount;
    prunedFlapCount = pruneResult.prunedFlapCount;
    if (prunedFlapCount > 0) {
      topo = buildEdgeTopology(activeIndices, finalFaceCount, workingVertexCount);
    }
  }

  // Pass 2: Armonizar orientación cara-a-cara por BFS sobre aristas manifold (count === 2)
  let harmonizedFaceCount =
    options?.harmonizeWinding !== false && topo.inconsistentManifoldEdgeCount > 0
      ? harmonizeManifoldWinding(activeIndices, finalFaceCount, topo)
      : 0;

  // Pass 2.5: Cerrar automáticamente lazos de borde abiertos si se solicita
  let filledHoleCount = 0;
  let addedCapTriangles = 0;
  if (options?.fillHoles === true && topo.openEdgeCount > 0) {
    const fillResult = fillOpenBoundaryLoops(
      activeIndices,
      workingPos,
      finalFaceCount,
      workingVertexCount,
      topo,
      diag
    );
    filledHoleCount = fillResult.filledHoleCount;
    addedCapTriangles = fillResult.addedCapTriangles;
    if (addedCapTriangles > 0) {
      workingPos = fillResult.posArray;
      activeIndices = fillResult.indices;
      finalFaceCount = fillResult.faceCount;
      workingVertexCount = fillResult.vertexCount;
      topo = buildEdgeTopology(activeIndices, finalFaceCount, workingVertexCount);
      if (options?.harmonizeWinding !== false && topo.inconsistentManifoldEdgeCount > 0) {
        harmonizedFaceCount += harmonizeManifoldWinding(activeIndices, finalFaceCount, topo);
      }
    }
  }

  const {
    edgeCounts,
    adjFaces,
    faceEdgeKeys,
    openEdgeCount,
    nonManifoldEdgeCount,
    isWatertight,
  } = topo;

  // Pass 3: Agrupación en componentes conexas (separar 100% cerradas vs abiertas)
  const visited = new Uint8Array(finalFaceCount);
  const closedComponents: ClosedComponentInfo[] = [];
  let openComponentCount = 0;

  for (let startF = 0; startF < finalFaceCount; startF++) {
    if (visited[startF]) continue;
    const compFaces: number[] = [];
    const stack = [startF];
    visited[startF] = 1;
    let isCompClosed = true;

    while (stack.length > 0) {
      const f = stack.pop()!;
      compFaces.push(f);
      const [k0, k1, k2] = faceEdgeKeys[f];
      if (
        k0 < 0 ||
        k1 < 0 ||
        k2 < 0 ||
        edgeCounts.get(k0) !== 2 ||
        edgeCounts.get(k1) !== 2 ||
        edgeCounts.get(k2) !== 2
      ) {
        isCompClosed = false;
      }
      for (const nf of adjFaces[f]) {
        if (!visited[nf]) {
          visited[nf] = 1;
          stack.push(nf);
        }
      }
    }

    if (!isCompClosed) {
      // Componente abierta: NO tocar su winding global
      openComponentCount++;
      continue;
    }

    // Componente 100% cerrada: calcular centroide y bbox
    let sumX = 0, sumY = 0, sumZ = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const countVerts = compFaces.length * 3;

    for (const f of compFaces) {
      const fBase = f * 3;
      for (let k = 0; k < 3; k++) {
        const vi = activeIndices[fBase + k] * 3;
        const vx = workingPos[vi];
        const vy = workingPos[vi + 1];
        const vz = workingPos[vi + 2];
        sumX += vx;
        sumY += vy;
        sumZ += vz;
        if (vx < minX) minX = vx;
        if (vy < minY) minY = vy;
        if (vz < minZ) minZ = vz;
        if (vx > maxX) maxX = vx;
        if (vy > maxY) maxY = vy;
        if (vz > maxZ) maxZ = vz;
      }
    }
    const cx0 = sumX / countVerts;
    const cy0 = sumY / countVerts;
    const cz0 = sumZ / countVerts;

    // Volumen firmado restando el centroide de la componente
    let signedVol6 = 0;
    for (const f of compFaces) {
      const fBase = f * 3;
      const i0 = activeIndices[fBase] * 3;
      const i1 = activeIndices[fBase + 1] * 3;
      const i2 = activeIndices[fBase + 2] * 3;
      const ax = workingPos[i0] - cx0;
      const ay = workingPos[i0 + 1] - cy0;
      const az = workingPos[i0 + 2] - cz0;
      const bx = workingPos[i1] - cx0;
      const by = workingPos[i1 + 1] - cy0;
      const bz = workingPos[i1 + 2] - cz0;
      const cx = workingPos[i2] - cx0;
      const cy = workingPos[i2 + 1] - cy0;
      const cz = workingPos[i2 + 2] - cz0;
      signedVol6 +=
        ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx);
    }

    const firstVi = activeIndices[compFaces[0] * 3] * 3;
    closedComponents.push({
      faces: compFaces,
      signedVol6,
      sampleVertex: [
        workingPos[firstVi],
        workingPos[firstVi + 1],
        workingPos[firstVi + 2],
      ],
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
    });
  }

  // Decidir inversión por profundidad de anidamiento (rayo desde sampleVertex)
  // Dirección de rayo ligeramente perturbada para evitar aristas/vértices alineados a ejes
  const rLen = Math.hypot(1.0, 1.37e-4, 2.19e-4);
  const rdx = 1.0 / rLen;
  const rdy = 1.37e-4 / rLen;
  const rdz = 2.19e-4 / rLen;

  let invertedComponentCount = 0;

  for (let i = 0; i < closedComponents.length; i++) {
    const comp = closedComponents[i];
    const [ox, oy, oz] = comp.sampleVertex;
    let nestingDepth = 0;

    for (let j = 0; j < closedComponents.length; j++) {
      if (i === j) continue;
      const other = closedComponents[j];
      if (
        ox < other.minX || ox > other.maxX ||
        oy < other.minY || oy > other.maxY ||
        oz < other.minZ || oz > other.maxZ
      ) {
        continue;
      }
      let hits = 0;
      for (const f of other.faces) {
        const fBase = f * 3;
        const i0 = activeIndices[fBase] * 3;
        const i1 = activeIndices[fBase + 1] * 3;
        const i2 = activeIndices[fBase + 2] * 3;
        const x0 = workingPos[i0];
        const x1 = workingPos[i1];
        const x2 = workingPos[i2];
        // Descarte rápido: el rayo apunta hacia +X, omitir triángulos completamente detrás
        if (x0 < ox && x1 < ox && x2 < ox) continue;
        if (
          rayIntersectsTriangle(
            ox, oy, oz,
            rdx, rdy, rdz,
            x0, workingPos[i0 + 1], workingPos[i0 + 2],
            x1, workingPos[i1 + 1], workingPos[i1 + 2],
            x2, workingPos[i2 + 1], workingPos[i2 + 2]
          )
        ) {
          hits++;
        }
      }
      if (hits % 2 === 1) {
        nestingDepth++;
      }
    }

    // Profundidad par -> volumen positivo; profundidad impar (cavidad real) -> volumen negativo
    const shouldBePositive = nestingDepth % 2 === 0;
    const needsInvert = shouldBePositive
      ? comp.signedVol6 < -1e-9
      : comp.signedVol6 > 1e-9;

    if (needsInvert) {
      invertedComponentCount++;
      for (const f of comp.faces) {
        const tmp = activeIndices[f * 3 + 1];
        activeIndices[f * 3 + 1] = activeIndices[f * 3 + 2];
        activeIndices[f * 3 + 2] = tmp;
      }
    }
  }

  // Reconstruir geometría no indexada con vértices soldados e índices con winding normalizado
  const outPositions = new Float32Array(finalFaceCount * 9);
  for (let f = 0; f < finalFaceCount; f++) {
    const fBase = f * 3;
    const dstBase = f * 9;
    for (let k = 0; k < 3; k++) {
      const vi = activeIndices[fBase + k] * 3;
      const dst = dstBase + k * 3;
      outPositions[dst] = workingPos[vi];
      outPositions[dst + 1] = workingPos[vi + 1];
      outPositions[dst + 2] = workingPos[vi + 2];
    }
  }

  const normalizedGeom = new THREE.BufferGeometry();
  normalizedGeom.setAttribute('position', new THREE.BufferAttribute(outPositions, 3));
  normalizedGeom.computeVertexNormals();
  normalizedGeom.computeBoundingBox();

  let finalVertexCount = workingVertexCount;
  let finalBb = bb;
  let finalExtents = extents;
  if (prunedFlapCount > 0) {
    const usedVerts = new Uint8Array(workingVertexCount);
    finalVertexCount = 0;
    for (let i = 0; i < activeIndices.length; i++) {
      const vi = activeIndices[i];
      if (!usedVerts[vi]) {
        usedVerts[vi] = 1;
        finalVertexCount++;
      }
    }
    finalBb = normalizedGeom.boundingBox ?? bb;
    finalExtents = [
      finalBb.max.x - finalBb.min.x,
      finalBb.max.y - finalBb.min.y,
      finalBb.max.z - finalBb.min.z,
    ];
  }

  const warnings = [...loaderWarnings];
  if (!isWatertight) {
    if (openEdgeCount > 0) {
      warnings.push(
        formatCoreWarning('WARN_MESH_OPEN_EDGES', { count: openEdgeCount })
      );
    }
    if (nonManifoldEdgeCount > 0) {
      warnings.push(
        formatCoreWarning('WARN_MESH_NON_MANIFOLD_EDGES', { count: nonManifoldEdgeCount })
      );
    }
  }
  if (openComponentCount > 0) {
    warnings.push(
      formatCoreWarning('WARN_MESH_OPEN_COMPONENTS', { count: openComponentCount })
    );
  }
  if (invertedComponentCount > 0) {
    warnings.push(
      formatCoreWarning('WARN_MESH_INVERTED_NORMALS_FIXED', { count: invertedComponentCount })
    );
  }
  if (prunedFlapCount > 0) {
    warnings.push(
      formatCoreWarning('WARN_MESH_FLAPS_PRUNED', { count: prunedFlapCount })
    );
  }
  if (harmonizedFaceCount > 0) {
    warnings.push(
      formatCoreWarning('WARN_MESH_WINDING_HARMONIZED', { count: harmonizedFaceCount })
    );
  }
  if (filledHoleCount > 0) {
    warnings.push(
      formatCoreWarning('WARN_MESH_HOLES_FILLED', {
        holes: filledHoleCount,
        triangles: addedCapTriangles,
      })
    );
  }

  const metadata: MeshMetadata = {
    fileName,
    vertexCount: finalVertexCount,
    faceCount: finalFaceCount,
    boundsMin: [finalBb.min.x, finalBb.min.y, finalBb.min.z],
    boundsMax: [finalBb.max.x, finalBb.max.y, finalBb.max.z],
    extents: finalExtents,
    isWatertight,
    openEdgeCount,
    nonManifoldEdgeCount,
    invertedComponentCount,
    openComponentCount,
    prunedFlapCount,
    harmonizedFaceCount,
    filledHoleCount,
    addedCapTriangles,
    unitScaleApplied,
    warnings,
  };

  return { geometry: normalizedGeom, metadata };
}
