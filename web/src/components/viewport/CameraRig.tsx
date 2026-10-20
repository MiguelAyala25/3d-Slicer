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
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);

  useEffect(() => {
    let span = 220;
    if (sliceResult) {
      const [[minX, minY], [maxX, maxY]] = sliceResult.scaledBounds;
      span = Math.max(maxX - minX, maxY - minY, sliceResult.scaledHeight, 50);
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
      camera.position.set(0, -1e-4 * dist, dist);
    } else if (preset === 'bottom') {
      camera.up.set(0, 1, 0);
      camera.position.set(0, -1e-4 * dist, -dist);
    } else {
      camera.up.set(0, 0, 1);
      if (preset === 'front') camera.position.set(0, -dist, 0);
      else if (preset === 'back') camera.position.set(0, dist, 0);
      else if (preset === 'left') camera.position.set(-dist, 0, 0);
      else if (preset === 'right') camera.position.set(dist, 0, 0);
      else camera.position.set(dist * 0.75, -dist * 0.75, dist * 0.65);
    }

    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [preset, trigger, sliceResult, meshMetadata, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
    />
  );
}
