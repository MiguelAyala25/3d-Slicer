import * as THREE from 'three';

const MAX_GPU_TEX_DIM = 2048;

interface CacheEntry {
  url: string;
  tex: THREE.Texture;
}

interface PendingEntry {
  url: string;
  callbacks: Set<(tex: THREE.Texture) => void>;
  cancelled: boolean;
}

const textureCache = new Map<string, CacheEntry>();
const pendingLoads = new Map<string, PendingEntry>();

function buildGpuTextureFromImage(img: HTMLImageElement): THREE.Texture {
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const maxDim = Math.max(w, h);

  let source: HTMLImageElement | HTMLCanvasElement = img;
  if (maxDim > MAX_GPU_TEX_DIM && typeof document !== 'undefined') {
    const scale = MAX_GPU_TEX_DIM / maxDim;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      source = canvas;
    }
  }

  const tex = new THREE.Texture(source);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

export function getCachedDecalTexture(
  key: string,
  url: string
): THREE.Texture | null {
  const entry = textureCache.get(key);
  if (entry && entry.url === url) {
    return entry.tex;
  }
  return null;
}

/**
 * Obtiene o carga (deduplicando descodificación y subida a GPU) la textura compartida para un decal.
 * Devuelve una función de cancelación para liberar al callback si el consumidor se desmonta.
 */
export function acquireDecalTexture(
  key: string,
  url: string,
  onReady: (tex: THREE.Texture) => void
): () => void {
  const existing = textureCache.get(key);
  if (existing && existing.url === url) {
    onReady(existing.tex);
    return () => {};
  }

  if (existing && existing.url !== url) {
    existing.tex.dispose();
    textureCache.delete(key);
  }

  let pending = pendingLoads.get(key);
  if (pending && pending.url !== url) {
    pending.cancelled = true;
    pending.callbacks.clear();
    pendingLoads.delete(key);
    pending = undefined;
  }

  if (pending) {
    pending.callbacks.add(onReady);
    return () => {
      pending?.callbacks.delete(onReady);
    };
  }

  const newPending: PendingEntry = {
    url,
    callbacks: new Set([onReady]),
    cancelled: false,
  };
  pendingLoads.set(key, newPending);

  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (newPending.cancelled || pendingLoads.get(key) !== newPending) {
      return;
    }
    pendingLoads.delete(key);
    const tex = buildGpuTextureFromImage(img);
    const prev = textureCache.get(key);
    if (prev && prev.tex !== tex) {
      prev.tex.dispose();
    }
    textureCache.set(key, { url, tex });
    for (const cb of newPending.callbacks) {
      cb(tex);
    }
    newPending.callbacks.clear();
  };
  img.onerror = () => {
    if (pendingLoads.get(key) === newPending) {
      pendingLoads.delete(key);
    }
    newPending.callbacks.clear();
  };
  img.src = url;

  return () => {
    newPending.callbacks.delete(onReady);
  };
}
