# Sculpture Performance & Tooling Log

Registro de mediciones de rendimiento, benchmarks y líneas base según el plan de refactorización [`docs/REFACTOR_PLAN.md`](./REFACTOR_PLAN.md).

---

## 1. Línea Base Inicial (Commit `8be7825` previo a C0)

### 1.1 Tests Unitarios (Vitest)
- **Fecha**: 2026-11-06
- **Configuración inicial**: `test.environment = 'jsdom'` en todo el runner (`web/vite.config.ts`).
- **Archivos**: 14 archivos.
- **Tests**: 132 pasados, 0 omitidos, 0 fallados.
- **Duración**: **31.48 s** (tiempo total acumulado en `jsdom`: ~127.49 s, 64% del tiempo medido por vitest).

### 1.2 Tests E2E (Playwright) — C0-1 Baseline
- **Fecha**: 2026-11-06
- **Comando**: `npx playwright test`
- **Resultado inicial**: **8 pasados, 4 fallados** (12 tests en total, duración 1.5 min).
- **Detalle de fallas preexistentes documentadas**:
  - `Test 2` (`Add discs mode: 100px camera orbit...`): Click estático en coordenadas del canvas 3D no colocó disco en el timeout.
  - `Test 7` (`Joint change with placed discs...`): Click estático en canvas 3D para colocar discos no intersecta la placa 3D en el viewport headless.
  - `Test 11` (`Confirmation when switching technique with discs placed...`): Mismo motivo de click estático para colocar discos en canvas 3D.
  - `Test 12` (`Warnings panel and slot calibration comb sheet...`): Se generan advertencias `W5` en lugar del selector `[data-testid="waffle-warning-W4"]`.
- **Decisión del usuario (Opción A)**: Se adopta esta línea base de 8/12 pasados para C0. Ningún cambio del plan debe quebrar los 8 tests que pasan.

---

## 2. Benchmark de Seccionado (B0)

Script: `web/scripts/bench-slice.ts` ejecutado mediante `npx vite-node scripts/bench-slice.ts` (1 calentamiento + 5 mediciones, reportando mediana).

### 2.1 Corrida 1 (Mediana de 5)
| Malla | Triángulos | Carga+Validación (ms) | Caché Ejes X+Z (ms) | Slice 50p (ms) | Slice 200p (ms) | Waffle 15x15 (ms) | Heap Pico (MB) |
|---|---|---|---|---|---|---|---|
| **Hand.OBJ** | 470 | 7.10 | 0.65 | 14.82 | 60.02 | 14.42 | 69.82 |
| **dragon-meshed.obj** | 500,000 | 5978.46 | 114.24 | 535.62 | 2698.32 | 597.77 | 120.83 |
| **Sphere ~998k** | 998,000 | 0.03 | 249.72 | 1185.03 | 5298.87 | *omitted (O(N²))* | 145.50 |

### 2.2 Corrida 2 (Verificación de consistencia)
| Malla | Triángulos | Carga+Validación (ms) | Caché Ejes X+Z (ms) | Slice 50p (ms) | Slice 200p (ms) | Waffle 15x15 (ms) | Heap Pico (MB) |
|---|---|---|---|---|---|---|---|
| **Hand.OBJ** | 470 | 12.27 | 1.22 | 26.05 | 109.33 | 16.77 | 77.58 |
| **dragon-meshed.obj** | 500,000 | 7255.34 | 139.53 | 672.76 | 3718.25 | 1038.23 | 119.79 |
| **Sphere ~998k** | 998,000 | 0.03 | 232.04 | 1810.96 | 6954.06 | *omitted (O(N²))* | 145.91 |


---

## 3. Optimizaciones y Tooling (C0)

