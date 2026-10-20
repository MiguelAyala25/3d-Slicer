import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { Loader2 } from 'lucide-react';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';
import { CameraRig } from './CameraRig';
import { OriginalMeshView } from './OriginalMeshView';
import { SlicedPlatesView } from './SlicedPlatesView';
import { InteractiveDiscsView } from './InteractiveDiscsView';

export function Viewport3D() {
  const viewMode = useSculptureStore((s) => s.viewMode);
  const isLoadingMesh = useSculptureStore((s) => s.isLoadingMesh);
  const isSlicing = useSculptureStore((s) => s.isSlicing);
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
  const statusMessage = useSculptureStore((s) => s.statusMessage);

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
      {/* Overlay con spinner para modelos pesados y proceso de corte */}
      {(isLoadingMesh || isSlicing) && (
        <div
          role="status"
          aria-live="polite"
          data-testid="viewport-loading-overlay"
          className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-black/45 backdrop-blur-[3px] transition-opacity duration-300"
        >
          <div className="hud-surface rounded-2xl px-6 py-5 flex flex-col items-center gap-3.5 shadow-2xl border border-white/[0.12] bg-[#121216]/95 max-w-sm text-center">
            <div className="relative flex items-center justify-center w-12 h-12">
              <span className="w-10 h-10 rounded-full border-2 border-[#0A84FF]/25 animate-ping absolute" />
              <Loader2 className="w-8 h-8 text-[#0A84FF] animate-spin" />
            </div>
            <div className="flex flex-col gap-1 items-center">
              <h3 className="text-sm font-semibold text-[#F4F4F5] tracking-tight">
                {isLoadingMesh ? 'Cargando modelo 3D...' : 'Calculando corte...'}
              </h3>
              <p className="text-xs text-[#A1A1AA] max-w-[260px] truncate">
                {isLoadingMesh
                  ? (meshMetadata?.fileName ?? 'Analizando y validando geometría...')
                  : statusMessage}
              </p>
            </div>
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
        ) : (
          <>
            <SlicedPlatesView />
            <InteractiveDiscsView />
          </>
        )}

        <CameraRig />

        <GizmoHelper
          alignment="top-right"
          margin={isCompact ? [72, 72] : [360, 60]}
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
