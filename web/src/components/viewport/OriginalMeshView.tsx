import { useMemo } from 'react';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';

export function OriginalMeshView() {
  const meshGeometry = useSculptureStore((s) => s.meshGeometry);
  const wireframe = useSculptureStore((s) => s.wireframe);
  const build = useSculptureStore((s) => s.build);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const waffleResult = useSculptureStore((s) => s.waffleResult);
  const waffleTargetScale = useSculptureStore((s) => s.waffleParams.targetScale);

  const scaleFactor =
    build.techniqueId === 'waffle'
      ? (waffleResult?.scaleFactor ?? waffleTargetScale ?? 1.0)
      : (sliceResult?.scaleFactor ?? 1.0);

  // Centrar visualmente la malla original en (0,0,0) sin duplicar el BufferGeometry
  const centerOffset = useMemo<[number, number, number]>(() => {
    if (!meshGeometry) return [0, 0, 0];
    meshGeometry.computeBoundingBox();
    const bb = meshGeometry.boundingBox;
    if (!bb) return [0, 0, 0];
    return [
      -0.5 * (bb.min.x + bb.max.x),
      -0.5 * (bb.min.y + bb.max.y),
      -0.5 * (bb.min.z + bb.max.z),
    ];
  }, [meshGeometry]);

  if (!meshGeometry) return null;

  return (
    <group scale={[scaleFactor, scaleFactor, scaleFactor]}>
      <mesh geometry={meshGeometry} position={centerOffset}>
        <meshStandardMaterial
          color="#6366F1"
          wireframe={wireframe}
          roughness={0.42}
          metalness={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
