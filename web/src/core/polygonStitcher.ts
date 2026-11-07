import {
  Clipper64,
  PolyTree64,
  ClipType,
  FillRule,
  Point64,
  Path64,
  Paths64,
  type PolyPathBase,
} from 'clipper2-js';
import { signedArea2D } from './geometry2d';
import type { Point2D, PolygonWithHoles } from '../types/sculpture';
import { applyClipperPatch } from './vendor/clipperPatch';

// Apply workaround for clipper2-js@1.2.4 OutRec initialization issue
applyClipperPatch();

export interface DirectedSegment2D {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface StitchFloorResult {
  polygons: PolygonWithHoles[];
  openChainsDiscarded: number;
  openChainsRepaired: number;
}

export const SNAP_TOLERANCE = 1e-3;       // 0.001 mm
export const MIN_REPAIR_GAP_MM = 0.005;    // 0.005 mm (5x SNAP_TOLERANCE, límite inferior absoluto)
export const MAX_REPAIR_GAP_LIMIT_MM = 0.1; // 0.1 mm (límite superior absoluto, por debajo del kerf típico)
export const REPAIR_GAP_DIAG_FACTOR = 1e-4; // Factor relativo a la diagonal 3D escalada (~1e-4 * diag)
export const MAX_REPAIR_GAP_MM = 0.05;    // 0.05 mm máxima micro-brecha reparable por defecto (~500 mm diag)
export const CLIPPER_SCALE = 100_000;     // Precisión 1e-5 mm en enteros de Clipper64
export const MIN_POLYGON_AREA_MM2 = 1e-3; // Área mínima en mm² para descartar astillas numéricas y contornos colapsados

/**
 * Calcula la tolerancia de micro-brecha reparable relativa a la escala real del modelo:
 * clamp(diag * 1e-4, MIN_REPAIR_GAP_MM = 0.005, MAX_REPAIR_GAP_LIMIT_MM = 0.1) mm.
 */
export function computeRepairGapMm(scaledDiagonalMm: number): number {
  return Math.max(
    MIN_REPAIR_GAP_MM,
    Math.min(MAX_REPAIR_GAP_LIMIT_MM, scaledDiagonalMm * REPAIR_GAP_DIAG_FACTOR)
  );
}

interface VertexNode {
  x: number;
  y: number;
  outEdges: number[];
}

export const CELL_OFFSET = 33_554_432;  // 2^25 (~33,554 mm span at 1e-3 snap)
export const CELL_STRIDE = 67_108_864;  // 2^26 (strictly < Number.MAX_SAFE_INTEGER)

export function cellKey(cx: number, cy: number): number {
  return (cx + CELL_OFFSET) * CELL_STRIDE + (cy + CELL_OFFSET);
}

export function polyTreeToPolygonsWithHoles(polyTree: PolyTree64): PolygonWithHoles[] {
  const resultPolygons: PolygonWithHoles[] = [];
  const invScale = 1.0 / CLIPPER_SCALE;

  function toRing2D(path: Path64, wantCCW: boolean): Point2D[] {
    const ring: Point2D[] = path.map((pt) => [pt.x * invScale, pt.y * invScale]);
    const area = signedArea2D(ring);
    if ((wantCCW && area < 0) || (!wantCCW && area > 0)) {
      ring.reverse();
    }
    return ring;
  }

  function traverseNode(node: PolyPathBase): void {
    for (const child of node.children) {
      if (!child.isHole && child.polygon && child.polygon.length >= 3) {
        const exterior = toRing2D(child.polygon, true); // Exterior siempre CCW
        const holes: Point2D[][] = [];
        let holeAreaSum = 0;

        for (const holeNode of child.children) {
          if (holeNode.isHole && holeNode.polygon && holeNode.polygon.length >= 3) {
            const holeRing = toRing2D(holeNode.polygon, false); // Hueco siempre CW
            holes.push(holeRing);
            holeAreaSum += Math.abs(signedArea2D(holeRing));

            // Islas dentro del hueco son nuevos polígonos exteriores (anidación profunda)
            traverseNode(holeNode);
          }
        }

        const extArea = Math.abs(signedArea2D(exterior));
        const netArea = extArea - holeAreaSum;
        if (netArea >= MIN_POLYGON_AREA_MM2) {
          resultPolygons.push({
            exterior,
            holes,
            area: netArea,
          });
        }
      }
    }
  }

  traverseNode(polyTree);

  // Ordenar de mayor a menor área para estabilidad determinista
  resultPolygons.sort((a, b) => b.area - a.area);

  return resultPolygons;
}

/**
 * Une segmentos dirigidos en lazos cerrados en tiempo O(n) usando hash espacial 2D,
 * fusiona cadenas abiertas cuyos extremos (tail -> head) disten <= maxRepairGapMm
 * independientemente del segmento de arranque, y ejecuta Clipper64.executePolyTree
 * con ClipType.Union y FillRule.NonZero.
 */
export function stitchAndUnionSegments(
  segments: DirectedSegment2D[],
  maxRepairGapMm: number = MAX_REPAIR_GAP_MM
): StitchFloorResult {
  if (segments.length === 0) {
    return { polygons: [], openChainsDiscarded: 0, openChainsRepaired: 0 };
  }

  const invCell = 1.0 / SNAP_TOLERANCE;
  const grid = new Map<number, number[]>();
  const vertices: VertexNode[] = [];
  const tolSq = SNAP_TOLERANCE * SNAP_TOLERANCE;

  function getOrCreateVertex(x: number, y: number): number {
    const cx = Math.floor(x * invCell);
    const cy = Math.floor(y * invCell);

    let bestIdx = -1;
    let bestDistSq = tolSq;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(cellKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const vIdx of bucket) {
          const v = vertices[vIdx];
          const dSq = (v.x - x) * (v.x - x) + (v.y - y) * (v.y - y);
          if (dSq <= bestDistSq) {
            bestDistSq = dSq;
            bestIdx = vIdx;
          }
        }
      }
    }

