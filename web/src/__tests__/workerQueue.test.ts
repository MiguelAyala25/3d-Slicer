import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlicerWorkerHost } from '../worker/slicer.worker';
import type { WorkerResponse } from '../types/sculpture';
import { DEFAULT_PARAMS } from '../core/params';
import type { WaffleParams } from '../core/waffle/types';
import { INITIAL_WAFFLE_STATE } from '../store/waffleSlice';

describe('SlicerWorkerHost Coalescing & Message Ordering (O5 / C5-2)', () => {
  let responses: WorkerResponse[] = [];
  let host: SlicerWorkerHost;

  beforeEach(() => {
    vi.useFakeTimers();
    responses = [];
    host = new SlicerWorkerHost((resp) => {
      responses.push(resp);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Malla sintética mínima válida (tetraedro de 4 triángulos)
  const syntheticPositions = new Float32Array([
    // Cara 1
    0, 0, 0,
    10, 0, 0,
    5, 10, 0,
    // Cara 2
    0, 0, 0,
    5, 5, 10,
    10, 0, 0,
    // Cara 3
    10, 0, 0,
    5, 5, 10,
    5, 10, 0,
    // Cara 4
    5, 10, 0,
    5, 5, 10,
    0, 0, 0,
  ]);

  it('coalesces 5 consecutive SLICE requests: skips first 4 and executes only the last one', async () => {
    // Sincronizar malla inicial
    host.handleMessage({
      type: 'SET_MESH',
      meshId: 1,
      positions: syntheticPositions,
    });
    expect(host.getMeshId()).toBe(1);

    // Enviar 5 mensajes SLICE consecutivos
    for (let jobId = 1; jobId <= 5; jobId++) {
      host.handleMessage({
        type: 'SLICE',
        jobId,
        meshId: 1,
        params: { ...DEFAULT_PARAMS, axis: 'z', plates: 10 + jobId },
      });
    }

    // Los jobs 1..4 fueron desplazados antes de que corriera el timer
    const skipped = responses.filter((r) => r.type === 'SLICE_SKIPPED');
    expect(skipped.length).toBe(4);
    expect(skipped.map((s) => s.jobId)).toEqual([1, 2, 3, 4]);

    // Avanzar el timer para ejecutar el último job pendiente (jobId = 5)
    await vi.runAllTimersAsync();

    const success = responses.filter((r) => r.type === 'SLICE_SUCCESS');
    expect(success.length).toBe(1);
    expect(success[0].jobId).toBe(5);
  });

  it('coalesces 5 consecutive SLICE_WAFFLE requests similarly', async () => {
    host.handleMessage({
      type: 'SET_MESH',
      meshId: 1,
      positions: syntheticPositions,
    });

    const waffleParams: WaffleParams = {
      ...INITIAL_WAFFLE_STATE.waffleParams,
      upAxis: 'z',
    };

    for (let jobId = 1; jobId <= 5; jobId++) {
      host.handleMessage({
        type: 'SLICE_WAFFLE',
        jobId,
        meshId: 1,
        coreParams: { ...DEFAULT_PARAMS, axis: 'z', plates: 10 + jobId },
        waffleParams,
      });
    }

    expect(responses.filter((r) => r.type === 'SLICE_SKIPPED').map((s) => s.jobId)).toEqual([1, 2, 3, 4]);

    await vi.runAllTimersAsync();

    const success = responses.filter((r) => r.type === 'SLICE_WAFFLE_SUCCESS');
    expect(success.length).toBe(1);
    expect(success[0].jobId).toBe(5);
  });

  it('preserves order of LOAD_MESH and SET_MESH and cancels obsolete pending slice', async () => {
    host.handleMessage({
      type: 'SET_MESH',
      meshId: 1,
      positions: syntheticPositions,
    });

    // Enviar un SLICE para meshId 1
    host.handleMessage({
      type: 'SLICE',
      jobId: 10,
      meshId: 1,
      params: { ...DEFAULT_PARAMS, axis: 'z', plates: 10 },
    });

    // Inmediatamente llega SET_MESH con meshId 2
    host.handleMessage({
      type: 'SET_MESH',
      meshId: 2,
      positions: syntheticPositions,
    });

    // El slice anterior para meshId 1 debe haberse cancelado limpiamente
    const skipped = responses.find((r) => r.jobId === 10);
    expect(skipped).toBeDefined();
    expect(skipped?.type).toBe('SLICE_SKIPPED');
    expect(host.getMeshId()).toBe(2);

    await vi.runAllTimersAsync();
    expect(responses.filter((r) => r.type === 'SLICE_SUCCESS')).toHaveLength(0);
  });

  it('returns SLICE_ERROR when meshId is obsolete or mismatched', async () => {
    host.handleMessage({
      type: 'SET_MESH',
      meshId: 5,
      positions: syntheticPositions,
    });

    // Enviar SLICE con meshId incorrecto (p. ej. 3 != 5)
    host.handleMessage({
      type: 'SLICE',
      jobId: 20,
      meshId: 3,
      params: { ...DEFAULT_PARAMS, axis: 'z', plates: 10 },
    });

    await vi.runAllTimersAsync();

    const errorResp = responses.find((r) => r.jobId === 20);
    expect(errorResp).toBeDefined();
    expect(errorResp?.type).toBe('SLICE_ERROR');
  });

  it('guarantees isSlicing turns false and result corresponds to latest job in a burst (C5-4)', async () => {
    // Simular el comportamiento del store con un fake worker respaldado por SlicerWorkerHost
    let isSlicing = false;
    let latestJobId = 0;
    let activeResultPlates = 0;

    const fakeWorkerHost = new SlicerWorkerHost((resp) => {
      if (resp.type === 'SLICE_SUCCESS') {
        if (resp.jobId === latestJobId) {
          isSlicing = false;
          activeResultPlates = resp.result.plates.length;
        }
      } else if (resp.type === 'SLICE_SKIPPED') {
        if (resp.jobId === latestJobId) {
          isSlicing = false;
        }
      } else if (resp.type === 'SLICE_ERROR') {
        if (resp.jobId === latestJobId) {
          isSlicing = false;
        }
      }
    });

    fakeWorkerHost.handleMessage({
      type: 'SET_MESH',
      meshId: 1,
      positions: syntheticPositions,
    });

    // Ráfaga de 5 llamadas a slice
    for (let plates = 10; plates <= 14; plates++) {
      latestJobId++;
      isSlicing = true;
      fakeWorkerHost.handleMessage({
        type: 'SLICE',
        jobId: latestJobId,
        meshId: 1,
        params: { ...DEFAULT_PARAMS, axis: 'z', plates },
      });
    }

    expect(isSlicing).toBe(true);

    // Drenar timers de la ráfaga
    await vi.runAllTimersAsync();

    // isSlicing debe haber retornado a false sin spinner colgado y con el resultado del último job (plates = 14)
    expect(isSlicing).toBe(false);
    expect(activeResultPlates).toBe(14);
  });
});
