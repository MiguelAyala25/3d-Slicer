import { serializeProject, parseProjectJson } from './project';
import { DEFAULT_PARAMS } from './params';
import { validateParams } from './validator';
import { DEFAULT_BUILD, type BuildConfig } from './build/types';
import type { Disc, SculptureParams } from '../types/sculpture';

export const LOCAL_STORAGE_KEY = 'sculpture_web_autosave_v1';
const IDB_NAME = 'sculpture_web_db';
const IDB_STORE = 'mesh_blobs';
const IDB_KEY = 'active_mesh';

export interface StoredMeshRecord {
  fileName: string;
  buffer: ArrayBuffer;
  savedAt: number;
}

export interface AutosaveSessionSnapshot {
  params: SculptureParams;
  discs: Disc[];
  meshFileName: string | null;
  savedAt: number;
  build: BuildConfig;
}

interface RawAutosaveEnvelope {
  projectJson: string;
  fullParams: SculptureParams;
  meshFileName: string | null;
  savedAt: number;
  build?: BuildConfig;
}

export function saveProjectToLocalStorage(
  params: SculptureParams,
  discs: Disc[],
  meshFileName: string | null,
  build: BuildConfig = DEFAULT_BUILD
): void {
  try {
    const envelope: RawAutosaveEnvelope = {
      projectJson: serializeProject(params, build, discs),
      fullParams: { ...params },
      meshFileName,
      savedAt: Date.now(),
      build,
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
    return {
      params: project.params,
      discs: project.discs,
      meshFileName: typeof parsed.meshFileName === 'string' ? parsed.meshFileName : null,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
      build,
    };
  } catch {
    return null;
  }
}

function openMeshDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
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
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.delete(IDB_KEY);
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
