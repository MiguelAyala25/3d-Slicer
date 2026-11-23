import type { StateCreator } from 'zustand';
import {
  blobToDataUrl,
  computeImageKey,
  dataUrlToBlob,
  loadImageBlobFromIndexedDB,
  saveImageBlobToIndexedDB,
} from '../core/autosave';
import { buildPrintCalibrationPackage } from '../core/printCalibration';
import { finalSize } from '../core/sizing';
import type {
  ImageDecal,
  PrintExportConfig,
  PrintTilingConfig,
  SerializedImageDecal,
} from '../types/sculpture';
import { persistAutosaveIfLoaded } from './projectSlice';
import type { SculptureStore } from './useSculptureStore';

export const DEFAULT_PRINT_TILING: PrintTilingConfig = {
  enabled: false,
  preset: 'letter',
  customW: 215.9,
  customH: 279.4,
  orientation: 'auto',
  overlapMm: 10.0,
  printerMarginMm: 3.0,
};

export const DEFAULT_PRINT_CONFIG: PrintExportConfig = {
  enabled: true,
  technique: 'uv',
  format: 'svg',
  dpi: 300,
  bleedMm: 1.0,
  includeRegistrationMarks: true,
  mirrorPrint: false,
  plateLabelMode: 'print',
  tiling: { ...DEFAULT_PRINT_TILING },
};

export interface DecalState {
  decals: ImageDecal[];
  selectedDecalId: string | null;
  decalObjectUrls: Record<string, string>;
  printConfig: PrintExportConfig;
  isPrintCalibrationPreview: boolean;
}

export interface DecalActions {
  addDecalFromFile: (file: File) => Promise<void>;
  updateDecal: (id: string, patch: Partial<ImageDecal>) => void;
  removeDecal: (id: string) => void;
  reorderDecal: (id: string, direction: 'up' | 'down') => void;
  selectDecal: (id: string | null) => void;
  clearDecals: () => void;
  setPrintConfig: (patch: Partial<PrintExportConfig>) => void;
  setPrintTilingConfig: (patch: Partial<PrintTilingConfig>) => void;
  openPrintCalibrationPreview: () => void;
  restoreDecalAssets: (decals: readonly SerializedImageDecal[]) => Promise<{ missingCount: number }>;
}

export type DecalSlice = DecalState & DecalActions;

let decalAutosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDecalAutosave(getState: () => SculptureStore): void {
  if (decalAutosaveTimer !== null) {
    clearTimeout(decalAutosaveTimer);
  }
  decalAutosaveTimer = setTimeout(() => {
    decalAutosaveTimer = null;
    persistAutosaveIfLoaded(getState());
  }, 250);
}

function flushDecalAutosave(getState: () => SculptureStore): void {
  if (decalAutosaveTimer !== null) {
    clearTimeout(decalAutosaveTimer);
    decalAutosaveTimer = null;
  }
  persistAutosaveIfLoaded(getState());
}

async function createPreviewImageUrl(blob: Blob): Promise<string> {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(blob);
  }
  return blobToDataUrl(blob);
}

async function decodeImageDimensions(url: string): Promise<{ pxW: number; pxH: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const pxW = img.naturalWidth || img.width || 1;
      const pxH = img.naturalHeight || img.height || 1;
      resolve({ pxW, pxH });
    };
    img.onerror = () => reject(new Error('No se pudo leer las dimensiones de la imagen'));
    img.src = url;
  });
}

async function decodeBlobDimensions(
  blob: Blob,
  fallbackUrl: string
): Promise<{ pxW: number; pxH: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      try {
        return {
          pxW: bmp.width || 1,
          pxH: bmp.height || 1,
        };
      } finally {
        bmp.close();
      }
    } catch {
      // Fallback a <img> si createImageBitmap falla con algún formato
    }
  }
  return decodeImageDimensions(fallbackUrl);
}

function makeDecalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `dec_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const createDecalSlice: StateCreator<
  SculptureStore,
  [],
  [],
  DecalSlice
> = (set, get) => ({
  decals: [],
  selectedDecalId: null,
  decalObjectUrls: {},
  printConfig: { ...DEFAULT_PRINT_CONFIG, tiling: { ...DEFAULT_PRINT_TILING } },
  isPrintCalibrationPreview: false,

  addDecalFromFile: async (file) => {
    const state = get();
    if (!state.modelExtents) {
      set({
        statusMessage: 'Carga un modelo 3D antes de agregar imágenes',
      });
      return;
    }

    const buffer = await file.arrayBuffer();
    const imageKey = await computeImageKey(buffer);
    const mimeType = file.type || 'image/png';
    const blob = new Blob([buffer], { type: mimeType });

    let previewUrl = state.decalObjectUrls[imageKey];
    if (!previewUrl) {
      previewUrl = await createPreviewImageUrl(blob);
    }

    const { pxW, pxH } = await decodeBlobDimensions(blob, previewUrl);

    void saveImageBlobToIndexedDB({
      key: imageKey,
      name: file.name,
      mimeType,
      blob,
      pxW,
      pxH,
      savedAt: Date.now(),
    }).catch(() => {});

    let centerX = 0;
    let centerZ = 0;
    let modelSpanX = 80;

    if (state.sliceResult && state.lastSliceAxis === 'y') {
      const [[minX, minYs], [maxX, maxYs]] = state.sliceResult.scaledBounds;
      centerX = Number(((minX + maxX) * 0.5).toFixed(2));
      centerZ = Number(((-(minYs + maxYs)) * 0.5).toFixed(2));
      modelSpanX = Math.max(20, maxX - minX);
    } else if (state.modelExtents) {
      const sz = finalSize(
        state.modelExtents,
        state.params.axis,
        state.params.plates,
        state.params.thickness,
        state.params.gap
      );
      modelSpanX = Math.max(20, sz.ancho);
    }

    const widthMm = Number(Math.max(10, modelSpanX * 0.5).toFixed(2));
    const heightMm = Number((widthMm * (pxH / pxW)).toFixed(2));
    const maxOrder = state.decals.reduce((m, d) => Math.max(m, d.order), 0);

    const newDecal: ImageDecal = {
      id: makeDecalId(),
      name: file.name,
      imageKey,
      pxW,
      pxH,
      centerX,
      centerZ,
      widthMm,
      heightMm,
      rotationDeg: 0,
      mode: 'surface',
      order: maxOrder + 1,
      visible: true,
    };

    set((s) => ({
      decals: [...s.decals, newDecal],
      selectedDecalId: newDecal.id,
      decalObjectUrls: { ...s.decalObjectUrls, [imageKey]: previewUrl },
      cameraPreset: 'front',
      cameraPresetTrigger: s.cameraPresetTrigger + 1,
      ...(s.sliceResult ? { viewMode: 'plates' } : {}),
      statusMessage:
        s.params.axis !== 'y'
          ? `Imagen '${file.name}' agregada. Cambia el eje de corte a Y para proyectarla.`
          : `Imagen '${file.name}' colocada en vista frontal`,
    }));

    flushDecalAutosave(get);
  },

  updateDecal: (id, patch) => {
    set((s) => ({
      decals: s.decals.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
    scheduleDecalAutosave(get);
  },

  removeDecal: (id) => {
    set((s) => {
      const remaining = s.decals.filter((d) => d.id !== id);
      const nextSelected =
        s.selectedDecalId === id
          ? remaining[remaining.length - 1]?.id ?? null
          : s.selectedDecalId;
      return {
        decals: remaining,
        selectedDecalId: nextSelected,
      };
    });
    flushDecalAutosave(get);
  },

  reorderDecal: (id, direction) => {
    set((s) => {
      const ordered = [...s.decals].sort((a, b) => a.order - b.order);
      const idx = ordered.findIndex((d) => d.id === id);
      if (idx === -1) return {};
      const targetIdx = direction === 'up' ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= ordered.length) return {};
      const tmp = ordered[idx];
      ordered[idx] = ordered[targetIdx];
      ordered[targetIdx] = tmp;
      const reindexed = ordered.map((d, i) => ({ ...d, order: i + 1 }));
      return { decals: reindexed };
    });
    flushDecalAutosave(get);
  },

  selectDecal: (id) => set({ selectedDecalId: id }),

  clearDecals: () => {
    set({ decals: [], selectedDecalId: null });
    flushDecalAutosave(get);
  },

  setPrintConfig: (patch) =>
    set((s) => ({
      printConfig: { ...s.printConfig, ...patch },
    })),

  setPrintTilingConfig: (patch) =>
    set((s) => ({
      printConfig: {
        ...s.printConfig,
        tiling: { ...s.printConfig.tiling, ...patch },
      },
    })),

  openPrintCalibrationPreview: () => {
    const state = get();
    const pkg = buildPrintCalibrationPackage(state.params, {
      bleedMm: state.printConfig.bleedMm,
      mirrorPrint: state.printConfig.mirrorPrint,
      includeRegistrationMarks: state.printConfig.includeRegistrationMarks,
      includePrintedLabels: state.printConfig.plateLabelMode === 'print',
    });
    set((s) => ({
      sheetLayouts: pkg.sheets,
      isPrintCalibrationPreview: true,
      isPreviewModalOpen: true,
      exportAnywayConfirmed: false,
      decalObjectUrls: {
        ...s.decalObjectUrls,
        [pkg.decal.imageKey]: pkg.imageDataUrl,
      },
      errorMessage: null,
    }));
  },

  restoreDecalAssets: async (decals) => {
    let missingCount = 0;
    const nextUrls: Record<string, string> = { ...get().decalObjectUrls };

    for (const d of decals) {
      if (nextUrls[d.imageKey]) continue;

      if (d.embeddedDataUrl) {
        try {
          const blob = await dataUrlToBlob(d.embeddedDataUrl);
          nextUrls[d.imageKey] = await createPreviewImageUrl(blob);
          void saveImageBlobToIndexedDB({
            key: d.imageKey,
            name: d.name,
            mimeType: blob.type || 'image/png',
            blob,
            pxW: d.pxW,
            pxH: d.pxH,
            savedAt: Date.now(),
          }).catch(() => {});
        } catch {
          // Data URL usable en memoria incluso si fetch/IndexedDB falla
          nextUrls[d.imageKey] = d.embeddedDataUrl;
        }
        continue;
      }

      const stored = await loadImageBlobFromIndexedDB(d.imageKey);
      if (stored) {
        nextUrls[d.imageKey] = await createPreviewImageUrl(stored.blob);
      } else {
        missingCount++;
      }
    }

    set({ decalObjectUrls: nextUrls });
    return { missingCount };
  },
});
