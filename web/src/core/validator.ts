import * as THREE from 'three';
import { mergeVertices } from 'three-stdlib';
import { PARAM_BOUNDS } from './params';
import type { CoreParams, MeshMetadata } from '../types/sculpture';

export const SUPPORTED_EXTENSIONS = new Set(['.obj', '.stl', '.3mf', '.ply']);
export const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB
export const MAX_TRIANGLES = 1_000_000;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateFileExtension(fileName: string, byteLength?: number): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new ValidationError('La ruta del archivo está vacía.');
  }
  const dotIdx = trimmed.lastIndexOf('.');
  const ext = dotIdx >= 0 ? trimmed.slice(dotIdx).toLowerCase() : '';
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new ValidationError(
      `Formato de archivo no soportado: '${ext || '(sin extensión)'}'. Formatos válidos: .3mf, .obj, .ply, .stl`
    );
  }
  if (byteLength !== undefined) {
    if (byteLength === 0) {
      throw new ValidationError(`El archivo '${trimmed}' está vacío (0 bytes).`);
    }
    if (byteLength > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(
        `El archivo '${trimmed}' excede el tamaño máximo permitido de 150 MB.`
      );
    }
  }
  return ext;
}

export function validateParams(params: CoreParams): void {
  if (
    !Number.isInteger(params.plates) ||
    params.plates < PARAM_BOUNDS.plates.min ||
    params.plates > PARAM_BOUNDS.plates.max
  ) {
    throw new ValidationError(
      `El número de placas debe ser un entero entre ${PARAM_BOUNDS.plates.min} y ${PARAM_BOUNDS.plates.max} (recibido: ${params.plates}).`
    );
  }
  if (
    !Number.isFinite(params.thickness) ||
    params.thickness < PARAM_BOUNDS.thickness.min ||
    params.thickness > PARAM_BOUNDS.thickness.max
  ) {
    throw new ValidationError(
      `El grosor debe estar entre ${PARAM_BOUNDS.thickness.min} y ${PARAM_BOUNDS.thickness.max} mm (recibido: ${params.thickness}).`
    );
  }
  if (
    !Number.isFinite(params.gap) ||
    params.gap < PARAM_BOUNDS.gap.min ||
    params.gap > PARAM_BOUNDS.gap.max
  ) {
    throw new ValidationError(
      `La separación debe ser mayor o igual a ${PARAM_BOUNDS.gap.min} mm y menor o igual a ${PARAM_BOUNDS.gap.max} mm (recibido: ${params.gap}).`
    );
  }
  if (!['x', 'y', 'z'].includes(params.axis)) {
    throw new ValidationError(
      `El eje de corte debe ser 'x', 'y' o 'z' (recibido: '${params.axis}').`
    );
  }
  if (
    !Number.isFinite(params.sheetW) ||
    params.sheetW < PARAM_BOUNDS.sheetW.min ||
    params.sheetW > PARAM_BOUNDS.sheetW.max ||
    !Number.isFinite(params.sheetH) ||
    params.sheetH < PARAM_BOUNDS.sheetH.min ||
    params.sheetH > PARAM_BOUNDS.sheetH.max
  ) {
    throw new ValidationError(
      `Las dimensiones de la hoja deben estar entre ${PARAM_BOUNDS.sheetW.min} y ${PARAM_BOUNDS.sheetW.max} mm (recibido: ${params.sheetW} x ${params.sheetH}).`
    );
  }
  if (
    !Number.isFinite(params.sheetMargin) ||
    params.sheetMargin < PARAM_BOUNDS.sheetMargin.min ||
    params.sheetMargin > PARAM_BOUNDS.sheetMargin.max
  ) {
    throw new ValidationError(
      `El margen de la hoja debe estar entre ${PARAM_BOUNDS.sheetMargin.min} y ${PARAM_BOUNDS.sheetMargin.max} mm (recibido: ${params.sheetMargin}).`
    );
  }
  if (params.sheetMargin * 2 >= Math.min(params.sheetW, params.sheetH)) {
    throw new ValidationError(
      `El margen (${params.sheetMargin} mm) es demasiado grande para la hoja de ${params.sheetW} x ${params.sheetH} mm.`
    );
  }
  if (
    !Number.isFinite(params.partGap) ||
    params.partGap < PARAM_BOUNDS.partGap.min ||
    params.partGap > PARAM_BOUNDS.partGap.max
  ) {
    throw new ValidationError(
      `La separación entre piezas debe estar entre ${PARAM_BOUNDS.partGap.min} y ${PARAM_BOUNDS.partGap.max} mm (recibido: ${params.partGap}).`
    );
  }
  if (
    !Number.isFinite(params.kerf) ||
    params.kerf < PARAM_BOUNDS.kerf.min ||
    params.kerf > PARAM_BOUNDS.kerf.max
  ) {
    throw new ValidationError(
      `El kerf debe estar entre ${PARAM_BOUNDS.kerf.min} y ${PARAM_BOUNDS.kerf.max} mm (recibido: ${params.kerf}).`
    );
  }
  if (typeof params.scrapTagEnabled !== 'boolean') {
    throw new ValidationError('scrapTagEnabled debe ser un valor booleano.');
  }
}

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
  loaderWarnings: string[] = []
): { geometry: THREE.BufferGeometry; metadata: MeshMetadata } {
  const posAttr = rawGeometry.getAttribute('position');
  if (!posAttr || posAttr.count < 3) {
    throw new ValidationError('La malla cargada está vacía (no contiene triángulos).');
  }

  rawGeometry.computeBoundingBox();
  const bb = rawGeometry.boundingBox;
  if (!bb) {
    throw new ValidationError('No se pudo calcular el bounding box de la malla.');
  }

  const extents: [number, number, number] = [
    bb.max.x - bb.min.x,
    bb.max.y - bb.min.y,
    bb.max.z - bb.min.z,
  ];
  const diag = Math.hypot(extents[0], extents[1], extents[2]);
  if (extents[0] < 1e-6 || extents[1] < 1e-6 || extents[2] < 1e-6) {
    throw new ValidationError(
      `La malla es plana o degenerada (dimensiones: ${extents[0].toFixed(4)} x ${extents[1].toFixed(4)} x ${extents[2].toFixed(4)}). Se requiere un modelo 3D con volumen.`
    );
  }

  // Soldado con tolerancia relativa a la diagonal (1e-6 * diag)
  const cleanForWeld = rawGeometry.clone();
  cleanForWeld.deleteAttribute('normal');
  cleanForWeld.deleteAttribute('uv');
  const weldTolerance = Math.max(1e-9, diag * 1e-6);
  const indexedGeom = mergeVertices(cleanForWeld, weldTolerance);

  const indexAttr = indexedGeom.getIndex();
  const weldedPos = indexedGeom.getAttribute('position');
  if (!indexAttr || !weldedPos) {
    throw new ValidationError('Error al indexar los vértices de la malla.');
  }

  const faceCount = Math.floor(indexAttr.count / 3);
  if (faceCount < 4) {
    throw new ValidationError(
      `La malla tiene muy pocas caras (${faceCount}). Se requiere un modelo 3D con al menos 4 caras.`
    );
  }
  if (faceCount > MAX_TRIANGLES) {
    throw new ValidationError(
      `La malla tiene ${faceCount.toLocaleString()} triángulos, excediendo el máximo permitido (${MAX_TRIANGLES.toLocaleString()}). Simplifica la malla antes de cargarla.`
    );
  }

  const indices = new Uint32Array(indexAttr.count);
  for (let i = 0; i < indexAttr.count; i++) {
    indices[i] = indexAttr.getX(i);
  }

  const vertexCount = weldedPos.count;
  // Mapa de aristas sin dirección: key = minV * vertexCount + maxV
  const edgeCounts = new Map<number, number>();
  const edgeFirstFace = new Map<number, number>();
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
    const keys: [number, number, number] = [0, 0, 0];
    for (let p = 0; p < 3; p++) {
      const u = pairs[p][0];
      const v = pairs[p][1];
      if (u === v) continue;
      const minV = u < v ? u : v;
      const maxV = u < v ? v : u;
      const key = minV * vertexCount + maxV;
      keys[p] = key;
      const prevCount = edgeCounts.get(key) ?? 0;
      edgeCounts.set(key, prevCount + 1);
      const otherFace = edgeFirstFace.get(key);
      if (otherFace !== undefined && otherFace !== f) {
        adjFaces[f].push(otherFace);
        adjFaces[otherFace].push(f);
      } else {
        edgeFirstFace.set(key, f);
      }
    }
    faceEdgeKeys[f] = keys;
  }

  let openEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) openEdgeCount++;
    else if (count > 2) nonManifoldEdgeCount++;
  }
  const isWatertight = openEdgeCount === 0 && nonManifoldEdgeCount === 0;

  // Agrupación en componentes conexas: separar 100% cerradas vs abiertas
  const visited = new Uint8Array(faceCount);
  const closedComponents: ClosedComponentInfo[] = [];
  let openComponentCount = 0;

  for (let startF = 0; startF < faceCount; startF++) {
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
      // Componente abierta: NO tocar su winding
      openComponentCount++;
      continue;
    }

    // Componente 100% cerrada: calcular centroide y bbox
    let sumX = 0, sumY = 0, sumZ = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const countVerts = compFaces.length * 3;

    for (const f of compFaces) {
      for (let k = 0; k < 3; k++) {
        const vi = indices[f * 3 + k];
        const vx = weldedPos.getX(vi);
        const vy = weldedPos.getY(vi);
        const vz = weldedPos.getZ(vi);
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
      const i0 = indices[f * 3];
      const i1 = indices[f * 3 + 1];
      const i2 = indices[f * 3 + 2];
      const ax = weldedPos.getX(i0) - cx0;
      const ay = weldedPos.getY(i0) - cy0;
      const az = weldedPos.getZ(i0) - cz0;
      const bx = weldedPos.getX(i1) - cx0;
      const by = weldedPos.getY(i1) - cy0;
      const bz = weldedPos.getZ(i1) - cz0;
      const cx = weldedPos.getX(i2) - cx0;
      const cy = weldedPos.getY(i2) - cy0;
      const cz = weldedPos.getZ(i2) - cz0;
      signedVol6 +=
        ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx);
    }

    const firstVi = indices[compFaces[0] * 3];
    closedComponents.push({
      faces: compFaces,
      signedVol6,
      sampleVertex: [
        weldedPos.getX(firstVi),
        weldedPos.getY(firstVi),
        weldedPos.getZ(firstVi),
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
        const i0 = indices[f * 3];
        const i1 = indices[f * 3 + 1];
        const i2 = indices[f * 3 + 2];
        if (
          rayIntersectsTriangle(
            ox, oy, oz,
            rdx, rdy, rdz,
            weldedPos.getX(i0), weldedPos.getY(i0), weldedPos.getZ(i0),
            weldedPos.getX(i1), weldedPos.getY(i1), weldedPos.getZ(i1),
            weldedPos.getX(i2), weldedPos.getY(i2), weldedPos.getZ(i2)
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
        const tmp = indices[f * 3 + 1];
        indices[f * 3 + 1] = indices[f * 3 + 2];
        indices[f * 3 + 2] = tmp;
      }
    }
  }

  // Reconstruir geometría no indexada con vértices soldados e índices con winding normalizado
  const outPositions = new Float32Array(faceCount * 9);
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 3; k++) {
      const vi = indices[f * 3 + k];
      outPositions[f * 9 + k * 3] = weldedPos.getX(vi);
      outPositions[f * 9 + k * 3 + 1] = weldedPos.getY(vi);
      outPositions[f * 9 + k * 3 + 2] = weldedPos.getZ(vi);
    }
  }

  const normalizedGeom = new THREE.BufferGeometry();
  normalizedGeom.setAttribute('position', new THREE.BufferAttribute(outPositions, 3));
  normalizedGeom.computeVertexNormals();
  normalizedGeom.computeBoundingBox();

  const warnings = [...loaderWarnings];
  if (!isWatertight) {
    if (openEdgeCount > 0) {
      warnings.push(
        `La malla no es cerrada (${openEdgeCount} aristas abiertas). Algunos cortes podrían quedar incompletos.`
      );
    }
    if (nonManifoldEdgeCount > 0) {
      warnings.push(
        `La malla contiene ${nonManifoldEdgeCount} aristas no-manifold (más de 2 caras compartidas).`
      );
    }
  }
  if (openComponentCount > 0) {
    warnings.push(
      `Se detectaron ${openComponentCount} componente(s) conexa(s) abierta(s); no se modificó la orientación de sus caras.`
    );
  }
  if (invertedComponentCount > 0) {
    warnings.push(
      `Se normalizó automáticamente la orientación de normales en ${invertedComponentCount} componente(s) cerrada(s) con caras invertidas.`
    );
  }

  const metadata: MeshMetadata = {
    fileName,
    vertexCount,
    faceCount,
    boundsMin: [bb.min.x, bb.min.y, bb.min.z],
    boundsMax: [bb.max.x, bb.max.y, bb.max.z],
    extents,
    isWatertight,
    openEdgeCount,
    nonManifoldEdgeCount,
    invertedComponentCount,
    openComponentCount,
    unitScaleApplied,
    warnings,
  };

  return { geometry: normalizedGeom, metadata };
}
