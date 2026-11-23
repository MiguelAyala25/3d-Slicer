import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';
import {
  buildPlateEdgesBufferGeometry,
  buildPlateExtrudeGeometry,
  visualPlateDepth,
} from './plateGeometry';
import { getSliceGroupRotation } from './sliceAxisTransform';

interface BuiltPlateGeometry {
  plateIndex: number;
  zCenter: number;
  color: THREE.Color;
  meshGeometry: THREE.BufferGeometry;
  edgesGeometry: THREE.BufferGeometry;
}

const NOOP_RAYCAST = () => null;

export function SlicedPlatesView() {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const lastSliceAxis = useSculptureStore((s) => s.lastSliceAxis);
  const thickness = useSculptureStore((s) => s.params.thickness);
  const gap = useSculptureStore((s) => s.params.gap);
  const hasFrontDecals = useSculptureStore(
    (s) => s.lastSliceAxis === 'y' && s.decals.some((d) => d.visible)
  );
  const wireframe = useSculptureStore((s) => s.wireframe);
  const showAllFloors = useSculptureStore((s) => s.showAllFloors);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const modeAddDiscs = useSculptureStore((s) => s.modeAddDiscs);
  const setActiveFloor = useSculptureStore((s) => s.setActiveFloor);

  // Invertir la rotación aplicada por AxisSliceCache para que el modelo permanezca parado
  // independientemente de si se corta en el eje X, Y o Z.
  const groupRotation = useMemo(
    () => getSliceGroupRotation(lastSliceAxis),
    [lastSliceAxis]
  );

  const builtPlates = useMemo<BuiltPlateGeometry[]>(() => {
    if (!sliceResult) return [];
    const total = sliceResult.plates.length;
    const list: BuiltPlateGeometry[] = [];
    const depth = visualPlateDepth(thickness, gap);

    for (let i = 0; i < total; i++) {
      const contour = sliceResult.plates[i];
      if (!contour || contour.length === 0) continue;

      const hue = total > 1 ? (i / total) * 0.78 : 0.55;
      const color = new THREE.Color().setHSL(hue, 0.72, 0.56);

      const meshGeometry = buildPlateExtrudeGeometry(contour, depth);
      const edgesGeometry = buildPlateEdgesBufferGeometry(contour, depth * 0.5);

      list.push({
        plateIndex: i,
        zCenter: sliceResult.zPositions[i],
        color,
        meshGeometry,
        edgesGeometry,
      });
    }
    return list;
  }, [sliceResult, thickness, gap]);

  // Liberación explícita de VRAM al desmontar o recalcular
  useEffect(() => {
    return () => {
      for (const item of builtPlates) {
        item.meshGeometry.dispose();
        item.edgesGeometry.dispose();
      }
    };
  }, [builtPlates]);

  if (!sliceResult) return null;

  return (
    <group rotation={groupRotation}>
      {builtPlates.map((item) => {
        const isCurrent = item.plateIndex === activeFloor;
        const isNextUpper = item.plateIndex === activeFloor + 1;

        if (!showAllFloors && !isCurrent && !isNextUpper) {
          return null;
        }

        const baseOpacity = isCurrent
          ? hasFrontDecals
            ? 0.28
            : 0.92
          : isNextUpper && !showAllFloors
            ? hasFrontDecals
              ? 0.18
              : 0.24
            : showAllFloors
              ? hasFrontDecals
                ? 0.14
                : 0.16
              : 0.0;

        return (
          <group key={item.plateIndex} position={[0, 0, item.zCenter]}>
            <mesh
              key={`mesh-${item.plateIndex}-${isCurrent}-${hasFrontDecals}`}
              geometry={item.meshGeometry}
              raycast={modeAddDiscs ? NOOP_RAYCAST : undefined}
              onClick={(e) => {
                if (!modeAddDiscs && e.altKey && e.delta <= 5) {
                  e.stopPropagation();
                  setActiveFloor(item.plateIndex);
                }
              }}
              onDoubleClick={(e) => {
                if (!modeAddDiscs) {
                  e.stopPropagation();
                  setActiveFloor(item.plateIndex);
                }
              }}
            >
              <meshStandardMaterial
                color={
                  hasFrontDecals
                    ? isCurrent
                      ? '#94A3B8'
                      : '#CBD5E1'
                    : isCurrent
                      ? '#6366F1'
                      : item.color
                }
                wireframe={wireframe}
                transparent={true}
                opacity={baseOpacity}
                depthWrite={isCurrent && !hasFrontDecals}
                roughness={hasFrontDecals ? 0.2 : 0.45}
                metalness={0.08}
              />
            </mesh>
            <lineSegments
              key={`lines-${item.plateIndex}-${isCurrent}-${isNextUpper}`}
              geometry={item.edgesGeometry}
              raycast={NOOP_RAYCAST}
            >
              <lineBasicMaterial
                color={
                  isCurrent ? '#E0E7FF' : isNextUpper ? '#F59E0B' : '#3F3F46'
                }
                transparent={true}
                opacity={isCurrent ? 0.95 : isNextUpper ? 0.65 : 0.25}
              />
            </lineSegments>
          </group>
        );
      })}
    </group>
  );
}
