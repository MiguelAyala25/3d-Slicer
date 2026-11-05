import { AxisSliceCache, sliceMeshFromCache } from '../core/slicer';
import { getWaffleAxesConfig, sliceWaffleFromCaches } from '../core/waffle';
import { loadMeshFromBuffer } from '../core/meshLoader';
import type { Axis, WorkerRequest, WorkerResponse } from '../types/sculpture';

let currentMeshId = -1;
let rawPositions: Float32Array | null = null;
let axisCaches: Partial<Record<Axis, AxisSliceCache>> = {};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'LOAD_MESH') {
    const { jobId, meshId, buffer, fileName, upOrientation } = msg;
    try {
      const t0 = performance.now();
      const { geometry, metadata } = loadMeshFromBuffer(buffer, fileName, {
        upOrientation,
      });
      const posAttr = geometry.getAttribute('position');
      const positions = new Float32Array(posAttr.array);

      currentMeshId = meshId;
      rawPositions = positions;
      axisCaches = {};
      const durationMs = performance.now() - t0;

      // Crear una copia transferible para el hilo principal, manteniendo rawPositions intacto en el Worker
      const transferPositions = new Float32Array(positions);

      const resp: WorkerResponse = {
        type: 'LOAD_MESH_SUCCESS',
        jobId,
        meshId,
        positions: transferPositions,
        metadata,
        durationMs,
      };
      // Transfer Float32Array buffer to avoid cloning while preserving rawPositions
      self.postMessage(resp, [transferPositions.buffer]);
    } catch (err) {
      const resp: WorkerResponse = {
        type: 'LOAD_MESH_ERROR',
        jobId,
        meshId,
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(resp);
    }
    return;
  }

  if (msg.type === 'SET_MESH') {
    currentMeshId = msg.meshId;
    rawPositions = msg.positions;
    axisCaches = {};
    return;
  }

  if (msg.type === 'SLICE') {
    const { jobId, meshId, params } = msg;
    if (!rawPositions || meshId !== currentMeshId) {
      const errResp: WorkerResponse = {
        type: 'SLICE_ERROR',
        jobId,
        meshId,
        error: 'No hay una malla sincronizada en el worker para cortar.',
      };
      self.postMessage(errResp);
      return;
    }

    try {
      const t0 = performance.now();
      let cache = axisCaches[params.axis];
      if (!cache) {
        cache = new AxisSliceCache(rawPositions, params.axis);
        axisCaches[params.axis] = cache;
      }
      const result = sliceMeshFromCache(cache, params);
      const durationMs = performance.now() - t0;

      const resp: WorkerResponse = {
        type: 'SLICE_SUCCESS',
        jobId,
        meshId,
        result,
        durationMs,
      };
      self.postMessage(resp);
    } catch (err) {
      const resp: WorkerResponse = {
        type: 'SLICE_ERROR',
        jobId,
        meshId,
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(resp);
    }
    return;
  }

  if (msg.type === 'SLICE_WAFFLE') {
    const { jobId, meshId, coreParams, waffleParams } = msg;
    if (!rawPositions || meshId !== currentMeshId) {
      const errResp: WorkerResponse = {
        type: 'SLICE_ERROR',
        jobId,
        meshId,
        error: 'No hay una malla sincronizada en el worker para cortar.',
      };
      self.postMessage(errResp);
      return;
    }

    try {
      const t0 = performance.now();
      const cfg = getWaffleAxesConfig(waffleParams.upAxis);

      let cacheP1 = axisCaches[cfg.p1Axis];
      if (!cacheP1) {
        cacheP1 = new AxisSliceCache(rawPositions, cfg.p1Axis);
        axisCaches[cfg.p1Axis] = cacheP1;
      }

      let cacheP2 = axisCaches[cfg.p2Axis];
      if (!cacheP2) {
        cacheP2 = new AxisSliceCache(rawPositions, cfg.p2Axis);
        axisCaches[cfg.p2Axis] = cacheP2;
      }

      const result = sliceWaffleFromCaches(cacheP1, cacheP2, coreParams, waffleParams);
      const durationMs = performance.now() - t0;

      const resp: WorkerResponse = {
        type: 'SLICE_WAFFLE_SUCCESS',
        jobId,
        meshId,
        result,
        durationMs,
      };
      self.postMessage(resp);
    } catch (err) {
      const resp: WorkerResponse = {
        type: 'SLICE_ERROR',
        jobId,
        meshId,
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(resp);
    }
  }
};
