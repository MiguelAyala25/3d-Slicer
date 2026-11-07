import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { loadMeshFromBuffer } from '../src/core/meshLoader';
import { AxisSliceCache, sliceMeshFromCache } from '../src/core/slicer';
import { sliceWaffleFromCaches } from '../src/core/waffle/waffleSlicer';
import { DEFAULT_PARAMS } from '../src/core/params';
import { DEFAULT_WAFFLE_PARAMS } from '../src/core/waffle/constants';
import type { CoreParams } from '../types/sculpture';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const MODELS_DIR = path.resolve(REPO_ROOT, 'Models');

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getMemoryHeapMb(): number {
  if (typeof global.gc === 'function') {
    global.gc();
  }
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
}

interface BenchResult {
  name: string;
  triangles: number;
  loadAndValidateMs: number;
  cacheBuildMs: number;
  slice50PlatesMs: number;
  slice200PlatesMs: number;
  sliceWaffleMs: number;
  peakHeapMb: number;
}

function createSyntheticSphereMesh(subdivisions: number): Float32Array {
  // THREE.IcosahedronGeometry(radius, detail) -> 20 * 4^detail faces
  // detail = 4 => 20 * 4^4 = 5,120 triangles
  // detail = 5 => 20 * 4^5 = 20,480 triangles
  // Para ~1M usamos SphereGeometry(radius, widthSegments, heightSegments)
  // widthSegments = 1000, heightSegments = 500 => 1000 * 500 * 2 = 1,000,000 triángulos
  const geom = new THREE.SphereGeometry(50, 1000, 500);
  const pos = geom.getAttribute('position').array as Float32Array;
  // Si está indexada, convertir a non-indexed para que cada 3 floats sean 1 vértice independiente
  if (geom.index) {
    const nonIndexed = geom.toNonIndexed();
    const res = new Float32Array(nonIndexed.getAttribute('position').array);
    geom.dispose();
    nonIndexed.dispose();
    return res;
  }
  const res = new Float32Array(pos);
  geom.dispose();
  return res;
}

function runMeasurement(
  name: string,
  getPositions: () => { positions: Float32Array; triCount: number; loadMs: number },
  skipWaffle = false
): BenchResult {
  const loadTimes: number[] = [];
  const cacheTimes: number[] = [];
  const slice50Times: number[] = [];
  const slice200Times: number[] = [];
  const waffleTimes: number[] = [];
  let peakHeap = 0;
  let triCount = 0;

  const coreParams50: CoreParams = {
    ...DEFAULT_PARAMS,
    axis: 'z',
    plates: 50,
    thickness: 3.0,
    gap: 2.0,
  };

  const coreParams200: CoreParams = {
    ...DEFAULT_PARAMS,
    axis: 'z',
    plates: 200,
    thickness: 3.0,
    gap: 2.0,
  };

  const waffleParams = {
    ...DEFAULT_WAFFLE_PARAMS,
    distributionMethod: 'count' as const,
    count1: 15,
    count2: 15,
  };

  // 1 calentamiento + 5 mediciones
  const RUNS = 5;
  for (let i = 0; i <= RUNS; i++) {
    const isWarmup = i === 0;

    const startLoad = performance.now();
    const { positions, triCount: count, loadMs } = getPositions();
    const endLoad = performance.now();
    triCount = count;

    const startCache = performance.now();
    const cacheZ = new AxisSliceCache(positions, 'z');
    const cacheX = new AxisSliceCache(positions, 'x');
    const endCache = performance.now();

    const startSlice50 = performance.now();
    sliceMeshFromCache(cacheZ, coreParams50);
    const endSlice50 = performance.now();

    const startSlice200 = performance.now();
    sliceMeshFromCache(cacheZ, coreParams200);
    const endSlice200 = performance.now();

    let waffleElapsed = 0;
    if (!skipWaffle) {
      const startWaffle = performance.now();
      sliceWaffleFromCaches(cacheX, cacheZ, coreParams50, waffleParams);
      const endWaffle = performance.now();
      waffleElapsed = endWaffle - startWaffle;
    }

    const currentHeap = getMemoryHeapMb();
    if (currentHeap > peakHeap) peakHeap = currentHeap;

    if (!isWarmup) {
      loadTimes.push(loadMs > 0 ? loadMs : endLoad - startLoad);
      cacheTimes.push(endCache - startCache);
      slice50Times.push(endSlice50 - startSlice50);
      slice200Times.push(endSlice200 - startSlice200);
      if (!skipWaffle) waffleTimes.push(waffleElapsed);
    }
  }

  return {
    name,
    triangles: triCount,
    loadAndValidateMs: Math.round(median(loadTimes) * 100) / 100,
    cacheBuildMs: Math.round(median(cacheTimes) * 100) / 100,
    slice50PlatesMs: Math.round(median(slice50Times) * 100) / 100,
    slice200PlatesMs: Math.round(median(slice200Times) * 100) / 100,
    sliceWaffleMs: skipWaffle ? -1 : Math.round(median(waffleTimes) * 100) / 100,
    peakHeapMb: peakHeap,
  };
}

