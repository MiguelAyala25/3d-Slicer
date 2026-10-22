import { PARAM_BOUNDS } from '../../params';
import { ValidationError } from '../../validator';
import type { Disc } from '../../../types/sculpture';

function formatPythonFloat(n: number): string {
  return Number.isInteger(n) ? `${n.toFixed(1)}` : `${n}`;
}

export function serializeDiscsHueco(discs: Disc[]): string {
  const discBlocks = discs.map((d) => {
    const lines = [
      '    {',
      `      "id": ${d.id},`,
      `      "hueco": ${d.gapIndex},`,
      `      "x": ${formatPythonFloat(d.x)},`,
      `      "y": ${formatPythonFloat(d.y)},`,
      `      "diameter": ${formatPythonFloat(d.diameter)}`,
      '    }',
    ];
    return lines.join('\n');
  });

  return discBlocks.length === 0
    ? '  "discs": []'
    : `  "discs": [\n${discBlocks.join(',\n')}\n  ]`;
}

export function parseDiscsHueco(rawDiscs: unknown, plates: number): Disc[] {
  if (!Array.isArray(rawDiscs)) {
    throw new ValidationError("El archivo de proyecto no contiene una lista 'discs' válida.");
  }

  const seenIds = new Set<number>();
  const discs: Disc[] = [];

  for (let i = 0; i < rawDiscs.length; i++) {
    const item = rawDiscs[i] as Record<string, unknown>;
    if (!item || typeof item !== 'object') {
      throw new ValidationError(`El disco en la posición ${i} es inválido.`);
    }
    const id = Number(item.id);
    const x = Number(item.x);
    const y = Number(item.y);
    const diameter = Number(item.diameter);
    const gapIndex = Number(item.hueco);

    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError(`El disco #${i} tiene un 'id' inválido (${String(item.id)}).`);
    }
    if (seenIds.has(id)) {
      throw new ValidationError(`El archivo contiene IDs de disco duplicados (id=${id}).`);
    }
    seenIds.add(id);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ValidationError(`El disco id=${id} tiene coordenadas (x, y) no numéricas.`);
    }
    if (
      !Number.isFinite(diameter) ||
      diameter < PARAM_BOUNDS.discDiameter.min ||
      diameter > PARAM_BOUNDS.discDiameter.max
    ) {
      throw new ValidationError(
        `El disco id=${id} tiene un diámetro inválido (${diameter} mm).`
      );
    }
    if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex >= plates - 1) {
      throw new ValidationError(
        `El disco id=${id} tiene un hueco fuera de rango (${gapIndex}; máximo permitido ${plates - 2}).`
      );
    }

    discs.push({ id, x, y, diameter, gapIndex });
  }

  return discs;
}
