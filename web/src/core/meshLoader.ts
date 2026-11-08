import * as THREE from 'three';
import {
  STLLoader,
  OBJLoader,
  PLYLoader,
  ThreeMFLoader,
  mergeBufferGeometries,
} from 'three-stdlib';
import { unzipSync, strFromU8 } from 'fflate';
import {
  validateFileExtension,
  normalizeAndValidateGeometry,
  ValidationError,
  formatCoreWarning,
} from './validator';
import type { MeshMetadata } from '../types/sculpture';

const THREE_MF_UNIT_SCALE: Record<string, number> = {
  micron: 0.001,
  millimeter: 1.0,
  centimeter: 10.0,
  inch: 25.4,
  foot: 304.8,
  meter: 1000.0,
};

function extract3MFUnitScale(buffer: ArrayBuffer): number {
  try {
    const zipData = unzipSync(new Uint8Array(buffer));
    for (const [path, bytes] of Object.entries(zipData)) {
      if (path.toLowerCase().endsWith('.model')) {
        const xmlHead = strFromU8(bytes.subarray(0, Math.min(bytes.length, 4096)));
        const match = xmlHead.match(/<model\b[^>]*\bunit=["']([^"']+)["']/i);
        if (match && match[1]) {
          const unitName = match[1].toLowerCase();
          return THREE_MF_UNIT_SCALE[unitName] ?? 1.0;
        }
      }
    }
  } catch {
    // Si falla la inspección previa del XML, ThreeMFLoader lanzará el error correspondiente
  }
  return 1.0;
}

function extractMergedGeometryFromObject3D(
  root: THREE.Object3D,
  unitScale = 1.0
): { geometry: THREE.BufferGeometry; warnings: string[] } {
  root.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];
  let ignoredLinesOrPoints = 0;

  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && mesh.geometry.getAttribute('position')?.count >= 3) {
        const posOnly = new THREE.BufferGeometry();
        posOnly.setAttribute('position', mesh.geometry.getAttribute('position').clone());
        if (mesh.geometry.index) {
          posOnly.setIndex(mesh.geometry.index);
        }
        posOnly.applyMatrix4(mesh.matrixWorld);
        if (Math.abs(unitScale - 1.0) > 1e-9) {
          posOnly.scale(unitScale, unitScale, unitScale);
        }
        const nonIndexed = posOnly.index ? posOnly.toNonIndexed() : posOnly;
        geometries.push(nonIndexed);
      }
    } else if (
      (child as THREE.Line).isLine ||
      (child as THREE.Points).isPoints
    ) {
      ignoredLinesOrPoints++;
    }
  });

  if (geometries.length === 0) {
    if (ignoredLinesOrPoints > 0) {
      throw new ValidationError('MESH_ONLY_LINES_OR_POINTS', {});
    }
    throw new ValidationError('MESH_NO_TRIANGLES_FOUND', {});
  }

  const warnings: string[] = [];
  if (ignoredLinesOrPoints > 0) {
    warnings.push(
      formatCoreWarning('WARN_LOADER_IGNORED_LINES_OR_POINTS', {
        count: ignoredLinesOrPoints,
      })
    );
  }

  const merged =
    geometries.length === 1
      ? geometries[0]
      : mergeBufferGeometries(geometries, false);

  if (!merged) {
    throw new ValidationError('MESH_MERGE_FAILED', {});
  }

  return { geometry: merged, warnings };
}

function checkPLYHasFaces(buffer: ArrayBuffer): void {
  const headBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
  const headText = new TextDecoder('utf-8', { fatal: false }).decode(headBytes);
  const faceMatch = headText.match(/element\s+face\s+(\d+)/i);
  if (!faceMatch || Number.parseInt(faceMatch[1], 10) === 0) {
    throw new ValidationError('PLY_POINT_CLOUD_NO_FACES', {});
  }
}

export interface LoadMeshOptions {
  upOrientation?: 'y-up' | 'z-up' | 'auto';
}

export function loadMeshFromBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  options?: LoadMeshOptions
): { geometry: THREE.BufferGeometry; metadata: MeshMetadata } {
  const ext = validateFileExtension(fileName, buffer.byteLength);
  let rawGeometry: THREE.BufferGeometry;
  let unitScaleApplied = 1.0;
  let loaderWarnings: string[] = [];

  if (ext === '.stl') {
    const loader = new STLLoader();
    rawGeometry = loader.parse(buffer);
  } else if (ext === '.ply') {
    checkPLYHasFaces(buffer);
    const loader = new PLYLoader();
    const parsed = loader.parse(buffer);
    if (!parsed.index && parsed.getAttribute('position')?.count < 12) {
      throw new ValidationError('PLY_NO_VALID_TRIANGLES', {});
    }
    rawGeometry = parsed.index ? parsed.toNonIndexed() : parsed;
  } else if (ext === '.obj') {
    const text = new TextDecoder('utf-8').decode(buffer);
    const loader = new OBJLoader();
    const group = loader.parse(text);
    const extracted = extractMergedGeometryFromObject3D(group, 1.0);
    rawGeometry = extracted.geometry;
    loaderWarnings = extracted.warnings;

    // Si se solicita convertir modelos con convención Y-up a Z-up
    if (options?.upOrientation === 'y-up') {
      // Rotación +90° alrededor del eje X: (x, y, z) -> (x, -z, y)
      rawGeometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI * 0.5));
      loaderWarnings.push(formatCoreWarning('WARN_LOADER_Y_UP_TO_Z_UP', {}));
    }
  } else if (ext === '.3mf') {
    unitScaleApplied = extract3MFUnitScale(buffer);
    const loader = new ThreeMFLoader();
    const group = loader.parse(buffer);
    const extracted = extractMergedGeometryFromObject3D(group, unitScaleApplied);
    rawGeometry = extracted.geometry;
    loaderWarnings = extracted.warnings;
    if (Math.abs(unitScaleApplied - 1.0) > 1e-6) {
      loaderWarnings.push(
        formatCoreWarning('WARN_LOADER_3MF_UNIT_SCALE', { scale: unitScaleApplied })
      );
    }
  } else {
    throw new ValidationError('FILE_EXTENSION_UNSUPPORTED', { ext });
  }

  return normalizeAndValidateGeometry(
    rawGeometry,
    fileName,
    unitScaleApplied,
    loaderWarnings
  );
}
