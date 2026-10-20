import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PARAMS } from '../core/params';
import {
  serializeProjectJson,
  parseProjectJson,
  checkParamsCompatibility,
  FORMAT_VERSION,
} from '../core/project';
import {
  saveProjectToLocalStorage,
  loadProjectFromLocalStorage,
  clearAutosaveStorage,
} from '../core/autosave';
import { ValidationError } from '../core/validator';
import type { Disc, SculptureParams } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GOLDEN_DIR = path.resolve(__dirname, '../../../web/golden');

describe('project serialization & autosave', () => {
  it('roundtrip is byte-compatible with web/golden/l_block_project.json (Correction #0 & B15)', () => {
    const rawGolden = fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_project.json'), 'utf-8');
    const parsed = parseProjectJson(rawGolden);

    expect(parsed.version).toBe(FORMAT_VERSION);
    expect(parsed.params.plates).toBe(5);
    expect(parsed.params.thickness).toBe(3.0);
    expect(parsed.params.gap).toBe(2.0);
    expect(parsed.params.axis).toBe('z');
    expect(parsed.discs.length).toBe(2);
    expect(parsed.discs[0]).toEqual({
      id: 1,
      gapIndex: 0,
      x: -7.5,
      y: 0.0,
      diameter: 5.0,
    });
    expect(parsed.discs[1]).toEqual({
      id: 2,
      gapIndex: 1,
      x: -7.5,
      y: 0.0,
      diameter: 5.0,
    });

    const serialized = serializeProjectJson(parsed.params, parsed.discs);
    // Compare normalized newlines (\r\n vs \n) and trimmed
    expect(serialized.replace(/\r\n/g, '\n').trim()).toBe(rawGolden.replace(/\r\n/g, '\n').trim());
  });

  it('rejects invalid project files', () => {
    // Missing required field
    expect(() => parseProjectJson(JSON.stringify({ version: '1.0', plates: 5 }))).toThrow(
      ValidationError
    );

    // Unsupported version
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          plates: 5,
          thickness: 3.0,
          gap: 2.0,
          axis: 'z',
          discs: [],
        })
      )
    ).toThrow(/Versión de archivo no soportada/);

    // Invalid hueco (>= plates - 1)
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '1.0',
          plates: 5,
          thickness: 3.0,
          gap: 2.0,
          axis: 'z',
          discs: [{ id: 1, hueco: 4, x: 0, y: 0, diameter: 5.0 }],
        })
      )
    ).toThrow(/hueco fuera de rango/);

    // Duplicate disc IDs
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '1.0',
          plates: 5,
          thickness: 3.0,
          gap: 2.0,
          axis: 'z',
          discs: [
            { id: 1, hueco: 0, x: 0, y: 0, diameter: 5.0 },
            { id: 1, hueco: 1, x: 0, y: 0, diameter: 5.0 },
          ],
        })
      )
    ).toThrow(/IDs de disco duplicados/);

    // Invalid diameter
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '1.0',
          plates: 5,
          thickness: 3.0,
          gap: 2.0,
          axis: 'z',
          discs: [{ id: 1, hueco: 0, x: 0, y: 0, diameter: -2.0 }],
        })
      )
    ).toThrow(/diámetro inválido/);
  });

  it('checks parameter compatibility accurately (Correction B16)', () => {
    const p1: SculptureParams = { ...DEFAULT_PARAMS, plates: 10, thickness: 3.0, gap: 2.0, axis: 'z' };
    const p2: SculptureParams = { ...DEFAULT_PARAMS, plates: 10, thickness: 3.0, gap: 2.0, axis: 'z' };
    expect(checkParamsCompatibility(p1, p2)).toBe(true);

    expect(checkParamsCompatibility({ ...p1, plates: 12 }, p2)).toBe(false);
    expect(checkParamsCompatibility({ ...p1, thickness: 4.0 }, p2)).toBe(false);
    expect(checkParamsCompatibility({ ...p1, gap: 3.0 }, p2)).toBe(false);
    expect(checkParamsCompatibility({ ...p1, axis: 'x' }, p2)).toBe(false);
  });

  it('saves and loads from localStorage via autosave', async () => {
    const params: SculptureParams = { ...DEFAULT_PARAMS, plates: 8, thickness: 4.0, gap: 2.5 };
    const discs: Disc[] = [{ id: 1, gapIndex: 0, x: 10, y: 15, diameter: 6.0 }];

    saveProjectToLocalStorage(params, discs, 'model.obj');
    const loaded = loadProjectFromLocalStorage();

    expect(loaded).not.toBeNull();
    expect(loaded?.params.plates).toBe(8);
    expect(loaded?.params.thickness).toBe(4.0);
    expect(loaded?.discs.length).toBe(1);
    expect(loaded?.discs[0].id).toBe(1);
    expect(loaded?.meshFileName).toBe('model.obj');

    await clearAutosaveStorage();
    expect(loadProjectFromLocalStorage()).toBeNull();
  });
});
