import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';
import { CameraRig } from './CameraRig';
import { OriginalMeshView } from './OriginalMeshView';
import { SlicedPlatesView } from './SlicedPlatesView';
import { InteractiveDiscsView } from './InteractiveDiscsView';

export function Viewport3D() {
  const viewMode = useSculptureStore((s) => s.viewMode);

  return (
    <div className="relative w-full h-full bg-[#09090B]">
      <Canvas
        dpr={[1, 2]}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: 42, position: [250, -250, 200], near: 0.5, far: 5000 }}
      >
        <color attach="background" args={['#09090B']} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[300, -250, 400]} intensity={0.95} />
        <directionalLight position={[-250, 300, -200]} intensity={0.4} />

        {/* Grilla rotada +90° en X para reposar sobre el plano XY (Z=0) */}
        <Grid
          rotation={[Math.PI * 0.5, 0, 0]}
          position={[0, 0, -0.01]}
          args={[1600, 1600]}
          cellSize={10}
          cellThickness={1.0}
          cellColor="#18181B"
          sectionSize={100}
          sectionThickness={1.5}
          sectionColor="#27272A"
          fadeDistance={750}
          fadeStrength={1.2}
          infiniteGrid={false}
          side={THREE.DoubleSide}
        />

        {viewMode === 'original' ? (
          <OriginalMeshView />
        ) : (
          <>
            <SlicedPlatesView />
            <InteractiveDiscsView />
          </>
        )}

        <CameraRig />

        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport
            axisColors={['#EF4444', '#22C55E', '#3B82F6']}
            labelColor="#F4F4F5"
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
