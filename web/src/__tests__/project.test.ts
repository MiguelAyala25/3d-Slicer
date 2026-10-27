import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PARAMS } from '../core/params';
import { DEFAULT_BUILD } from '../core/build/types';
import {
  serializeProjectJson,
  serializeProject,
  parseProjectJson,
  projectFormatFor,
  checkParamsCompatibility,
  FORMAT_VERSION,
} from '../core/project';
import {
  saveProjectToLocalStorage,
  loadProjectFromLocalStorage,
  clearAutosaveStorage,
  LOCAL_STORAGE_KEY,
} from '../core/autosave';
import { ValidationError } from '../core/validator';
import type { SculptureParams } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GOLDEN_DIR = path.resolve(__dirname, '../../../web/golden');

describe('project serialization & autosave', () => {
  it('roundtrip is byte-compatible with web/golden/l_block_project.json (Correction #0 & B15)', () => {
    const rawGolden = fs.readFileSync(path.join(GOLDEN_DIR, 'l_block_project.json'), 'utf-8');
    const parsed = parseProjectJson(rawGolden);

    expect(parsed.version).toBe(FORMAT_VERSION);
    expect(parsed.build).toEqual(DEFAULT_BUILD);
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

  it('1. roundtrip 2.0 complete: produces exact E.2 text and parses all 13 parameters', () => {
    const customParams: SculptureParams = {
      ...DEFAULT_PARAMS,
      thickness: 3.0,
      sheetW: 600.0,
      sheetH: 400.0,
      sheetMargin: 10.0,
      partGap: 5.0,
      kerf: 0.15,
      scrapTagEnabled: true,
      plates: 10,
      axis: 'z',
      gap: 0,
    };
    const build = { techniqueId: 'stacked' as const, jointId: 'none' as const };

    const serialized = serializeProject(customParams, build, []);
    const expectedJson = `{
  "version": "2.0",
  "material": {
    "thickness": 3.0,
    "sheetW": 600.0,
    "sheetH": 400.0,
    "sheetMargin": 10.0,
    "partGap": 5.0,
    "kerf": 0.15,
    "scrapTagEnabled": true
  },
  "technique": {
    "id": "stacked",
    "params": {
      "plates": 10,
      "axis": "z"
    }
  },
  "joint": {
    "id": "none",
    "params": {}
  }
}`;
    expect(serialized.replace(/\r\n/g, '\n')).toBe(expectedJson);

    const parsed = parseProjectJson(serialized);
    expect(parsed.version).toBe('2.0');
    expect(parsed.build).toEqual(build);
    expect(parsed.params.thickness).toBe(3.0);
    expect(parsed.params.sheetW).toBe(600.0);
    expect(parsed.params.sheetH).toBe(400.0);
    expect(parsed.params.sheetMargin).toBe(10.0);
    expect(parsed.params.partGap).toBe(5.0);
    expect(parsed.params.kerf).toBe(0.15);
    expect(parsed.params.scrapTagEnabled).toBe(true);
    expect(parsed.params.plates).toBe(10);
    expect(parsed.params.axis).toBe('z');
    expect(parsed.params.gap).toBe(0);
    expect(parsed.discs).toEqual([]);

    const reserialized = serializeProject(parsed.params, parsed.build, parsed.discs);
    expect(reserialized.replace(/\r\n/g, '\n')).toBe(expectedJson);
  });

  it('2. chooses correct project format version via projectFormatFor', () => {
    expect(
      projectFormatFor(DEFAULT_BUILD, { ...DEFAULT_PARAMS, gap: 2.0 })
    ).toBe('1.0');
    expect(
      projectFormatFor({ techniqueId: 'stacked', jointId: 'none' }, { ...DEFAULT_PARAMS, gap: 0 })
    ).toBe('2.0');
    expect(
      projectFormatFor(DEFAULT_BUILD, { ...DEFAULT_PARAMS, gap: 0 })
    ).toBe('2.0');
  });

  it('4. 2.0 with discs import', () => {
    const raw2 = `{
  "version": "2.0",
  "material": {
    "thickness": 4.0,
    "sheetW": 600.0,
    "sheetH": 400.0,
    "sheetMargin": 10.0,
    "partGap": 5.0,
    "kerf": 0.15,
    "scrapTagEnabled": true
  },
  "technique": {
    "id": "stacked",
    "params": {
      "plates": 8,
      "axis": "y"
    }
  },
  "joint": {
    "id": "discs",
    "params": {
      "gap": 2.5,
      "discDiameter": 7.0,
      "engraveClearance": 0.4
    },
    "discs": [
      {
        "id": 1,
        "hueco": 0,
        "x": -7.5,
        "y": 0.0,
        "diameter": 5.0
      }
    ]
  }
}`;

    const parsed = parseProjectJson(raw2);
    expect(parsed.version).toBe('2.0');
    expect(parsed.build).toEqual({ techniqueId: 'stacked', jointId: 'discs' });
    expect(parsed.params.gap).toBe(2.5);
    expect(parsed.params.discDiameter).toBe(7.0);
    expect(parsed.params.engraveClearance).toBe(0.4);
    expect(parsed.params.plates).toBe(8);
    expect(parsed.params.axis).toBe('y');
    expect(parsed.discs.length).toBe(1);
    expect(parsed.discs[0]).toEqual({
      id: 1,
      gapIndex: 0,
      x: -7.5,
      y: 0.0,
      diameter: 5.0,
    });
  });

  it('5. rejects invalid project files and unsupported versions with exact messages', () => {
    // Missing required field
    expect(() => parseProjectJson(JSON.stringify({ version: '1.0', plates: 5 }))).toThrow(
      ValidationError
    );

    // Unsupported version
    expect(() =>
      parseProjectJson(JSON.stringify({ version: '3.0' }))
    ).toThrow("Versión de archivo no soportada: '3.0' (se esperaba '1.0' o '2.0').");

    expect(() =>
      parseProjectJson(JSON.stringify({ version: '0.9' }))
    ).toThrow("Versión de archivo no soportada: '0.9' (se esperaba '1.0' o '2.0').");

    expect(() =>
      parseProjectJson(JSON.stringify({}))
    ).toThrow("Versión de archivo no soportada: 'undefined' (se esperaba '1.0' o '2.0').");

    // Missing material or technique in 2.0
    expect(() =>
      parseProjectJson(JSON.stringify({ version: '2.0', technique: {}, joint: {} }))
    ).toThrow("Falta el campo obligatorio 'material' en el archivo JSON.");

    expect(() =>
      parseProjectJson(JSON.stringify({ version: '2.0', material: {}, joint: {} }))
    ).toThrow("Falta el campo obligatorio 'technique' en el archivo JSON.");

    // Extra root key
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {},
          technique: {},
          joint: {},
          foo: 123,
        })
      )
    ).toThrow("Campo no reconocido 'foo' en la raíz.");

    // Extra key in material
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
            extraKey: 42,
          },
          technique: { id: 'stacked', params: { plates: 10, axis: 'z' } },
          joint: { id: 'none', params: {} },
        })
      )
    ).toThrow("Campo no reconocido 'extraKey' en 'material'.");

    // Invalid technique id
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
          },
          technique: { id: 'cubes', params: { plates: 10, axis: 'z' } },
          joint: { id: 'none', params: {} },
        })
      )
    ).toThrow("Técnica desconocida: 'cubes'.");

    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
          },
          technique: { id: 'origami', params: {} },
          joint: { id: 'none', params: {} },
        })
      )
    ).toThrow("Técnica desconocida: 'origami'.");

    // Unavailable joint id
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
          },
          technique: { id: 'stacked', params: { plates: 10, axis: 'z' } },
          joint: { id: 'rod', params: {} },
        })
      )
    ).toThrow('La unión «Con varilla» aún no está disponible.');

    // joint.params with none has extra key
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
          },
          technique: { id: 'stacked', params: { plates: 10, axis: 'z' } },
          joint: { id: 'none', params: { gap: 1 } },
        })
      )
    ).toThrow("Campo no reconocido 'gap' en 'joint.params'.");

    // joint.discs with none
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
          },
          technique: { id: 'stacked', params: { plates: 10, axis: 'z' } },
          joint: { id: 'none', params: {}, discs: [] },
        })
      )
    ).toThrow('La unión «Sin separación» no admite discos.');

    // Non-numeric plates
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
          },
          technique: { id: 'stacked', params: { plates: 'diez', axis: 'z' } },
          joint: { id: 'none', params: {} },
        })
      )
    ).toThrow("El campo 'technique.params.plates' debe ser numérico.");

    // Non-boolean scrapTagEnabled
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: 'si',
          },
          technique: { id: 'stacked', params: { plates: 10, axis: 'z' } },
          joint: { id: 'none', params: {} },
        })
      )
    ).toThrow("El campo 'material.scrapTagEnabled' debe ser booleano.");

    // plates: 1 out of bounds
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
          },
          technique: { id: 'stacked', params: { plates: 1, axis: 'z' } },
          joint: { id: 'none', params: {} },
        })
      )
    ).toThrow(/El número de placas debe ser un entero entre 2 y 200/);

    // thickness: 0 out of bounds
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
          },
          technique: { id: 'stacked', params: { plates: 10, axis: 'z' } },
          joint: { id: 'none', params: {} },
        })
      )
    ).toThrow(/El grosor debe estar entre 0.1 y 100 mm/);

    // axis: 'w' invalid
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: {
            thickness: 3.0,
            sheetW: 600.0,
            sheetH: 400.0,
            sheetMargin: 10.0,
            partGap: 5.0,
            kerf: 0.15,
            scrapTagEnabled: true,
          },
          technique: { id: 'stacked', params: { plates: 10, axis: 'w' } },
          joint: { id: 'none', params: {} },
        })
      )
    ).toThrow(/El eje de corte debe ser 'x', 'y' o 'z'/);

    // Discs with hueco out of range (in 1.0)
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
  });

  it('checks parameter compatibility accurately (Correction B16 & build)', () => {
    const p1: SculptureParams = { ...DEFAULT_PARAMS, plates: 10, thickness: 3.0, gap: 2.0, axis: 'z' };
    const p2: SculptureParams = { ...DEFAULT_PARAMS, plates: 10, thickness: 3.0, gap: 2.0, axis: 'z' };
    expect(checkParamsCompatibility(p1, p2)).toBe(true);

    expect(checkParamsCompatibility({ ...p1, plates: 12 }, p2)).toBe(false);
    expect(checkParamsCompatibility({ ...p1, thickness: 4.0 }, p2)).toBe(false);
    expect(checkParamsCompatibility({ ...p1, gap: 3.0 }, p2)).toBe(false);
    expect(checkParamsCompatibility({ ...p1, axis: 'x' }, p2)).toBe(false);

    // Build compatibility
    expect(
      checkParamsCompatibility(
        p1,
        p2,
        { techniqueId: 'stacked', jointId: 'none' },
        { techniqueId: 'stacked', jointId: 'discs' }
      )
    ).toBe(false);
  });

  it('6. autosave: saves and loads with none, preserves build, gap=0 and sheet params', async () => {
    const params: SculptureParams = {
      ...DEFAULT_PARAMS,
      plates: 8,
      thickness: 4.0,
      gap: 0,
      sheetW: 500,
      sheetH: 350,
      scrapTagEnabled: false,
    };
    const noneBuild = { techniqueId: 'stacked' as const, jointId: 'none' as const };

    saveProjectToLocalStorage(params, [], 'model.obj', noneBuild);
    const loaded = loadProjectFromLocalStorage();

    expect(loaded).not.toBeNull();
    expect(loaded?.build).toEqual(noneBuild);
    expect(loaded?.params.plates).toBe(8);
    expect(loaded?.params.thickness).toBe(4.0);
    expect(loaded?.params.gap).toBe(0);
    expect(loaded?.params.sheetW).toBe(500);
    expect(loaded?.params.sheetH).toBe(350);
    expect(loaded?.params.scrapTagEnabled).toBe(false);
    expect(loaded?.discs.length).toBe(0);
    expect(loaded?.meshFileName).toBe('model.obj');

    // Envelope without build (pre-Phase 8 format) is read as DEFAULT_BUILD
    const oldEnvelope = {
      projectJson: serializeProjectJson({ ...DEFAULT_PARAMS, plates: 6, thickness: 3, gap: 2, axis: 'z' }, []),
      fullParams: { ...DEFAULT_PARAMS, plates: 6, thickness: 3, gap: 2, axis: 'z' },
      meshFileName: 'old.obj',
      savedAt: Date.now(),
    };
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(oldEnvelope));
    const loadedOld = loadProjectFromLocalStorage();
    expect(loadedOld?.build).toEqual(DEFAULT_BUILD);
    expect(loadedOld?.params.plates).toBe(6);

    await clearAutosaveStorage();
    expect(loadProjectFromLocalStorage()).toBeNull();
  });

  it('7. roundtrip 2.0 waffle: serializes and parses all waffle parameters with slots joint', () => {
    const customParams: SculptureParams = {
      ...DEFAULT_PARAMS,
      thickness: 3.0,
      sheetW: 600.0,
      sheetH: 400.0,
      sheetMargin: 10.0,
      partGap: 5.0,
      kerf: 0.15,
      scrapTagEnabled: true,
    };
    const build = { techniqueId: 'waffle' as const, jointId: 'slots' as const };
    const waffleParams = {
      upAxis: 'z' as const,
      pitch: 14.0,
      slotClearance: 0.1,
      gridOffset: 1.0,
      slotLabelsEnabled: true,
      targetScale: 1.5,
    };

    const serialized = serializeProject(customParams, build, [], waffleParams);
    const parsed = parseProjectJson(serialized);

    expect(parsed.version).toBe('2.0');
    expect(parsed.build).toEqual(build);
    expect(parsed.waffleParams).toEqual(waffleParams);
    expect(parsed.params.thickness).toBe(3.0);
    expect(parsed.params.kerf).toBe(0.15);
    expect(parsed.discs).toEqual([]);

    const reserialized = serializeProject(parsed.params, parsed.build, parsed.discs, parsed.waffleParams);
    expect(reserialized.replace(/\r\n/g, '\n')).toBe(serialized.replace(/\r\n/g, '\n'));
  });

  it('8. rejects invalid waffle 2.0 projects with exact messages', () => {
    // Waffle with invalid joint (e.g. none or discs)
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: { thickness: 3.0, sheetW: 600, sheetH: 400, sheetMargin: 10, partGap: 5, kerf: 0.15, scrapTagEnabled: true },
          technique: {
            id: 'waffle',
            params: { upAxis: 'z', pitch: 12, slotClearance: 0.1, gridOffset: 0, slotLabelsEnabled: true, targetScale: 1.0 },
          },
          joint: { id: 'none', params: {} },
        })
      )
    ).toThrow("La técnica «Waffle» solo admite la unión «Encaje por ranuras» ('slots').");

    // Waffle with discs property
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: { thickness: 3.0, sheetW: 600, sheetH: 400, sheetMargin: 10, partGap: 5, kerf: 0.15, scrapTagEnabled: true },
          technique: {
            id: 'waffle',
            params: { upAxis: 'z', pitch: 12, slotClearance: 0.1, gridOffset: 0, slotLabelsEnabled: true, targetScale: 1.0 },
          },
          joint: { id: 'slots', params: {}, discs: [] },
        })
      )
    ).toThrow('La unión «Encaje por ranuras» no admite discos.');

    // Missing upAxis
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: { thickness: 3.0, sheetW: 600, sheetH: 400, sheetMargin: 10, partGap: 5, kerf: 0.15, scrapTagEnabled: true },
          technique: {
            id: 'waffle',
            params: { pitch: 12, slotClearance: 0.1, gridOffset: 0, slotLabelsEnabled: true, targetScale: 1.0 },
          },
          joint: { id: 'slots', params: {} },
        })
      )
    ).toThrow("Falta el campo obligatorio 'technique.params.upAxis' en el archivo JSON.");

    // Invalid upAxis
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: { thickness: 3.0, sheetW: 600, sheetH: 400, sheetMargin: 10, partGap: 5, kerf: 0.15, scrapTagEnabled: true },
          technique: {
            id: 'waffle',
            params: { upAxis: 'w', pitch: 12, slotClearance: 0.1, gridOffset: 0, slotLabelsEnabled: true, targetScale: 1.0 },
          },
          joint: { id: 'slots', params: {} },
        })
      )
    ).toThrow("El campo 'technique.params.upAxis' debe ser 'x', 'y' o 'z'.");

    // Pitch < 2 * thickness
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: { thickness: 3.0, sheetW: 600, sheetH: 400, sheetMargin: 10, partGap: 5, kerf: 0.15, scrapTagEnabled: true },
          technique: {
            id: 'waffle',
            params: { upAxis: 'z', pitch: 4.0, slotClearance: 0.1, gridOffset: 0, slotLabelsEnabled: true, targetScale: 1.0 },
          },
          joint: { id: 'slots', params: {} },
        })
      )
    ).toThrow('La separación entre secciones (4 mm) debe ser al menos 2 veces el grosor de placa (6.00 mm).');

    // Unknown field in technique.params
    expect(() =>
      parseProjectJson(
        JSON.stringify({
          version: '2.0',
          material: { thickness: 3.0, sheetW: 600, sheetH: 400, sheetMargin: 10, partGap: 5, kerf: 0.15, scrapTagEnabled: true },
          technique: {
            id: 'waffle',
            params: { upAxis: 'z', pitch: 12, slotClearance: 0.1, gridOffset: 0, slotLabelsEnabled: true, targetScale: 1.0, extra: 42 },
          },
          joint: { id: 'slots', params: {} },
        })
      )
    ).toThrow("Campo no reconocido 'extra' en 'technique.params'.");
  });

  it('9. autosave with waffle: preserves waffleParams in envelope', async () => {
    const params: SculptureParams = {
      ...DEFAULT_PARAMS,
      thickness: 3.0,
      kerf: 0.15,
    };
    const waffleBuild = { techniqueId: 'waffle' as const, jointId: 'slots' as const };
    const waffleParams = {
      upAxis: 'y' as const,
      pitch: 16.0,
      slotClearance: 0.15,
      gridOffset: -2.0,
      slotLabelsEnabled: false,
      targetScale: 0.8,
    };

    saveProjectToLocalStorage(params, [], 'sculpture.stl', waffleBuild, waffleParams);
    const loaded = loadProjectFromLocalStorage();

    expect(loaded).not.toBeNull();
    expect(loaded?.build).toEqual(waffleBuild);
    expect(loaded?.waffleParams).toEqual(waffleParams);
    expect(loaded?.meshFileName).toBe('sculpture.stl');

    await clearAutosaveStorage();
  });
});
