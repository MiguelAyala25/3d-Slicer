import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { affineInvert } from '../../core/affine2d';
import {
  computeImageToPlate,
  getSurfaceVisibility,
} from '../../core/imageProjection';
import { useSculptureStore } from '../../store/useSculptureStore';
import type { ImageDecal, PolygonWithHoles } from '../../types/sculpture';
import {
  acquireDecalTexture,
  getCachedDecalTexture,
} from './decalTextureCache';
import { getLiveDecalTransform } from './decalLiveTransform';
import { visualPlateDepth } from './plateGeometry';
import { getSliceGroupRotation } from './sliceAxisTransform';

const NOOP_RAYCAST = () => null;

const DECAL_VERTEX_SHADER = /* glsl */ `
varying vec2 vPlateXY;
void main() {
  vPlateXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DECAL_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uRow0;
uniform vec3 uRow1;
varying vec2 vPlateXY;
void main() {
  float u = uRow0.x * vPlateXY.x + uRow0.y * vPlateXY.y + uRow0.z;
  float v = uRow1.x * vPlateXY.x + uRow1.y * vPlateXY.y + uRow1.z;
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) discard;
  vec4 texColor = texture2D(uMap, vec2(u, v));
  if (texColor.a < 0.01) discard;
  gl_FragColor = texColor;
  #include <colorspace_fragment>
}
`;

