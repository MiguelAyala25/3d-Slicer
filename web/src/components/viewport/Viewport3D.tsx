import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { Loader2 } from 'lucide-react';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';
import { CameraRig } from './CameraRig';
import { OriginalMeshView } from './OriginalMeshView';
import { SlicedPlatesView } from './SlicedPlatesView';
import { WafflePlatesView } from './WafflePlatesView';
import { JOINT_UI } from '../joints/registry';

export function Viewport3D() {
  const viewMode = useSculptureStore((s) => s.viewMode);
  const isLoadingMesh = useSculptureStore((s) => s.isLoadingMesh);
  const isSlicing = useSculptureStore((s) => s.isSlicing);
  const build = useSculptureStore((s) => s.build);
  const JointViewportLayer = build.jointId ? JOINT_UI[build.jointId]?.ViewportLayer : undefined;

  const [isCompact, setIsCompact] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 1100 : false
  );

  useEffect(() => {
    const handleResize = () => setIsCompact(window.innerWidth < 1100);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="relative w-full h-full bg-[#09090B]">
      {/* Indicador flotante estilizado y coherente con el HUD para carga y corte */}
      {(isLoadingMesh || isSlicing) && (
        <div
          role="status"
          aria-live="polite"
          data-testid="viewport-loading-overlay"
          className="fixed top-14 left-1/2 -translate-x-1/2 z-30 pointer-events-none select-none transition-all animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="bg-[#1b1b1d]/95 backdrop-blur-xl border border-white/[0.08] rounded-full px-4 py-2 flex items-center gap-2.5 shadow-2xl">
            <Loader2 className="w-4 h-4 text-[#2997ff] animate-spin shrink-0" />
            <span className="text-xs font-semibold text-[#f4f4f5] tracking-wide">
              {isLoadingMesh ? 'Cargando modelo 3D...' : 'Calculando corte...'}
            </span>
          </div>
        </div>
      )}

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
        ) : build.techniqueId === 'waffle' ? (
          <WafflePlatesView />
        ) : (
          <>
            <SlicedPlatesView />
            {JointViewportLayer && <JointViewportLayer />}
          </>
        )}

        <CameraRig />

        <GizmoHelper
          alignment="top-right"
          margin={isCompact ? [80, 75] : [410, 75]}
        >
          <GizmoViewport
            axisColors={['#EF4444', '#22C55E', '#3B82F6']}
            labelColor="#F4F4F5"
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
