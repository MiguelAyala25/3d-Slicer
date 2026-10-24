import type { Axis } from '../../types/sculpture';
import { getWaffleAxesConfig } from './canonicalFrame';

/**
 * Calcula las posiciones ordenadas de una familia de secciones a lo largo de su eje normal.
 * N = max(1, floor(L / pitch))
 * a_i = hMin + (L - N * pitch) / 2 + pitch / 2 + i * pitch + gridOffset
 * Descarta posiciones fuera de (hMin, hMax).
 */
export function computeFamilyGridPositions(
  hMin: number,
  hMax: number,
  pitch: number,
  gridOffset: number
): number[] {
  const L = hMax - hMin;
  if (L <= 1e-6 || pitch <= 1e-6) return [];

  const N = Math.max(1, Math.floor(L / pitch));
  const positions: number[] = [];
  const base = hMin + (L - N * pitch) * 0.5 + pitch * 0.5 + gridOffset;

  for (let i = 0; i < N; i++) {
    const pos = base + i * pitch;
    // Filtrar estrictamente dentro del intervalo útil
    if (pos > hMin + 1e-9 && pos < hMax - 1e-9) {
      positions.push(pos);
    }
  }

  return positions;
}

export function computeWaffleGrid(
  boundsMin: [number, number, number],
  boundsMax: [number, number, number],
  upAxis: Axis,
  pitch: number,
  gridOffset: number
): { p1Positions: number[]; p2Positions: number[] } {
  const cfg = getWaffleAxesConfig(upAxis);

  const axisIndex = (ax: Axis) => (ax === 'x' ? 0 : ax === 'y' ? 1 : 2);

  const idx1 = axisIndex(cfg.p1Axis);
  const idx2 = axisIndex(cfg.p2Axis);

  const p1Positions = computeFamilyGridPositions(
    boundsMin[idx1],
    boundsMax[idx1],
    pitch,
    gridOffset
  );

  const p2Positions = computeFamilyGridPositions(
    boundsMin[idx2],
    boundsMax[idx2],
    pitch,
    gridOffset
  );

  return { p1Positions, p2Positions };
}
