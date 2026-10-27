import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';
import {
  buildPlateEdgesBufferGeometry,
  buildPlateExtrudeGeometry,
} from './plateGeometry';
import { canonicalToWorldMatrix4Elements } from '../../core/waffle/canonicalFrame';
import { canonicalPointToWorld3D } from '../../core/waffle/canonicalFrame';
import { WAFFLE_CONSTANTS } from '../../core/waffle/constants';
import type { WaffleSection } from '../../core/waffle/types';

interface BuiltWaffleGeometry {
  section: WaffleSection;
  matrix: THREE.Matrix4;
  meshGeometry: THREE.BufferGeometry;
  edgesGeometry: THREE.BufferGeometry;
}

export function WafflePlatesView() {
  const waffleResult = useSculptureStore((s) => s.waffleResult);
  const waffleParams = useSculptureStore((s) => s.waffleParams);
  const thickness = useSculptureStore((s) => s.params.thickness);
  const wireframe = useSculptureStore((s) => s.wireframe);
  const waffleFamilyFilter = useSculptureStore((s) => s.waffleFamilyFilter);
  const selectedWafflePieceId = useSculptureStore((s) => s.selectedWafflePieceId);
  const selectWafflePiece = useSculptureStore((s) => s.selectWafflePiece);

  const builtSections = useMemo<BuiltWaffleGeometry[]>(() => {
    if (!waffleResult) return [];

    const list: BuiltWaffleGeometry[] = [];
    const sections: WaffleSection[] = [];

    if (waffleFamilyFilter === 'both' || waffleFamilyFilter === 'P1') {
      sections.push(...waffleResult.p1Sections);
    }
    if (waffleFamilyFilter === 'both' || waffleFamilyFilter === 'P2') {
      sections.push(...waffleResult.p2Sections);
    }

    for (const sec of sections) {
      if (!sec.polygons || sec.polygons.length === 0) continue;

      const meshGeometry = buildPlateExtrudeGeometry(sec.polygons, thickness);
      const edgesGeometry = buildPlateEdgesBufferGeometry(sec.polygons, thickness * 0.5);

      const matrixElements = canonicalToWorldMatrix4Elements(
        sec.planeCoord,
        waffleParams.upAxis,
        sec.family
      );
      const matrix = new THREE.Matrix4().fromArray(matrixElements);

      list.push({
        section: sec,
        matrix,
        meshGeometry,
        edgesGeometry,
      });
    }

    return list;
  }, [waffleResult, waffleParams.upAxis, waffleFamilyFilter, thickness]);

  // Set of partner piece IDs for the currently selected piece
  const partnerPieceIds = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    if (!waffleResult || !selectedWafflePieceId) return set;

    for (const cr of waffleResult.crossings) {
      if (cr.p1PieceId === selectedWafflePieceId) {
        set.add(cr.p2PieceId);
      } else if (cr.p2PieceId === selectedWafflePieceId) {
        set.add(cr.p1PieceId);
      }
    }
    return set;
  }, [waffleResult, selectedWafflePieceId]);

  // Crossing 3D line segments for the active piece
  const crossingLinesGeometry = useMemo<THREE.BufferGeometry | null>(() => {
    if (!waffleResult || !selectedWafflePieceId) return null;

    const points: number[] = [];
    for (const cr of waffleResult.crossings) {
      if (
        cr.p1PieceId === selectedWafflePieceId ||
        cr.p2PieceId === selectedWafflePieceId
      ) {
        if (cr.overlap.length === 0) continue;
        const minV = Math.min(...cr.overlap.map((iv) => iv.min));
        const maxV = Math.max(...cr.overlap.map((iv) => iv.max));

        const pStart = canonicalPointToWorld3D(
          cr.bCoord,
          minV,
          0,
          cr.aCoord,
          waffleParams.upAxis,
          'P1'
        );
        const pEnd = canonicalPointToWorld3D(
          cr.bCoord,
          maxV,
          0,
          cr.aCoord,
          waffleParams.upAxis,
          'P1'
        );

        points.push(...pStart, ...pEnd);
      }
    }

    if (points.length === 0) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geom;
  }, [waffleResult, selectedWafflePieceId, waffleParams.upAxis]);

  // Dispose VRAM on unmount or geometry change
  useEffect(() => {
    return () => {
      for (const item of builtSections) {
        item.meshGeometry.dispose();
        item.edgesGeometry.dispose();
      }
      crossingLinesGeometry?.dispose();
    };
  }, [builtSections, crossingLinesGeometry]);

  if (!waffleResult) return null;

  return (
    <group>
      {builtSections.map(({ section, matrix, meshGeometry, edgesGeometry }) => {
        const isSelected = selectedWafflePieceId === section.id;
        const isPartner = partnerPieceIds.has(section.id);
        const hasSelection = selectedWafflePieceId !== null;

        let fillColor: string;
        let edgeColor: string;
        let opacity: number;
        let depthWrite: boolean;

        if (isSelected) {
          fillColor = WAFFLE_CONSTANTS.COLOR_SELECTED_FILL;
          edgeColor = WAFFLE_CONSTANTS.COLOR_SELECTED_EDGE;
          opacity = 0.95;
          depthWrite = true;
        } else if (isPartner) {
          fillColor = WAFFLE_CONSTANTS.COLOR_PARTNER_FILL;
          edgeColor = '#A7F3D0';
          opacity = 0.75;
          depthWrite = true;
        } else if (hasSelection) {
          fillColor =
            section.family === 'P1'
              ? WAFFLE_CONSTANTS.COLOR_P1_FILL
              : WAFFLE_CONSTANTS.COLOR_P2_FILL;
          edgeColor =
            section.family === 'P1'
              ? WAFFLE_CONSTANTS.COLOR_P1_EDGE
              : WAFFLE_CONSTANTS.COLOR_P2_EDGE;
          opacity = 0.18;
          depthWrite = false;
        } else {
          fillColor =
            section.family === 'P1'
              ? WAFFLE_CONSTANTS.COLOR_P1_FILL
              : WAFFLE_CONSTANTS.COLOR_P2_FILL;
          edgeColor =
            section.family === 'P1'
              ? WAFFLE_CONSTANTS.COLOR_P1_EDGE
              : WAFFLE_CONSTANTS.COLOR_P2_EDGE;
          opacity = 0.82;
          depthWrite = true;
        }

        return (
          <group
            key={section.id}
            matrixAutoUpdate={false}
            matrix={matrix}
            onClick={(e) => {
              e.stopPropagation();
              selectWafflePiece(isSelected ? null : section.id);
            }}
          >
            <mesh geometry={meshGeometry}>
              <meshStandardMaterial
                color={fillColor}
                roughness={0.35}
                metalness={0.15}
                wireframe={wireframe}
                transparent={opacity < 1.0}
                opacity={opacity}
                depthWrite={depthWrite}
                side={THREE.DoubleSide}
              />
            </mesh>

            {!wireframe && (
              <lineSegments geometry={edgesGeometry}>
                <lineBasicMaterial
                  color={edgeColor}
                  transparent={opacity < 1.0}
                  opacity={Math.min(1.0, opacity * 1.25)}
                  depthWrite={depthWrite}
                />
              </lineSegments>
            )}
          </group>
        );
      })}

      {/* Highlight crossing lines for selected piece */}
      {crossingLinesGeometry && (
        <lineSegments geometry={crossingLinesGeometry}>
          <lineBasicMaterial
            color="#10B981"
            linewidth={3}
            depthTest={false}
            transparent
            opacity={0.95}
          />
        </lineSegments>
      )}
    </group>
  );
}
