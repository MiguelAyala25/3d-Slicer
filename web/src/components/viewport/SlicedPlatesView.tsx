import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';
import {
  buildPlateEdgesBufferGeometry,
  buildPlateExtrudeGeometry,
  visualPlateDepth,
} from './plateGeometry';

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
  const wireframe = useSculptureStore((s) => s.wireframe);
  const showAllFloors = useSculptureStore((s) => s.showAllFloors);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const modeAddDiscs = useSculptureStore((s) => s.modeAddDiscs);
  const setActiveFloor = useSculptureStore((s) => s.setActiveFloor);

  // Invertir la rotación aplicada por AxisSliceCache para que el modelo permanezca parado
  // independientemente de si se corta en el eje X, Y o Z:
  // - axis 'x': el slicer rotó -90° en Y ((x, y, z) -> (-z, y, x)). La inversa es +90° en Y.
  // - axis 'y': el slicer rotó +90° en X ((x, y, z) -> (x, -z, y)). La inversa es -90° en X.
  // - axis 'z': sin rotación.
  const groupRotation = useMemo<[number, number, number]>(() => {
    if (lastSliceAxis === 'x') {
      return [0, Math.PI * 0.5, 0];
    }
    if (lastSliceAxis === 'y') {
      return [-Math.PI * 0.5, 0, 0];
    }
    return [0, 0, 0];
  }, [lastSliceAxis]);

  const builtPlates = useMemo<BuiltPlateGeometry[]>(() => {
    if (!sliceResult) return [];
    const total = sliceResult.plates.length;
    const list: BuiltPlateGeometry[] = [];
    const depth = visualPlateDepth(thickness, gap);

    for (let i = 0; i < total; i++) {
      const contour = sliceResult.plates[i];
      if (!contour || contour.length === 0) continue;

      // Rampa HSV perceptual y estable basada en la fracción de altura física (índice i / total)
      const hue = total > 1 ? (i / total) * 0.78 : 0.55;
      const color = new THREE.Color().setHSL(hue, 0.72, 0.56);

      const meshGeometry = buildPlateExtrudeGeometry(contour, depth);
      const edgesGeometry = buildPlateEdgesBufferGeometry(
        contour,
        depth * 0.5
      );

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

        const opacity = isCurrent
          ? 0.92
          : isNextUpper && !showAllFloors
            ? 0.24
            : showAllFloors
              ? 0.16
              : 0.0;

        return (
          <group
            key={item.plateIndex}
            position={[0, 0, item.zCenter]}
          >
            <mesh
              key={`mesh-${item.plateIndex}-${isCurrent}`}
              geometry={item.meshGeometry}
              // En modo colocación (modeAddDiscs) o en placas no activas, desactivar raycast para no interceptar el plano Z_top
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
                color={isCurrent ? '#6366F1' : item.color}
                wireframe={wireframe}
                transparent={true}
                opacity={opacity}
                depthWrite={isCurrent}
                roughness={0.45}
                metalness={0.1}
              />
            </mesh>
            <lineSegments
              key={`lines-${item.plateIndex}-${isCurrent}-${isNextUpper}`}
              geometry={item.edgesGeometry}
              raycast={NOOP_RAYCAST}
            >
              <lineBasicMaterial
                color={isCurrent ? '#E0E7FF' : isNextUpper ? '#F59E0B' : '#3F3F46'}
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
