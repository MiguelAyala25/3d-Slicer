// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useSculptureStore } from '../store/useSculptureStore';
import { DEFAULT_PARAMS } from '../core/params';
import { DEFAULT_BUILD } from '../core/build/types';
import { INITIAL_WAFFLE_STATE } from '../store/waffleSlice';
import { parseProjectJson } from '../core/project';
import { saveProjectToLocalStorage, clearAutosaveStorage } from '../core/autosave';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');

function loadFixtureArrayBuffer(name: string): ArrayBuffer {
  const buf = fs.readFileSync(path.join(FIXTURES_DIR, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('useSculptureStore Characterization Tests (M1 / C7-4 & C7-5)', () => {
  const originalRunSlice = useSculptureStore.getState().runSlice;
  let runSliceSpy: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(async () => {
    window.localStorage.clear();
    await clearAutosaveStorage();
    runSliceSpy = vi.fn(async () => {
      await originalRunSlice();
    });

    useSculptureStore.getState().resetDiscs();
    useSculptureStore.setState({
      params: { ...DEFAULT_PARAMS },
      build: { ...DEFAULT_BUILD },
      waffleParams: { ...INITIAL_WAFFLE_STATE.waffleParams },
      wafflePitchManuallyEdited: false,
      waffleResult: null,
      waffleFamilyFilter: 'both',
      selectedWafflePieceId: null,
      isCalibrationSheetModalOpen: false,
      gapManuallyEdited: false,
      isResultDirty: false,
      modelExtents: null,
      sizeIntent: { kind: 'plates' },
      sizeCommitSeq: 0,
      meshGeometry: null,
      meshMetadata: null,
      meshFileName: null,
      sliceResult: null,
      isSlicing: false,
      isLoadingMesh: false,
      lastSliceAxis: null,
      lastSliceDurationMs: null,
      viewMode: 'original',
      wireframe: false,
      showAllFloors: true,
      activeFloor: 0,
      cameraPreset: 'iso',
      cameraPresetTrigger: 0,
      sheetLayouts: null,
      isPreviewModalOpen: false,
      pendingAutosave: null,
      errorMessage: null,
      runSlice: runSliceSpy,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    useSculptureStore.setState({ runSlice: originalRunSlice });
  });

  it('1. Debounce (350ms): rapid continuous parameter edits trigger a single runSlice call (C7-4, C7-5)', async () => {
    const buffer = loadFixtureArrayBuffer('test_l_block.obj');
    await useSculptureStore.getState().loadMeshArrayBuffer(buffer, 'test_l_block.obj', true);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);
    runSliceSpy.mockClear();

    // Activar timers falsos y desactivar el bypass de entorno de test para ejercitar el debounce real de 350ms
    vi.useFakeTimers();
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'development');

    // Ráfaga de 5 cambios de plates en stacked
    for (const plates of [6, 7, 8, 9, 10]) {
      useSculptureStore.getState().setParam('plates', plates);
    }
    expect(useSculptureStore.getState().params.plates).toBe(10);
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(349);
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);
    expect(useSculptureStore.getState().sliceResult?.plates.length).toBe(10);

    // Ráfaga en setPlatesFromDimension
    runSliceSpy.mockClear();
    useSculptureStore.getState().setPlatesFromDimension('alto', 50);
    useSculptureStore.getState().setPlatesFromDimension('alto', 60);
    useSculptureStore.getState().setPlatesFromDimension('alto', 70);
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(350);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);

    // Cambiar a técnica waffle y probar ráfaga en setWaffleParam('pitch') y setWaffleDimensionTarget
    useSculptureStore.getState().setTechnique('waffle');
    expect(runSliceSpy).toHaveBeenCalledTimes(2); // setTechnique ejecuta 1 corte inmediato
    runSliceSpy.mockClear();

    useSculptureStore.getState().setWaffleParam('pitch', 14);
    useSculptureStore.getState().setWaffleParam('pitch', 16);
    useSculptureStore.getState().setWaffleParam('pitch', 18);
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(350);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);

    runSliceSpy.mockClear();
    useSculptureStore.getState().setWaffleDimensionTarget('alto', 80);
    useSculptureStore.getState().setWaffleDimensionTarget('alto', 90);
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(350);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);
  });

  it('2. Discrete axis/grid changes cancel pending debounce and trigger immediate runSlice (C7-5)', async () => {
    const buffer = loadFixtureArrayBuffer('test_l_block.obj');
    await useSculptureStore.getState().loadMeshArrayBuffer(buffer, 'test_l_block.obj', true);
    runSliceSpy.mockClear();

    vi.useFakeTimers();
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'development');

    // Programar un cambio con debounce y enseguida cambiar de eje
    useSculptureStore.getState().setParam('plates', 8);
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    useSculptureStore.getState().setParam('axis', 'x');
    expect(runSliceSpy).toHaveBeenCalledTimes(1);

    // Al pasar los 350ms del cambio previo de plates, NO debe dispararse otro runSlice
    await vi.advanceTimersByTimeAsync(400);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);

    // En modo waffle: upAxis y optimizeWaffleGridForTargetSections son inmediatos
    useSculptureStore.getState().setTechnique('waffle');
    runSliceSpy.mockClear();

    useSculptureStore.getState().setWaffleParam('pitch', 15);
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    useSculptureStore.getState().setWaffleParam('upAxis', 'y');
    expect(runSliceSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);

    runSliceSpy.mockClear();
    useSculptureStore.getState().optimizeWaffleGridForTargetSections(5);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);
  });

  it('3. setTechnique and setJoint require confirmation when discs exist and only runSlice when confirmed (C7-4, C7-5)', async () => {
    useSculptureStore.setState({
      params: { ...DEFAULT_PARAMS, plates: 5, thickness: 3.0, gap: 2.0, axis: 'z', discDiameter: 5.0 },
    });
    const buffer = loadFixtureArrayBuffer('test_l_block.stl');
    await useSculptureStore.getState().loadMeshArrayBuffer(buffer, 'test_l_block.stl', true);

    // Colocar un disco válido en (-7.5, 0.0) con diámetro 5 mm (igual que en l_block_project.json)
    useSculptureStore.getState().addDiscAtActiveFloor(-7.5, 0.0);
    const placedCount = useSculptureStore.getState().discs.length;
    expect(placedCount).toBeGreaterThan(0);

    runSliceSpy.mockClear();

    // Intento sin confirmar hacia waffle -> pide confirmación y NO ejecuta runSlice
    const unconfirmedWaffle = useSculptureStore.getState().setTechnique('waffle');
    expect(unconfirmedWaffle).toEqual({ needsConfirmation: true, discCount: placedCount });
    expect(useSculptureStore.getState().build.techniqueId).toBe('stacked');
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    // Intento sin confirmar hacia joint none -> pide confirmación y NO ejecuta runSlice
    const unconfirmedNone = useSculptureStore.getState().setJoint('none');
    expect(unconfirmedNone).toEqual({ needsConfirmation: true, discCount: placedCount });
    expect(useSculptureStore.getState().build.jointId).toBe('discs');
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    // Confirmado hacia joint none -> limpia discos y ejecuta exactamente 1 runSlice
    const confirmedNone = useSculptureStore.getState().setJoint('none', { confirmed: true });
    expect(confirmedNone).toEqual({ needsConfirmation: false, discCount: 0 });
    expect(useSculptureStore.getState().build.jointId).toBe('none');
    expect(useSculptureStore.getState().discs).toHaveLength(0);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);
  });

  it('4. View, floor navigation, camera presets and sheet preview modals behave identically (viewSlice)', async () => {
    const buffer = loadFixtureArrayBuffer('test_l_block.obj');
    await useSculptureStore.getState().loadMeshArrayBuffer(buffer, 'test_l_block.obj', true);

    const store = useSculptureStore.getState();
    expect(store.viewMode).toBe('plates');

    store.setViewMode('original');
    expect(useSculptureStore.getState().viewMode).toBe('original');

    store.toggleWireframe();
    expect(useSculptureStore.getState().wireframe).toBe(true);
    store.toggleWireframe();
    expect(useSculptureStore.getState().wireframe).toBe(false);

    store.setShowAllFloors(false);
    expect(useSculptureStore.getState().showAllFloors).toBe(false);

    // Floor navigation clamps to [0, plates - 1] and clears selectedDiscId
    useSculptureStore.setState({ selectedDiscId: 99 });
    store.setActiveFloor(999);
    expect(useSculptureStore.getState().activeFloor).toBe(
      useSculptureStore.getState().sliceResult!.plates.length - 1
    );
    expect(useSculptureStore.getState().selectedDiscId).toBeNull();

    store.setActiveFloor(0);
    store.stepFloor(1);
    expect(useSculptureStore.getState().activeFloor).toBe(1);
    store.stepFloor(-1);
    expect(useSculptureStore.getState().activeFloor).toBe(0);

    // Camera preset increments trigger counter
    const prevTrigger = useSculptureStore.getState().cameraPresetTrigger;
    store.setCameraPreset('top');
    expect(useSculptureStore.getState().cameraPreset).toBe('top');
    expect(useSculptureStore.getState().cameraPresetTrigger).toBe(prevTrigger + 1);

    // Sheet preview modal
    store.openSheetPreviewModal();
    expect(useSculptureStore.getState().isPreviewModalOpen).toBe(true);
    expect(useSculptureStore.getState().sheetLayouts?.length).toBeGreaterThan(0);

    store.closeSheetPreviewModal();
    expect(useSculptureStore.getState().isPreviewModalOpen).toBe(false);

    // Calibration sheet modal
    store.openCalibrationSheetPreview();
    expect(useSculptureStore.getState().isCalibrationSheetModalOpen).toBe(true);
    expect(useSculptureStore.getState().isPreviewModalOpen).toBe(true);
    expect(useSculptureStore.getState().sheetLayouts).toHaveLength(1);

    store.closeCalibrationSheetPreview();
    expect(useSculptureStore.getState().isCalibrationSheetModalOpen).toBe(false);
  });

  it('5. Project export/import and autosave session actions preserve state and runSlice count (projectSlice)', async () => {
    const buffer = loadFixtureArrayBuffer('test_l_block.obj');
    await useSculptureStore.getState().loadMeshArrayBuffer(buffer, 'test_l_block.obj', true);
    runSliceSpy.mockClear();

    const exportedJson = useSculptureStore.getState().exportProjectJsonString();
    const parsedSame = parseProjectJson(exportedJson);

    // Import compatible project -> does not require confirmation and does not re-slice
    const sameOutcome = await useSculptureStore.getState().importProjectFromParsed(parsedSame, false);
    expect(sameOutcome).toEqual({ needsConfirmation: false });
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    // Import incompatible project (different plates) without forceAdapt -> asks confirmation, 0 slices
    const parsedDiff = {
      ...parsedSame,
      params: { ...parsedSame.params, plates: parsedSame.params.plates + 2 },
    };
    const diffUnconfirmed = await useSculptureStore.getState().importProjectFromParsed(parsedDiff, false);
    expect(diffUnconfirmed).toEqual({ needsConfirmation: true });
    expect(runSliceSpy).toHaveBeenCalledTimes(0);

    // Import incompatible project with forceAdapt = true -> applies and runs 1 slice
    const diffConfirmed = await useSculptureStore.getState().importProjectFromParsed(parsedDiff, true);
    expect(diffConfirmed).toEqual({ needsConfirmation: false });
    expect(useSculptureStore.getState().params.plates).toBe(parsedDiff.params.plates);
    expect(runSliceSpy).toHaveBeenCalledTimes(1);

    // Discard autosave clears localStorage and pendingAutosave
    saveProjectToLocalStorage(
      useSculptureStore.getState().params,
      useSculptureStore.getState().discs,
      'test_l_block.obj',
      useSculptureStore.getState().build
    );
    useSculptureStore.setState({
      pendingAutosave: {
        snapshot: {
          params: useSculptureStore.getState().params,
          discs: [],
          meshFileName: 'test_l_block.obj',
          savedAt: Date.now(),
          build: useSculptureStore.getState().build,
        },
        meshRecord: null,
      },
    });
    await useSculptureStore.getState().discardAutosaveSession();
    expect(useSculptureStore.getState().pendingAutosave).toBeNull();
  });
});
