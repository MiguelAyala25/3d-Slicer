import { useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { isPointOnPlate } from '../../../core/joints/discs/discGeometry';
import { useSculptureStore } from '../../../store/useSculptureStore';
import type { Disc } from '../../../types/sculpture';

interface DragState {
  discId: number;
  gapIndex: number;
  diameter: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  meshGroup: THREE.Group;
}

export function InteractiveDiscsView() {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const thickness = useSculptureStore((s) => s.params.thickness);
  const gap = useSculptureStore((s) => s.params.gap);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const showAllFloors = useSculptureStore((s) => s.showAllFloors);
  const modeAddDiscs = useSculptureStore((s) => s.modeAddDiscs);
  const discs = useSculptureStore((s) => s.discs);
  const selectedDiscId = useSculptureStore((s) => s.selectedDiscId);
  const addDiscAtActiveFloor = useSculptureStore((s) => s.addDiscAtActiveFloor);
  const selectDisc = useSculptureStore((s) => s.selectDisc);
  const commitDiscMove = useSculptureStore((s) => s.commitDiscMove);

  const controls = useThree((s) => s.controls as { enabled?: boolean } | null);
  const dragRef = useRef<DragState | null>(null);
  const discGroupRefs = useRef<Map<number, THREE.Group>>(new Map());

  // Plano matemático en Z_top de la placa activa para colocación y arrastre sin interferencia de placas translúcidas
  const activeMathPlane = useMemo(() => {
    if (!sliceResult || activeFloor >= sliceResult.zPositions.length) {
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    }
    const zTop = sliceResult.zPositions[activeFloor] + thickness * 0.5;
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), -zTop);
  }, [sliceResult, activeFloor, thickness]);

  if (!sliceResult) return null;

  const canPlaceOnActiveFloor = activeFloor < sliceResult.plates.length - 1;
  const activeZTop =
    (sliceResult.zPositions[activeFloor] ?? 0) + thickness * 0.5;

  // Corrección #1: Colocar discos SOLO en onClick, con e.delta <= 5 y modeAddDiscs === true.
  // Orbitar (arrastrar > 5 px) o estar en modo selección (!modeAddDiscs) jamás crea discos ni lanza errores.
  const handlePlaneClick = (e: ThreeEvent<MouseEvent>) => {
    if (!modeAddDiscs || !canPlaceOnActiveFloor) return;
    if (e.button !== 0 || e.altKey) return;
    if (e.delta > 5) return;
    if (dragRef.current) return;
    const hit = new THREE.Vector3();
    if (e.ray.intersectPlane(activeMathPlane, hit)) {
      e.stopPropagation();
      addDiscAtActiveFloor(hit.x, hit.y);
    }
  };

  const handleDiscPointerDown = (e: ThreeEvent<PointerEvent>, disc: Disc) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectDisc(disc.id);

    if (disc.gapIndex !== activeFloor) return;
    const groupObj = discGroupRefs.current.get(disc.id);
    if (!groupObj) return;

    if (controls && 'enabled' in controls) {
      controls.enabled = false;
    }
    (e.target as HTMLElement | null)?.setPointerCapture?.(e.pointerId);

    dragRef.current = {
      discId: disc.id,
      gapIndex: disc.gapIndex,
      diameter: disc.diameter,
      startX: disc.x,
      startY: disc.y,
      currentX: disc.x,
      currentY: disc.y,
      meshGroup: groupObj,
    };
  };

  const handleGlobalPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();

    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(activeMathPlane, hit)) return;

    // Mover el disco suavemente siguiendo el cursor sobre la placa activa sin barrera ni fuerza repulsiva
    const activePlate = sliceResult.plates[drag.gapIndex];
    if (activePlate && isPointOnPlate(hit.x, hit.y, activePlate, 2.0)) {
      drag.currentX = hit.x;
      drag.currentY = hit.y;
      drag.meshGroup.position.x = hit.x;
      drag.meshGroup.position.y = hit.y;
    }
  };

  const handleGlobalPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();

    if (controls && 'enabled' in controls) {
      controls.enabled = true;
    }

    commitDiscMove(
      drag.discId,
      drag.startX,
      drag.startY,
      drag.currentX,
      drag.currentY
    );
    dragRef.current = null;
  };

  const [[minX, minY], [maxX, maxY]] = sliceResult.scaledBounds;
  const planeW = Math.max(500, (maxX - minX) * 3);
  const planeH = Math.max(500, (maxY - minY) * 3);

  return (
    <group
      onPointerMove={handleGlobalPointerMove}
      onPointerUp={handleGlobalPointerUp}
    >
      {/* Plano receptor en Z_top activo SOLO cuando modeAddDiscs === true (en modo selección no responde) */}
      {modeAddDiscs && canPlaceOnActiveFloor && (
        <mesh
          name="disc-placement-plane"
          position={[0, 0, activeZTop]}
          onClick={handlePlaneClick}
        >
          <planeGeometry args={[planeW, planeH]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {discs.map((disc) => {
        const isCurrentGap = disc.gapIndex === activeFloor;
        if (!showAllFloors && !isCurrentGap) return null;

        const zBase =
          (sliceResult.zPositions[disc.gapIndex] ?? 0) + thickness * 0.5;
        const zCenter = zBase + gap * 0.5;
        const isSelected = disc.id === selectedDiscId;
        const radius = disc.diameter * 0.5;

        return (
          <group
            key={disc.id}
            ref={(node) => {
              if (node) discGroupRefs.current.set(disc.id, node);
              else discGroupRefs.current.delete(disc.id);
            }}
            position={[disc.x, disc.y, zCenter]}
            onPointerDown={(e) => handleDiscPointerDown(e, disc)}
          >
            {/* Cilindro orientado a lo largo de +Z (rotado +90° en X desde el cilindro Y-up de Three.js) */}
            <mesh rotation={[Math.PI * 0.5, 0, 0]}>
              <cylinderGeometry args={[radius, radius, gap, 32]} />
              <meshStandardMaterial
                color={
                  isSelected
                    ? '#FBBF24'
                    : isCurrentGap
                      ? '#F59E0B'
                      : '#78350F'
                }
                transparent={!isCurrentGap}
                opacity={isCurrentGap ? 0.96 : 0.38}
                roughness={0.3}
                metalness={0.2}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
