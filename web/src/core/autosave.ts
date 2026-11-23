import { serializeProject, parseProjectJson } from './project';
import { DEFAULT_PARAMS } from './params';
import { validateParams } from './validator';
import { DEFAULT_BUILD, type BuildConfig } from './build/types';
import type { Disc, ImageDecal, SculptureParams } from '../types/sculpture';
import type { WaffleParams } from './waffle/types';

export const LOCAL_STORAGE_KEY = 'sculpture_web_autosave_v1';
const IDB_NAME = 'sculpture_web_db';
const IDB_VERSION = 2;
const IDB_STORE = 'mesh_blobs';
const IDB_KEY = 'active_mesh';
const IDB_IMAGE_STORE = 'image_blobs';

export interface StoredMeshRecord {
  fileName: string;
  buffer: ArrayBuffer;
  savedAt: number;
}

export interface StoredImageRecord {
  key: string;
  name: string;
  mimeType: string;
  blob: Blob;
  pxW: number;
  pxH: number;
  savedAt: number;
}

export interface AutosaveSessionSnapshot {
  params: SculptureParams;
  discs: Disc[];
  meshFileName: string | null;
  savedAt: number;
  build: BuildConfig;
  waffleParams?: WaffleParams;
  decals?: ImageDecal[];
}

interface RawAutosaveEnvelope {
  projectJson: string;
  fullParams: SculptureParams;
  meshFileName: string | null;
  savedAt: number;
  build?: BuildConfig;
  waffleParams?: WaffleParams;
  decals?: ImageDecal[];
}

export function saveProjectToLocalStorage(
  params: SculptureParams,
  discs: Disc[],
  meshFileName: string | null,
  build: BuildConfig = DEFAULT_BUILD,
  waffleParams?: WaffleParams,
  decals?: ImageDecal[]
): void {
  try {
    const cleanDecals = decals && decals.length > 0 ? decals : undefined;
    const envelope: RawAutosaveEnvelope = {
      projectJson: serializeProject(params, build, discs, waffleParams, cleanDecals),
      fullParams: { ...params },
      meshFileName,
      savedAt: Date.now(),
      build,
      waffleParams,
      ...(cleanDecals ? { decals: cleanDecals } : {}),
    };
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Ignorar errores de cuota en modo privado
  }
}

export function loadProjectFromLocalStorage(): AutosaveSessionSnapshot | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RawAutosaveEnvelope>;
    if (!parsed || typeof parsed.projectJson !== 'string') return null;
    const baseParams: SculptureParams = {
      ...DEFAULT_PARAMS,
      ...(parsed.fullParams ?? {}),
    };
    validateParams(baseParams);
    const project = parseProjectJson(parsed.projectJson, baseParams);
    const build = parsed.build ?? project.build;
    const decals = project.decals ?? parsed.decals;
    return {
      params: project.params,
      discs: project.discs,
      meshFileName: typeof parsed.meshFileName === 'string' ? parsed.meshFileName : null,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
      build,
      waffleParams: project.waffleParams ?? parsed.waffleParams,
      ...(decals && decals.length > 0 ? { decals } : {}),
    };
  } catch {
    return null;
  }
}

function openMeshDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
      if (!db.objectStoreNames.contains(IDB_IMAGE_STORE)) {
        db.createObjectStore(IDB_IMAGE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAutosaveStorage(): Promise<void> {
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // noop
  }
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return;
    const db = await openMeshDatabase();
    const stores = [IDB_STORE];
    if (db.objectStoreNames.contains(IDB_IMAGE_STORE)) {
      stores.push(IDB_IMAGE_STORE);
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      if (db.objectStoreNames.contains(IDB_IMAGE_STORE)) {
        tx.objectStore(IDB_IMAGE_STORE).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // noop
  }
}

export async function saveMeshBufferToIndexedDB(
  fileName: string,
  buffer: ArrayBuffer
): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return;
    const db = await openMeshDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const record: StoredMeshRecord = {
        fileName,
        buffer,
        savedAt: Date.now(),
      };
      store.put(record, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // noop
  }
}

export async function loadMeshBufferFromIndexedDB(): Promise<StoredMeshRecord | null> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    const db = await openMeshDatabase();
    return await new Promise<StoredMeshRecord | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function computeImageKey(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
      const bytes = new Uint8Array(hashBuf);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback en contextos no seguros
    }
  }
  const view = new Uint8Array(buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    h1 = Math.imul(h1 ^ view[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (view[i] + i), 0x01000193) >>> 0;
  }
  return `fnv_${h1.toString(16).padStart(8, '0')}_${h2.toString(16).padStart(8, '0')}_${view.length}`;
}

export async function saveImageBlobToIndexedDB(record: StoredImageRecord): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return;
    const db = await openMeshDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_IMAGE_STORE, 'readwrite');
      tx.objectStore(IDB_IMAGE_STORE).put(record, record.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // noop
  }
}

export async function loadImageBlobFromIndexedDB(
  key: string
): Promise<StoredImageRecord | null> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    const db = await openMeshDatabase();
    if (!db.objectStoreNames.contains(IDB_IMAGE_STORE)) return null;
    return await new Promise<StoredImageRecord | null>((resolve) => {
      const tx = db.transaction(IDB_IMAGE_STORE, 'readonly');
      const req = tx.objectStore(IDB_IMAGE_STORE).get(key);
      req.onsuccess = () => resolve((req.result as StoredImageRecord | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function loadAllImageBlobsFromIndexedDB(): Promise<StoredImageRecord[]> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return [];
    const db = await openMeshDatabase();
    if (!db.objectStoreNames.contains(IDB_IMAGE_STORE)) return [];
    return await new Promise<StoredImageRecord[]>((resolve) => {
      const tx = db.transaction(IDB_IMAGE_STORE, 'readonly');
      const req = tx.objectStore(IDB_IMAGE_STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredImageRecord[]) ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function deleteImageBlobFromIndexedDB(key: string): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return;
    const db = await openMeshDatabase();
    if (!db.objectStoreNames.contains(IDB_IMAGE_STORE)) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_IMAGE_STORE, 'readwrite');
      tx.objectStore(IDB_IMAGE_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // noop
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el blob de imagen'));
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