    if (bestIdx !== -1) {
      return bestIdx;
    }

    const newIdx = vertices.length;
    vertices.push({ x, y, outEdges: [] });
    const key = cellKey(cx, cy);
    const bucket = grid.get(key);
    if (bucket) bucket.push(newIdx);
    else grid.set(key, [newIdx]);
    return newIdx;
  }

  interface Edge {
    from: number;
    to: number;
    dx: number;
    dy: number;
    used: boolean;
  }

  const edges: Edge[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    if (dx * dx + dy * dy <= 1e-16) continue;
    const u = getOrCreateVertex(s.x0, s.y0);
    const v = getOrCreateVertex(s.x1, s.y1);
    if (u === v) continue;
    const edgeIdx = edges.length;
    edges.push({ from: u, to: v, dx, dy, used: false });
    vertices[u].outEdges.push(edgeIdx);
  }

  // Elegir la siguiente arista saliente no usada de forma determinista (giro más a la derecha)
  function pickNextEdge(currVertex: number, inDx: number, inDy: number): number {
    const outList = vertices[currVertex].outEdges;
    let availableCount = 0;
    let singleCandidate = -1;
    for (const eIdx of outList) {
      if (!edges[eIdx].used) {
        availableCount++;
        singleCandidate = eIdx;
      }
    }
    if (availableCount === 0) return -1;
    if (availableCount === 1) return singleCandidate;

    const baseAngle = Math.atan2(-inDy, -inDx);
    let bestEdge = -1;
    let bestDelta = Infinity;

    for (const eIdx of outList) {
      const e = edges[eIdx];
      if (e.used) continue;
      let delta = Math.atan2(e.dy, e.dx) - baseAngle;
      while (delta <= 0) delta += Math.PI * 2;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestEdge = eIdx;
      }
    }
    return bestEdge;
  }

  const closedLoops: Point2D[][] = [];
  const openChains: number[][] = [];
  let openChainsDiscarded = 0;
  let openChainsRepaired = 0;

  // 1. Construir cadenas por conectividad exacta (SNAP_TOLERANCE)
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;

    const startEdge = edges[i];
    startEdge.used = true;
    const startVertex = startEdge.from;
    let currVertex = startEdge.to;
    let prevDx = startEdge.dx;
    let prevDy = startEdge.dy;

    const chainVertices: number[] = [startVertex, currVertex];

    while (currVertex !== startVertex) {
      const nextEdgeIdx = pickNextEdge(currVertex, prevDx, prevDy);
      if (nextEdgeIdx === -1) break;
      const nextEdge = edges[nextEdgeIdx];
      nextEdge.used = true;
      currVertex = nextEdge.to;
      prevDx = nextEdge.dx;
      prevDy = nextEdge.dy;
      chainVertices.push(currVertex);
    }

    if (currVertex === startVertex) {
      chainVertices.pop(); // Quitar el vértice repetido de cierre
      if (chainVertices.length >= 3) {
        closedLoops.push(chainVertices.map((vi) => [vertices[vi].x, vertices[vi].y]));
      }
    } else {
      openChains.push(chainVertices);
    }
  }

  // 2. Unir el final (tail) de una cadena abierta con el inicio (head) de otra
  //    usando un hash espacial 2D con radio MAX_REPAIR_GAP_MM antes de decidir cierre o descarte.
  //    headGrid se mantiene incrementalmente: cada cadena activa se indexa una sola vez por su head,
  //    y se remueve al desactivarse (al fusionarse como B o al cerrarse como A).
  if (openChains.length > 0) {
    const active = new Uint8Array(openChains.length);
    active.fill(1);
    const invRepairCell = 1.0 / maxRepairGapMm;
    const maxGapSq = maxRepairGapMm * maxRepairGapMm;

    // Inicializar headGrid una sola vez con los índices ordenados de todas las cadenas abiertas
    const headGrid = new Map<number, number[]>();
    for (let cIdx = 0; cIdx < openChains.length; cIdx++) {
      const headV = vertices[openChains[cIdx][0]];
      const hx = Math.floor(headV.x * invRepairCell);
      const hy = Math.floor(headV.y * invRepairCell);
      const key = cellKey(hx, hy);
      const bucket = headGrid.get(key);
      if (bucket) bucket.push(cIdx);
      else headGrid.set(key, [cIdx]);
    }

    function removeHeadFromGrid(chainIdx: number): void {
      const headV = vertices[openChains[chainIdx][0]];
      const hx = Math.floor(headV.x * invRepairCell);
      const hy = Math.floor(headV.y * invRepairCell);
      const key = cellKey(hx, hy);
      const bucket = headGrid.get(key);
      if (bucket) {
        const idx = bucket.indexOf(chainIdx);
        if (idx !== -1) {
          bucket.splice(idx, 1);
        }
      }
    }

    for (let i = 0; i < openChains.length; i++) {
      if (!active[i]) continue;
      const chainA = openChains[i];

      // Extender chainA de forma iterativa mientras encuentre una cabeza vecina en headGrid
      while (active[i]) {
        const tailIdx = chainA[chainA.length - 1];
        const tailV = vertices[tailIdx];
        const tx = Math.floor(tailV.x * invRepairCell);
        const ty = Math.floor(tailV.y * invRepairCell);

        let bestOther = -1;
        let bestDistSq = maxGapSq;

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = headGrid.get(cellKey(tx + dx, ty + dy));
            if (!bucket) continue;
            for (let b = 0; b < bucket.length; b++) {
              const j = bucket[b];
              if (j === i || !active[j]) continue;
              const headV = vertices[openChains[j][0]];
              const dSq =
                (tailV.x - headV.x) * (tailV.x - headV.x) +
                (tailV.y - headV.y) * (tailV.y - headV.y);
              if (dSq <= bestDistSq) {
                bestDistSq = dSq;
                bestOther = j;
              }
            }
          }
        }

        if (bestOther === -1) {
          // No hay candidato para extender la cola de chainA; pasar a la siguiente cadena
          break;
        }

        // Fusionar chainB en chainA
        const chainB = openChains[bestOther];
        const bridgeDist = Math.sqrt(bestDistSq);
        if (bridgeDist > SNAP_TOLERANCE) {
          openChainsRepaired++;
        }
        if (tailIdx === chainB[0]) {
          for (let k = 1; k < chainB.length; k++) {
            chainA.push(chainB[k]);
          }
        } else {
          for (let k = 0; k < chainB.length; k++) {
            chainA.push(chainB[k]);
          }
        }
        active[bestOther] = 0;
        removeHeadFromGrid(bestOther);

        // Si tras fusionar la cadena cierra exactamente sobre su propio head
        if (chainA[chainA.length - 1] === chainA[0]) {
          chainA.pop();
          if (chainA.length >= 3) {
            closedLoops.push(chainA.map((vi) => [vertices[vi].x, vertices[vi].y]));
          }
          active[i] = 0;
          removeHeadFromGrid(i);
          break;
        }
      }
    }

    // 3. Evaluar cierre o descarte para las cadenas abiertas restantes
    for (let i = 0; i < openChains.length; i++) {
      if (!active[i]) continue;
      const chain = openChains[i];
      const firstV = vertices[chain[0]];
      const lastV = vertices[chain[chain.length - 1]];
      const gapDist = Math.hypot(lastV.x - firstV.x, lastV.y - firstV.y);

      if (chain.length >= 3 && gapDist <= maxRepairGapMm) {
        if (gapDist > SNAP_TOLERANCE) {
          openChainsRepaired++;
        }
        closedLoops.push(chain.map((vi) => [vertices[vi].x, vertices[vi].y]));
      } else {
        openChainsDiscarded++;
      }
    }
  }

  if (closedLoops.length === 0) {
    return { polygons: [], openChainsDiscarded, openChainsRepaired };
  }

  const subjectPaths = new Paths64();
  for (const loop of closedLoops) {
    const path = new Path64();
    for (const [x, y] of loop) {
      path.push(
        new Point64(
          Math.round(x * CLIPPER_SCALE),
          Math.round(y * CLIPPER_SCALE)
        )
      );
    }
    subjectPaths.push(path);
  }

  const clipper = new Clipper64();
  clipper.preserveCollinear = false;
  clipper.addSubjectPaths(subjectPaths);

  const polyTree = new PolyTree64();
  clipper.executePolyTree(ClipType.Union, FillRule.NonZero, polyTree);

  const resultPolygons = polyTreeToPolygonsWithHoles(polyTree);

  return {
    polygons: resultPolygons,
    openChainsDiscarded,
    openChainsRepaired,
  };
}
