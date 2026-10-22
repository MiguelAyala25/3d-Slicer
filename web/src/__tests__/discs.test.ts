import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiscManager, MAX_HISTORY } from '../core/joints/discs/DiscManager';
import {
  clampDiscPositionToGap,
  isDiscInsidePlate,
  isDiscValidForGap,
} from '../core/joints/discs/discGeometry';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { sliceMesh } from '../core/slicer';
import { DEFAULT_PARAMS } from '../core/params';
import { ValidationError } from '../core/validator';
import type { PlateContour } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../../web/fixtures');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createSquarePlate(halfSize: number): PlateContour {
  return [
    {
      exterior: [
        [-halfSize, -halfSize],
        [halfSize, -halfSize],
        [halfSize, halfSize],
        [-halfSize, halfSize],
      ],
      holes: [],
      area: 4 * halfSize * halfSize,
    },
  ];
}

describe('discs & geometry2d', () => {
  it('validates disc completely inside plate and gap (Correction A4)', () => {
    // Stepped plates: P0 is 40x40 (halfSize 20), P1 is 20x20 (halfSize 10), P2 is 10x10 (halfSize 5)
    const plates: PlateContour[] = [
      createSquarePlate(20),
      createSquarePlate(10),
      createSquarePlate(5),
    ];

    // Disc diameter 6.0 (R = 3.0). Valid range in P0 is [-17, 17], in P1 is [-7, 7], in P2 is [-2, 2]
    // In gap 0 (plates 0 and 1), valid range is intersection: [-7, 7]
    expect(isDiscValidForGap(0, 0, 6.0, 0, plates)).toBe(true);
    expect(isDiscValidForGap(7, 0, 6.0, 0, plates)).toBe(true);
    // At (8, 0): inside P0 (dist to edge 12 >= 3), but inside P1 dist to edge is 2 < 3 -> false
    expect(isDiscInsidePlate(8, 0, 6.0, plates[0])).toBe(true);
    expect(isDiscInsidePlate(8, 0, 6.0, plates[1])).toBe(false);
    expect(isDiscValidForGap(8, 0, 6.0, 0, plates)).toBe(false);
  });

  it('rejects disc near outer boundary or inner hole on test_torus.stl', () => {
    const torusBuf = toArrayBuffer(fs.readFileSync(path.join(FIXTURES_DIR, 'test_torus.stl')));
    const mesh = loadMeshFromBuffer(torusBuf, 'test_torus.stl');
    const positions = mesh.geometry.getAttribute('position').array as Float32Array;
    const sliceResult = sliceMesh(positions, {
      ...DEFAULT_PARAMS,
      plates: 5,
      thickness: 3.0,
      gap: 2.0,
      axis: 'z',
    });

    // Middle plate has an inner hole
    const midPlate = sliceResult.plates[2];
    expect(midPlate.length).toBeGreaterThan(0);
    expect(midPlate[0].holes.length).toBeGreaterThan(0);

    // Center (0, 0) falls inside the hole
    expect(isDiscInsidePlate(0, 0, 6.0, midPlate)).toBe(false);
  });

  it('auto-copies to gap k+1 only if it fits in plates[k+2]', () => {
    const dm = new DiscManager(6.0);
    // P0: 40x40, P1: 20x20, P2: 10x10
    const plates: PlateContour[] = [
      createSquarePlate(20),
      createSquarePlate(10),
      createSquarePlate(5),
    ];

    // Placing disc at (0, 0) fits in P0 (R=3 <= 20), P1 (R=3 <= 10), and P2 (R=3 <= 5) -> autoCopy succeeds
    const outcome1 = dm.addDisc(0, 0, 0, plates, 6.0, true);
    expect(outcome1.primary).toBeDefined();
    expect(outcome1.autoCopied).not.toBeNull();
    expect(outcome1.autoCopied?.gapIndex).toBe(1);

    // Placing disc at (4, 0) fits in P0 and P1, but in P2 dist to edge is 1 < 3 -> cannot fit in P2
    // So auto-copy to gap 1 (between P1 and P2) should be rejected
    const outcome2 = dm.addDisc(4, 0, 0, plates, 6.0, true);
    expect(outcome2.primary).toBeDefined();
    expect(outcome2.autoCopied).toBeNull();
  });

  it('slides smoothly along boundary using clampDiscPositionToGap (Correction #5d)', () => {
    // Square plate [-10, 10]^2. Valid range for d=6.0 (R=3.0) is [-7, 7]^2
    const plates: PlateContour[] = [
      createSquarePlate(10),
      createSquarePlate(10),
    ];

    const prevValid: [number, number] = [0, 6.5];
    const target: [number, number] = [5, 15]; // Way above top edge y=10
    const clamped = clampDiscPositionToGap(target[0], target[1], prevValid[0], prevValid[1], 6.0, 0, plates);

    // X should slide to 5, Y should be clamped to valid boundary 7
    expect(clamped[0]).toBeCloseTo(5.0, 1);
    expect(clamped[1]).toBeCloseTo(7.0, 1);
    expect(isDiscValidForGap(clamped[0], clamped[1], 6.0, 0, plates)).toBe(true);
  });

  it('rescales positions by scaleRatio before purgeInvalidDiscs (Correction #5c)', () => {
    const dm = new DiscManager(6.0);
    const plates: PlateContour[] = [
      createSquarePlate(10),
      createSquarePlate(10),
    ];

    dm.addDisc(4.0, 2.0, 0, plates, 6.0, false);
    expect(dm.getAllDiscs()[0].x).toBe(4.0);
    expect(dm.getAllDiscs()[0].y).toBe(2.0);

    // Rescale by 1.5
    dm.rescalePositions(1.5);
    expect(dm.getAllDiscs()[0].x).toBeCloseTo(6.0, 4);
    expect(dm.getAllDiscs()[0].y).toBeCloseTo(3.0, 4);
    // Diameter stays in physical mm
    expect(dm.getAllDiscs()[0].diameter).toBe(6.0);

    // At (6, 3) inside [-10, 10]^2 with R=3, dist to x=10 is 4 >= 3 -> still valid
    const purged = dm.purgeInvalidDiscs(plates);
    expect(purged).toBe(0);
    expect(dm.getAllDiscs().length).toBe(1);

    // If scaled further by 2.0 -> (12, 6) which is outside -> purged
    dm.rescalePositions(2.0);
    const purged2 = dm.purgeInvalidDiscs(plates);
    expect(purged2).toBe(1);
    expect(dm.getAllDiscs().length).toBe(0);
  });

  it('setDiameter rejects enlarging when it invades plate boundary', () => {
    const dm = new DiscManager(6.0);
    const plates: PlateContour[] = [
      createSquarePlate(10),
      createSquarePlate(10),
    ];

    const outcome = dm.addDisc(6.0, 0.0, 0, plates, 6.0, false);
    const id = outcome.primary.id;

    // Increasing diameter to 10.0 (R=5.0) at x=6.0 means outer edge reaches 6+5=11 > 10 -> throws ValidationError
    expect(() => dm.setDiameter(id, 10.0, plates)).toThrow(ValidationError);
    // Smaller diameter 4.0 fits
    expect(dm.setDiameter(id, 4.0, plates)).toBe(true);
    expect(dm.getAllDiscs()[0].diameter).toBe(4.0);
  });

  it('manages undo and redo up to MAX_HISTORY (50)', () => {
    const dm = new DiscManager(6.0);
    const plates: PlateContour[] = [
      createSquarePlate(10),
      createSquarePlate(10),
    ];

    dm.addDisc(0, 0, 0, plates, 6.0, false);
    expect(dm.getAllDiscs().length).toBe(1);
    expect(dm.canUndo()).toBe(true);
    expect(dm.canRedo()).toBe(false);

    dm.undo();
    expect(dm.getAllDiscs().length).toBe(0);
    expect(dm.canUndo()).toBe(false);
    expect(dm.canRedo()).toBe(true);

    dm.redo();
    expect(dm.getAllDiscs().length).toBe(1);

    // Test history cap
    for (let i = 0; i < MAX_HISTORY + 10; i++) {
      dm.saveSnapshot();
    }
    // Undoing should work without crash
    expect(dm.undo()).toBe(true);
  });

  it('allows placing and moving small circles near edges without artificial barriers', () => {
    const dm = new DiscManager(6.0);
    // Square plate 20x20 (halfSize 10)
    const plates: PlateContour[] = [
      createSquarePlate(10),
      createSquarePlate(10),
    ];

    // Disc diameter 0.5 mm placed at (9.5, 0.0), which is 0.5 mm from the edge
    const outcomeSmall = dm.addDisc(9.5, 0.0, 0, plates, 0.5, false);
    expect(outcomeSmall.primary).toBeDefined();
    expect(outcomeSmall.primary.diameter).toBe(0.5);
    expect(outcomeSmall.primary.x).toBe(9.5);

    // Can shrink diameter down to 0.1 mm
    expect(dm.setDiameter(outcomeSmall.primary.id, 0.1, plates)).toBe(true);
    expect(dm.getAllDiscs()[0].diameter).toBe(0.1);

    // Can move disc right along the edge (x=9.8) without being rejected
    expect(dm.moveDisc(outcomeSmall.primary.id, 9.8, 0.0, plates)).toBe(true);
    expect(dm.getAllDiscs()[0].x).toBe(9.8);
  });
});