async function main() {
  console.log('=== Iniziando Benchmark de Seccionado (B0) ===');
  console.log(`Node: ${process.version}, Plataforma: ${process.platform} (${process.arch})`);

  const results: BenchResult[] = [];

  // 1. Hand.OBJ
  const handPath = path.join(MODELS_DIR, 'Hand.OBJ');
  if (fs.existsSync(handPath)) {
    console.log('\n[1/3] Midiendo Models/Hand.OBJ...');
    const handBuf = fs.readFileSync(handPath);
    const res = runMeasurement('Hand.OBJ', () => {
      const t0 = performance.now();
      const mesh = loadMeshFromBuffer(toArrayBuffer(handBuf), 'Hand.OBJ');
      const t1 = performance.now();
      const pos = mesh.geometry.getAttribute('position').array as Float32Array;
      return { positions: pos, triCount: mesh.metadata.faceCount, loadMs: t1 - t0 };
    });
    results.push(res);
  }

  // 2. dragon-meshed.obj
  const dragonPath = path.join(MODELS_DIR, 'dragon-meshed.obj');
  if (fs.existsSync(dragonPath)) {
    console.log('\n[2/3] Midiendo Models/dragon-meshed.obj...');
    const dragonBuf = fs.readFileSync(dragonPath);
    const res = runMeasurement('dragon-meshed.obj', () => {
      const t0 = performance.now();
      const mesh = loadMeshFromBuffer(toArrayBuffer(dragonBuf), 'dragon-meshed.obj');
      const t1 = performance.now();
      const pos = mesh.geometry.getAttribute('position').array as Float32Array;
      return { positions: pos, triCount: mesh.metadata.faceCount, loadMs: t1 - t0 };
    });
    results.push(res);
  }

  // 3. Malla sintética grande (~1M triángulos)
  console.log('\n[3/3] Midiendo Malla Sintética (~1M triángulos, slice 50p/200p y cache)...');
  const synthPos = createSyntheticSphereMesh(8);
  const triCountSynth = synthPos.length / 9;
  const resSynth = runMeasurement(
    `Sphere ~${Math.round(triCountSynth / 1000)}k`,
    () => {
      return { positions: synthPos, triCount: triCountSynth, loadMs: 0 };
    },
    true // omitir Waffle en 1M triángulos por coste O(N^2) no apto para benchmark rápido
  );
  results.push(resSynth);

  // 4. Medición de ráfaga (Burst de 10 mensajes SLICE) - C5 / O5
  console.log('\n[4/4] Midiendo Ráfaga de 10 cortes SLICE consecutivos (Hand.OBJ & dragon-meshed.obj)...');
  if (fs.existsSync(handPath)) {
    const handBuf = fs.readFileSync(handPath);
    const mesh = loadMeshFromBuffer(toArrayBuffer(handBuf), 'Hand.OBJ');
    const pos = mesh.geometry.getAttribute('position').array as Float32Array;
    const cache = new AxisSliceCache(pos, 'z');

    const t0 = performance.now();
    for (let i = 1; i <= 10; i++) {
      sliceMeshFromCache(cache, { ...DEFAULT_PARAMS, axis: 'z', plates: 40 + i });
    }
    const elapsed10 = performance.now() - t0;

    const t1 = performance.now();
    sliceMeshFromCache(cache, { ...DEFAULT_PARAMS, axis: 'z', plates: 50 });
    const elapsed1 = performance.now() - t1;

    console.log(`- Hand.OBJ: 10 cortes secuenciales = ${elapsed10.toFixed(2)} ms | 1 corte coalesced = ${elapsed1.toFixed(2)} ms (Ahorro: ${(100 * (1 - elapsed1 / elapsed10)).toFixed(1)}%)`);
  }

  if (fs.existsSync(dragonPath)) {
    const dragonBuf = fs.readFileSync(dragonPath);
    const mesh = loadMeshFromBuffer(toArrayBuffer(dragonBuf), 'dragon-meshed.obj');
    const pos = mesh.geometry.getAttribute('position').array as Float32Array;
    const cache = new AxisSliceCache(pos, 'z');

    const t0 = performance.now();
    for (let i = 1; i <= 10; i++) {
      sliceMeshFromCache(cache, { ...DEFAULT_PARAMS, axis: 'z', plates: 40 + i });
    }
    const elapsed10 = performance.now() - t0;

    const t1 = performance.now();
    sliceMeshFromCache(cache, { ...DEFAULT_PARAMS, axis: 'z', plates: 50 });
    const elapsed1 = performance.now() - t1;

    console.log(`- dragon-meshed.obj: 10 cortes secuenciales = ${elapsed10.toFixed(2)} ms | 1 corte coalesced = ${elapsed1.toFixed(2)} ms (Ahorro: ${(100 * (1 - elapsed1 / elapsed10)).toFixed(1)}%)`);
  }

  console.log('\n=== RESULTADOS BENCHMARK B0 (Mediana de 5 ejecuciones) ===');
  console.table(results);

  // Formato Markdown para docs/perf-log.md
  console.log('\nMarkdown para docs/perf-log.md:');
  console.log('| Malla | Triángulos | Carga+Validación (ms) | Caché Ejes X+Z (ms) | Slice 50p (ms) | Slice 200p (ms) | Waffle 15x15 (ms) | Heap Pico (MB) |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(
      `| **${r.name}** | ${r.triangles.toLocaleString()} | ${r.loadAndValidateMs} | ${r.cacheBuildMs} | ${r.slice50PlatesMs} | ${r.slice200PlatesMs} | ${r.sliceWaffleMs} | ${r.peakHeapMb} |`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