### 3.1 Issue O6: Vitest con entorno `node` por defecto
- **Configuración**: `vite.config.ts` actualizado a `test.environment = 'node'`.
- Archivos anotados con `// @vitest-environment jsdom`:
  1. `src/__tests__/validator.test.ts` (3MF loader usa `DOMParser`)
  2. `src/__tests__/zeroGap.test.ts` (valida SVG generado con `DOMParser`)
  3. `src/__tests__/waffleExporter.test.ts` (valida SVG generado con `DOMParser`)
  4. `src/__tests__/exporter.test.ts` (valida SVG generado con `DOMParser`)
  5. `src/__tests__/project.test.ts` (pruebas de autosave usan `localStorage`)
- **Archivos en entorno nativo `node`**: 9 archivos (`slicer`, `sizing`, `waffleSlicer`, `baseline`, `architecture`, `discs`, `waffle2d`, `layout`, `joints`).
- **Tests**: **14/14 archivos, 132/132 tests pasados** (0 fallos).
- **Duración antes**: **31.48 s** (con jsdom ocupando 64% del tiempo, ~127.49 s acumulados).
- **Duración después**: **19.97 s** (~36.5 % de reducción de tiempo de suite).

### 3.2 Issue L6: Eliminar pseudo-benchmark en `waffleSlicer.test.ts`
- Eliminado el bloque `describe('Non-blocking Benchmark', ...)` en `web/src/__tests__/waffleSlicer.test.ts`.
- El conteo base de tests unitarios pasa de 132 a **131 tests en 14 archivos**, sin `console.log('[Benchmark Waffle 3D Slicing]')` en `stdout`.
- Duración de `waffleSlicer.test.ts`: bajó de ~1,409–2,334 ms a **808 ms**; suite total en **11.36 s**.

### 3.3 Issue L1: ESLint en modo warn (DEC-10 = A)
- **Herramientas**: `eslint@9.21.0`, `typescript-eslint@8.26.0`, `eslint-plugin-react-hooks@5.2.0`, `globals@16.0.0`.
- **Configuración**: `web/eslint.config.js` con `@typescript-eslint/no-explicit-any: 'warn'`.
- **Script**: `"lint": "eslint src"`.
- **Línea base**: **0 errores, 36 warnings** (código de salida 0). No se ejecutó `--fix` para preservar la regla de no mezclar limpiezas con cambios de comportamiento.

### 3.4 Issue L2: Dependencias sin uso
- Se confirmó con búsqueda exhaustiva que `clsx` y `tailwind-merge` tenían 0 usos.
- Eliminadas `clsx` y `tailwind-merge` de `package.json` y `package-lock.json` (`npm ls clsx tailwind-merge` -> `(empty)`).
- `dxf-parser` (usado únicamente en tests de exportación y `write-baseline.ts`) movido de `dependencies` a `devDependencies`.
- Verificado con `tsc`, `vitest` y `npm run build` en verde.

### 3.5 Issue L3: Triage de dependencias y actualización segura
- **npm audit --omit=dev inicial**: 4 vulnerabilidades reportadas:
  1. `fflate` (0.8.2): bucle infinito en archives malformados ZIP64 (moderada).
  2. `clipper2-js` (1.2.4): depende de `@angular/core` y `@angular/common` v18/19 por empaquetado upstream (advisories de Angular XSS/HTTP token leak).
- **Acciones tomadas**:
  - `fflate` actualizado a `0.8.3` (versión exacta en `package.json`).
  - Vulnerabilidad de `fflate` resuelta: `npm audit --omit=dev` ya no la reporta.
  - Los 3 avisos restantes en producción provienen exclusivamente de las subdependencias internas `@angular/*` del paquete upstream `clipper2-js@1.2.4`. Como la aplicación corre en el cliente / Web Worker y solo invoca funciones matemáticas de polígonos de Clipper sin usar Angular router ni HTTP client, estas vulnerabilidades no son explotables en runtime.
  - No se ejecutó `npm audit fix --force` ni se elevó TypeScript a 7.x.
- **Resultado del gate**: `tsc --noEmit`, `vitest` (131/131) y `npm run build` en verde.

