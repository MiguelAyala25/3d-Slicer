import type * as THREE from 'three';
import { AxisSliceCache, sliceMeshFromCache } from '../core/slicer';
import { getWaffleAxesConfig, sliceWaffleFromCaches } from '../core/waffle';
import { parseRawMeshFromBuffer } from '../core/meshLoader';
import { diagnoseGeometry, normalizeAndValidateGeometry } from '../core/meshRepair';
import type {
  Axis,
  MeshRepairOptions,
  WorkerRequest,
  WorkerResponse,
} from '../types/sculpture';

export type PostMessageFn = (response: WorkerResponse, transfer?: Transferable[]) => void;

export class SlicerWorkerHost {
  private currentMeshId = -1;
  private rawPositions: Float32Array | null = null;
  private axisCaches: Partial<Record<Axis, AxisSliceCache>> = {};
  private pendingLoad: {
    meshId: number;
    rawGeometry: THREE.BufferGeometry;
    fileName: string;
    unitScaleApplied: number;
    loaderWarnings: string[];
  } | null = null;

  private pendingSliceMsg: Extract<WorkerRequest, { type: 'SLICE' | 'SLICE_WAFFLE' }> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private postMessageFn: PostMessageFn) {}

  public getMeshId(): number {
    return this.currentMeshId;
  }

  public getRawPositions(): Float32Array | null {
    return this.rawPositions;
  }

  private clearPendingLoad(): void {
    if (this.pendingLoad) {
      this.pendingLoad.rawGeometry.dispose();
      this.pendingLoad = null;
    }
  }

  public handleMessage(msg: WorkerRequest): void {
    if (msg.type === 'LOAD_MESH') {
      this.handleLoadMesh(msg);
      return;
    }

    if (msg.type === 'COMPLETE_LOAD_MESH') {
      this.handleCompleteLoadMesh(msg);
      return;
    }

    if (msg.type === 'CANCEL_PENDING_LOAD') {
      if (this.pendingLoad?.meshId === msg.meshId) {
        this.clearPendingLoad();
      }
      return;
    }

    if (msg.type === 'SET_MESH') {
      this.clearPendingLoad();
      this.cancelPendingSlice();
      this.currentMeshId = msg.meshId;
      this.rawPositions = msg.positions;
      this.axisCaches = {};
      return;
    }

    if (msg.type === 'SLICE' || msg.type === 'SLICE_WAFFLE') {
      // Coalescing: Si ya hay un slice pendiente antes de ejecutarse, descartar el anterior
      if (this.pendingSliceMsg) {
        this.postMessageFn({
          type: 'SLICE_SKIPPED',
          jobId: this.pendingSliceMsg.jobId,
          meshId: this.pendingSliceMsg.meshId,
        });
      }

      this.pendingSliceMsg = msg;

      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          this.executePendingSlice();
        }, 0);
      }
    }
  }

  public cancelPendingSlice(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingSliceMsg) {
      const dropped = this.pendingSliceMsg;
      this.pendingSliceMsg = null;
      this.postMessageFn({
        type: 'SLICE_SKIPPED',
        jobId: dropped.jobId,
        meshId: dropped.meshId,
      });
    }
  }

  public flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.executePendingSlice();
  }

  private executePendingSlice(): void {
    const msg = this.pendingSliceMsg;
    if (!msg) return;
    this.pendingSliceMsg = null;

    if (msg.type === 'SLICE') {
      this.handleSlice(msg);
    } else if (msg.type === 'SLICE_WAFFLE') {
      this.handleSliceWaffle(msg);
    }
  }

  private commitParsedMesh(
    jobId: number,
    meshId: number,
    rawGeometry: THREE.BufferGeometry,
    fileName: string,
    unitScaleApplied: number,
    loaderWarnings: string[],
    repairOptions: MeshRepairOptions,
    t0: number
  ): void {
    this.cancelPendingSlice();
    const { geometry, metadata } = normalizeAndValidateGeometry(
      rawGeometry,
      fileName,
      unitScaleApplied,
      loaderWarnings,
      repairOptions
    );
    rawGeometry.dispose();

    const posAttr = geometry.getAttribute('position');
    const positions = posAttr.array as Float32Array;

    this.currentMeshId = meshId;
    this.rawPositions = positions;
    this.axisCaches = {};
    const durationMs = performance.now() - t0;

    const transferPositions = new Float32Array(positions);

    const resp: WorkerResponse = {
      type: 'LOAD_MESH_SUCCESS',
      jobId,
      meshId,
      positions: transferPositions,
      metadata,
      durationMs,
    };
    this.postMessageFn(resp, [transferPositions.buffer]);
  }

  private handleLoadMesh(msg: Extract<WorkerRequest, { type: 'LOAD_MESH' }>): void {
    const {
      jobId,
      meshId,
      buffer,
      fileName,
      upOrientation,
      fillHoles,
      pruneFlaps,
      harmonizeWinding,
      checkBeforeRepair,
    } = msg;
    this.clearPendingLoad();
    let rawGeometry: THREE.BufferGeometry | null = null;
    try {
      const t0 = performance.now();
      const parsed = parseRawMeshFromBuffer(buffer, fileName, { upOrientation });
      rawGeometry = parsed.rawGeometry;

      if (checkBeforeRepair) {
        const diagnosis = diagnoseGeometry(rawGeometry, fileName);
        if (diagnosis.hasRepairableIssues) {
          this.pendingLoad = {
            meshId,
            rawGeometry,
            fileName,
            unitScaleApplied: parsed.unitScaleApplied,
            loaderWarnings: parsed.loaderWarnings,
          };
          rawGeometry = null;
          this.postMessageFn({
            type: 'LOAD_MESH_NEEDS_REPAIR',
            jobId,
            meshId,
            diagnosis,
          });
          return;
        }
      }

      const geomToCommit = rawGeometry;
      rawGeometry = null;
      this.commitParsedMesh(
        jobId,
        meshId,
        geomToCommit,
        fileName,
        parsed.unitScaleApplied,
        parsed.loaderWarnings,
        { fillHoles, pruneFlaps, harmonizeWinding },
        t0
      );
    } catch (err) {
      if (rawGeometry) rawGeometry.dispose();
      const resp: WorkerResponse = {
        type: 'LOAD_MESH_ERROR',
        jobId,
        meshId,
        error: err instanceof Error ? err.message : String(err),
      };
      this.postMessageFn(resp);
    }
  }

  private handleCompleteLoadMesh(
    msg: Extract<WorkerRequest, { type: 'COMPLETE_LOAD_MESH' }>
  ): void {
    const { jobId, meshId, repairOptions } = msg;
    const pending = this.pendingLoad;
    if (!pending || pending.meshId !== meshId) {
      this.postMessageFn({
        type: 'LOAD_MESH_ERROR',
        jobId,
        meshId,
        error: 'No hay una carga pendiente para completar la reparación.',
      });
      return;
    }

    this.pendingLoad = null;
    try {
      this.commitParsedMesh(
        jobId,
        meshId,
        pending.rawGeometry,
        pending.fileName,
        pending.unitScaleApplied,
        pending.loaderWarnings,
        repairOptions,
        performance.now()
      );
    } catch (err) {
      pending.rawGeometry.dispose();
      this.postMessageFn({
        type: 'LOAD_MESH_ERROR',
        jobId,
        meshId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handleSlice(msg: Extract<WorkerRequest, { type: 'SLICE' }>): void {
    const { jobId, meshId, params } = msg;
    if (!this.rawPositions || meshId !== this.currentMeshId) {
      const errResp: WorkerResponse = {
        type: 'SLICE_ERROR',
        jobId,
        meshId,
        error: 'No hay una malla sincronizada en el worker para cortar.',
      };
      this.postMessageFn(errResp);
      return;
    }

    try {
      const t0 = performance.now();
      let cache = this.axisCaches[params.axis];
      if (!cache) {
        cache = new AxisSliceCache(this.rawPositions, params.axis);
        this.axisCaches[params.axis] = cache;
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
      this.postMessageFn(resp);
    } catch (err) {
      const resp: WorkerResponse = {
        type: 'SLICE_ERROR',
        jobId,
        meshId,
        error: err instanceof Error ? err.message : String(err),
      };
      this.postMessageFn(resp);
    }
  }

  private handleSliceWaffle(msg: Extract<WorkerRequest, { type: 'SLICE_WAFFLE' }>): void {
    const { jobId, meshId, coreParams, waffleParams } = msg;
    if (!this.rawPositions || meshId !== this.currentMeshId) {
      const errResp: WorkerResponse = {
        type: 'SLICE_ERROR',
        jobId,
        meshId,
        error: 'No hay una malla sincronizada en el worker para cortar.',
      };
      this.postMessageFn(errResp);
      return;
    }

    try {
      const t0 = performance.now();
      const cfg = getWaffleAxesConfig(waffleParams.upAxis);

      let cacheP1 = this.axisCaches[cfg.p1Axis];
      if (!cacheP1) {
        cacheP1 = new AxisSliceCache(this.rawPositions, cfg.p1Axis);
        this.axisCaches[cfg.p1Axis] = cacheP1;
      }

      let cacheP2 = this.axisCaches[cfg.p2Axis];
      if (!cacheP2) {
        cacheP2 = new AxisSliceCache(this.rawPositions, cfg.p2Axis);
        this.axisCaches[cfg.p2Axis] = cacheP2;
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
      this.postMessageFn(resp);
    } catch (err) {
      const resp: WorkerResponse = {
        type: 'SLICE_ERROR',
        jobId,
        meshId,
        error: err instanceof Error ? err.message : String(err),
      };
      this.postMessageFn(resp);
    }
  }
}

// Inicializar host con el contexto del worker si estamos en WorkerGlobalScope
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const host = new SlicerWorkerHost((resp, transfer) => {
    if (transfer && transfer.length > 0) {
      self.postMessage(resp, transfer);
    } else {
      self.postMessage(resp);
    }
  });

  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    host.handleMessage(event.data);
  };
}
