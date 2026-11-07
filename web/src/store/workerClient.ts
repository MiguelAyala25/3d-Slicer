import * as THREE from 'three';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { sliceMesh } from '../core/slicer';
import { sliceWaffleMesh } from '../core/waffle/waffleSlicer';
import type { WaffleParams, WaffleSliceResult } from '../core/waffle/types';
import type {
  MeshMetadata,
  SculptureParams,
  SliceResult,
  WorkerRequest,
  WorkerResponse,
} from '../types/sculpture';

export const AUTO_SLICE_DEBOUNCE_MS = 350;

let workerInstance: Worker | null = null;
let currentMeshId = 0;
let latestJobId = 0;

let autoSliceTimer: ReturnType<typeof setTimeout> | null = null;
let isWorkerExecuting = false;
let pendingWorkerJob: {
  jobId: number;
  meshId: number;
  isWaffle: boolean;
  paramsSnapshot: SculptureParams;
  waffleParamsSnapshot: WaffleParams;
  callbacks: SliceJobCallbacks;
  resolve: () => void;
} | null = null;

export interface SliceJobCallbacks {
  onSliceSuccess: (result: SliceResult, durationMs: number) => void;
  onWaffleSuccess: (result: WaffleSliceResult, durationMs: number) => void;
  onSkipped: () => void;
  onWorkerError: (errorMsg: string) => void;
  onSyncError: (errorMsg: string) => void;
}

export function clearAutoSliceTimer(): void {
  if (autoSliceTimer) {
    clearTimeout(autoSliceTimer);
    autoSliceTimer = null;
  }
}

