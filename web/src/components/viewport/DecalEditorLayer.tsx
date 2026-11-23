import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useSculptureStore } from '../../store/useSculptureStore';
import type { ImageDecal } from '../../types/sculpture';
import {
  acquireDecalTexture,
  getCachedDecalTexture,
} from './decalTextureCache';
import {
  setLiveDecalTransform,
  type LiveDecalTransform,
} from './decalLiveTransform';

const NOOP_RAYCAST = () => null;
const WORLD_Y_UP = new THREE.Vector3(0, 1, 0);
const CLICK_MAX_DIST_PX = 5;

function hitTestDecalAtPoint(
  decals: readonly ImageDecal[],
  hx: number,
  hz: number
): ImageDecal | null {
  const ordered = decals
    .filter((d) => d.visible && d.widthMm > 0 && d.heightMm > 0)
    .sort((a, b) =>
      b.order !== a.order ? b.order - a.order : b.id.localeCompare(a.id)
    );

  for (const d of ordered) {
    const dx = hx - d.centerX;
    const dz = hz - d.centerZ;
    const rad = (d.rotationDeg * Math.PI) / 180;
    const lx = dx * Math.cos(rad) + dz * Math.sin(rad);
    const lz = -dx * Math.sin(rad) + dz * Math.cos(rad);
    if (Math.abs(lx) <= d.widthMm * 0.5 && Math.abs(lz) <= d.heightMm * 0.5) {
      return d;
    }
  }
  return null;
}

type DragMode =
  | {
      kind: 'move';
      startX: number;
      startZ: number;
      origCX: number;
      origCZ: number;
      hasMoved: boolean;
      live: LiveDecalTransform;
    }
  | {
      kind: 'scale';
      origW: number;
      origH: number;
      hasMoved: boolean;
      live: LiveDecalTransform;
    }
  | {
      kind: 'rotate';
      hasMoved: boolean;
      live: LiveDecalTransform;
    };

