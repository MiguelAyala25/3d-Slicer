// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useSculptureStore } from '../store/useSculptureStore';
import { isExportBlockedByDiscardedChains } from '../store/viewSlice';
import { getDiscardedChainsSummary } from '../core/slicer';
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

function buildBinaryStlBuffer(positions: Float32Array): ArrayBuffer {
  const triCount = Math.floor(positions.length / 9);
  const ab = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(ab);
  view.setUint32(80, triCount, true);
  for (let t = 0; t < triCount; t++) {
    const off = 84 + t * 50;
    for (let v = 0; v < 9; v++) {
      view.setFloat32(off + 12 + v * 4, positions[t * 9 + v], true);
    }
  }
  return ab;
}

function createOpenBottomBoxPositions(): Float32Array {
  const p = [
    [-10, -10, -10],
    [10, -10, -10],
    [10, 10, -10],
    [-10, 10, -10],
    [-10, -10, 10],
    [10, -10, 10],
    [10, 10, 10],
    [-10, 10, 10],
  ];
  // 5 faces (missing bottom -Z) -> 10 triangles
  const tris = [
    [4, 5, 6], [4, 6, 7], // Top (+Z)
    [0, 1, 5], [0, 5, 4], // Front (-Y)
    [2, 3, 7], [2, 7, 6], // Back (+Y)
    [0, 4, 7], [0, 7, 3], // Left (-X)
    [1, 2, 6], [1, 6, 5], // Right (+X)
  ];
  const arr = new Float32Array(tris.length * 9);
  tris.forEach((tri, t) => {
    tri.forEach((vi, k) => {
      arr[t * 9 + k * 3] = p[vi][0];
      arr[t * 9 + k * 3 + 1] = p[vi][1];
      arr[t * 9 + k * 3 + 2] = p[vi][2];
    });
  });
  return arr;
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
      pendingMeshRepair: null,
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

  it('6. Export confirmation with open chains discarded (DEC-2 / D2 / C9-1)', () => {
    // 1. Selector logic with discarded chains
    const cleanResult = {
      plates: [[{ exterior: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [], area: 100 }]],
      zPositions: [0],
      scaleFactor: 1.0,
      scaledBounds: [[[0, 0], [10, 10]]],
      scaledHeight: 10,
      warnings: [],
    } as unknown as import('../types/sculpture').SliceResult;
    expect(isExportBlockedByDiscardedChains('stacked', cleanResult, false)).toBe(false);
    expect(getDiscardedChainsSummary(cleanResult)).toEqual({ totalDiscarded: 0, affectedFloors: [] });

    const puncturedResult = {
      ...cleanResult,
      warnings: [
        { floorIndex: 0, openChainsDiscarded: 2, openChainsRepaired: 0, message: 'warning' },
        { floorIndex: 2, openChainsDiscarded: 1, openChainsRepaired: 1, message: 'warning' },
      ],
    };
    expect(getDiscardedChainsSummary(puncturedResult)).toEqual({
      totalDiscarded: 3,
      affectedFloors: [0, 2],
    });

    // Blocked if unconfirmed
    expect(isExportBlockedByDiscardedChains('stacked', puncturedResult, false)).toBe(true);
    // Unblocked if confirmed
    expect(isExportBlockedByDiscardedChains('stacked', puncturedResult, true)).toBe(false);
    // Non-stacked (e.g. waffle) is never blocked by this
    expect(isExportBlockedByDiscardedChains('waffle', puncturedResult, false)).toBe(false);

    // 2. Store actions and state transitions
    useSculptureStore.setState({
      sliceResult: puncturedResult,
      exportAnywayConfirmed: false,
    });
    expect(useSculptureStore.getState().exportAnywayConfirmed).toBe(false);

    // User confirms export anyway
    useSculptureStore.getState().confirmExportAnyway();
    expect(useSculptureStore.getState().exportAnywayConfirmed).toBe(true);

    // Closing modal resets confirmation
    useSculptureStore.getState().closeSheetPreviewModal();
    expect(useSculptureStore.getState().exportAnywayConfirmed).toBe(false);
    expect(useSculptureStore.getState().isPreviewModalOpen).toBe(false);

    // Re-opening modal keeps confirmation false until re-confirmed
    useSculptureStore.getState().openSheetPreviewModal();
    expect(useSculptureStore.getState().exportAnywayConfirmed).toBe(false);
  });

  it('7. On-load mesh health check prompts for repair on defective mesh and supports repair, skip, and cancel', async () => {
    // 1. Clean mesh loads immediately without prompting
    const cleanBuf = loadFixtureArrayBuffer('test_l_block.obj');
    await useSculptureStore.getState().loadMeshArrayBuffer(cleanBuf, 'test_l_block.obj', true);
    expect(useSculptureStore.getState().pendingMeshRepair).toBeNull();
    expect(useSculptureStore.getState().meshFileName).toBe('test_l_block.obj');

    // 2. Defective open-bottom mesh pauses with pendingMeshRepair while keeping previous mesh intact
    const openBoxStlBuf = buildBinaryStlBuffer(createOpenBottomBoxPositions());
    await useSculptureStore.getState().loadMeshArrayBuffer(openBoxStlBuf, 'open_scan.stl', true);

    const pending = useSculptureStore.getState().pendingMeshRepair;
    expect(pending).not.toBeNull();
    expect(pending!.diagnosis.hasRepairableIssues).toBe(true);
    expect(pending!.diagnosis.openHoleLoopCount).toBe(1);
    expect(pending!.diagnosis.estimatedCapTriangles).toBe(2);
    expect(useSculptureStore.getState().meshFileName).toBe('test_l_block.obj');

    // 3. Canceling keeps previous clean mesh untouched
    useSculptureStore.getState().cancelPendingMeshRepair();
    expect(useSculptureStore.getState().pendingMeshRepair).toBeNull();
    expect(useSculptureStore.getState().meshFileName).toBe('test_l_block.obj');

    // 4. Repairing and loading caps the hole cleanly with 0 empty plates
    await useSculptureStore.getState().loadMeshArrayBuffer(openBoxStlBuf, 'open_scan.stl', true);
    await useSculptureStore.getState().resolvePendingMeshRepair({
      fillHoles: true,
      pruneFlaps: true,
      harmonizeWinding: true,
    });
    expect(useSculptureStore.getState().pendingMeshRepair).toBeNull();
    expect(useSculptureStore.getState().meshFileName).toBe('open_scan.stl');
    expect(useSculptureStore.getState().meshMetadata?.isWatertight).toBe(true);
    expect(useSculptureStore.getState().meshMetadata?.filledHoleCount).toBe(1);
    const sliceRes = useSculptureStore.getState().sliceResult;
    expect(sliceRes).not.toBeNull();
    expect(sliceRes!.plates.every((p) => p.length > 0)).toBe(true);

    // 5. Loading without repair leaves raw defects intact
    await useSculptureStore.getState().loadMeshArrayBuffer(openBoxStlBuf, 'open_scan_raw.stl', true);
    await useSculptureStore.getState().resolvePendingMeshRepair({
      fillHoles: false,
      pruneFlaps: false,
      harmonizeWinding: false,
    });
    expect(useSculptureStore.getState().meshFileName).toBe('open_scan_raw.stl');
    expect(useSculptureStore.getState().meshMetadata?.isWatertight).toBe(false);
    expect(useSculptureStore.getState().meshMetadata?.openEdgeCount).toBeGreaterThan(0);
    expect(useSculptureStore.getState().meshMetadata?.filledHoleCount).toBe(0);
  });
});