export function scheduleAutoSlice(action: () => void, delayMs = AUTO_SLICE_DEBOUNCE_MS): void {
  clearAutoSliceTimer();
  if (
    typeof window === 'undefined' ||
    delayMs <= 0 ||
    (typeof process !== 'undefined' &&
      (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true'))
  ) {
    action();
    return;
  }
  autoSliceTimer = setTimeout(() => {
    autoSliceTimer = null;
    action();
  }, delayMs);
}

export function getOrCreateWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null;
  }
  if (!workerInstance) {
    try {
      workerInstance = new Worker(
        new URL('../worker/slicer.worker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch {
      workerInstance = null;
    }
  }
  return workerInstance;
}

if (typeof window !== 'undefined') {
  getOrCreateWorker();
}

export async function loadMeshWithWorkerOrFallback(
  buffer: ArrayBuffer,
  fileName: string,
  upOrientation: 'y-up' | undefined
): Promise<{ geometry: THREE.BufferGeometry; metadata: MeshMetadata }> {
  currentMeshId += 1;
  const meshId = currentMeshId;
  const worker = getOrCreateWorker();

  if (worker) {
    latestJobId += 1;
    const jobId = latestJobId;
    const outcome = await new Promise<{ positions: Float32Array; metadata: MeshMetadata }>(
      (resolve, reject) => {
        const onMsg = (evt: MessageEvent<WorkerResponse>) => {
          const msg = evt.data;
          if (msg.jobId !== jobId) return;
          worker.removeEventListener('message', onMsg);
          worker.removeEventListener('error', onErr);
          if (msg.type === 'LOAD_MESH_SUCCESS') {
            resolve({ positions: msg.positions, metadata: msg.metadata });
          } else if (msg.type === 'LOAD_MESH_ERROR') {
            reject(new Error(msg.error));
          }
        };
        const onErr = (e: ErrorEvent) => {
          worker.removeEventListener('message', onMsg);
          worker.removeEventListener('error', onErr);
          reject(new Error(e.message || 'Error en el worker de carga'));
        };
        worker.addEventListener('message', onMsg);
        worker.addEventListener('error', onErr);

        const req: WorkerRequest = {
          type: 'LOAD_MESH',
          jobId,
          meshId,
          buffer,
          fileName,
          upOrientation,
        };
        worker.postMessage(req);
      }
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(outcome.positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    return { geometry, metadata: outcome.metadata };
  }

  // Fallback síncrono para tests en Vitest / Node
  return loadMeshFromBuffer(buffer, fileName, { upOrientation });
}

export async function runSliceJob(opts: {
  isWaffle: boolean;
  geometry: THREE.BufferGeometry;
  paramsSnapshot: SculptureParams;
  waffleParamsSnapshot: WaffleParams;
  callbacks: SliceJobCallbacks;
}): Promise<void> {
  const { isWaffle, geometry, paramsSnapshot, waffleParamsSnapshot, callbacks } = opts;

  latestJobId += 1;
  const jobId = latestJobId;
  const meshId = currentMeshId;

  const worker = getOrCreateWorker();
  if (worker) {
    await new Promise<void>((resolve) => {
      const executeJob = (
        targetJobId: number,
        targetMeshId: number,
        isWaffleJob: boolean,
        targetParams: SculptureParams,
        targetWaffleParams: WaffleParams,
        targetCallbacks: SliceJobCallbacks,
        onJobDone: () => void
      ) => {
        isWorkerExecuting = true;

        const advanceQueue = () => {
          if (pendingWorkerJob) {
            const next = pendingWorkerJob;
            pendingWorkerJob = null;
            executeJob(
              next.jobId,
              next.meshId,
              next.isWaffle,
              next.paramsSnapshot,
              next.waffleParamsSnapshot,
              next.callbacks,
              next.resolve
            );
          } else {
            isWorkerExecuting = false;
          }
        };

        const onMessage = (evt: MessageEvent<WorkerResponse>) => {
          const msg = evt.data;
          if (msg.jobId !== targetJobId) return;
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);

          if (targetJobId === latestJobId) {
            if (msg.type === 'SLICE_SUCCESS') {
              targetCallbacks.onSliceSuccess(msg.result, msg.durationMs);
            } else if (msg.type === 'SLICE_WAFFLE_SUCCESS') {
              targetCallbacks.onWaffleSuccess(msg.result, msg.durationMs);
            } else if (msg.type === 'SLICE_SKIPPED') {
              targetCallbacks.onSkipped();
            } else if (msg.type === 'SLICE_ERROR') {
              targetCallbacks.onWorkerError(msg.error);
            }
          }

          onJobDone();
          advanceQueue();
        };

        const onError = (err: ErrorEvent) => {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          if (targetJobId === latestJobId) {
            targetCallbacks.onWorkerError(err.message || 'Error en el worker de corte');
          }
          onJobDone();
          advanceQueue();
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);

        if (isWaffleJob) {
          const req: WorkerRequest = {
            type: 'SLICE_WAFFLE',
            jobId: targetJobId,
            meshId: targetMeshId,
            coreParams: targetParams,
            waffleParams: targetWaffleParams,
          };
          worker.postMessage(req);
        } else {
          const req: WorkerRequest = {
            type: 'SLICE',
            jobId: targetJobId,
            meshId: targetMeshId,
            params: targetParams,
          };
          worker.postMessage(req);
        }
      };

      if (isWorkerExecuting) {
        if (pendingWorkerJob) {
          pendingWorkerJob.resolve();
        }
        pendingWorkerJob = {
          jobId,
          meshId,
          isWaffle,
          paramsSnapshot,
          waffleParamsSnapshot,
          callbacks,
          resolve,
        };
      } else {
        executeJob(
          jobId,
          meshId,
          isWaffle,
          paramsSnapshot,
          waffleParamsSnapshot,
          callbacks,
          resolve
        );
      }
    });
    return;
  }

  // Fallback síncrono (entorno de pruebas Vitest / jsdom)
  try {
    const t0 = performance.now();
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;
    if (isWaffle) {
      const result = sliceWaffleMesh(posArray, paramsSnapshot, waffleParamsSnapshot);
      callbacks.onWaffleSuccess(result, performance.now() - t0);
    } else {
      const result = sliceMesh(posArray, paramsSnapshot);
      callbacks.onSliceSuccess(result, performance.now() - t0);
    }
  } catch (err) {
    callbacks.onSyncError(err instanceof Error ? err.message : String(err));
  }
}
