import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';
import type { PlateContour, Point2D } from '../../types/sculpture';

interface BuiltPlateGeometry {
  plateIndex: number;
  zCenter: number;
  color: THREE.Color;
  meshGeometry: THREE.BufferGeometry;
  edgesGeometry: THREE.BufferGeometry;
}

const NOOP_RAYCAST = () => null;

function buildPlateEdgesBufferGeometry(
  plate: PlateContour,
  halfThickness: number
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
    addRingLines(poly.exterior, -halfThickness);
    addRingLines(poly.exterior, halfThickness);
    for (const hole of poly.holes) {
      addRingLines(hole, -halfThickness);
      addRingLines(hole, halfThickness);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  return geom;
}

function buildPlateExtrudeGeometry(
  plate: PlateContour,
  thickness: number
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
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  // Centrar extrusión en [-thickness/2, +thickness/2] alrededor de zCenter
  extrudeGeom.translate(0, 0, -thickness * 0.5);
  return extrudeGeom;
}

export function SlicedPlatesView() {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const thickness = useSculptureStore((s) => s.params.thickness);
  const wireframe = useSculptureStore((s) => s.wireframe);
  const showAllFloors = useSculptureStore((s) => s.showAllFloors);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const modeAddDiscs = useSculptureStore((s) => s.modeAddDiscs);
  const setActiveFloor = useSculptureStore((s) => s.setActiveFloor);

  const builtPlates = useMemo<BuiltPlateGeometry[]>(() => {
    if (!sliceResult) return [];
    const total = sliceResult.plates.length;
    const list: BuiltPlateGeometry[] = [];

    for (let i = 0; i < total; i++) {
      const contour = sliceResult.plates[i];
      if (!contour || contour.length === 0) continue;

      // Color HSV estable basado en índice físico i / total (viewer.py:390)
      const hue = total > 1 ? (i / total) * 0.78 : 0.55;
      const color = new THREE.Color().setHSL(hue, 0.72, 0.56);

      const meshGeometry = buildPlateExtrudeGeometry(contour, thickness);
      const edgesGeometry = buildPlateEdgesBufferGeometry(
        contour,
        thickness * 0.5
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
  }, [sliceResult, thickness]);

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
    <group>
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