function buildMoveArrowsGeometry(): THREE.BufferGeometry {
  // Cruz direccional de 4 puntas en coordenadas unitarias [-0.56, 0.56]
  const pts = [
    // Eje horizontal + vertical
    -0.56, 0, 0, 0.56, 0, 0,
    0, -0.56, 0, 0, 0.56, 0,
    // Punta derecha
    0.36, 0.16, 0, 0.56, 0, 0,
    0.36, -0.16, 0, 0.56, 0, 0,
    // Punta izquierda
    -0.36, 0.16, 0, -0.56, 0, 0,
    -0.36, -0.16, 0, -0.56, 0, 0,
    // Punta superior
    -0.16, 0.36, 0, 0, 0.56, 0,
    0.16, 0.36, 0, 0, 0.56, 0,
    // Punta inferior
    -0.16, -0.36, 0, 0, -0.56, 0,
    0.16, -0.36, 0, 0, -0.56, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function writeOutlinePositions(
  geom: THREE.BufferGeometry,
  widthMm: number,
  heightMm: number
): void {
  const hw = widthMm * 0.5;
  const hh = heightMm * 0.5;
  const handleDist = hh + Math.max(8, Math.min(18, heightMm * 0.14));
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  posAttr.setXYZ(0, -hw, -hh, 0);
  posAttr.setXYZ(1, hw, -hh, 0);
  posAttr.setXYZ(2, hw, -hh, 0);
  posAttr.setXYZ(3, hw, hh, 0);
  posAttr.setXYZ(4, hw, hh, 0);
  posAttr.setXYZ(5, -hw, hh, 0);
  posAttr.setXYZ(6, -hw, hh, 0);
  posAttr.setXYZ(7, -hw, -hh, 0);
  posAttr.setXYZ(8, 0, hh, 0);
  posAttr.setXYZ(9, 0, handleDist, 0);
  posAttr.needsUpdate = true;
  geom.computeBoundingSphere();
}

export function DecalEditorLayer() {
  const buildTechniqueId = useSculptureStore((s) => s.build.techniqueId);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const lastSliceAxis = useSculptureStore((s) => s.lastSliceAxis);
  const thickness = useSculptureStore((s) => s.params.thickness);
  const decals = useSculptureStore((s) => s.decals);
  const selectedDecalId = useSculptureStore((s) => s.selectedDecalId);
  const decalObjectUrls = useSculptureStore((s) => s.decalObjectUrls);
  const cameraPreset = useSculptureStore((s) => s.cameraPreset);
  const modeAddDiscs = useSculptureStore((s) => s.modeAddDiscs);
  const selectDecal = useSculptureStore((s) => s.selectDecal);
  const updateDecal = useSculptureStore((s) => s.updateDecal);

  const selectedDecal = useMemo(
    () => decals.find((d) => d.id === selectedDecalId && d.visible) ?? null,
    [decals, selectedDecalId]
  );

  const { camera, gl, controls } = useThree();
  const groupRef = useRef<THREE.Group | null>(null);
  const ghostMeshRef = useRef<THREE.Mesh | null>(null);
  const cornerRefs = useRef<Array<THREE.Group | null>>([null, null, null, null]);
  const rotHandleRef = useRef<THREE.Mesh | null>(null);
  const moveGizmoRef = useRef<THREE.Group | null>(null);
  const moveFillMatRef = useRef<THREE.MeshBasicMaterial | null>(null);

  const isFrontVisibleRef = useRef(false);
  const dirVecRef = useRef(new THREE.Vector3());
  const dragRef = useRef<DragMode | null>(null);
  const pointerDownCanvasRef = useRef<{ x: number; y: number } | null>(null);
  const startedOnGizmoRef = useRef(false);

  // Objetos Three reutilizables en caliente para 0 asignaciones por puntero
  const raycasterRef = useRef(new THREE.Raycaster());
  const ndcRef = useRef(new THREE.Vector2());
  const planeRef = useRef(new THREE.Plane(WORLD_Y_UP, 0));
  const hitVecRef = useRef(new THREE.Vector3());

  const [loadedGhostTex, setLoadedGhostTex] = useState<{
    url: string;
    tex: THREE.Texture;
  } | null>(null);

  const editorY = useMemo(() => {
    if (!sliceResult || sliceResult.zPositions.length === 0) return -10;
    return sliceResult.zPositions[0] - thickness * 0.5 - 4.0;
  }, [sliceResult, thickness]);

  const editorYRef = useRef(editorY);
  useLayoutEffect(() => {
    editorYRef.current = editorY;
  }, [editorY]);

  const outlineGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(10 * 3), 3)
    );
    return g;
  }, []);

  const moveArrowsGeom = useMemo(() => buildMoveArrowsGeometry(), []);

  useEffect(() => {
    return () => {
      outlineGeom.dispose();
      moveArrowsGeom.dispose();
    };
  }, [outlineGeom, moveArrowsGeom]);

  const imageKey = selectedDecal?.imageKey;
  const imageUrl = imageKey ? decalObjectUrls[imageKey] : undefined;

  useEffect(() => {
    if (!imageKey || !imageUrl) {
      setLoadedGhostTex(null);
      return;
    }
    const cached = getCachedDecalTexture(imageKey, imageUrl);
    if (cached) {
      setLoadedGhostTex({ url: imageUrl, tex: cached });
      return;
    }
    return acquireDecalTexture(imageKey, imageUrl, (tex) => {
      setLoadedGhostTex({ url: imageUrl, tex });
    });
  }, [imageKey, imageUrl]);

  const ghostTexture =
    imageUrl && loadedGhostTex?.url === imageUrl
      ? loadedGhostTex.tex
      : imageKey && imageUrl
        ? getCachedDecalTexture(imageKey, imageUrl)
        : null;

  const applyGizmoRefs = useCallback(
    (t: Pick<LiveDecalTransform, 'centerX' | 'centerZ' | 'widthMm' | 'heightMm' | 'rotationDeg'>) => {
      const group = groupRef.current;
      if (group) {
        const rad = (t.rotationDeg * Math.PI) / 180;
        group.position.set(t.centerX, editorYRef.current, t.centerZ);
        group.rotation.set(0, -rad, 0);
      }
      if (ghostMeshRef.current) {
        ghostMeshRef.current.scale.set(t.widthMm, t.heightMm, 1);
      }

      const hw = t.widthMm * 0.5;
      const hh = t.heightMm * 0.5;
      const handleSize = Math.max(2.8, Math.min(7, Math.min(hw, hh) * 0.14));
      const rotDist = hh + Math.max(8, Math.min(18, t.heightMm * 0.14));
      const moveRadius = Math.max(3.4, Math.min(8.0, handleSize * 0.92));

      writeOutlinePositions(outlineGeom, t.widthMm, t.heightMm);

      const corners: Array<[number, number]> = [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ];
      for (let i = 0; i < 4; i++) {
        const cGroup = cornerRefs.current[i];
        if (cGroup) {
          cGroup.position.set(corners[i][0], corners[i][1], 0.2);
          cGroup.scale.set(handleSize, handleSize, 1);
        }
      }
      if (rotHandleRef.current) {
        rotHandleRef.current.position.set(0, rotDist, 0.2);
        rotHandleRef.current.scale.set(handleSize, handleSize, 1);
      }
      if (moveGizmoRef.current) {
        moveGizmoRef.current.scale.set(moveRadius, moveRadius, 1);
      }
    },
    [outlineGeom]
  );

  // Sincronizar gizmo cuando cambia selectedDecal o editorY fuera de un arrastre activo
  useLayoutEffect(() => {
    if (!selectedDecal || dragRef.current) return;
    applyGizmoRefs(selectedDecal);
    if (groupRef.current) {
      groupRef.current.visible = isFrontVisibleRef.current;
    }
  }, [selectedDecal, editorY, applyGizmoRefs]);

  useFrame(() => {
    camera.getWorldDirection(dirVecRef.current);
    const isFront =
      cameraPreset === 'front' &&
      dirVecRef.current.y > 0.92 &&
      Math.abs(dirVecRef.current.x) < 0.35 &&
      Math.abs(dirVecRef.current.z) < 0.35;
    isFrontVisibleRef.current = isFront;
    if (groupRef.current) {
      groupRef.current.visible = isFront;
    }
  });

  const setOrbitEnabled = useCallback(
    (enabled: boolean) => {
      const orbit = controls as unknown as OrbitControlsImpl | null;
      if (orbit && typeof orbit.enabled === 'boolean') {
        orbit.enabled = enabled;
      }
    },
    [controls]
  );

  const setCanvasCursor = useCallback(
    (cursor: string) => {
      if (gl.domElement) {
        gl.domElement.style.cursor = cursor;
      }
    },
    [gl]
  );

  const intersectPointerWithEditorPlane = useCallback(
    (clientX: number, clientY: number): [number, number] | null => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      ndcRef.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycasterRef.current.setFromCamera(ndcRef.current, camera);
      planeRef.current.set(WORLD_Y_UP, -editorYRef.current);
      if (!raycasterRef.current.ray.intersectPlane(planeRef.current, hitVecRef.current)) {
        return null;
      }
      return [hitVecRef.current.x, hitVecRef.current.z];
    },
    [camera, gl]
  );

  useEffect(() => {
    const domEl = gl.domElement;

    const handleCanvasPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerDownCanvasRef.current = { x: e.clientX, y: e.clientY };
      startedOnGizmoRef.current = false;
    };

    const handleCanvasPointerLeave = () => {
      if (!dragRef.current) {
        setCanvasCursor('');
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        if (e.target === domEl && isFrontVisibleRef.current) {
          const st = useSculptureStore.getState();
          if (
            st.build.techniqueId === 'stacked' &&
            st.lastSliceAxis === 'y' &&
            !st.modeAddDiscs &&
            st.selectedDecalId === null &&
            st.decals.length > 0
          ) {
            const hoverHit = intersectPointerWithEditorPlane(e.clientX, e.clientY);
            const hitDecal = hoverHit
              ? hitTestDecalAtPoint(st.decals, hoverHit[0], hoverHit[1])
              : null;
            setCanvasCursor(hitDecal ? 'pointer' : '');
          }
        }
        return;
      }

      const hit = intersectPointerWithEditorPlane(e.clientX, e.clientY);
      if (!hit) return;
      const [hx, hz] = hit;
      const live = drag.live;

      if (drag.kind === 'move') {
        live.centerX = Number((drag.origCX + (hx - drag.startX)).toFixed(2));
        live.centerZ = Number((drag.origCZ + (hz - drag.startZ)).toFixed(2));
      } else if (drag.kind === 'scale') {
        const dx = hx - live.centerX;
        const dz = hz - live.centerZ;
        const rad = (live.rotationDeg * Math.PI) / 180;
        const lx = dx * Math.cos(rad) + dz * Math.sin(rad);
        const lz = -dx * Math.sin(rad) + dz * Math.cos(rad);
        if (e.shiftKey) {
          live.widthMm = Number(Math.max(5, 2 * Math.abs(lx)).toFixed(2));
          live.heightMm = Number(Math.max(5, 2 * Math.abs(lz)).toFixed(2));
        } else {
          const scaleFactor =
            Math.hypot(lx / (drag.origW * 0.5), lz / (drag.origH * 0.5)) /
            Math.SQRT2;
          const nextW = Number(Math.max(5, drag.origW * scaleFactor).toFixed(2));
          const nextH = Number((nextW * (drag.origH / drag.origW)).toFixed(2));
          live.widthMm = nextW;
          live.heightMm = nextH;
        }
      } else if (drag.kind === 'rotate') {
        const dx = hx - live.centerX;
        const dz = hz - live.centerZ;
        let deg = ((Math.atan2(dz, dx) - Math.PI * 0.5) * 180) / Math.PI;
        while (deg > 180) deg -= 360;
        while (deg < -180) deg += 360;
        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        }
        live.rotationDeg = Number(deg.toFixed(1));
      }

      drag.hasMoved = true;
      setLiveDecalTransform(live);
      applyGizmoRefs(live);
    };

    const completePointerInteraction = (e: PointerEvent, allowClickSelect: boolean) => {
      const drag = dragRef.current;
      const wasGizmo = startedOnGizmoRef.current || drag !== null;
      const down = pointerDownCanvasRef.current;
      pointerDownCanvasRef.current = null;
      startedOnGizmoRef.current = false;

      if (drag) {
        const finalLive = drag.live;
        const moved = drag.hasMoved;
        dragRef.current = null;
        setLiveDecalTransform(null);
        setOrbitEnabled(true);
        setCanvasCursor('');
        if (moveFillMatRef.current) {
          moveFillMatRef.current.color.set('#0A84FF');
        }
        if (moved) {
          updateDecal(finalLive.id, {
            centerX: finalLive.centerX,
            centerZ: finalLive.centerZ,
            widthMm: finalLive.widthMm,
            heightMm: finalLive.heightMm,
            rotationDeg: finalLive.rotationDeg,
          });
        }
      }

      if (
        allowClickSelect &&
        !wasGizmo &&
        down &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) <= CLICK_MAX_DIST_PX
      ) {
        const st = useSculptureStore.getState();
        if (
          st.build.techniqueId === 'stacked' &&
          st.lastSliceAxis === 'y' &&
          !st.modeAddDiscs &&
          st.decals.length > 0 &&
          isFrontVisibleRef.current
        ) {
          const hitPt = intersectPointerWithEditorPlane(e.clientX, e.clientY);
          const hitDecal = hitPt
            ? hitTestDecalAtPoint(st.decals, hitPt[0], hitPt[1])
            : null;
          if (hitDecal) {
            selectDecal(hitDecal.id);
          } else if (st.selectedDecalId !== null) {
            selectDecal(null);
          }
        }
      }
    };

    const handlePointerUp = (e: PointerEvent) => completePointerInteraction(e, true);
    const handlePointerCancel = (e: PointerEvent) => completePointerInteraction(e, false);

    domEl?.addEventListener('pointerdown', handleCanvasPointerDown, true);
    domEl?.addEventListener('pointerleave', handleCanvasPointerLeave);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      domEl?.removeEventListener('pointerdown', handleCanvasPointerDown, true);
      domEl?.removeEventListener('pointerleave', handleCanvasPointerLeave);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      dragRef.current = null;
      pointerDownCanvasRef.current = null;
      startedOnGizmoRef.current = false;
      setLiveDecalTransform(null);
      setOrbitEnabled(true);
      setCanvasCursor('');
    };
  }, [
    applyGizmoRefs,
    gl,
    intersectPointerWithEditorPlane,
    selectDecal,
    setCanvasCursor,
    setOrbitEnabled,
    updateDecal,
  ]);

  if (
    buildTechniqueId !== 'stacked' ||
    !sliceResult ||
    lastSliceAxis !== 'y' ||
    modeAddDiscs ||
    !selectedDecal
  ) {
    return null;
  }

  const rad = (selectedDecal.rotationDeg * Math.PI) / 180;

  const startDrag = (kind: DragMode['kind']) => (e: ThreeEvent<PointerEvent>) => {
    if (!isFrontVisibleRef.current) return;
    e.stopPropagation();
    startedOnGizmoRef.current = true;
    const hit = intersectPointerWithEditorPlane(
      e.nativeEvent.clientX,
      e.nativeEvent.clientY
    );
    if (!hit) return;
    setOrbitEnabled(false);

    const live: LiveDecalTransform = {
      id: selectedDecal.id,
      centerX: selectedDecal.centerX,
      centerZ: selectedDecal.centerZ,
      widthMm: selectedDecal.widthMm,
      heightMm: selectedDecal.heightMm,
      rotationDeg: selectedDecal.rotationDeg,
    };
    setLiveDecalTransform(live);

    if (kind === 'move') {
      setCanvasCursor('grabbing');
      if (moveFillMatRef.current) {
        moveFillMatRef.current.color.set('#38BDF8');
      }
      dragRef.current = {
        kind: 'move',
        startX: hit[0],
        startZ: hit[1],
        origCX: selectedDecal.centerX,
        origCZ: selectedDecal.centerZ,
        hasMoved: false,
        live,
      };
    } else if (kind === 'scale') {
      dragRef.current = {
        kind: 'scale',
        origW: Math.max(5, selectedDecal.widthMm),
        origH: Math.max(5, selectedDecal.heightMm),
        hasMoved: false,
        live,
      };
    } else {
      setCanvasCursor('grabbing');
      dragRef.current = {
        kind: 'rotate',
        hasMoved: false,
        live,
      };
    }
  };

  const handleHover =
    (cursor: string, highlightMove = false) =>
    (e: ThreeEvent<PointerEvent>) => {
      if (!isFrontVisibleRef.current || dragRef.current) return;
      e.stopPropagation();
      setCanvasCursor(cursor);
      if (highlightMove && moveFillMatRef.current) {
        moveFillMatRef.current.color.set('#38BDF8');
      }
    };

  const handleHoverEnd =
    (unhighlightMove = false) =>
    () => {
      if (unhighlightMove && moveFillMatRef.current && dragRef.current?.kind !== 'move') {
        moveFillMatRef.current.color.set('#0A84FF');
      }
      if (!dragRef.current) {
        setCanvasCursor('');
      }
    };

  const cornerCursors = ['nesw-resize', 'nwse-resize', 'nesw-resize', 'nwse-resize'] as const;

  return (
    <group
      ref={groupRef}
      visible={false}
      position={[selectedDecal.centerX, editorY, selectedDecal.centerZ]}
      rotation={[0, -rad, 0]}
    >
      {/* Plano XZ del decal: Rx(+PI/2) alinea +X -> +X_mundo, +Y -> +Z_mundo y normal -> -Y_mundo */}
      <group rotation={[Math.PI * 0.5, 0, 0]}>
        <mesh
          ref={ghostMeshRef}
          scale={[selectedDecal.widthMm, selectedDecal.heightMm, 1]}
          onPointerDown={startDrag('move')}
          onPointerOver={handleHover('grab')}
          onPointerOut={handleHoverEnd()}
          renderOrder={25}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            key={ghostTexture ? 'ghost-tex' : 'ghost-solid'}
            map={ghostTexture ?? undefined}
            color={ghostTexture ? '#FFFFFF' : '#2997FF'}
            transparent={true}
            opacity={0.28}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        <lineSegments
          position={[0, 0, 0.08]}
          geometry={outlineGeom}
          renderOrder={26}
          raycast={NOOP_RAYCAST}
        >
          <lineBasicMaterial color="#2997FF" />
        </lineSegments>

        {[0, 1, 2, 3].map((i) => (
          <group
            key={`corner-${i}`}
            ref={(el) => {
              cornerRefs.current[i] = el;
            }}
          >
            <mesh scale={[1.28, 1.28, 1]} renderOrder={27} raycast={NOOP_RAYCAST}>
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial color="#0A84FF" side={THREE.DoubleSide} />
            </mesh>
            <mesh
              position={[0, 0, 0.02]}
              onPointerDown={startDrag('scale')}
              onPointerOver={handleHover(cornerCursors[i])}
              onPointerOut={handleHoverEnd()}
              renderOrder={28}
            >
              <planeGeometry args={[1, 1]} />
              <meshBasicMaterial color="#FFFFFF" side={THREE.DoubleSide} />
            </mesh>
          </group>
        ))}

        {/* Asa de rotación arriba del borde superior */}
        <mesh
          ref={rotHandleRef}
          onPointerDown={startDrag('rotate')}
          onPointerOver={handleHover('grab')}
          onPointerOut={handleHoverEnd()}
          renderOrder={28}
        >
          <circleGeometry args={[0.6, 20]} />
          <meshBasicMaterial color="#F59E0B" side={THREE.DoubleSide} />
        </mesh>

        {/* Gizmo central dedicado para mover la imagen */}
        <group ref={moveGizmoRef} position={[0, 0, 0.28]}>
          <mesh renderOrder={29} raycast={NOOP_RAYCAST}>
            <circleGeometry args={[1.18, 28]} />
            <meshBasicMaterial color="#FFFFFF" side={THREE.DoubleSide} />
          </mesh>
          <mesh
            position={[0, 0, 0.02]}
            onPointerDown={startDrag('move')}
            onPointerOver={handleHover('grab', true)}
            onPointerOut={handleHoverEnd(true)}
            renderOrder={30}
          >
            <circleGeometry args={[1.0, 28]} />
            <meshBasicMaterial
              ref={moveFillMatRef}
              color="#0A84FF"
              side={THREE.DoubleSide}
            />
          </mesh>
          <lineSegments
            position={[0, 0, 0.04]}
            geometry={moveArrowsGeom}
            renderOrder={31}
            raycast={NOOP_RAYCAST}
          >
            <lineBasicMaterial color="#FFFFFF" />
          </lineSegments>
        </group>
      </group>
    </group>
  );
}
