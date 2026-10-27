import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useSculptureStore } from '../../store/useSculptureStore';

export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const camera = useThree((s) => s.camera as THREE.PerspectiveCamera);
  const preset = useSculptureStore((s) => s.cameraPreset);
  const trigger = useSculptureStore((s) => s.cameraPresetTrigger);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const waffleResult = useSculptureStore((s) => s.waffleResult);
  const build = useSculptureStore((s) => s.build);
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);

  useEffect(() => {
    let span = 220;
    let cx = 0;
    let cy = 0;
    let cz = 0;

    if (build.techniqueId === 'waffle' && waffleResult) {
      const { min, max } = waffleResult.scaledBounds3D;
      const dx = max[0] - min[0];
      const dy = max[1] - min[1];
      const dz = max[2] - min[2];
      span = Math.max(dx, dy, dz, 50);
      cx = (min[0] + max[0]) * 0.5;
      cy = (min[1] + max[1]) * 0.5;
      cz = (min[2] + max[2]) * 0.5;
    } else if (sliceResult) {
      const [[minX, minY], [maxX, maxY]] = sliceResult.scaledBounds;
      span = Math.max(maxX - minX, maxY - minY, sliceResult.scaledHeight, 50);
      cx = (minX + maxX) * 0.5;
      cy = (minY + maxY) * 0.5;
      cz = sliceResult.scaledHeight * 0.5;
    } else if (meshMetadata) {
      span = Math.max(...meshMetadata.extents, 50);
    }

    const dist = span * 1.65;
    camera.near = Math.max(0.5, span * 0.002);
    camera.far = Math.max(3000, span * 15);
    camera.updateProjectionMatrix();

    // Evitar colinealidad con up=(0,0,1) en vistas Top y Bottom
    if (preset === 'top') {
      camera.up.set(0, 1, 0);
      camera.position.set(cx, cy - 1e-4 * dist, cz + dist);
    } else if (preset === 'bottom') {
      camera.up.set(0, 1, 0);
      camera.position.set(cx, cy - 1e-4 * dist, cz - dist);
    } else {
      camera.up.set(0, 0, 1);
      if (preset === 'front') camera.position.set(cx, cy - dist, cz);
      else if (preset === 'back') camera.position.set(cx, cy + dist, cz);
      else if (preset === 'left') camera.position.set(cx - dist, cy, cz);
      else if (preset === 'right') camera.position.set(cx + dist, cy, cz);
      else camera.position.set(cx + dist * 0.75, cy - dist * 0.75, cz + dist * 0.65);
    }

    if (controlsRef.current) {
      controlsRef.current.target.set(cx, cy, cz);
      controlsRef.current.update();
    }
  }, [preset, trigger, sliceResult, waffleResult, build.techniqueId, meshMetadata, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
    />
  );
}