function buildPlateShapeGeometry(
  polys: PolygonWithHoles[] | undefined
): THREE.BufferGeometry | null {
  if (!polys || polys.length === 0) return null;
  const shapes: THREE.Shape[] = [];
  for (const poly of polys) {
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
  if (shapes.length === 0) return null;
  return new THREE.ShapeGeometry(shapes, 1);
}

function writePlateToUvUniforms(
  transform: Pick<
    ImageDecal,
    'pxW' | 'pxH' | 'centerX' | 'centerZ' | 'widthMm' | 'heightMm' | 'rotationDeg'
  >,
  row0: THREE.Vector3,
  row1: THREE.Vector3
): void {
  const safeW = Math.max(0.5, transform.widthMm);
  const safeH = Math.max(0.5, transform.heightMm);
  const safePxW = Math.max(1, transform.pxW);
  const safePxH = Math.max(1, transform.pxH);

  const imageToPlate = computeImageToPlate({
    pxW: safePxW,
    pxH: safePxH,
    centerX: transform.centerX,
    centerZ: transform.centerZ,
    widthMm: safeW,
    heightMm: safeH,
    rotationDeg: transform.rotationDeg,
  });
  const [a, b, c, d, e, f] = affineInvert(imageToPlate);
  row0.set(a / safePxW, c / safePxW, e / safePxW);
  row1.set(-b / safePxH, -d / safePxH, 1.0 - f / safePxH);
}

function createDecalShaderMaterial(tex: THREE.Texture | null): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: DECAL_VERTEX_SHADER,
    fragmentShader: DECAL_FRAGMENT_SHADER,
    uniforms: {
      uMap: { value: tex },
      uRow0: { value: new THREE.Vector3(0, 0, -1) },
      uRow1: { value: new THREE.Vector3(0, 0, -1) },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

export function DecalPreviewLayer() {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const lastSliceAxis = useSculptureStore((s) => s.lastSliceAxis);
  const decals = useSculptureStore((s) => s.decals);
  const decalObjectUrls = useSculptureStore((s) => s.decalObjectUrls);
  const thickness = useSculptureStore((s) => s.params.thickness);
  const gap = useSculptureStore((s) => s.params.gap);
  const showAllFloors = useSculptureStore((s) => s.showAllFloors);
  const activeFloor = useSculptureStore((s) => s.activeFloor);

  const [loadedTextures, setLoadedTextures] = useState<
    Record<string, { url: string; tex: THREE.Texture }>
  >({});

  const activeDecals = useMemo(
    () =>
      decals
        .filter(
          (d) =>
            d.visible &&
            d.widthMm > 0 &&
            d.heightMm > 0 &&
            d.pxW > 0 &&
            d.pxH > 0
        )
        .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id.localeCompare(b.id))),
    [decals]
  );

  const hasSurfaceDecal = activeDecals.some((d) => d.mode === 'surface');
  const hasPlaneDecal = activeDecals.some((d) => d.mode === 'plane');

  // Triangulación única por SliceResult (no se recalcula nunca al mover/escalar decals)
  const surfacePlateGeoms = useMemo(() => {
    if (!sliceResult || lastSliceAxis !== 'y' || !hasSurfaceDecal) return [];
    const { visibleSurfacePlates } = getSurfaceVisibility(sliceResult);
    return visibleSurfacePlates.map((polys) => buildPlateShapeGeometry(polys));
  }, [sliceResult, lastSliceAxis, hasSurfaceDecal]);

  useEffect(() => {
    return () => {
      for (const g of surfacePlateGeoms) {
        g?.dispose();
      }
    };
  }, [surfacePlateGeoms]);

  const fullPlateGeoms = useMemo(() => {
    if (!sliceResult || lastSliceAxis !== 'y' || !hasPlaneDecal) return [];
    return sliceResult.plates.map((polys) => buildPlateShapeGeometry(polys));
  }, [sliceResult, lastSliceAxis, hasPlaneDecal]);

  useEffect(() => {
    return () => {
      for (const g of fullPlateGeoms) {
        g?.dispose();
      }
    };
  }, [fullPlateGeoms]);

  // Cargar y compartir texturas por imageKey sin duplicar descodificación
  useEffect(() => {
    if (lastSliceAxis !== 'y' || activeDecals.length === 0) return;
    const unsubs: Array<() => void> = [];
    const seen = new Set<string>();

    for (const d of activeDecals) {
      if (seen.has(d.imageKey)) continue;
      seen.add(d.imageKey);
      const url = decalObjectUrls[d.imageKey];
      if (!url) continue;

      const cached = getCachedDecalTexture(d.imageKey, url);
      if (cached) {
        setLoadedTextures((prev) =>
          prev[d.imageKey]?.url === url && prev[d.imageKey]?.tex === cached
            ? prev
            : { ...prev, [d.imageKey]: { url, tex: cached } }
        );
        continue;
      }

      const key = d.imageKey;
      unsubs.push(
        acquireDecalTexture(key, url, (tex) => {
          setLoadedTextures((prev) => ({
            ...prev,
            [key]: { url, tex },
          }));
        })
      );
    }

    return () => {
      for (const u of unsubs) u();
    };
  }, [activeDecals, decalObjectUrls, lastSliceAxis]);

  // Pool persistente de ShaderMaterial por decal.id (evita recompilar GLSL durante arrastre)
  const materialsRef = useRef<Map<string, THREE.ShaderMaterial>>(new Map());
  const activeIdsKey = activeDecals.map((d) => d.id).join('|');

  const materialsById = useMemo(() => {
    const map = new Map<string, THREE.ShaderMaterial>();
    for (const d of activeDecals) {
      let mat = materialsRef.current.get(d.id);
      const url = decalObjectUrls[d.imageKey];
      const tex =
        url && loadedTextures[d.imageKey]?.url === url
          ? loadedTextures[d.imageKey].tex
          : url
            ? getCachedDecalTexture(d.imageKey, url)
            : null;
      if (!mat) {
        mat = createDecalShaderMaterial(tex);
        materialsRef.current.set(d.id, mat);
      }
      if (tex && mat.uniforms.uMap.value !== tex) {
        mat.uniforms.uMap.value = tex;
      }
      writePlateToUvUniforms(
        d,
        mat.uniforms.uRow0.value as THREE.Vector3,
        mat.uniforms.uRow1.value as THREE.Vector3
      );
      map.set(d.id, mat);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdsKey]);

  // Sincronizar uniforms y limpiar materiales de decals eliminados
  useLayoutEffect(() => {
    const liveIds = new Set(activeDecals.map((d) => d.id));
    for (const [id, mat] of materialsRef.current.entries()) {
      if (!liveIds.has(id)) {
        mat.dispose();
        materialsRef.current.delete(id);
      }
    }
    for (const d of activeDecals) {
      const mat = materialsRef.current.get(d.id);
      if (!mat) continue;
      const url = decalObjectUrls[d.imageKey];
      const tex =
        url && loadedTextures[d.imageKey]?.url === url
          ? loadedTextures[d.imageKey].tex
          : url
            ? getCachedDecalTexture(d.imageKey, url)
            : null;
      if (tex && mat.uniforms.uMap.value !== tex) {
        mat.uniforms.uMap.value = tex;
      }
      writePlateToUvUniforms(
        d,
        mat.uniforms.uRow0.value as THREE.Vector3,
        mat.uniforms.uRow1.value as THREE.Vector3
      );
    }
  }, [activeDecals, decalObjectUrls, loadedTextures]);

  useEffect(() => {
    const cache = materialsRef.current;
    return () => {
      for (const mat of cache.values()) {
        mat.dispose();
      }
      cache.clear();
    };
  }, []);

  // Actualización GPU en 120 FPS desde el bus transitorio durante arrastre
  useFrame(() => {
    const live = getLiveDecalTransform();
    for (const d of activeDecals) {
      const mat = materialsRef.current.get(d.id);
      if (!mat) continue;
      const source =
        live && live.id === d.id
          ? {
              pxW: d.pxW,
              pxH: d.pxH,
              centerX: live.centerX,
              centerZ: live.centerZ,
              widthMm: live.widthMm,
              heightMm: live.heightMm,
              rotationDeg: live.rotationDeg,
            }
          : d;
      writePlateToUvUniforms(
        source,
        mat.uniforms.uRow0.value as THREE.Vector3,
        mat.uniforms.uRow1.value as THREE.Vector3
      );
    }
  });

  const groupRotation = useMemo(() => getSliceGroupRotation('y'), []);

  if (!sliceResult || lastSliceAxis !== 'y' || activeDecals.length === 0) {
    return null;
  }

  const depth = visualPlateDepth(thickness, gap);
  const plateCount = sliceResult.plates.length;

  return (
    <group rotation={groupRotation}>
      {activeDecals.map((decal, stackIdx) => {
        const url = decalObjectUrls[decal.imageKey];
        const hasTex = Boolean(
          url &&
            (loadedTextures[decal.imageKey]?.url === url ||
              getCachedDecalTexture(decal.imageKey, url))
        );
        const mat = materialsById.get(decal.id);
        if (!hasTex || !mat) return null;

        if (decal.mode === 'plane') {
          const plateIndex = Math.max(
            0,
            Math.min(plateCount - 1, decal.plateIndex ?? 0)
          );
          const isVisibleFloor =
            showAllFloors ||
            plateIndex === activeFloor ||
            plateIndex === activeFloor + 1;
          if (!isVisibleFloor) return null;
          const geom = fullPlateGeoms[plateIndex];
          if (!geom) return null;

          const zCenter = sliceResult.zPositions[plateIndex];
          const zPos = zCenter - depth * 0.5 - 0.06 - stackIdx * 0.02;

          return (
            <mesh
              key={`${decal.id}-plane-${plateIndex}`}
              position={[0, 0, zPos]}
              geometry={geom}
              material={mat}
              renderOrder={10 + stackIdx}
              raycast={NOOP_RAYCAST}
            />
          );
        }

        return surfacePlateGeoms.map((geom, plateIndex) => {
          if (!geom) return null;
          const isVisibleFloor =
            showAllFloors ||
            plateIndex === activeFloor ||
            plateIndex === activeFloor + 1;
          if (!isVisibleFloor) return null;

          const zCenter = sliceResult.zPositions[plateIndex];
          const zPos = zCenter - depth * 0.5 - 0.06 - stackIdx * 0.02;

          return (
            <mesh
              key={`${decal.id}-surf-${plateIndex}`}
              position={[0, 0, zPos]}
              geometry={geom}
              material={mat}
              renderOrder={10 + stackIdx}
              raycast={NOOP_RAYCAST}
            />
          );
        });
      })}
    </group>
  );
}
