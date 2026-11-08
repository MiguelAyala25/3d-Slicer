import { validateAndParseDiscs } from '../../projectSchema';
import type { Disc } from '../../../types/sculpture';

export function formatCanonicalFloat(n: number): string {
  return Number.isInteger(n) ? `${n.toFixed(1)}` : `${n}`;
}

export function serializeDiscsHueco(discs: Disc[]): string {
  const discBlocks = discs.map((d) => {
    const lines = [
      '    {',
      `      "id": ${d.id},`,
      `      "hueco": ${d.gapIndex},`,
      `      "x": ${formatCanonicalFloat(d.x)},`,
      `      "y": ${formatCanonicalFloat(d.y)},`,
      `      "diameter": ${formatCanonicalFloat(d.diameter)}`,
      '    }',
    ];
    return lines.join('\n');
  });

  return discBlocks.length === 0
    ? '  "discs": []'
    : `  "discs": [\n${discBlocks.join(',\n')}\n  ]`;
}

export function parseDiscsHueco(rawDiscs: unknown, plates: number): Disc[] {
  return validateAndParseDiscs(rawDiscs, plates);
}
