# Plan Maestro de Migración a Web (`./web`) — Escultura de Planos Seriados (v2.0 Auditado y Corregido)

> [!IMPORTANT]
> **Instrucción para el Agente Implementador**: Este documento contiene el 100% de las decisiones de arquitectura, convenciones de coordenadas, matemáticas, estructuras de datos, algoritmos completos, constantes, textos de interfaz y pruebas automatizadas. **No tomes decisiones propias, no inventes estilos, no uses literales mágicos, no omitas controles y no modifiques ni leas ningún archivo fuera de la carpeta `./web`.** Todos los modelos de prueba (`./web/fixtures/`) y archivos de referencia generados desde Python (`./web/golden/`) ya se encuentran dentro de `./web/`. Sigue cada Fase y Chunk en orden secuencial.

---

## Tabla de Cambios Respecto a la Versión Anterior (Mapeo de Defectos `A1` – `D`)

| ID | Qué estaba mal en la v1.0 | Regla nueva en la v2.0 | Sección donde quedó resuelto | Criterio de aceptación (Test) |
| :--- | :--- | :--- | :--- | :--- |
| **A1** | Se invertía $Y$ solo en DXF (`yDxf = sheetH - y`) y no en SVG (donde $+Y$ apunta hacia abajo), generando archivos espejo entre sí y respecto a 3D; además, al reflejar $Y$ los arcos `ARC` de círculos punteados no invertían sus ángulos CCW. | **Marco Único Cartesiano CAD ($+X$ derecha, $+Y$ arriba)** en 3D, `layout.ts` y `dxfExporter.ts` (`xDxf = x, yDxf = y` sin invertir). Solo `svgExporter.ts` refleja el lienzo con `<g id="cad-frame" transform="translate(0, sheetH) scale(1, -1)">` y contra-refleja cada `<text>` localmente. Documentada la ley de transformación de `ARC` bajo reflexión de $Y$: $\theta'_{\text{start}} = (-\theta_{\text{end}}) \bmod 360^\circ$, $\theta'_{\text{end}} = (-\theta_{\text{start}}) \bmod 360^\circ$. | **§0.2**, **§3 Fase 4 (Chunks 4.1, 4.2, 4.3)** y **§3 Fase 7 (Chunk 7.1)** | Test con pieza asimétrica (`web/fixtures/test_l_block.obj` en eje `y` y `z`): al comparar los vértices de la Placa 0 en Top 3D, SVG parseado (convertido a marco CAD) y DXF parseado con `dxf-parser`, el bounding box, orientación CCW (área firmada $>0$) y posición de la esquina de la L coinciden con error $< 10^{-3}\text{ mm}$. |
| **A2** | Se llamaba a `Clipper.booleanOpPolyTree(1, ...)`, método inexistente en `clipper2-js@1.2.4`, pasando el literal `1` que corresponde a `ClipType.Intersection` (`None=0, Intersection=1, Union=2`), vaciando todas las placas al intersectar con un `Paths64` vacío. | Prohibido usar literales numéricos. Se usa la clase `Clipper64` verificada en `node_modules/clipper2-js/lib/engine.d.ts`: `clipper.addSubjectPaths(subjectPaths)` y `clipper.executePolyTree(ClipType.Union, FillRule.NonZero, polyTree)`, recorriendo `node.children` (`Array<PolyPathBase>`). | **§0.3**, **§3 Fase 2 (Chunk 2.1)** y **§3 Fase 7** | Test unitario verifica `ClipType.Union === 2`, y que un contorno cuadrado de $20\times 20\text{ mm}$ produce 1 polígono con `area === 400` y no vacío. |
| **A3** | Se usaba `FillRule.EvenOdd` (que aplica XOR y convierte solapes de objetos en huecos) y se afirmaba falsamente que equivalía a `shapely.make_valid`. No se orientaban los segmentos ni se normalizaba el winding de la malla. | Al cargar la malla se sueldan vértices y se normaliza el winding **solo en componentes 100% cerradas**, restando su centroide y decidiendo la inversión por profundidad de anidamiento (rayo desde un vértice: profundidad par $\to$ volumen positivo; impar $\to$ volumen negativo de cavidad real, no se invierte). Componentes abiertas no se tocan y emiten advertencia. Cada segmento de corte se orienta con la normal del triángulo $\vec{t} = \hat{k} \times \vec{n} = (-n_y, n_x, 0)$ (exteriores CCW, huecos CW) y se ejecuta `Clipper64.executePolyTree` con **`FillRule.NonZero`**. | **§3 Fase 1 (Chunk 1.3)**, **§3 Fase 2 (Chunk 2.1 y 2.2)** y **§3 Fase 7** | 1) Esfera hueca conserva la cavidad (`depth = 1`, volumen negativo preservado). 2) STL cerrado invertido se corrige (`depth = 0`). 3) Malla abierta lejos del origen no cambia y emite warning. 4) Dos cubos solapados producen 1 único polígono exterior sin hueco interior. |
| **A4** | Solo se validaba el centro del disco contra `plates[k]` con holgura exterior de $1.0\text{ mm}$, permitiendo discos que sobresalían del borde o quedaban flotando fuera de `plates[k+1]` (y auto-copias flotando fuera de `plates[k+2]`). | Nuevo módulo `web/src/core/geometry2d.ts` (`pointInPolygonWithHoles`, `distanceToPolygonBoundary`, `isDiscInsidePlate`, `isDiscValidForGap`, `clampDiscPositionToGap`). Un disco en `hueco = k` es válido solo si el **disco completo** ($\text{distAlBorde} \ge r$) cae dentro de `plates[k]` **Y** `plates[k+1]`. La auto-copia a `k+1` exige que además quepa en `plates[k+2]`. Se aplica en `addDisc`, `moveDisc` (proyección al punto válido más cercano con `clampDiscPositionToGap`) y `setDiameter` (rechazo con aviso). Documentada la diferencia con la tolerancia de $1.0\text{ mm}$ de `viewer.py` (que queda solo para hit-testing de selección de piso). | **§2**, **§3 Fase 2 (Chunk 2.1)**, **§3 Fase 3 (Chunk 3.1)**, **§3 Fase 5 (Chunk 5.2)** y **§3 Fase 7** | Test sobre placas escalonadas ($40\times 40$, $20\times 20$, $10\times 10\text{ mm}$) verificando rechazo en bordes, no auto-copia cuando no cabe en `k+2`, arrastre rápido pegado al borde con `clampDiscPositionToGap` sin congelarse, y rechazo en `setDiameter` si al crecer rebasa la placa. |
| **A5** | En `stitchSegmentsToLoops`, el `unshift` al extender por `head` estaba invertido (`reverseSeg ? p1 : p0`, duplicando `head`), y las cadenas abiertas se aceptaban como lazos cerrados (trazando diagonales a través de la pieza). | Corregida la extensión sobre segmentos dirigidos y añadido un paso que une el final de una cadena abierta con el inicio de otra mediante hash espacial (radio `MAX_REPAIR_GAP_MM = 0.05 mm`) antes de decidir cierre o descarte. Prohibido cerrar cadenas abiertas con una diagonal: si $d(\text{tail}, \text{head}) \le 0.05\text{ mm}$ se cierra como micro-brecha (`openChainsRepaired`); si $> 0.05\text{ mm}$ se **descarta** la cadena abierta (`openChainsDiscarded`) y se emite warning. | **§3 Fase 2 (Chunk 2.2)** y **§3 Fase 7** | 1) Lazo de 100 segmentos con brecha de $0.01\text{ mm}$ en el segmento 50 produce 1 lazo reparado y `openChainsRepaired === 1` sea cual sea el segmento de arranque. 2) Una "C" abierta de 3 lados se descarta (`polygons.length === 0`, `openChainsDiscarded === 1`). |
| **A6** | Intersección plano-triángulo sin especificar qué ocurre cuando un vértice o arista cae exactamente sobre $z = z_{\text{cut}}$ ni el orden de interpolación entre triángulos vecinos. | Regla determinista semi-abierta: vértice **arriba** si $z \ge z_{\text{cut}}$, **abajo** si $z < z_{\text{cut}}$ (sin micro-perturbación). Solo se intersectan aristas con un vértice arriba y otro abajo ($z_{\text{high}} - z_{\text{low}} > 0$ siempre). La interpolación ordena canónicamente $(V_{\text{low}}, V_{\text{high}})$ por índice/altura para que triángulos adyacentes obtengan el mismo punto bit a bit. | **§3 Fase 2 (Chunk 2.3)** y **§3 Fase 7** | Tests de corte pasando exactamente por vértices, aristas horizontales coplanares (escalón de `test_l_block.obj`), ápice que solo toca el plano, vértices duplicados y aristas no-manifold. |
| **A7** | El encadenado de segmentos era $O(n^2)$ por plano, congelando el worker en mallas densas. | Reemplazado por **Hash Espacial 2D** sobre extremos cuantizados (`cellSize = 1e-3 mm`) consultando vecindad $3\times 3$ (9 celdas) para evitar fallos en fronteras de celda, más recorrido de grafo dirigido en $O(n)$ con regla determinista de ángulo mínimo de giro (turn-rightmost) para nodos de grado $> 2$. | **§3 Fase 2 (Chunk 2.2)** y **§3 Fase 7** | Benchmark informativo (no bloqueante) en Vitest: plano con $10\,000$ segmentos se encadena en $< 50\text{ ms}$; $8\,000$ segmentos $\times 200$ placas sin bloquear el worker. Test de nodo grado 4 (figura en 8). |
| **A8** | No se habían verificado las matrices de rotación X/Y, el centrado por `bounds.mean(axis=0)` ni el frame planar de `trimesh.section_multiplane`, y no existían Golden Files. | Verificadas en Python las matrices exactas $R_x$ y $R_y$, el centrado por centro de bounding box $(\min + \max)/2$ y que `section_multiplane([0,0,0], [0,0,1])` tiene transformación planar identidad $(x_{2D}=x_{3D}, y_{2D}=y_{3D})$. Copiados los fixtures a `./web/fixtures/` y generados los Golden Files reales en `./web/golden/` (`l_block_slice_z/x/y.json`, `torus_slice_z.json`, `hand_slice_z.json`, `l_block_project.json`, `l_block_layout.json`, `l_block_layout_y.json`, SVG y DXF). | **§0.4**, **§2**, **§3 Fase 2 (Chunk 2.3)** y **§3 Fase 7** | Tests automatizados en Vitest que comparan la salida de `sliceMesh`, `generateLayouts`, `serializeProjectJson`, `svgExporter` y `dxfExporter` contra `./web/golden/*.json`. |
| **B1** | Se transfería el `ArrayBuffer` de la geometría cacheada al Worker (fallando el segundo corte con `detached ArrayBuffer`) y no había control de condición de carrera entre cortes. | La geometría se clona al enviarla al Worker una sola vez al cargar (`SET_MESH`) y permanece cacheada en el Worker; los cortes envían solo `{ type: 'SLICE', jobId, meshId, params }`. `jobId` incremental descarta respuestas obsoletas y permite reemplazo limpio. | **§3 Fase 2 (Chunk 2.3)** y **§3 Fase 5 (Chunk 5.1)** | Test de dos llamadas consecutivas a `runSlice()` sobre la misma geometría sin `detached ArrayBuffer`, y descarte de `jobId` obsoleto. |
| **B2** | La lógica de corte vivía dentro de `slicer.worker.ts` acoplada a `self.onmessage` (inexistente en `jsdom`). | Extraído `web/src/core/slicer.ts` 100% puro y síncrono (`AxisSliceCache`, `sliceMeshFromCache`, `sliceMesh`). `slicer.worker.ts` queda como wrapper delgado de mensajes. | **§2**, **§3 Fase 2 (Chunk 2.3)** | `slicer.test.ts` importa y ejecuta `sliceMesh` directamente en Vitest sin necesidad de Web Worker. |
| **B3** | Se reconstruía toda la estructura de aceleración en cada cambio de `plates`/`thickness`/`gap`, se afirmaba que cambiar de eje no tocaba la malla y se prometía `"< 1 ms"` con `MeshBVH`. | Índice por eje (`AxisSliceCache`) con **Z-Interval Bucketing** ($B = 128$ cubetas sobre $[\min Z', \max Z']$ en coordenadas centradas no escaladas) construido 1 vez por eje usado. Cambiar `plates`/`thickness`/`gap` solo recalcula `autoScale`: corta en $z_{\text{cut}}/\text{autoScale}$ y multiplica puntos 2D por `autoScale`. Cambiar de eje construye/reutiliza la entrada de ese eje en `axisCaches`. Eliminado `three-mesh-bvh` y el claim falso `"< 1 ms"`. | **§0.1**, **§3 Fase 2 (Chunk 2.3)** y **§3 Fase 7** | Benchmark informativo (no bloqueante) con malla de $\ge 500\,000$ triángulos: construcción de `AxisSliceCache` $< 100\text{ ms}$, re-corte al cambiar `plates`/`thickness`/`gap` en el mismo eje $< 80\text{ ms}$. |
| **B4** | Las placas translúcidas (`opacity: 0.16`) seguían interceptando el raycaster, bloqueando la colocación de discos en pisos inferiores, y orbitar la cámara disparaba `onPointerDown` creando discos o errores. | `modeAddDiscs` en el store y en `DiscsDockHUD`. Los discos se colocan **solo con `onClick` y `e.delta <= 5`, y solo si `modeAddDiscs === true`**, intersectando el plano matemático $Z = Z_{\text{top}}(\text{activeFloor})$ mientras las placas desactivan su raycast. En modo selección (`modeAddDiscs === false`), el plano no responde. Orbitar nunca crea discos ni lanza errores. | **§3 Fase 5 (Chunks 5.1 y 5.2)**, **§3 Fase 6 (Chunk 6.2)** y **§3 Fase 7 (Chunk 7.3)** | Test E2E en Playwright: arrastrar la cámara $100\text{ px}$ (tanto en modo selección como en `modeAddDiscs`) no crea discos ni lanza errores; con `activeFloor = 2` bajo placas translúcidas y `modeAddDiscs = true`, un clic (`delta <= 5`) coloca el disco en el piso 2. |
| **B5** | Cada `pointermove` al arrastrar un disco actualizaba Zustand (120–240 re-renders/s del HUD) y el spinner de diámetro creaba múltiples snapshots de Undo. | Durante el arrastre se proyecta la posición con `clampDiscPositionToGap` y se muta directamente `drag.meshGroup.position` sin tocar Zustand; en `pointerup` se hace **1 solo commit y 1 solo snapshot de Undo** únicamente si la posición cambió ($> 10^{-4}\text{ mm}$). El input de diámetro hace commit al historial en `onBlur`/`Enter`. Todos los componentes usan selectores atómicos. | **§3 Fase 3 (Chunk 3.1)**, **§3 Fase 5 (Chunk 5.2)** y **§3 Fase 6 (Chunks 6.1 y 6.2)** | Test verifica que arrastrar un disco a lo largo de 50 eventos `pointermove` (incluyendo arrastre rápido pegado al borde) no se congela y en `pointerup` incrementa el stack de Undo en exactamente 1 entrada (y 0 si no se movió). |
| **B6** | Atajos de teclado se disparaban dentro de `<input>` y colisionaban con atajos del navegador (`Ctrl+7`, `Ctrl+L`, `Ctrl+T`, `Ctrl+P`, `Ctrl+F`). | Se ignoran todos los atajos cuando el foco está en `input`, `textarea`, `select` o `isContentEditable`. Atajos de letra/número exigen `!ctrlKey && !metaKey && !altKey`. `App.tsx` implementa exactamente §1.3/§1.4: `W`/`ArrowUp` piso siguiente, `S`/`ArrowDown` piso anterior, `7`/`T` Top, `1`/`F` Frente, `3`/`L` Lado, `0`/`P` 3D, `B` o `Shift+7` Abajo. | **§1.4**, **§3 Fase 6 (Chunk 6.1)** y **§3 Fase 7 (Chunk 7.3)** | Test verifica que presionar `Backspace`, `Delete`, `W`, `S`, `7` dentro de un `<input>` no borra discos ni cambia el piso/cámara, y que `W`/`S`/`7`/`1`/`3`/`0`/`B`/`Shift+7` ejecutan sus acciones fuera de inputs. |
| **B7** | La vista `Top` mirando a $(0,0,-1)$ con `up=(0,0,1)` era singular en `OrbitControls`; `camera.up` por prop no bastaba; `near/far = 0.1/50000` causaba Z-fighting. | Se fija `THREE.Object3D.DEFAULT_UP.set(0, 0, 1)` en `main.tsx` antes de crear la escena. Las vistas `Top` y `Bottom` usan `up = (0, 1, 0)` y offset polar $10^{-4}\cdot d$ en $-Y$ manteniendo $+X$ derecha y $+Y$ arriba sin singularidad. `near` y `far` se ajustan dinámicamente al bounding box del modelo. | **§3 Fase 5 (Chunk 5.2)** | Test verifica que en vista `Top` la matriz de vista proyecta $(1,0,0)$ a $+X$ de pantalla y $(0,1,0)$ a $+Y$ de pantalla sin `NaN` en `OrbitControls`, y `far / near <= 25000`. |
| **B8** | El DXF `AC1024` escrito a mano sin handles ni tablas `CLASSES`/`BLOCK_RECORD`/`AcDbPolyline` no abría en AutoCAD, y en `AC1009` (R12) la variable `$INSUNITS` no existe en la especificación DXF (es ignorada por `ezdxf`/LibreCAD/LightBurn). | Se verificó con `ezdxf` y el importador DXF de Inkscape que `$INSUNITS` no es soportado en `AC1009` (`Drawing units ($INSUNITS) are not exported for DXF R12`). Se pasa a **DXF R2000 (`$ACADVER = AC1015`)** mediante la librería `@tarikjabiri/dxf@2.9.0` con `$INSUNITS = 4` (mm) y `$MEASUREMENT = 1` (métrico), auditado con `0` errores en `ezdxf.audit()`. En placas, discos con `gapIndex === i` se graban como `CIRCLE` sólido y con `gapIndex === i - 1` como `ARC` punteados, ambos con diámetro `d + engraveClearance`. | **§0.1**, **§0.3**, **§3 Fase 4 (Chunk 4.2)**, **§3 Fase 7 (Chunk 7.2)** y **§4 (DoD-5)** | Test parsea el DXF `AC1015` con `DxfParser` (`dxf-parser@1.1.2`), audita con `ezdxf` (`0` errores) e importa con Inkscape (`scale = 1.0` mm); una placa con 1 disco arriba y 1 abajo exporta `1 CIRCLE` y `N ARC` en `GRABADO` con `r = (d + engraveClearance) / 2`. |
| **B9** | `ExtrudeGeometry` sin `useMemo` ni `dispose()` fugaba VRAM; `<Edges>` de drei congelaba la CPU calculando ángulos diedros; no se verificaba orientación de huecos en `THREE.Shape`. | `ExtrudeGeometry` y geometrías de borde envueltas en `useMemo` con `dispose()` explícito en `useEffect` cleanup. Prohibido usar `<Edges>`: los contornos de las placas se dibujan con `<lineSegments>` construido directamente desde los anillos 2D (`exterior` + `interiors` en $z=0$ y $z=\text{thickness}$). Verificada orientación CCW/CW en `THREE.Shape`. | **§3 Fase 5 (Chunk 5.2)** | Test verifica que `buildPlateExtrudeGeometry` con un hueco CW genera el número exacto de triángulos sin tapar el agujero y que las geometrías previas ejecutan `.dispose()` al cambiar `sliceResult`. |
| **B10** | El validador marcaba 100% de aristas como abiertas en STL no indexados, usaba tolerancia absoluta y muestreaba aristas. | Se sueldan vértices primero con `mergeVertices(geom, Math.max(1e-9, bboxDiagonal * 1e-6))` (tolerancia **relativa** a la diagonal) y se inspecciona el **100% de las aristas** del índice resultante, contabilizando aristas abiertas ($c=1$) y aristas no-manifold ($c>2$). | **§3 Fase 1 (Chunk 1.3)** y **§3 Fase 7** | Test carga `web/fixtures/test_l_block.stl` (no indexado de origen): tras `mergeVertices` relativo detecta `openEdgeCount === 0, nonManifoldEdgeCount === 0, isWatertight === true`. |
| **B11** | No se rechazaban nubes de puntos PLY ni OBJ con solo líneas `l`/puntos `p`; en 3MF no se aplicaban unidades ni `matrixWorld`; sin límite de triángulos. | Se rechaza cualquier archivo con 0 triángulos válidos. En OBJ/3MF se ejecuta `group.updateMatrixWorld(true)` y se aplica `child.matrixWorld`; si hay `Line`/`Points` sin `Mesh` se rechaza con mensaje claro. En 3MF se lee `<model unit="...">` del XML y se convierte a mm. Límite `MAX_TRIANGLES = 1_000_000`. | **§3 Fase 1 (Chunk 1.3)** y **§3 Fase 7** | Tests unitarios rechazando un PLY de solo vértices (`0 faces`), un OBJ de solo líneas `l 1 2`, y verificando escala `unit="inch"` ($\times 25.4$) y `transform` de `<item>` en 3MF. |
| **B12** | Advertencia de unidades (`>2000` / `<0.1`) era engañosa porque `autoScale` normaliza la altura; existía el estado muerto `repaired`; `validateParams` permitía `gap = 0`. | Eliminada la advertencia de unidades del mesh y reemplazada por nota de auto-escala en el Inspector. Eliminado `repaired` y el check de reparación. Fuente única `PARAM_BOUNDS` en `params.ts` extraída de `params.py` y `ui.py` con `gap >= 0.1` (`gap > 0`) tanto en `validateParams` como en `NumericInput`. | **§0.0**, **§3 Fase 1 (Chunks 1.2 y 1.3)** y **§3 Fase 6 (Chunks 6.1 y 6.2)** | Test verifica que `validateParams` rechaza `gap = 0` y usa exactamente `PARAM_BOUNDS`, y que un modelo de 5000 unidades no emite falso warning de unidades. |
| **B13** | Política ambigua para placas vacías (Python reindexaba en `viewer.py` pero no en `layout.py`, desfasando pisos y discos). | Índices físicos fijos `0 .. plates - 1` en toda la app. `activeFloor` es índice físico; `stepFloor` y slider saltan placas vacías (`[]`); contador muestra `"Piso k+1 / plates (válidas)"`; color HSV usa `i / plates` estable; un disco adyacente a placa vacía (`plates[k].length === 0 || plates[k+1].length === 0`) es inválido. | **§3 Fase 5 (Chunks 5.1 y 5.2)** y **§3 Fase 6 (Chunk 6.2)** | Test con placa intermedia vacía (`plates[2] = []`): verifica que `stepFloor(1)` salta de `1` a `3`, el color de la placa `3` usa `3/plates`, y `isDiscValidForGap` rechaza huecos `1` y `2`. |
| **B14** | Al re-cortar solo se filtraba `hueco <= plates - 2`, dejando discos huérfanos fuera de los polígonos o sin reescalar. | Cambiar de eje (`axis`) limpia todos los discos con aviso. Re-cortar en el mismo eje **reescala $(x, y)$ de los discos por `newAutoScale / oldAutoScale` antes de invocar `purgeInvalidDiscs`**, eliminando los que queden fuera de polígono o en placa vacía y emitiendo warning con el conteo. | **§3 Fase 3 (Chunk 3.1)**, **§3 Fase 5 (Chunk 5.1)** y **§3 Fase 7** | Test: tras colocar discos y re-cortar con distinto `thickness`/`gap` (que cambia `scaleFactor`), las posiciones $(x, y)$ se reescalan por `newScale / oldScale` antes de filtrar con `purgeInvalidDiscs`. |
| **B15** | `loadProjectFromDict` no validaba el esquema del JSON importado y el esquema de `project.ts` discrepaba de `project.py` y `web/golden/l_block_project.json`. | `serializeProjectJson` y `parseProjectJson` usan el esquema exacto y byte-compatible de `project.py:14-85` y `web/golden/l_block_project.json` (`version`, `plates`, `thickness`, `gap`, `axis`, `discs: [{ id, hueco, x, y, diameter }]`), validando rangos de `PARAM_BOUNDS`, unicidad de `id`, `0 <= hueco <= plates - 2`, `1.0 <= diameter <= 50.0` y actualizando `nextId = max(id) + 1`. | **§0.0**, **§3 Fase 3 (Chunk 3.2)** y **§3 Fase 7** | Tests rechazando JSON con `version` inválida, `hueco >= plates - 1`, IDs duplicados o `diameter <= 0`, y test roundtrip byte-compatible con `./web/golden/l_block_project.json`. |
| **B16** | El plan citaba `layout.py` sin volcar las fórmulas ni los algoritmos de `_compute_plate_label`, `ScrapTag`, bandejas y `calculate_used_dimensions`. | Volcado el algoritmo completo de `layout.ts` con `partGap`, `engraveClearance`, `scrapTagEnabled`, distinción de discos `gapIndex === i` (sólido) vs `gapIndex === i - 1` (punteado) en `plate.discs`, y bandejas multi-fila. | **§3 Fase 4 (Chunk 4.1)** | Test verifica `generateLayouts` con `partGap`, `engraveClearance`, `scrapTagEnabled`, bandejas `DiscGroup` y círculos sólidos/punteados. |
| **C1** | Se cargaban `Inter` y `JetBrains Mono` desde Google Fonts en `index.html`, rompiendo el uso offline. | Instalados `@fontsource/inter@5.3.0` y `@fontsource/jetbrains-mono@5.3.0` e importados localmente en `src/main.tsx`. Cero peticiones de red externas. | **§3 Fase 1 (Chunk 1.1)** | Verificación de `index.html` sin `<link>` externos y carga de CSS local de `@fontsource`. |
| **C2** | `user-select: none` estaba en `body`, rompiendo la edición de `<input>` en Safari. | Eliminado `user-select: none` de `body`; se aplica únicamente en el contenedor del `<Canvas>` y barras HUD mediante clase `.select-none`, forzando `user-select: text` en `input, textarea`. | **§3 Fase 1 (Chunk 1.1)** | Test de estilos verifica que `body` no tiene `user-select: none` y que los `<input>` permiten selección de texto. |
| **C3** | `backdrop-blur-xl` / `backdrop-filter` en paneles sobre un `<Canvas>` WebGL que repinta a 60–120 FPS degradaba el rendimiento de GPU. | Eliminado `backdrop-filter` de `.hud-surface` en `src/index.css`; todos los paneles flotantes del HUD usan fondo casi opaco `rgba(18, 18, 21, 0.95)` (`bg-[#121215]/95`) sin `backdrop-filter`. | **§1.2**, **§3 Fase 1 (Chunk 1.1)** y **§3 Fase 6 (Chunk 6.2)** | Inspección de `.hud-surface` en `src/index.css` y componentes HUD: `0` ocurrencias de `backdrop-filter` / `backdrop-blur` sobre el canvas 3D. |
| **C4** | `#71717A` sobre `#121215` (~3.9:1) no cumplía contraste WCAG AA (4.5:1); controles de `28px` eran pequeños en touch; bajo `1100px` los paneles se solapaban y el drag de discos peleaba con orbit táctil. | Texto secundario subido a `#A1A1AA` (contraste 7.3:1) y unidades/muted a `#9CA3AF` (5.8:1). Altura de controles `32px` (`h-8`) en desktop y `40px` en touch (`pointer: coarse`). Definido layout responsive (`< 1100px` inspector como drawer colapsable) y desactivación de `OrbitControls` al arrastrar un disco. | **§1.2**, **§1.3**, **§3 Fase 5 (Chunk 5.2)** y **§3 Fase 6 (Chunk 6.2)** | Test de contraste ($\ge 4.5:1$), test responsive a `1024x768` sin solapamiento de paneles y bloqueo de `OrbitControls` durante drag. |
| **C5** | El wireframe ASCII tenía glifos Unicode (`✓`, `▲`, `▼`, `▶`, `●`) contradiciendo la regla anti-emoji. | Eliminados todos los glifos del wireframe y de los textos; reemplazados exclusivamente por componentes de `lucide-react` con nombre explícito. | **§1.2**, **§1.3** y **§3 Fase 6 (Chunk 6.2)** | Búsqueda estática en `src/` verifica 0 emojis y 0 glifos decorativos Unicode en botones/labels. |
| **C6** | Textos con voseo rioplatense copiados de Python (`"Probá"`, `"Verificá"`, `"tenés"`, `"aplicá"`). | Todos los mensajes estandarizados a **español neutro/mexicano** (`"Prueba"`, `"Verifica"`, `"tienes"`, `"aplica"`). | **§3 Fase 1 (Chunk 1.3)**, **§3 Fase 2 (Chunk 2.3)** y **§3 Fase 6 (Chunk 6.2)** | Test verifica que ningún mensaje de error/advertencia/UI contiene voseo. |
| **C7** | No había persistencia local ante cierre accidental de la pestaña, o el autosave sobrescribía el estado al iniciar sin preguntar al usuario. | Autosave en `localStorage` e `IndexedDB`. Al abrir la app, `checkAutosaveOnStartup` detecta si hay sesión guardada y muestra el banner **"Sesión recuperable — [Restaurar sesión] [Descartar]"** en `TopProjectBar`. Prohibido sobrescribir el estado sin confirmación explícita del usuario. | **§2**, **§3 Fase 3 (Chunk 3.2)**, **§3 Fase 5 (Chunk 5.1)** y **§3 Fase 6 (Chunks 6.1 y 6.2)** | Test verifica que al iniciar con un autosave existente el estado inicial permanece intacto hasta pulsar `"Restaurar sesión"`, y se limpia al pulsar `"Descartar"`. |
| **C8** | `npm create vite` generaba archivos extra (`App.css`, `tsconfig.app.json`) y prompts interactivos; `vite.config.ts` no importaba de `'vitest/config'` ni existía script `"test"`. | Inicialización determinista no interactiva escribiendo directamente `package.json` (con versiones exactas pineadas y scripts `"dev"`, `"build"`, `"typecheck"`, `"test"`, `"test:e2e"`), `tsconfig.json` único y `vite.config.ts` importando `defineConfig` de `'vitest/config'` con `test: { environment: 'jsdom' }`. | **§2** y **§3 Fase 1 (Chunk 1.1)** | Ejecución limpia de `npm install`, `npm run typecheck`, `npm test` y `npm run build` sin prompts interactivos. |
| **D** | La Fase 7 tenía solo 4 tests básicos sin golden files, sin casos degenerados, sin lector DXF real ni E2E con Playwright. | **Fase 7 reescrita por completo**: tests contra Golden Files de Python (`./web/golden/`), casos degenerados de malla/slicing, validación con `dxf-parser` y apertura real en Inkscape/`ezdxf`, test de quiralidad A1 y arcos/círculos con `engraveClearance`, benchmarks no bloqueantes, y suite E2E con Playwright (`./web/e2e/`). | **§3 Fase 7 (Chunks 7.1, 7.2 y 7.3)** y **§4** | 100% de tests unitarios (`vitest run`) y E2E (`playwright test`) en verde cumpliendo la Definición de Terminado (§4). |

---

## 0. Auditoría de Incompatibilidades, Decisiones Globales de Arquitectura y Equivalencia Matemática

El proyecto original en Python (`./*.py`) depende de binarios nativos en C/C++ (`GEOS` vía `shapely`, `OpenGL`/`Qt6` vía `PySide6` y `pyqtgraph`) y acceso directo al sistema de archivos del sistema operativo (`os`, `QFileDialog`). La aplicación web en `./web` reemplaza cada módulo por equivalentes **100% Client-Side en TypeScript**, sin backend.

### 0.0 Fuente Única de Verdad: Tabla de Parámetros, Defaults, Rangos y Esquema JSON (Extraída de `params.py`, `ui.py`, `project.py` y `web/golden/l_block_project.json`)

Esta tabla resuelve de forma definitiva todas las discrepancias entre v1 y v2 y constituye la **única fuente de verdad** para `src/types/sculpture.ts`, `src/core/params.ts`, `src/core/validator.ts`, `src/core/project.ts`, `src/core/layout.ts`, la UI (`RightInspector.tsx`, `DiscsDockHUD.tsx`) y la suite de tests:

| Campo TypeScript (`SculptureParams` / `Disc`) | Campo Python (`Params` / `Disc`) | Clave en Proyecto JSON (`project.py`) | Tipo | Default Exacto | Rango `[min, max]` | Step / Decimales UI | Referencia Exacta (`archivo:línea`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `plates` | `plates` | `"plates"` | `int` | `10` | `[2, 200]` | `step: 1` (`0` dec.) | `params.py:10`, `ui.py:114-118`, `project.py:25,64` |
| `thickness` | `thickness` | `"thickness"` | `float` | `3.0` | `[0.1, 100.0]` | `step: 0.5` | `params.py:11`, `ui.py:120-125`, `project.py:26,65` |
| `gap` | `gap` | `"gap"` | `float` | `3.0` | `[0.1, 1000.0]` | `step: 0.5` | `params.py:12`, `ui.py:127-132`, `project.py:27,66` |
| `axis` | `axis` | `"axis"` | `'z' \| 'x' \| 'y'` | `'z'` | `{'z', 'x', 'y'}` | Combo `Z / X / Y` | `params.py:13`, `ui.py:138-140,289-294`, `project.py:28,67` |
| `sheetW` | `sheet_w` | *(no se guarda en JSON)* | `float` | `600.0` | `[10.0, 5000.0]` | `step: 1.0` | `params.py:14`, `ui.py:149-153` |
| `sheetH` | `sheet_h` | *(no se guarda en JSON)* | `float` | `400.0` | `[10.0, 5000.0]` | `step: 1.0` | `params.py:15`, `ui.py:155-159` |
| `sheetMargin` | `sheet_margin` | *(no se guarda en JSON)* | `float` | `10.0` | `[0.0, 200.0]` | `step: 1.0` | `params.py:16`, `ui.py:161-165` |
| `partGap` | `part_gap` | *(no se guarda en JSON)* | `float` | `5.0` | `[0.0, 100.0]` | `step: 1.0` | `params.py:17`, `ui.py:167-171` |
| `kerf` | `kerf` | *(no se guarda en JSON)* | `float` | `0.15` | `[0.0, 5.0]` | `step: 0.01` (`3` dec.) | `params.py:18`, `ui.py:173-179` |
| `discDiameter` | `disc_diameter` | *(en cada disco: `"diameter"`)* | `float` | `6.0` | `[1.0, 50.0]` | `step: 1.0` | `params.py:21`, `ui.py:189-193` |
| `engraveClearance` | `engrave_clearance` | *(no se guarda en JSON)* | `float` | `0.3` | `[0.0, 10.0]` | `step: 0.1` | `params.py:22`, `ui.py:195-199` |
| `scrapTagEnabled` | `scrap_tag_enabled` | *(no se guarda en JSON)* | `boolean` | `true` | `{true, false}` | Toggle booleano | `params.py:25`, `layout.py:394` |
| `Disc.id` | `Disc.id` | `"discs"[i]."id"` | `int` | `1` (`_next_id`) | `[1, ∞)` (único) | — | `discs.py:8,18`, `project.py:31,74,82` |
| `Disc.gapIndex` | `Disc.hueco` | `"discs"[i]."hueco"` | `int` | `activeFloor` | `[0, plates - 2]` | — | `discs.py:9`, `project.py:32,75` |
| `Disc.x`, `Disc.y` | `Disc.x`, `Disc.y` | `"discs"[i]."x"`, `"y"` | `float` | Clic 3D | Finito (dentro de placa) | — | `discs.py:10-11`, `project.py:33-34,76-77` |
| `Disc.diameter` | `Disc.diameter` | `"discs"[i]."diameter"` | `float` | `params.discDiameter` (`6.0`) | `[1.0, 50.0]` | `step: 0.5` / `1.0` | `discs.py:12`, `project.py:35,78`, `ui.py:189-193` |

- **Esquema JSON de Proyecto 100% Byte-Compatible con `project.py:14-54` y `web/golden/l_block_project.json:1-23`**:
  ```json
  {
    "version": "1.0",
    "plates": 5,
    "thickness": 3.0,
    "gap": 2.0,
    "axis": "z",
    "discs": [
      {
        "id": 1,
        "hueco": 0,
        "x": -7.5,
        "y": 0.0,
        "diameter": 5.0
      }
    ]
  }
  ```

### 0.1 Tabla de Reemplazo Técnico (Sin Backend, 100% Client-Side)

| Módulo Original | Dependencia Nativa / OS | Reemplazo Web Exacto (Client-Side) | Justificación Técnica Verificada |
| :--- | :--- | :--- | :--- |
| `validator.py` | `os.path`, `trimesh.repair` | API `File` + soldado relativo `mergeVertices` (`three-stdlib`) + validador topológico 100% de aristas y normalizador de winding por profundidad de anidamiento (`web/src/core/validator.ts`) | Valida extensión, tamaño $> 0$, existencia de triángulos reales (rechaza nubes de puntos PLY u OBJ de solo líneas), suelda vértices con tolerancia relativa $10^{-6}\times \text{diagonal}$, normaliza el winding **solo en componentes 100% cerradas** restando su centroide y evaluando profundidad de anidamiento por raycast (par $\to V > 0$, impar $\to V < 0$), y cuenta aristas abiertas ($c=1$) y no-manifold ($c>2$). |
| `slicer.py` | `trimesh.section_multiplane` + `shapely` (GEOS C++) | `web/src/core/slicer.ts` (puro) + `polygonStitcher.ts` (Hash Espacial $O(n)$ + unión de cadenas abiertas + `Clipper64` de `clipper2-js@1.2.4`) ejecutado desde `web/src/worker/slicer.worker.ts` | Índice por eje con **Z-Interval Bucketing** ($128$ cubetas en $Z$), intersección plano-triángulo semi-abierta determinista ($z \ge z_{\text{cut}}$ vs $z < z_{\text{cut}}$), segmentos orientados con la normal del triángulo $\vec{t} = (-n_y, n_x)$, stitching $O(n)$ con paso de unión cola-cabeza entre cadenas abiertas (`MAX_REPAIR_GAP_MM = 0.05 mm`) y unión jerárquica con `Clipper64.executePolyTree(ClipType.Union, FillRule.NonZero, polyTree)`. |
| `discs.py` | Python `dataclass` + `viewer.py` | `web/src/core/geometry2d.ts` + `web/src/core/discs.ts` + store `zustand` (`web/src/store/useSculptureStore.ts`) | Mantiene el historial `undo`/`redo` (límite 50), reescala $(x,y)$ por `newAutoScale / oldAutoScale` antes de `purgeInvalidDiscs`, proyecta al punto válido más cercano durante el arrastre (`clampDiscPositionToGap`) y exige que el círculo completo ($\text{distAlBorde} \ge r$) caiga dentro de `plates[k]` y `plates[k+1]`. |
| `layout.py` | `shapely.affinity.translate` | Traducción matemática 1:1 de coordenadas 2D en el marco CAD unificado (`web/src/core/layout.ts`) | Shelf-packing en orden numérico estricto sin rotación, validación de área útil, `computePlateLabel`, `ScrapTag` controlado por `scrapTagEnabled`, círculos de grabado con `diameter + engraveClearance` distinguiendo `gapIndex === i` (sólido) vs `gapIndex === i - 1` (punteado) en `plate.discs`, y bandejas de discos (`DiscGroup`) con compensación de kerf. |
| `exporter.py` | `svgwrite`, `ezdxf`, `os.makedirs` | Generador SVG (`svgExporter.ts`) y generador **DXF R2000 (`AC1015`)** con `@tarikjabiri/dxf@2.9.0` (`dxfExporter.ts`) + `JSZip` | En `AC1009` (R12) la variable `$INSUNITS` no forma parte del estándar DXF y es ignorada por `ezdxf`/LibreCAD/LightBurn. Por ello se genera **DXF `AC1015` (AutoCAD 2000)** mediante `@tarikjabiri/dxf@2.9.0` con `$INSUNITS = 4` (mm) y `$MEASUREMENT = 1` (métrico), `LWPOLYLINE` cerrada, `CIRCLE` (discos de corte y grabados sólidos `gapIndex === i`), `ARC` (grabados punteados `gapIndex === i - 1`), `LINE` y `TEXT`. |
| `preview_dialog.py` | `QFileDialog.getExistingDirectory` | Modal interactivo con Pan/Zoom + descarga `Blob` individual (`.dxf`/`.svg`) y empaquetado `.zip` con `jszip` (`SheetPreviewModal.tsx`) | Permite inspeccionar todas las hojas a escala 1:1 en mm y descargar la hoja activa o todas las hojas empaquetadas en `.zip`. |
| `project.py` | `json.dump` / `json.load` | Serialización/validación byte-compatible con esquema JSON `v1.0` (`web/src/core/project.ts`) + Autosave con banner de confirmación (`web/src/core/autosave.ts`) | Compatible byte a byte con `web/golden/l_block_project.json`, con banner explícito `"Restaurar sesión"` / `"Descartar"` al iniciar para no sobrescribir nunca el estado sin permiso. |
| `viewer.py` | `pyqtgraph.opengl.GLViewWidget` | `@react-three/fiber` + `@react-three/drei` + `THREE.ExtrudeGeometry` + `<lineSegments>` (`web/src/components/viewport/`) | Sistema global $Z$-up (`Object3D.DEFAULT_UP.set(0,0,1)`), modo explícito `modeAddDiscs` con colocación solo en `onClick` (`e.delta <= 5`), arrastre con `clampDiscPositionToGap` a 60–120 FPS y bordes vectoriales rápidos sin `<Edges>`. |

---

### 0.2 Decisión Global de Sistema de Coordenadas y Quiralidad (Corrección Crítica `A1`)

* **Qué estaba mal**:
  En `slicer.py`, los polígonos 2D se generan en el marco cartesiano derecho ($+X$ derecha, $+Y$ arriba). En `layout.py:347-349`, las placas se trasladan con `dx = curr_x - minx`, `dy = curr_y - miny` **sin invertir el eje $Y$**. Sin embargo, `exporter.py` volcaba esas coordenadas directamente a SVG (donde $+Y$ apunta hacia abajo, reflejando verticalmente cada placa respecto a la vista Top 3D) y en DXF aplicaba `y_dxf = sheet_h - y` (reflejando verticalmente las placas en sentido opuesto al SVG y además rompiendo los ángulos CCW de los arcos `ARC` en los círculos punteados).
* **Regla nueva (Marco Único Cartesiano CAD en toda la aplicación)**:
  1. **Un solo marco de coordenadas 2D ($+X$ hacia la derecha, $+Y$ hacia arriba)** rige en:
     - **Visor 3D (Vista Top)**: mirando desde $+Z$ hacia $-Z$, el eje $+X$ apunta a la derecha y el eje $+Y$ apunta hacia arriba.
     - **Resultado de Slicing (`SliceResult.plates`)**: cada punto $[x, y]$ está en milímetros con $+X$ derecha, $+Y$ arriba, contornos exteriores en sentido **antihorario (CCW, área firmada $> 0$)** y huecos interiores en sentido **horario (CW, área firmada $< 0$)**.
     - **Motor de Layout (`layout.ts`)**: el origen $(0, 0)$ de la hoja de material ($W \times H$) es la **esquina inferior izquierda**; $X \in [0, \text{sheetW}]$ crece hacia la derecha y $Y \in [0, \text{sheetH}]$ crece hacia arriba. La traslación `dx = currX - minx`, `dy = currY - miny` es una traslación rígida pura ($\det = +1$), preservando 1:1 la orientación (quiralidad) y el winding CCW/CW de la vista Top 3D.
     - **Exportador DXF (`dxfExporter.ts`)**: como DXF es nativamente cartesiano ($+X$ derecha, $+Y$ arriba), escribe directamente $(x_{\text{dxf}}, y_{\text{dxf}}) = (x, y)$ **sin aplicar `sheetH - y`**.
  2. **Transformación e IDs Unificados en el Exportador SVG (`svgExporter.ts`)**:
     - Como el estándar SVG tiene el origen arriba a la izquierda y $+Y$ hacia abajo, `svgExporter.ts` envuelve todas las capas dentro de un grupo raíz con **`id="cad-frame"`** que refleja el eje $Y$ respecto a la altura de la hoja (`sheet.height`, derivado de `params.sheetH`), conteniendo los grupos **`id="referencia"`** (opcional), **`id="grabado"`** e **`id="corte"`**:
       ```xml
       <g id="cad-frame" transform="translate(0, ${fmt(sheet.height)}) scale(1, -1)">
         <g id="referencia">...</g>
         <g id="grabado">...</g>
         <g id="corte">...</g>
       </g>
       ```
     - Para que las etiquetas de texto (`ScrapTag`, `PlacedPlate` y `DiscGroup`) no aparezcan cabeza abajo por el `scale(1, -1)` del grupo padre, cada elemento `<text>` posicionado en $(tx, ty)$ aplica una transformación local de contra-reflexión:
       ```xml
       <text x="0" y="0" transform="translate(${fmt(tx)}, ${fmt(ty)}) scale(1, -1)" ...>TEXTO</text>
       ```
  3. **Ley de transformación de arcos `ARC` (círculos punteados)**:
     - En DXF, la entidad `ARC` siempre se traza en sentido **antihorario (CCW)** desde `startAngle` (código 50, en grados) hasta `endAngle` (código 51, en grados).
     - En nuestro marco CAD unificado ($+Y$ arriba tanto en `layout.ts` como en `dxfExporter.ts`), no hay reflexión de $Y$, por lo que el segmento $k \in [0, N-1]$ tiene directamente:
       $$\text{startAngle}_k = k \cdot \text{stepDeg}, \qquad \text{endAngle}_k = k \cdot \text{stepDeg} + \text{dashDeg}$$
     - **Regla matemática obligatoria si en cualquier utilidad se refleja $Y$ ($y' = H - y$)**: una reflexión vertical transforma cualquier ángulo $\theta \mapsto -\theta$ e invierte el recorrido CCW $\leftrightarrow$ CW. Por tanto, bajo una reflexión en $Y$, un arco CCW $[\theta_{\text{start}}, \theta_{\text{end}}]$ debe intercambiar y negar sus extremos para seguir cubriendo el mismo trazo físico en CCW:
       $$\theta'_{\text{start}} = ((-\theta_{\text{end}}) \bmod 360 + 360) \bmod 360, \qquad \theta'_{\text{end}} = ((-\theta_{\text{start}}) \bmod 360 + 360) \bmod 360$$
* **Criterio de aceptación (Test)**:
  - En `exporter.test.ts`, se rebana la pieza asimétrica `web/fixtures/test_l_block.obj` en el eje `y` (donde cada placa tiene silueta en L asimétrica) y en el eje `z`:
    1. Se toma `placedPlate = sheet.plates[0].polygons[0].exterior` trasladado por `(xOffset, yOffset)`.
    2. Se parsea el DXF con `DxfParser` (`dxf-parser@1.1.2`) y se extraen los vértices de la primera `LWPOLYLINE` en la capa `CORTE`.
    3. Se parsea el SVG, se verifica `<g id="cad-frame" transform="translate(0, ${sheet.height}) scale(1, -1)">` (calculado dinámicamente desde `sheet.height`, sin `2440` fijo) y los grupos `id="corte"` e `id="grabado"`, y se extraen los vértices del primer `<path>` en `<g id="corte">`.
    4. Se comprueba que los vértices de Top 3D, SVG y DXF coinciden punto por punto ($\max \|\Delta \vec{p}\| < 10^{-3}\text{ mm}$) y tienen la misma área firmada positiva ($\text{signedArea} > 0$, sin espejado).

---

### 0.3 Verificación de Tipos y APIs en `.d.ts` Instalados (Regla 4 y Correcciones `A2`, `B8`)

Todas las versiones de dependencias están **pineadas de forma exacta** (sin `^` ni `~`) y sus firmas fueron verificadas directamente contra los archivos `.d.ts`:

1. **`clipper2-js@1.2.4`**:
   - Verificado en `node_modules/clipper2-js/lib/core.d.ts`:
     ```ts
     export declare enum ClipType { None = 0, Intersection = 1, Union = 2, Difference = 3, Xor = 4 }
     export declare enum FillRule { EvenOdd = 0, NonZero = 1, Positive = 2, Negative = 3 }
     export interface IPoint64 { x: number; y: number; }
     export declare class Path64 extends Array<IPoint64> {}
     export declare class Paths64 extends Array<Path64> {}
     ```
   - Verificado en `node_modules/clipper2-js/lib/engine.d.ts`:
     ```ts
     export declare class Clipper64 extends ClipperBase {
       addSubjectPaths(paths: Paths64): void;
       executePolyTree(clipType: ClipType, fillRule: FillRule, polytree: PolyTree64, openPaths?: Paths64): boolean;
     }
     export declare abstract class PolyPathBase {
       children: Array<PolyPathBase>;
       polygon?: Path64;
       get isHole(): boolean;
     }
     export declare class PolyTree64 extends PolyPath64 {}
     ```
   - Verificado en `node_modules/clipper2-js/lib/clipper.d.ts`:
     `Clipper.makePath(arr: number[]): Path64` recibe un `number[]` plano `[x0, y0, x1, y1, ...]` de enteros redondeados (`Math.round(x * CLIPPER_SCALE)`).
2. **`three@0.186.0`, `@types/three@0.186.0` y `three-stdlib@2.36.1`**:
   - En `node_modules/three-stdlib/utils/BufferGeometryUtils.d.ts`, las funciones exportadas se llaman **`mergeBufferGeometries(geometries: BufferGeometry[], useGroups?: boolean): BufferGeometry | null`** y **`mergeVertices(geometry: BufferGeometry, tolerance?: number): BufferGeometry`**. (Nota: en `three/examples/jsm/utils/BufferGeometryUtils.d.ts` se llama `mergeGeometries`, pero en `three-stdlib@2.36.1` el nombre real exportado es `mergeBufferGeometries`).
   - En `node_modules/three-stdlib/index.d.ts`, los cargadores exportados son `STLLoader`, `OBJLoader`, `PLYLoader` y `ThreeMFLoader` (desde `'three-stdlib'`).
3. **`react@19.3.1`, `react-dom@19.3.1`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@react-three/fiber@9.8.2`, `@react-three/drei@10.7.9`**:
   - `@react-three/fiber@9.8.2` está diseñado específicamente para React 19 y `three@0.186.0`.
4. **`@tarikjabiri/dxf@2.9.0` y `dxf-parser@1.1.2`**:
   - Verificado en `@tarikjabiri/dxf@2.9.0` (`lib/index.d.ts`):
     ```ts
     export declare enum Colors { Red = 1, Green = 3, Cyan = 4, Blue = 5, Magenta = 6, White = 7, Black = 0, Yellow = 2 }
     export declare enum Units { Unitless = 0, Inches = 1, Millimeters = 4, Centimeters = 5, Meters = 6 }
     export declare enum LWPolylineFlags { None = 0, Closed = 1, Plinegen = 128 }
     export declare function point2d(x?: number, y?: number): vec2_t;
     export declare function point3d(x?: number, y?: number, z?: number): vec3_t;
     export declare class DxfWriter {
       setUnits(units: Units): void;
       setVariable(name: string, values: values_t): void;
       addLayer(name: string, color: number, lineType?: string, flags?: LayerFlags): DxfLayer;
       addLWPolyline(points: LWPolylineVertex[], options?: LWPolylineOptions): LWPolyline;
       addLine(startPoint: vec3_t, endPoint: vec3_t, options?: CommonEntityOptions): Line;
       addCircle(center: vec3_t, radius: number, options?: CommonEntityOptions): Circle;
       addArc(center: vec3_t, radius: number, startAngle: number, endAngle: number, options?: CommonEntityOptions): Arc;
       addText(firstAlignmentPoint: vec3_t, height: number, value: string, options?: TextOptions): Text;
       stringify(): string;
     }
     ```
   - Verificado en `node_modules/dxf-parser/dist/DxfParser.d.ts` y `entities/arc.js`:
     `new DxfParser().parseSync(dxfString)` retorna `IDxf | null` con `header`, `tables.layer.layers` y `entities`. En `IArcEntity`, `dxf-parser` convierte los códigos `50` (`startAngle`) y `51` (`endAngle`) de grados a **radianes** (`Math.PI / 180 * curr.value`), detalle documentado para los tests de `exporter.test.ts`.

---

### 0.4 Equivalencia Matemática 1:1 con Python (`slicer.py`) y Golden Files (Corrección `A8`)

* **Qué estaba mal**:
  No se había verificado la matriz exacta de rotación de `trimesh.transformations.rotation_matrix` para los ejes `x` e `y`, ni cómo `mesh.bounds.mean(axis=0)` centra el modelo, ni la matriz `to_2D` interna de `trimesh.section_multiplane`.
* **Regla nueva (Matemática verificada contra Python 3.14 + `trimesh`)**:
  1. **Rotación de eje (`slicer.py:126-132`)**:
     Sea $(x, y, z)$ un vértice original del modelo cargado:
     - Si `axis === 'z'`:
       $$(x', y', z') = (x,\; y,\; z)$$
     - Si `axis === 'x'` (`tx.rotation_matrix(-np.pi / 2, [0, 1, 0])`):
       $$R_x = \begin{bmatrix} 0 & 0 & -1 & 0 \\ 0 & 1 & 0 & 0 \\ 1 & 0 & 0 & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix} \implies (x', y', z') = (-z,\; y,\; x)$$
     - Si `axis === 'y'` (`tx.rotation_matrix(+np.pi / 2, [1, 0, 0])`):
       $$R_y = \begin{bmatrix} 1 & 0 & 0 & 0 \\ 0 & 0 & -1 & 0 \\ 0 & 1 & 0 & 0 \\ 0 & 0 & 0 & 1 \end{bmatrix} \implies (x', y', z') = (x,\; -z,\; y)$$
     Ambas matrices tienen $\det(R) = +1$, por lo que preservan la orientación de las normales.
  2. **Centrado por centro de Bounding Box (`slicer.py:135`)**:
     En Python, `mesh.bounds` es una matriz $2 \times 3$ `[[minX', minY', minZ'], [maxX', maxY', maxZ']]`. Por tanto, `mesh.bounds.mean(axis=0)` calcula el **centro de la caja delimitadora** (NO el centroide promedio de los vértices):
     $$c_x = \frac{\min X' + \max X'}{2}, \qquad c_y = \frac{\min Y' + \max Y'}{2}, \qquad c_z = \frac{\min Z' + \max Z'}{2}$$
     $$(x_c, y_c, z_c) = (x' - c_x,\; y' - c_y,\; z' - c_z)$$
     Tras este paso, los límites en $Z$ son simétricos: $\min Z_c = -\frac{L}{2}$ y $\max Z_c = +\frac{L}{2}$, donde $L = \max Z' - \min Z' = \text{totalLength}$.
  3. **Escala automática y posiciones de corte (`slicer.py:144-160`)**:
     $$\text{assembledHeight} = \text{plates} \cdot \text{thickness} + (\text{plates} - 1) \cdot \text{gap}$$
     $$\text{autoScale} = \begin{cases} \dfrac{\text{assembledHeight}}{L} & \text{si } L > 0 \\ 1.0 & \text{si } L = 0 \end{cases}$$
     $$\min Z_{\text{mm}} = \min Z_c \cdot \text{autoScale} = -\frac{\text{assembledHeight}}{2}$$
     Para cada placa $i \in \{0, \dots, \text{plates}-1\}$:
     $$z_{\text{cut}}(i) = \min Z_{\text{mm}} + i \cdot (\text{thickness} + \text{gap}) + \frac{\text{thickness}}{2}$$
  4. **Frame planar de `trimesh.section_multiplane` (`slicer.py:162-166`)**:
     En `trimesh.intersections.mesh_multiplane(mesh, plane_origin=[0,0,0], plane_normal=[0,0,1], heights=cut_positions)`, la transformación base `plane_transform([0,0,0], [0,0,1])` llama a `align_vectors([0,0,1], [0,0,1])`, que devuelve la matriz identidad $4\times 4$ ($I_4$). Para cada altura $h$, `to_3D` es únicamente la traslación $(0, 0, h)$ y `to_2D = inv(to_3D)` proyecta $(x_{\text{mm}}, y_{\text{mm}}, z_{\text{mm}}) \mapsto (x_{\text{mm}}, y_{\text{mm}})$ **sin ningún desplazamiento ni rotación en $XY$**. Por consiguiente, las coordenadas $(x, y)$ de los polígonos y de los discos en los archivos `.json` de Python coinciden de forma directa con las coordenadas $(x_{\text{mm}}, y_{\text{mm}})$ de la malla centrada y escalada en la Web.
* **Criterio de aceptación (Test)**:
  - En `slicer.test.ts`, al cortar `web/fixtures/test_l_block.obj` en los ejes `'z'`, `'x'` e `'y'` y comparar contra `web/golden/l_block_slice_z.json`, `web/golden/l_block_slice_x.json` y `web/golden/l_block_slice_y.json`, `originalBounds`, `assembledHeight`, `autoScale`, `emptyPlates`, el número de polígonos por placa, sus `bounds` y sus `area` coinciden con diferencia $< 10^{-3}$.

---

## 1. Sistema de Diseño y Reestructuración de UI/UX (Anti-AI Slop)

### 1.1 Diagnóstico de por qué la UI original falla (y qué NO repetir)
En `ui.py` y `viewer.py`, los controles están amontonados en una columna gris estática a la izquierda y dos filas de botones horizontales arriba del visor con emojis (`➕ Zoom +`, `🗑 Borrar disco`, `💾 Exportar`). Eso rompe la jerarquía espacial, roba espacio al visor 3D y mezcla acciones globales (Archivo/Proyecto) con herramientas contextuales del lienzo 3D (Cámara, Piso Activo, Discos).

### 1.2 Dirección Estética (`frontend-design` Token System: *"Precision CAD Studio"*)
Inspirada en **Shapr3D, Spline y Linear**: el visor 3D ocupa el **100% del viewport (`100vw × 100vh`)** y la interfaz se compone de superficies flotantes de alto rendimiento sobre el lienzo con densidad de herramienta profesional (controles de `32px` de alto en escritorio y `40px` en pantallas táctiles, tipografía técnica local y cero decoración superflua).

* **Correcciones de UI y Entorno Aplicadas (`C1`, `C2`, `C3`, `C4`, `C5`)**:
  - **C1 (Fuentes 100% Offline)**: Prohibido usar Google Fonts en `index.html`. Se instalan `@fontsource/inter@5.3.0` y `@fontsource/jetbrains-mono@5.3.0` y se importan localmente en `src/main.tsx`.
  - **C2 (`user-select` seguro en Safari)**: Prohibido poner `user-select: none` en `body`. Solo el contenedor del `<Canvas>` y las etiquetas de los paneles HUD llevan la clase `select-none`, mientras que `input, textarea` tienen `user-select: text` explícito.
  - **C3 (Rendimiento sobre WebGL sin `backdrop-blur-xl`)**: Usar `backdrop-blur-xl` en 5 paneles sobre un `<Canvas>` WebGL que repinta cada frame obliga al compositor del navegador a desenfocar el framebuffer en tiempo real y degrada los FPS. Todos los paneles HUD usan fondo casi opaco **`bg-[#121215]/95`** sin `backdrop-blur`.
  - **C4 (Accesibilidad WCAG AA $\ge 4.5:1$ y Diseño Responsive `< 1100px`)**:
    - El color `#71717A` sobre `#121215` tenía un ratio de contraste de $\sim 3.9:1$ (inferior al mínimo WCAG AA de $4.5:1$). Se reemplaza por **`#A1A1AA` (`zinc-400`, ratio $7.3:1$)** para texto secundario y **`#9CA3AF` (`gray-400`, ratio $5.8:1$)** para unidades y etiquetas muted.
    - Los controles interactivos tienen una altura mínima de `32px` (`h-8`) en puntero fino (mouse) y `40px` (`pointer-coarse:min-h-10`) en dispositivos táctiles.
    - **Responsive bajo `1100px` (`max-[1100px]`)**: Cuando el ancho de ventana es $< 1100\text{ px}$, el `RightInspector` se convierte en un **drawer lateral colapsable** con botón toggle `[SlidersHorizontal] Parámetros` en la esquina superior derecha; las barras superiores (`TopProjectBar` y `CameraToolbar`) hacen wrap en un contenedor flex superior sin superponerse; y el `FloorNavigatorHUD` se compacta a `44px` de ancho.
  - **C5 (Cero Emojis y Cero Glifos Unicode)**: Prohibido usar emojis (`💾`, `🗑`, `➕`, `👁`, `🔄`) o glifos Unicode (`✓`, `▲`, `▼`, `▶`, `●`) tanto en el código como en el wireframe. Se usan exclusivamente íconos vectoriales de `lucide-react` con `size={15}` y `strokeWidth={1.75}`.

* **Paleta de Color Exacta (Tokens CSS/Tailwind)**:
  * `Canvas Background`: `#09090B` (`zinc-950`) con grilla CAD en el plano $XY$ (`#18181B` celdas de `10mm`, `#27272A` secciones de `100mm`).
  * `Floating Surface (HUD)`: `rgba(18, 18, 21, 0.95)` (`bg-[#121215]/95`).
  * `Surface Border`: `rgba(255, 255, 255, 0.08)` (`border border-white/[0.08]`).
  * `Input / Control Well`: `#1C1C21` (`bg-[#1C1C21] border border-white/[0.08] focus-within:border-[#0A84FF]`).
  * `Primary Accent`: `#0A84FF` (hover `#0070E0`) — usado para el botón primario `"Aplicar corte"`, el segmento activo y discos seleccionados.
  * `Disc Accent (Amber)`: `#F59E0B` (normal), `#FDE047` (hover), `#38BDF8` (seleccionado).
  * `Laser Semantics`: Corte `#FF3B30` (en UI) / `#FF0000` (en archivo exportado); Grabado `#0A84FF` (en UI) / `#0000FF` (en archivo exportado).
  * `Text Hierarchy (WCAG AA Checked)`: Primary `#F4F4F5` (`zinc-100`, 16.5:1), Secondary `#A1A1AA` (`zinc-400`, 7.3:1), Muted/Units `#9CA3AF` (`gray-400`, 5.8:1).

### 1.3 Wireframe Espacial (Sin Glifos Unicode — Todos los Íconos son `lucide-react`)

```text
+------------------------------------------------------------------------------------------------------+
| [TopLeft Pill: Archivo y Proyecto]                        [TopCenter Pill: Vistas Camara + Malla]    |
|  [Upload: Cargar 3D] [Hand.OBJ] | [FolderOpen] [Save]      [Arriba][Frente][Lado][Abajo][3D] | [Eye] |
|  [Banner Autosave (condicional): Sesion recuperable -> [Restaurar sesion] [Descartar]]               |
|                                                                                                      |
|  [Left HUD: Navegador de Pisos]                                  [Right HUD: Inspector (288px)]      |
|   +----------------------------+                                  +--------------------------------+ |
|   | PISO ACTIVO   04 / 10 (10) |                                  | CORTE Y ESCALA                 | |
|   | [ChevronUp: Piso sig. (W)] |                                  | Placas           [     10   ]  | |
|   |                            |                                  | Grosor           [   3.0 mm ]  | |
|   |    |  Slider Vertical      |                                  | Separacion       [   3.0 mm ]  | |
|   |    |  interactivo          |                                  | [Layers] Discos: misma lamina  | |
|   |    |  (salta vacias)       |                                  | Eje          [ Z  |  X  |  Y ] | |
|   |                            |       LIENZO 3D INTERACTIVO      | [     Aplicar Corte (CTA)    ] | |
|   | [ChevronDown: Piso ant.(S)]|          (100vw x 100vh)         |--------------------------------| |
|   |----------------------------|                                  | [ChevronRight] Hoja (600x400)  | |
|   | [Switch] Solo piso activo  |                                  | [ChevronRight] Discos (6.0mm)  | |
|   +----------------------------+                                  |--------------------------------| |
|                                                                   | RESULTADO                      | |
|                                                                   | Placas validas         10 / 10 | |
|                                                                   | Escala auto              1.42x | |
|                                                                   | Dim.      120.4 x 85.0 x 57 mm | |
|  [BottomLeft Pill: StatusBarPill]                                 |--------------------------------| |
|   [Texto de estado contextual]                                    | [ Vista Previa y Exportar    ] | |
|         [BottomCenter Floating Dock: Herramientas de Discos]      +--------------------------------+ |
|          [MousePointer: Seleccionar | PlusCircle: Poner Discos] | [Diam 6.0mm] [Trash2] [Undo][Redo] |
+------------------------------------------------------------------------------------------------------+
```

### 1.4 Tabla de Mapeo Completo de Controles

| Control en la App Python (`ui.py` / `viewer.py`) | Nueva Ubicación en la Web | Componente React e Íconos `lucide-react` |
| :--- | :--- | :--- |
| `btn_load` ("Cargar modelo 3D...") + `lbl_file` | **Top-Left Floating Pill** + soporte Drag & Drop en toda la ventana | `TopProjectBar.tsx` (`Upload`, `Box`) — sin indicador de "reparado" (B12) |
| `btn_load_project` / `btn_save_project` (`.json`) | **Top-Left Floating Pill** | `TopProjectBar.tsx` (`FolderOpen`, `Save`) |
| Banner de recuperación de sesión automática | **Top-Left debajo de `TopProjectBar`** (aparece si existe autosave válido) | `TopProjectBar.tsx` (`RotateCcw`, `X`) (C7) |
| `btn_view_top`, `side`, `front`, `bottom`, `3d` | **Top-Center Floating Pill** (atajos sin modificadores: `7`/`T`, `3`/`L`, `1`/`F`, `Shift+7`/`B` para Abajo, `0`/`P`) | `CameraToolbar.tsx` (`Compass`) (B6) |
| `btn_toggle_mesh` ("Ver modelo original") | **Top-Center Floating Pill** | `CameraToolbar.tsx` (`Eye`, `EyeOff`) |
| `lbl_floor`, `btn_prev_floor`, `btn_next_floor`, `btn_solo_piso` | **Left Floating HUD** (con slider vertical que salta placas vacías y contador físico/válidas) | `FloorNavigatorHUD.tsx` (`ChevronUp`, `ChevronDown`, `Layers`) (B13) |
| `btn_poner_discos`, `spin_selected_diam`, `btn_delete_disc`, `btn_undo`, `btn_redo` | **Bottom-Center Floating Dock** (visible cuando `sliceResult !== null`) | `DiscsDockHUD.tsx` (`MousePointer`, `PlusCircle`, `Trash2`, `Undo2`, `Redo2`) |
| `lbl_status` (mensajes de ayuda e interacción) | **Bottom-Left Subtle Pill** | `StatusBarPill.tsx` (`Info`) |
| `spin_plates`, `spin_thickness`, `spin_gap`, `lbl_disc_sheet`, `combo_axis`, `btn_apply` | **Right Floating Inspector** — Sección principal (*Corte y Escala*) | `RightInspector.tsx` (`SlidersHorizontal`, `Play`, `Loader2`) |
| `section_sheet` (`sheet_w`, `sheet_h`, `sheet_margin`, `part_gap`, `kerf`) | **Right Floating Inspector** — Acordeón (*Hoja de Corte*) | `RightInspector.tsx` (`ChevronRight`, `ChevronDown`) |
| `section_cols` (`disc_diameter`, `engrave_clearance`, `scrap_tag_enabled`) | **Right Floating Inspector** — Acordeón (*Discos y Rotulado*) | `RightInspector.tsx` (`CircleDot`, `Tag`) |
| `lbl_info` + `lbl_warnings` + `btn_export_dxf` | **Right Floating Inspector** — Métricas + Advertencias + CTA Exportación | `RightInspector.tsx` (`AlertTriangle`, `FileOutput`) |
| `PreviewDialog` (`tabs`, zoom/pan, métricas por hoja, exportar hoja / todas) | **Modal de Pantalla Completa** con pestañas, visor SVG interactivo y descargas `.dxf` / `.svg` / `.zip` | `SheetPreviewModal.tsx` (`ZoomIn`, `ZoomOut`, `Maximize2`, `Download`, `Archive`, `X`) |

---

## 2. Estructura de Archivos Real y Exacta (`./web`)

El agente implementador trabajará únicamente sobre la siguiente estructura real dentro de `./web/` (sin archivos basura de plantillas como `App.css`, `tsconfig.app.json` ni `src/assets/`):

```text
web/
├── package.json                  # Dependencias con versiones exactas pineadas y scripts dev/build/typecheck/test/test:e2e
├── tsconfig.json                 # Configuración única de TypeScript (strict: true)
├── vite.config.ts                # Importa defineConfig de 'vitest/config' con plugins react + tailwindcss + test jsdom
├── playwright.config.ts          # Configuración de pruebas E2E con Playwright
├── index.html                    # Entrada HTML limpia sin enlaces externos a Google Fonts
├── fixtures/                     # Modelos 3D de prueba copiados para independencia total fuera de ./web
│   ├── test_l_block.obj          # Bloque en L asimétrico (OBJ)
│   ├── test_l_block.stl          # Bloque en L asimétrico (STL no indexado)
│   ├── test_l_block.ply          # Bloque en L asimétrico (PLY)
│   ├── test_l_block.3mf          # Bloque en L asimétrico (3MF)
│   ├── test_torus.stl            # Toroide con hueco central (STL)
│   └── Hand.OBJ                  # Modelo orgánico complejo (Mano 3D)
├── golden/                       # Golden files generados desde Python (slicer.py, layout.py, project.py, exporter.py)
│   ├── l_block_slice_z.json
│   ├── l_block_slice_x.json
│   ├── l_block_slice_y.json
│   ├── torus_slice_z.json
│   ├── hand_slice_z.json
│   ├── l_block_project.json
│   ├── l_block_layout.json
│   ├── l_block_layout_y.json
│   ├── l_block_hoja_1_placas_python.svg
│   ├── l_block_hoja_1_placas_python.dxf
│   ├── l_block_hoja_2_discos_python.svg
│   └── l_block_hoja_2_discos_python.dxf
├── e2e/
│   └── sculpture.spec.ts         # Suite E2E Playwright (colocar/arrastrar/borrar discos, undo, teclado en inputs, cambio de piso)
└── src/
    ├── main.tsx                  # Configura THREE.Object3D.DEFAULT_UP.set(0,0,1), importa @fontsource y monta <App />
    ├── App.tsx                   # Layout principal, listener global de teclado seguro y Drag & Drop de archivos
    ├── index.css                 # @import "tailwindcss"; variables y reglas de selección seguras
    ├── types/
    │   └── sculpture.ts          # Contratos de datos (Params, Disc, SliceResult, SheetLayout, WorkerMessages, etc.)
    ├── core/
    │   ├── params.ts             # PARAM_BOUNDS (fuente única de verdad), DEFAULT_PARAMS, getDiscThickness, isDiscsSeparateSheet
    │   ├── validator.ts          # Validaciones de archivo, parámetros, soldado relativo, estanqueidad 100%, no-manifold y winding
    │   ├── meshLoader.ts         # Cargador .obj/.stl/.3mf/.ply -> BufferGeometry validada, unidades 3MF, matrixWorld y normalización
    │   ├── geometry2d.ts         # pointInPolygonWithHoles, distanceToPolygonBoundary, isDiscInsidePlate, isDiscValidForGap, clampDiscPositionToGap
    │   ├── polygonStitcher.ts    # Hash espacial 2D O(n) + unión de cadenas abiertas + Clipper64.executePolyTree(ClipType.Union, FillRule.NonZero)
    │   ├── slicer.ts             # Motor de slicing puro y síncrono (AxisSliceCache con Z-Bucketing + sliceMesh)
    │   ├── discs.ts              # Clase DiscManager (add, move, setDiameter, remove, undo, redo, rescalePositions, purgeInvalidDiscs)
    │   ├── project.ts            # Serialización y validación estricta de esquema JSON v1.0 byte-compatible con project.py
    │   ├── autosave.ts           # Persistencia automática en localStorage (estado/discos) e IndexedDB (ArrayBuffer del modelo)
    │   ├── layout.ts             # Algoritmo 1:1 de acomodo 2D (placas, _computePlateLabel, ScrapTag, bandejas de discos)
    │   ├── svgExporter.ts        # Generador SVG 1:1 en mm con grupo raíz CAD id="cad-frame" translate(0,H) scale(1,-1)
    │   └── dxfExporter.ts        # Generador ASCII DXF AC1015 (@tarikjabiri/dxf@2.9.0) con $INSUNITS=4, $MEASUREMENT=1, LWPOLYLINE, CIRCLE, ARC, LINE, TEXT + ZIP
    ├── worker/
    │   └── slicer.worker.ts      # Wrapper delgado de Web Worker sobre core/slicer.ts con cache por eje y control de jobId
    ├── store/
    │   └── useSculptureStore.ts  # Estado global en Zustand con selectores atómicos, control de carreras y autosave
    ├── components/
    │   ├── ui/
    │   │   ├── NumericInput.tsx  # Input numérico accesible (h-8 / touch min-h-10) con commit en blur/Enter o debounce
    │   │   └── Collapsible.tsx   # Acordeón con íconos lucide-react (ChevronRight / ChevronDown)
    │   ├── hud/
    │   │   ├── TopProjectBar.tsx
    │   │   ├── CameraToolbar.tsx
    │   │   ├── FloorNavigatorHUD.tsx
    │   │   ├── DiscsDockHUD.tsx
    │   │   ├── RightInspector.tsx
    │   │   └── StatusBarPill.tsx
    │   ├── modal/
    │   │   └── SheetPreviewModal.tsx
    │   └── viewport/
    │       ├── Viewport3D.tsx
    │       ├── CameraRig.tsx
    │       ├── OriginalMeshView.tsx
    │       ├── SlicedPlatesView.tsx
    │       └── InteractiveDiscsView.tsx
    └── __tests__/
        ├── validator.test.ts
        ├── slicer.test.ts
        ├── discs.test.ts
        ├── layout.test.ts
        ├── exporter.test.ts
        └── project.test.ts
```


---

## 3. Plan de Implementación Detallado por Fases y Chunks

Cada fase está dividida en **Chunks atómicos**, con archivos exactos a crear/modificar, bloques de corrección explícitos (**Qué estaba mal**, **Regla nueva**, **Criterio de aceptación**) y código/especificaciones completas listas para implementar sin ambigüedad.

---

### FASE 1: Bootstrapping en `./web`, Contratos de Datos y Validadores

#### Chunk 1.1: Inicialización de `./web` con Dependencias Pineadas (Correcciones C1, C2, C3, C8, #5e, #7)

- **Corrección C1 (Plantilla Vite y configuración TS/Vitest)**:
  - *Qué estaba mal*: El plan invocaba `npm create vite@latest .` dejando `App.css`, `src/assets/react.svg`, `tsconfig.app.json` y `tsconfig.node.json` huérfanos, y proponía un `vite.config.ts` que importaba `defineConfig` de `'vite'` incluyendo un bloque `test:` que falla en compilación TypeScript.
  - *Regla nueva*: Inicializar `./web` escribiendo directamente `package.json`, un único `tsconfig.json` (eliminando `tsconfig.app.json`, `tsconfig.node.json`, `src/App.css` y `src/assets/`), y un `vite.config.ts` que importa `defineConfig` desde `'vitest/config'`.
  - *Criterio de aceptación*: `npm run typecheck` (`tsc --noEmit`) y `npm run build` terminan con código `0` sin errores de tipos en `vite.config.ts`.
- **Corrección C2 + #7 (Dependencias exactas y alineación de tipos incluyendo `@tarikjabiri/dxf@2.9.0`)**:
  - *Qué estaba mal*: `package.json` usaba rangos `^`, omitía `@types/three` (o arriesgaba desalineación con `three`), instalaba `three-bvh-csg` sin usarlo jamás, y carecía de `@tarikjabiri/dxf` para emitir DXF `AC1015` con unidades milimétricas honradas.
  - *Regla nueva*: Pinear versiones exactas verificadas contra sus `.d.ts` instalados (`three@0.186.0` + `@types/three@0.186.0`, `@react-three/fiber@9.8.2`, `@react-three/drei@10.7.9`, `react@19.3.1`, `clipper2-js@1.2.4`, `three-stdlib@2.36.1`, `@tarikjabiri/dxf@2.9.0`, `dxf-parser@1.1.2`, `@playwright/test@1.64.1`) y eliminar `three-bvh-csg`.
  - *Criterio de aceptación*: `package.json` no contiene ningún prefijo `^` ni `~`; todas las firmas importadas compilan con `strict: true`.
- **Corrección C3 (Fuentes offline y selección CSS)**:
  - *Qué estaba mal*: Se cargaban `Inter` y `JetBrains Mono` desde `fonts.googleapis.com` (rompiendo el requisito 100% offline) y se aplicaba `user-select: none` globalmente sobre `body`, impidiendo copiar métricas, errores o valores de inputs.
  - *Regla nueva*: Instalar e importar `@fontsource/inter` y `@fontsource/jetbrains-mono` localmente en `src/main.tsx`. Aplicar `select-none` únicamente en elementos interactivos de barra/canvas, manteniendo `.hud-text-selectable` (`user-select: text`) en paneles de métricas, tablas de errores e inputs.
  - *Criterio de aceptación*: Desconectando la red en Playwright (`context.setOffline(true)`), la app carga con `0` peticiones externas fallidas y permite seleccionar texto en el inspector de métricas.
- **Corrección #5e (Eliminación de `backdrop-filter` en `.hud-surface`)**:
  - *Qué estaba mal*: `.hud-surface` en `src/index.css` incluía `backdrop-filter: blur(12px);` sobre múltiples paneles flotantes simultáneos encima del canvas WebGL, causando caídas de FPS durante el orbitado 3D en GPUs integradas.
  - *Regla nueva*: Quitar `backdrop-filter` de `.hud-surface` y utilizar `background-color: rgba(18, 18, 21, 0.95);`.
  - *Criterio de aceptación*: `src/index.css` no contiene `backdrop-filter` y `getComputedStyle(el).backdropFilter` en cualquier `.hud-surface` devuelve `'none'`.

##### Archivo `web/package.json`
```json
{
  "name": "sculpture-web",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@fontsource/inter": "5.3.0",
    "@fontsource/jetbrains-mono": "5.3.0",
    "@react-three/drei": "10.7.9",
    "@react-three/fiber": "9.8.2",
    "@tarikjabiri/dxf": "2.9.0",
    "clipper2-js": "1.2.4",
    "clsx": "2.1.1",
    "dxf-parser": "1.1.2",
    "fflate": "0.8.2",
    "jszip": "3.10.2",
    "lucide-react": "1.59.0",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "tailwind-merge": "3.7.0",
    "three": "0.186.0",
    "three-stdlib": "2.36.1",
    "zustand": "5.0.15"
  },
  "devDependencies": {
    "@playwright/test": "1.64.1",
    "@tailwindcss/vite": "4.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@types/three": "0.186.0",
    "@vitejs/plugin-react": "6.1.2",
    "jsdom": "30.1.3",
    "tailwindcss": "4.3.3",
    "typescript": "5.8.3",
    "vite": "8.3.4",
    "vitest": "5.0.5"
  }
}
```

##### Archivo `web/vite.config.ts`
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
  },
});
```

##### Archivo `web/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true
  },
  "include": ["src", "vite.config.ts", "playwright.config.ts", "e2e"]
}
```

##### Archivo `web/index.html`
```html
<!doctype html>
<html lang="es" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Escultura de Planos Seriados — CAD Studio</title>
  </head>
  <body class="bg-[#09090B] text-[#F4F4F5] antialiased overflow-hidden">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

##### Archivo `web/src/index.css`
```css
@import "tailwindcss";

@layer base {
  :root {
    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }

  body {
    font-family: var(--font-sans);
    background-color: #09090B;
    color: #F4F4F5;
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
}

.font-mono-tabular {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.hud-surface {
  background-color: rgba(18, 18, 21, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.hud-text-selectable {
  user-select: text;
}
```

---

#### Chunk 1.2: Contratos de Datos y Parámetros (`src/types/sculpture.ts` y `src/core/params.ts`) (Correcciones #0, #2, B12, B13)

- **Corrección #0 + #2 + B12 (Fuente única de verdad de parámetros extraída de `params.py:9-33`, `project.py:14-85` y `ui.py:94-205`)**:
  - *Qué estaba mal*: Había discrepancia entre v1 y v2 (`plates` 10 vs 20, `discDiameter` 6 vs 10, hoja `600x400` vs `1220x2440`, `sheetMargin` 10 vs 15, `partGap` vs `spacing`, y ausencia de `engraveClearance` y `scrapTagEnabled`). Además, `PlacedPlate.discs` no distinguía entre círculos sólidos (`gapIndex === i`) y punteados (`gapIndex === i - 1`) ni preservaba `d.diameter + params.engraveClearance`.
  - *Regla nueva*: Propagar exactamente la tabla de `§0.0` (`DEFAULT_PARAMS` y `PARAM_BOUNDS`) extraída de `params.py:9-33` y `ui.py:94-205`, restaurando `partGap`, `engraveClearance: 0.3` (`[0.0..10.0]`) y `scrapTagEnabled: true`. Definir `PlateEngraveDisc` en `PlacedPlate.discs` con `diameter: d.diameter + params.engraveClearance`, `nominalDiameter: d.diameter`, `gapIndex` e `isDashed: d.gapIndex === plateIndex - 1`.
  - *Criterio de aceptación*: Test unitario verifica que `DEFAULT_PARAMS` y `PARAM_BOUNDS` coinciden campo por campo con la tabla de `§0.0` (`params.py` + `ui.py`) y que `validateParams({ ...DEFAULT_PARAMS, gap: 0 })` lanza `ValidationError`.
- **Corrección B13 (Política explícita de placas vacías)**:
  - *Qué estaba mal*: No estaba definido cómo se numeran las placas cuando un plano de corte no intersecta la malla (o produce área `< 1e-3 mm²`), rompiendo índices de pisos, colores y huecos de discos.
  - *Regla nueva*:
    1. `SliceResult.plates` tiene **siempre longitud fija `params.plates`** con índices físicos `0 .. params.plates - 1`.
    2. Si el plano `i` no produce contornos válidos, `plates[i]` es `[]` (placa vacía).
    3. `activeFloor` en el store es siempre el **índice físico** `0 .. params.plates - 1`.
    4. Los botones/slider de navegación de pisos saltan automáticamente los índices donde `plates[i].length === 0`.
    5. El contador de la UI muestra `"Piso {activeFloor} ({validCount} placas válidas de {params.plates})"`.
    6. El color HSV de la placa `i` se calcula siempre con su índice físico `i / params.plates` para que el color sea estable.
    7. Un disco en el hueco `k` requiere que **ambas** placas adyacentes (`plates[k]` y `plates[k + 1]`) sean no vacías y contengan el disco completo.
  - *Criterio de aceptación*: Test unitario con una malla que deja el plano `0` vacío verifica que `result.plates.length === params.plates`, `result.plates[0].length === 0`, y que intentar agregar un disco en `gapIndex = 0` es rechazado.

##### Archivo `web/src/types/sculpture.ts`
```ts
export type Axis = 'x' | 'y' | 'z';

export interface SculptureParams {
  plates: number;            // params.py:13 default 10, ui.py:96 [2..200]
  thickness: number;         // params.py:14 default 3.0, ui.py:101 [0.1..100.0]
  gap: number;               // params.py:15 default 3.0, ui.py:107 [0.1..1000.0]
  axis: Axis;                // params.py:16 default 'z', ui.py:113 ['x','y','z']
  sheetW: number;            // params.py:19 default 600.0, ui.py:124 [10.0..5000.0]
  sheetH: number;            // params.py:20 default 400.0, ui.py:130 [10.0..5000.0]
  sheetMargin: number;       // params.py:21 default 10.0, ui.py:136 [0.0..200.0]
  partGap: number;           // params.py:22 default 5.0, ui.py:142 [0.0..100.0]
  kerf: number;              // params.py:25 default 0.15, ui.py:148 [0.0..5.0]
  discDiameter: number;      // params.py:28 default 6.0, ui.py:168 [1.0..50.0]
  engraveClearance: number;  // params.py:30 default 0.3, ui.py:155 [0.0..10.0]
  scrapTagEnabled: boolean;  // params.py:33 default true, ui.py:162 boolean
}

export type Point2D = [number, number];

export interface PolygonWithHoles {
  exterior: Point2D[];
  holes: Point2D[][];
  area: number;
}

export type PlateContour = PolygonWithHoles[];

export interface Disc {
  id: number;
  x: number;
  y: number;
  diameter: number;
  gapIndex: number; // Índice físico k (JSON 'hueco'): une plates[k] con plates[k + 1]
}

export interface PlateEngraveDisc {
  id: number;
  x: number;               // Coordenada X local a la placa (mm CAD)
  y: number;               // Coordenada Y local a la placa (mm CAD)
  diameter: number;        // d.diameter + params.engraveClearance (layout.py:173)
  nominalDiameter: number; // d.diameter sin holgura
  gapIndex: number;        // gapIndex === plateIndex -> sólido; gapIndex === plateIndex - 1 -> punteado
  isDashed: boolean;       // false: círculo SÓLIDO (gapIndex === i); true: PUNTEADO (gapIndex === i - 1)
}

export interface SliceWarning {
  floorIndex: number;
  openChainsDiscarded: number;
  openChainsRepaired: number;
  message: string;
}

export interface SliceResult {
  plates: PlateContour[];           // Longitud fija === params.plates (vacías son [])
  zPositions: number[];             // Longitud fija === params.plates
  scaleFactor: number;
  scaledBounds: [Point2D, Point2D]; // [[minX, minY], [maxX, maxY]]
  scaledHeight: number;
  warnings: SliceWarning[];
}

export interface MeshMetadata {
  fileName: string;
  vertexCount: number;
  faceCount: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  extents: [number, number, number];
  isWatertight: boolean;
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
  invertedComponentCount: number;
  openComponentCount: number;
  unitScaleApplied: number;
  warnings: string[];
}

export interface PlacedPlate {
  plateIndex: number;           // Índice físico 0 .. plates-1
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
  polygons: PolygonWithHoles[]; // Coordenadas locales normalizadas a (0,0) en su bbox min
  discs: PlateEngraveDisc[];    // Discos de grabado locales con diameter = d.diameter + engraveClearance e isDashed
  labelText: string;
  labelX: number;               // Centro X de etiqueta en coordenadas de hoja (mm CAD)
  labelY: number;               // Centro Y de etiqueta en coordenadas de hoja (mm CAD)
  labelSize: number;
  labelOutside: boolean;
}

export interface PlacedDisc {
  discId: number;
  gapIndex: number;
  x: number;                    // Centro X en la hoja (mm CAD)
  y: number;                    // Centro Y en la hoja (mm CAD)
  diameter: number;
  label: string;                // p. ej. "D0-1"
}

export interface DiscGroup {
  gapIndex: number;
  plateA: number;
  plateB: number;
  label: string;                // p. ej. "P0-P1"
  trayX: number;
  trayY: number;
  trayW: number;
  trayH: number;
  labelSepX: number;
  discs: PlacedDisc[];
}

export interface ScrapTag {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];              // ["SOBRANTE", "{w} x {h} mm"]
}

export interface SheetLayout {
  sheetIndex: number;
  sheetType: 'plates' | 'discs';
  materialThickness: number;
  width: number;
  height: number;
  margin: number;
  kerf: number;
  engraveClearance: number;
  plates: PlacedPlate[];
  discs: PlacedDisc[];
  discGroups: DiscGroup[];
  scrapTags: ScrapTag[];
  usedWidth: number;
  usedHeight: number;
  usedAreaMm2: number;
  usableAreaMm2: number;
  occupancyPct: number;
  remnantWidth: number;
  remnantHeight: number;
  remnantAreaMm2: number;
}

export type WorkerRequest =
  | {
      type: 'SET_MESH';
      meshId: number;
      positions: Float32Array;
    }
  | {
      type: 'SLICE';
      jobId: number;
      meshId: number;
      params: SculptureParams;
    };

export type WorkerResponse =
  | {
      type: 'SLICE_SUCCESS';
      jobId: number;
      meshId: number;
      result: SliceResult;
      durationMs: number;
    }
  | {
      type: 'SLICE_ERROR';
      jobId: number;
      meshId: number;
      error: string;
    };
```

##### Archivo `web/src/core/params.ts`
```ts
import type { SculptureParams } from '../types/sculpture';

/**
 * Límites y pasos extraídos de params.py:9-59 y ui.py:94-205 (§0.0).
 */
export const PARAM_BOUNDS = {
  plates: { min: 2, max: 200, step: 1 },
  thickness: { min: 0.1, max: 100.0, step: 0.5 },
  gap: { min: 0.1, max: 1000.0, step: 0.5 },
  sheetW: { min: 10.0, max: 5000.0, step: 10.0 },
  sheetH: { min: 10.0, max: 5000.0, step: 10.0 },
  sheetMargin: { min: 0.0, max: 200.0, step: 1.0 },
  partGap: { min: 0.0, max: 100.0, step: 1.0 },
  kerf: { min: 0.0, max: 5.0, step: 0.01 },
  discDiameter: { min: 1.0, max: 50.0, step: 1.0 },
  engraveClearance: { min: 0.0, max: 10.0, step: 0.1 },
} as const;

/**
 * Valores por defecto extraídos de params.py:9-33 (§0.0).
 */
export const DEFAULT_PARAMS: SculptureParams = {
  plates: 10,
  thickness: 3.0,
  gap: 3.0,
  axis: 'z',
  sheetW: 600.0,
  sheetH: 400.0,
  sheetMargin: 10.0,
  partGap: 5.0,
  kerf: 0.15,
  discDiameter: 6.0,
  engraveClearance: 0.3,
  scrapTagEnabled: true,
};

export function getDiscThickness(params: Pick<SculptureParams, 'gap'>): number {
  return params.gap;
}

export function isDiscsSeparateSheet(
  params: Pick<SculptureParams, 'gap' | 'thickness'>
): boolean {
  return Math.abs(params.gap - params.thickness) > 0.01;
}

export function getDiscSheetNotice(
  params: Pick<SculptureParams, 'gap' | 'thickness'>
): string {
  if (!isDiscsSeparateSheet(params)) {
    return 'Discos: misma lámina que placas';
  }
  return `Discos: lámina aparte de ${params.gap.toFixed(1)} mm`;
}
```

---

#### Chunk 1.3: Validador de Archivos, Geometría, Soldado Relativo y Normalización de Winding (`src/core/validator.ts` y `src/core/meshLoader.ts`) (Correcciones #3, A3, B10, B11, B12)

- **Corrección B10 (Validador de estanqueidad con soldado relativo y revisión del 100% de aristas)**:
  - *Qué estaba mal*: En mallas no indexadas (como todos los `.stl`), cada triángulo tiene vértices separados y el validador marcaba el 100% de las aristas como abiertas. Además usaba una tolerancia fija `1e-4` y muestreaba solo `50,000` caras.
  - *Regla nueva*:
    1. Calcular primero la diagonal del bounding box `diag = Math.hypot(dx, dy, dz)`.
    2. Soldar vértices con `mergeVertices(geom, Math.max(1e-9, diag * 1e-6))` de `three-stdlib`.
    3. Recorrer **el 100% de los triángulos** (en un modelo de 500k caras toma `< 90 ms` con claves numéricas `minIdx * N + maxIdx`) contando cuántas veces aparece cada arista sin dirección y cuántas veces con cada dirección.
    4. Clasificar aristas con `count === 1` como abiertas (`openEdgeCount`) y aristas con `count > 2` como `nonManifoldEdgeCount`.
  - *Criterio de aceptación*: `test_l_block.stl` y `test_torus.stl` (archivos STL no indexados) reportan `isWatertight === true`, `openEdgeCount === 0` y `nonManifoldEdgeCount === 0`. Un cubo al que se le elimina una cara reporta `isWatertight === false` y `openEdgeCount === 4`.
- **Corrección #3 + A3 (Normalización de winding solo en componentes 100% cerradas, restando centroide y evaluando profundidad de anidamiento por rayo)**:
  - *Qué estaba mal*: Evaluar el volumen firmado respecto al origen global $(0,0,0)$ en todas las componentes conexas causaba dos fallos graves: (a) una malla abierta lejos del origen tenía volumen aparente dependiente de su traslación y podía invertirse erróneamente; (b) una cavidad interior cerrada (cuyas normales apuntan legítimamente hacia el hueco, con volumen firmado negativo) era invertida a volumen positivo, destruyendo la cavidad en `FillRule.NonZero`.
  - *Regla nueva*:
    1. Agrupar los triángulos en componentes conexas por aristas compartidas.
    2. Clasificar una componente como **100% cerrada** únicamente si todas las aristas de sus triángulos tienen `edgeCounts.get(key) === 2`.
    3. **Componentes abiertas**: NO tocar jamás el orden de sus vértices; incrementar `openComponentCount` y emitir advertencia en `metadata.warnings`.
    4. **Componentes 100% cerradas**:
       - Calcular el centroide $\mathbf{c}$ de la componente y evaluar el volumen firmado restando $\mathbf{c}$: $6V = \sum (\mathbf{a}-\mathbf{c}) \cdot ((\mathbf{b}-\mathbf{c}) \times (\mathbf{d}-\mathbf{c}))$.
       - Determinar la **profundidad de anidamiento** (`nestingDepth`) lanzando un rayo desde un vértice de la componente contra todas las demás componentes 100% cerradas y contando cuántas la contienen (intersecciones impares de Möller–Trumbore).
       - Si `nestingDepth % 2 === 0` (profundidad par: carcasa exterior o isla dentro de cavidad) $\implies$ el volumen debe ser **positivo** ($6V > 0$); invertir solo si $6V < -10^{-9}$.
       - Si `nestingDepth % 2 === 1` (profundidad impar: cavidad real) $\implies$ el volumen debe ser **negativo** ($6V < 0$, no se invierte si ya es negativo; invertir solo si $6V > 10^{-9}$).
  - *Criterio de aceptación*:
    1. Esfera/cubo hueco (carcasa exterior $6V > 0$, cavidad interior $6V < 0$, profundidad 1) conserva la cavidad (`invertedComponentCount === 0`) y produce placas con agujero interior.
    2. STL invertido (una sola componente cerrada a profundidad 0 con $6V < 0$) se corrige (`invertedComponentCount === 1`).
    3. Malla abierta trasladada lejos del origen $(+5000, +5000, +5000)$ no cambia ningún triángulo (`invertedComponentCount === 0`, `openComponentCount === 1`) y emite advertencia.
- **Corrección B11 (Rechazo de nubes de puntos/líneas, soporte real de unidades y transformaciones en 3MF, y límite de triángulos)**:
  - *Qué estaba mal*: `PLYLoader` con solo vértices o un `.obj` con solo líneas (`l`) o puntos (`p`) pasaba o se ignoraba en silencio; `3MFLoader` ignoraba el atributo `<model unit="inch|micron|...">` y referencias múltiples en `<build><item transform="...">`.
  - *Regla nueva*:
    1. Definir `MAX_TRIANGLES = 1_000_000` y `MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024` (150 MB).
    2. En `.ply`, exigir que el número de triángulos (`index ? index.count / 3 : position.count / 3` habiendo caras en el header PLY) sea `>= 4`. Si el header PLY declara `element face 0`, rechazar con error explícito `"El archivo PLY es una nube de puntos y no contiene caras triangulares."`.
    3. En `.obj`, contar objetos `THREE.LineSegments` / `THREE.Points` omitidos; si no hay ningún `THREE.Mesh` con triángulos, lanzar error explícito; si hay mallas pero también líneas/puntos sueltos, agregar advertencia en `metadata.warnings`.
    4. En `.3mf`, inspeccionar `3D/3dmodel.model` con `fflate.unzipSync` para leer `unit="..."` (`micron: 0.001`, `millimeter: 1.0`, `centimeter: 10.0`, `inch: 25.4`, `foot: 304.8`, `meter: 1000.0`), llamar `group.updateMatrixWorld(true)`, clonar cada `Mesh.geometry` y aplicar `mesh.matrixWorld` seguido del factor de escala de unidad.
  - *Criterio de aceptación*: Tests unitarios verifican que un PLY de nube de puntos y un OBJ de solo líneas lanzan `ValidationError`, y que un 3MF con `unit="inch"` y `transform` en `<item>` aplica tanto la matriz de transformación como el factor `25.4`.

##### Archivo `web/src/core/validator.ts`
```ts
import * as THREE from 'three';
import { mergeVertices } from 'three-stdlib';
import { PARAM_BOUNDS } from './params';
import type { MeshMetadata, SculptureParams } from '../types/sculpture';

export const SUPPORTED_EXTENSIONS = new Set(['.obj', '.stl', '.3mf', '.ply']);
export const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB
export const MAX_TRIANGLES = 1_000_000;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateFileExtension(fileName: string, byteLength?: number): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new ValidationError('La ruta del archivo está vacía.');
  }
  const dotIdx = trimmed.lastIndexOf('.');
  const ext = dotIdx >= 0 ? trimmed.slice(dotIdx).toLowerCase() : '';
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new ValidationError(
      `Formato de archivo no soportado: '${ext || '(sin extensión)'}'. Formatos válidos: .3mf, .obj, .ply, .stl`
    );
  }
  if (byteLength !== undefined) {
    if (byteLength === 0) {
      throw new ValidationError(`El archivo '${trimmed}' está vacío (0 bytes).`);
    }
    if (byteLength > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(
        `El archivo '${trimmed}' excede el tamaño máximo permitido de 150 MB.`
      );
    }
  }
  return ext;
}

export function validateParams(params: SculptureParams): void {
  if (
    !Number.isInteger(params.plates) ||
    params.plates < PARAM_BOUNDS.plates.min ||
    params.plates > PARAM_BOUNDS.plates.max
  ) {
    throw new ValidationError(
      `El número de placas debe ser un entero entre ${PARAM_BOUNDS.plates.min} y ${PARAM_BOUNDS.plates.max} (recibido: ${params.plates}).`
    );
  }
  if (
    !Number.isFinite(params.thickness) ||
    params.thickness < PARAM_BOUNDS.thickness.min ||
    params.thickness > PARAM_BOUNDS.thickness.max
  ) {
    throw new ValidationError(
      `El grosor debe estar entre ${PARAM_BOUNDS.thickness.min} y ${PARAM_BOUNDS.thickness.max} mm (recibido: ${params.thickness}).`
    );
  }
  if (
    !Number.isFinite(params.gap) ||
    params.gap < PARAM_BOUNDS.gap.min ||
    params.gap > PARAM_BOUNDS.gap.max
  ) {
    throw new ValidationError(
      `La separación debe ser mayor o igual a ${PARAM_BOUNDS.gap.min} mm y menor o igual a ${PARAM_BOUNDS.gap.max} mm (recibido: ${params.gap}).`
    );
  }
  if (!['x', 'y', 'z'].includes(params.axis)) {
    throw new ValidationError(
      `El eje de corte debe ser 'x', 'y' o 'z' (recibido: '${params.axis}').`
    );
  }
  if (
    !Number.isFinite(params.discDiameter) ||
    params.discDiameter < PARAM_BOUNDS.discDiameter.min ||
    params.discDiameter > PARAM_BOUNDS.discDiameter.max
  ) {
    throw new ValidationError(
      `El diámetro del disco debe estar entre ${PARAM_BOUNDS.discDiameter.min} y ${PARAM_BOUNDS.discDiameter.max} mm (recibido: ${params.discDiameter}).`
    );
  }
  if (
    !Number.isFinite(params.sheetW) ||
    params.sheetW < PARAM_BOUNDS.sheetW.min ||
    params.sheetW > PARAM_BOUNDS.sheetW.max ||
    !Number.isFinite(params.sheetH) ||
    params.sheetH < PARAM_BOUNDS.sheetH.min ||
    params.sheetH > PARAM_BOUNDS.sheetH.max
  ) {
    throw new ValidationError(
      `Las dimensiones de la hoja deben estar entre ${PARAM_BOUNDS.sheetW.min} y ${PARAM_BOUNDS.sheetW.max} mm (recibido: ${params.sheetW} x ${params.sheetH}).`
    );
  }
  if (
    !Number.isFinite(params.sheetMargin) ||
    params.sheetMargin < PARAM_BOUNDS.sheetMargin.min ||
    params.sheetMargin > PARAM_BOUNDS.sheetMargin.max
  ) {
    throw new ValidationError(
      `El margen de la hoja debe estar entre ${PARAM_BOUNDS.sheetMargin.min} y ${PARAM_BOUNDS.sheetMargin.max} mm (recibido: ${params.sheetMargin}).`
    );
  }
  if (params.sheetMargin * 2 >= Math.min(params.sheetW, params.sheetH)) {
    throw new ValidationError(
      `El margen (${params.sheetMargin} mm) es demasiado grande para la hoja de ${params.sheetW} x ${params.sheetH} mm.`
    );
  }
  if (
    !Number.isFinite(params.partGap) ||
    params.partGap < PARAM_BOUNDS.partGap.min ||
    params.partGap > PARAM_BOUNDS.partGap.max
  ) {
    throw new ValidationError(
      `La separación entre piezas debe estar entre ${PARAM_BOUNDS.partGap.min} y ${PARAM_BOUNDS.partGap.max} mm (recibido: ${params.partGap}).`
    );
  }
  if (
    !Number.isFinite(params.kerf) ||
    params.kerf < PARAM_BOUNDS.kerf.min ||
    params.kerf > PARAM_BOUNDS.kerf.max
  ) {
    throw new ValidationError(
      `El kerf debe estar entre ${PARAM_BOUNDS.kerf.min} y ${PARAM_BOUNDS.kerf.max} mm (recibido: ${params.kerf}).`
    );
  }
  if (
    !Number.isFinite(params.engraveClearance) ||
    params.engraveClearance < PARAM_BOUNDS.engraveClearance.min ||
    params.engraveClearance > PARAM_BOUNDS.engraveClearance.max
  ) {
    throw new ValidationError(
      `La holgura de grabado debe estar entre ${PARAM_BOUNDS.engraveClearance.min} y ${PARAM_BOUNDS.engraveClearance.max} mm (recibido: ${params.engraveClearance}).`
    );
  }
  if (typeof params.scrapTagEnabled !== 'boolean') {
    throw new ValidationError('scrapTagEnabled debe ser un valor booleano.');
  }
}

/**
 * Intersección rayo-triángulo (Möller–Trumbore) para determinar si el punto origen
 * está dentro de otra componente conexa cerrada.
 */
function rayIntersectsTriangle(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number
): boolean {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return false;
  const invDet = 1.0 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0.0 || u > 1.0) return false;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0.0 || u + v > 1.0) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t > 1e-7;
}

interface ClosedComponentInfo {
  faces: number[];
  signedVol6: number;
  sampleVertex: [number, number, number];
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * Suelda vértices con tolerancia relativa a la diagonal del bounding box,
 * verifica estanqueidad en el 100% de las aristas, evalúa el volumen firmado
 * restando el centroide SOLO en componentes 100% cerradas y decide la inversión
 * por profundidad de anidamiento (par -> positivo, impar -> negativo).
 * Las componentes abiertas no se tocan y generan una advertencia explícita.
 */
export function normalizeAndValidateGeometry(
  rawGeometry: THREE.BufferGeometry,
  fileName: string,
  unitScaleApplied = 1.0,
  loaderWarnings: string[] = []
): { geometry: THREE.BufferGeometry; metadata: MeshMetadata } {
  const posAttr = rawGeometry.getAttribute('position');
  if (!posAttr || posAttr.count < 3) {
    throw new ValidationError('La malla cargada está vacía (no contiene triángulos).');
  }

  rawGeometry.computeBoundingBox();
  const bb = rawGeometry.boundingBox;
  if (!bb) {
    throw new ValidationError('No se pudo calcular el bounding box de la malla.');
  }

  const extents: [number, number, number] = [
    bb.max.x - bb.min.x,
    bb.max.y - bb.min.y,
    bb.max.z - bb.min.z,
  ];
  const diag = Math.hypot(extents[0], extents[1], extents[2]);
  if (extents[0] < 1e-6 || extents[1] < 1e-6 || extents[2] < 1e-6) {
    throw new ValidationError(
      `La malla es plana o degenerada (dimensiones: ${extents[0].toFixed(4)} x ${extents[1].toFixed(4)} x ${extents[2].toFixed(4)}). Se requiere un modelo 3D con volumen.`
    );
  }

  // Soldado con tolerancia relativa a la diagonal (1e-6 * diag)
  const cleanForWeld = rawGeometry.clone();
  cleanForWeld.deleteAttribute('normal');
  cleanForWeld.deleteAttribute('uv');
  const weldTolerance = Math.max(1e-9, diag * 1e-6);
  const indexedGeom = mergeVertices(cleanForWeld, weldTolerance);

  const indexAttr = indexedGeom.getIndex();
  const weldedPos = indexedGeom.getAttribute('position');
  if (!indexAttr || !weldedPos) {
    throw new ValidationError('Error al indexar los vértices de la malla.');
  }

  const faceCount = Math.floor(indexAttr.count / 3);
  if (faceCount < 4) {
    throw new ValidationError(
      `La malla tiene muy pocas caras (${faceCount}). Se requiere un modelo 3D con al menos 4 caras.`
    );
  }
  if (faceCount > MAX_TRIANGLES) {
    throw new ValidationError(
      `La malla tiene ${faceCount.toLocaleString()} triángulos, excediendo el máximo permitido (${MAX_TRIANGLES.toLocaleString()}). Simplifica la malla antes de cargarla.`
    );
  }

  const indices = new Uint32Array(indexAttr.count);
  for (let i = 0; i < indexAttr.count; i++) {
    indices[i] = indexAttr.getX(i);
  }

  const vertexCount = weldedPos.count;
  // Mapa de aristas sin dirección: key = minV * vertexCount + maxV
  const edgeCounts = new Map<number, number>();
  const edgeFirstFace = new Map<number, number>();
  const adjFaces: number[][] = Array.from({ length: faceCount }, () => []);
  const faceEdgeKeys: [number, number, number][] = new Array(faceCount);

  for (let f = 0; f < faceCount; f++) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    const pairs: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    const keys: [number, number, number] = [0, 0, 0];
    for (let p = 0; p < 3; p++) {
      const u = pairs[p][0];
      const v = pairs[p][1];
      if (u === v) continue;
      const minV = u < v ? u : v;
      const maxV = u < v ? v : u;
      const key = minV * vertexCount + maxV;
      keys[p] = key;
      const prevCount = edgeCounts.get(key) ?? 0;
      edgeCounts.set(key, prevCount + 1);
      const otherFace = edgeFirstFace.get(key);
      if (otherFace !== undefined && otherFace !== f) {
        adjFaces[f].push(otherFace);
        adjFaces[otherFace].push(f);
      } else {
        edgeFirstFace.set(key, f);
      }
    }
    faceEdgeKeys[f] = keys;
  }

  let openEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) openEdgeCount++;
    else if (count > 2) nonManifoldEdgeCount++;
  }
  const isWatertight = openEdgeCount === 0 && nonManifoldEdgeCount === 0;

  // Agrupación en componentes conexas: separar 100% cerradas vs abiertas
  const visited = new Uint8Array(faceCount);
  const closedComponents: ClosedComponentInfo[] = [];
  let openComponentCount = 0;

  for (let startF = 0; startF < faceCount; startF++) {
    if (visited[startF]) continue;
    const compFaces: number[] = [];
    const stack = [startF];
    visited[startF] = 1;
    let isCompClosed = true;

    while (stack.length > 0) {
      const f = stack.pop()!;
      compFaces.push(f);
      const [k0, k1, k2] = faceEdgeKeys[f];
      if (
        edgeCounts.get(k0) !== 2 ||
        edgeCounts.get(k1) !== 2 ||
        edgeCounts.get(k2) !== 2
      ) {
        isCompClosed = false;
      }
      for (const nf of adjFaces[f]) {
        if (!visited[nf]) {
          visited[nf] = 1;
          stack.push(nf);
        }
      }
    }

    if (!isCompClosed) {
      // Componente abierta: NO tocar su winding
      openComponentCount++;
      continue;
    }

    // Componente 100% cerrada: calcular centroide y bbox
    let sumX = 0, sumY = 0, sumZ = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const countVerts = compFaces.length * 3;

    for (const f of compFaces) {
      for (let k = 0; k < 3; k++) {
        const vi = indices[f * 3 + k];
        const vx = weldedPos.getX(vi);
        const vy = weldedPos.getY(vi);
        const vz = weldedPos.getZ(vi);
        sumX += vx;
        sumY += vy;
        sumZ += vz;
        if (vx < minX) minX = vx;
        if (vy < minY) minY = vy;
        if (vz < minZ) minZ = vz;
        if (vx > maxX) maxX = vx;
        if (vy > maxY) maxY = vy;
        if (vz > maxZ) maxZ = vz;
      }
    }
    const cx0 = sumX / countVerts;
    const cy0 = sumY / countVerts;
    const cz0 = sumZ / countVerts;

    // Volumen firmado restando el centroide de la componente
    let signedVol6 = 0;
    for (const f of compFaces) {
      const i0 = indices[f * 3];
      const i1 = indices[f * 3 + 1];
      const i2 = indices[f * 3 + 2];
      const ax = weldedPos.getX(i0) - cx0;
      const ay = weldedPos.getY(i0) - cy0;
      const az = weldedPos.getZ(i0) - cz0;
      const bx = weldedPos.getX(i1) - cx0;
      const by = weldedPos.getY(i1) - cy0;
      const bz = weldedPos.getZ(i1) - cz0;
      const cx = weldedPos.getX(i2) - cx0;
      const cy = weldedPos.getY(i2) - cy0;
      const cz = weldedPos.getZ(i2) - cz0;
      signedVol6 +=
        ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx);
    }

    const firstVi = indices[compFaces[0] * 3];
    closedComponents.push({
      faces: compFaces,
      signedVol6,
      sampleVertex: [
        weldedPos.getX(firstVi),
        weldedPos.getY(firstVi),
        weldedPos.getZ(firstVi),
      ],
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
    });
  }

  // Decidir inversión por profundidad de anidamiento (rayo desde sampleVertex)
  // Dirección de rayo ligeramente perturbada para evitar aristas/vértices alineados a ejes
  const rLen = Math.hypot(1.0, 1.37e-4, 2.19e-4);
  const rdx = 1.0 / rLen;
  const rdy = 1.37e-4 / rLen;
  const rdz = 2.19e-4 / rLen;

  let invertedComponentCount = 0;

  for (let i = 0; i < closedComponents.length; i++) {
    const comp = closedComponents[i];
    const [ox, oy, oz] = comp.sampleVertex;
    let nestingDepth = 0;

    for (let j = 0; j < closedComponents.length; j++) {
      if (i === j) continue;
      const other = closedComponents[j];
      if (
        ox < other.minX || ox > other.maxX ||
        oy < other.minY || oy > other.maxY ||
        oz < other.minZ || oz > other.maxZ
      ) {
        continue;
      }
      let hits = 0;
      for (const f of other.faces) {
        const i0 = indices[f * 3];
        const i1 = indices[f * 3 + 1];
        const i2 = indices[f * 3 + 2];
        if (
          rayIntersectsTriangle(
            ox, oy, oz,
            rdx, rdy, rdz,
            weldedPos.getX(i0), weldedPos.getY(i0), weldedPos.getZ(i0),
            weldedPos.getX(i1), weldedPos.getY(i1), weldedPos.getZ(i1),
            weldedPos.getX(i2), weldedPos.getY(i2), weldedPos.getZ(i2)
          )
        ) {
          hits++;
        }
      }
      if (hits % 2 === 1) {
        nestingDepth++;
      }
    }

    // Profundidad par -> volumen positivo; profundidad impar (cavidad real) -> volumen negativo
    const shouldBePositive = nestingDepth % 2 === 0;
    const needsInvert = shouldBePositive
      ? comp.signedVol6 < -1e-9
      : comp.signedVol6 > 1e-9;

    if (needsInvert) {
      invertedComponentCount++;
      for (const f of comp.faces) {
        const tmp = indices[f * 3 + 1];
        indices[f * 3 + 1] = indices[f * 3 + 2];
        indices[f * 3 + 2] = tmp;
      }
    }
  }

  // Reconstruir geometría no indexada con vértices soldados e índices con winding normalizado
  const outPositions = new Float32Array(faceCount * 9);
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 3; k++) {
      const vi = indices[f * 3 + k];
      outPositions[f * 9 + k * 3] = weldedPos.getX(vi);
      outPositions[f * 9 + k * 3 + 1] = weldedPos.getY(vi);
      outPositions[f * 9 + k * 3 + 2] = weldedPos.getZ(vi);
    }
  }

  const normalizedGeom = new THREE.BufferGeometry();
  normalizedGeom.setAttribute('position', new THREE.BufferAttribute(outPositions, 3));
  normalizedGeom.computeVertexNormals();
  normalizedGeom.computeBoundingBox();

  const warnings = [...loaderWarnings];
  if (!isWatertight) {
    if (openEdgeCount > 0) {
      warnings.push(
        `La malla no es cerrada (${openEdgeCount} aristas abiertas). Algunos cortes podrían quedar incompletos.`
      );
    }
    if (nonManifoldEdgeCount > 0) {
      warnings.push(
        `La malla contiene ${nonManifoldEdgeCount} aristas no-manifold (más de 2 caras compartidas).`
      );
    }
  }
  if (openComponentCount > 0) {
    warnings.push(
      `Se detectaron ${openComponentCount} componente(s) conexa(s) abierta(s); no se modificó la orientación de sus caras.`
    );
  }
  if (invertedComponentCount > 0) {
    warnings.push(
      `Se normalizó automáticamente la orientación de normales en ${invertedComponentCount} componente(s) cerrada(s) con caras invertidas.`
    );
  }

  const metadata: MeshMetadata = {
    fileName,
    vertexCount,
    faceCount,
    boundsMin: [bb.min.x, bb.min.y, bb.min.z],
    boundsMax: [bb.max.x, bb.max.y, bb.max.z],
    extents,
    isWatertight,
    openEdgeCount,
    nonManifoldEdgeCount,
    invertedComponentCount,
    openComponentCount,
    unitScaleApplied,
    warnings,
  };

  return { geometry: normalizedGeom, metadata };
}
```

##### Archivo `web/src/core/meshLoader.ts`
```ts
import * as THREE from 'three';
import {
  STLLoader,
  OBJLoader,
  PLYLoader,
  ThreeMFLoader,
  mergeBufferGeometries,
} from 'three-stdlib';
import { unzipSync, strFromU8 } from 'fflate';
import {
  validateFileExtension,
  normalizeAndValidateGeometry,
  ValidationError,
} from './validator';
import type { MeshMetadata } from '../types/sculpture';

const THREE_MF_UNIT_SCALE: Record<string, number> = {
  micron: 0.001,
  millimeter: 1.0,
  centimeter: 10.0,
  inch: 25.4,
  foot: 304.8,
  meter: 1000.0,
};

function extract3MFUnitScale(buffer: ArrayBuffer): number {
  try {
    const zipData = unzipSync(new Uint8Array(buffer));
    for (const [path, bytes] of Object.entries(zipData)) {
      if (path.toLowerCase().endsWith('.model')) {
        const xmlHead = strFromU8(bytes.subarray(0, Math.min(bytes.length, 4096)));
        const match = xmlHead.match(/<model\b[^>]*\bunit=["']([^"']+)["']/i);
        if (match && match[1]) {
          const unitName = match[1].toLowerCase();
          return THREE_MF_UNIT_SCALE[unitName] ?? 1.0;
        }
      }
    }
  } catch {
    // Si falla la inspección previa del XML, ThreeMFLoader lanzará el error correspondiente
  }
  return 1.0;
}

function extractMergedGeometryFromObject3D(
  root: THREE.Object3D,
  unitScale = 1.0
): { geometry: THREE.BufferGeometry; warnings: string[] } {
  root.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];
  let ignoredLinesOrPoints = 0;

  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && mesh.geometry.getAttribute('position')?.count >= 3) {
        const cloned = mesh.geometry.clone();
        cloned.applyMatrix4(mesh.matrixWorld);
        if (Math.abs(unitScale - 1.0) > 1e-9) {
          cloned.scale(unitScale, unitScale, unitScale);
        }
        const nonIndexed = cloned.index ? cloned.toNonIndexed() : cloned;
        const posOnly = new THREE.BufferGeometry();
        posOnly.setAttribute('position', nonIndexed.getAttribute('position'));
        geometries.push(posOnly);
      }
    } else if (
      (child as THREE.Line).isLine ||
      (child as THREE.Points).isPoints
    ) {
      ignoredLinesOrPoints++;
    }
  });

  if (geometries.length === 0) {
    if (ignoredLinesOrPoints > 0) {
      throw new ValidationError(
        'El archivo contiene únicamente líneas o puntos sueltos y ninguna malla triangular 3D.'
      );
    }
    throw new ValidationError('No se encontraron mallas triangulares en el archivo.');
  }

  const warnings: string[] = [];
  if (ignoredLinesOrPoints > 0) {
    warnings.push(
      `Se omitieron ${ignoredLinesOrPoints} objeto(s) de líneas/puntos que no forman parte de la malla triangular.`
    );
  }

  const merged =
    geometries.length === 1
      ? geometries[0]
      : mergeBufferGeometries(geometries, false);

  if (!merged) {
    throw new ValidationError('No fue posible fusionar los sub-objetos de la malla 3D.');
  }

  return { geometry: merged, warnings };
}

function checkPLYHasFaces(buffer: ArrayBuffer): void {
  const headBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
  const headText = new TextDecoder('utf-8', { fatal: false }).decode(headBytes);
  const faceMatch = headText.match(/element\s+face\s+(\d+)/i);
  if (!faceMatch || Number.parseInt(faceMatch[1], 10) === 0) {
    throw new ValidationError(
      'El archivo PLY es una nube de puntos (0 caras declaradas) y no contiene triángulos.'
    );
  }
}

export function loadMeshFromBuffer(
  buffer: ArrayBuffer,
  fileName: string
): { geometry: THREE.BufferGeometry; metadata: MeshMetadata } {
  const ext = validateFileExtension(fileName, buffer.byteLength);
  let rawGeometry: THREE.BufferGeometry;
  let unitScaleApplied = 1.0;
  let loaderWarnings: string[] = [];

  if (ext === '.stl') {
    const loader = new STLLoader();
    rawGeometry = loader.parse(buffer);
  } else if (ext === '.ply') {
    checkPLYHasFaces(buffer);
    const loader = new PLYLoader();
    const parsed = loader.parse(buffer);
    if (!parsed.index && parsed.getAttribute('position')?.count < 12) {
      throw new ValidationError('El archivo PLY no contiene caras triangulares válidas.');
    }
    rawGeometry = parsed.index ? parsed.toNonIndexed() : parsed;
  } else if (ext === '.obj') {
    const text = new TextDecoder('utf-8').decode(buffer);
    const loader = new OBJLoader();
    const group = loader.parse(text);
    const extracted = extractMergedGeometryFromObject3D(group, 1.0);
    rawGeometry = extracted.geometry;
    loaderWarnings = extracted.warnings;
  } else if (ext === '.3mf') {
    unitScaleApplied = extract3MFUnitScale(buffer);
    const loader = new ThreeMFLoader();
    const group = loader.parse(buffer);
    const extracted = extractMergedGeometryFromObject3D(group, unitScaleApplied);
    rawGeometry = extracted.geometry;
    loaderWarnings = extracted.warnings;
    if (Math.abs(unitScaleApplied - 1.0) > 1e-6) {
      loaderWarnings.push(
        `Se aplicó factor de conversión de unidades 3MF (x${unitScaleApplied}).`
      );
    }
  } else {
    throw new ValidationError(`Extensión no soportada: ${ext}`);
  }

  return normalizeAndValidateGeometry(
    rawGeometry,
    fileName,
    unitScaleApplied,
    loaderWarnings
  );
}
```

---

### FASE 2: Motor de Slicing Puro, Geometría 2D, Stitching O(n) y Clipper2

#### Chunk 2.1: Primitivas Geométricas 2D (`src/core/geometry2d.ts`) (Correcciones A4, #5d)

- **Corrección A4 (Validación estricta de disco completo dentro de polígono con huecos)**:
  - *Qué estaba mal*: El plan validaba únicamente si el centro $(x, y)$ del disco estaba dentro del contorno exterior de una placa o aplicaba el margen antiguo de Python (`1.0 mm` al centro en `viewer.py:720-733`), permitiendo que parte de un disco de radio $R = 5\text{ mm}$ saliera fuera del borde de la placa o invadiera un hueco interior, o quedara flotando sin tocar la placa superior $k+1$.
  - *Regla nueva*:
    - Documentar explícitamente la diferencia respecto a Python: en `viewer.py:720-733`, `_is_disc_inside_plate` usaba `poly.buffer(-1.0).contains(Point(x, y))` (que solo exigía que el **centro** estuviera a $\ge 1.0\text{ mm}$ del borde, independientemente del diámetro del disco). En la versión web se exige la condición geométrica exacta:
      $$\text{pointInPolygonWithHoles}(x, y, P) = \text{true} \quad \land \quad \text{distToBoundary}(x, y, P) \ge R - 10^{-5}$$
      donde $R = \text{diameter} / 2$.
    - Un disco en el hueco `gapIndex = k` es válido **sí y solo si** cabe íntegramente en algún polígono de `plates[k]` **Y** en algún polígono de `plates[k + 1]`.
    - La auto-copia al hueco `k + 1` en `addDisc` ocurre **sí y solo si** `k + 1 < plates.length - 1` y el disco también cabe íntegramente en `plates[k + 2]`.
  - *Criterio de aceptación*: En un cuadrado de $20 \times 20\text{ mm}$ centrado en $(0,0)$, un disco de diámetro $10\text{ mm}$ ($R=5\text{ mm}$) en $(0,0)$ es aceptado, pero en $(6,0)$ (centro a $4\text{ mm}$ del borde $x=10$) es rechazado. En `test_torus.stl`, un disco cuyo borde invade el agujero central es rechazado.
- **Corrección #5d (`clampDiscPositionToGap` por proyección al punto válido más cercano para arrastre fluido)**:
  - *Qué estaba mal*: Durante el arrastre de un disco en el visor 3D, si el puntero salía rápidamente fuera del margen válido ($R$ del borde), `moveDisc` simplemente rechazaba la posición y el disco se quedaba congelado lejos del borde en vez de deslizarse pegado al límite válido.
  - *Regla nueva*: Implementar `clampDiscPositionToGap(targetX, targetY, prevValidX, prevValidY, diameter, gapIndex, plates)` en `src/core/geometry2d.ts`. Cuando `(targetX, targetY)` no es directamente válido, proyecta iterativamente el punto hacia adentro de las fronteras violadas (exteriores y huecos de `plates[gapIndex]` y `plates[gapIndex + 1]`) a distancia $R + 10^{-4}\text{ mm}$, evalúa candidatos de deslizamiento axial y aplica bisección de respaldo hacia `(prevValidX, prevValidY)` en esquinas agudas.
  - *Criterio de aceptación*: Test unitario verifica que arrastrar rápidamente un disco de $d = 6\text{ mm}$ ($R = 3\text{ mm}$) desde $(0, 6.5)$ hasta $(5, 15)$ en una placa cuadrada $[-10, 10]^2$ no congela el disco en $(0, 6.5)$, sino que lo desliza suavemente a $(5, 7)$ pegado al borde válido.

##### Archivo `web/src/core/geometry2d.ts`
```ts
import type { PlateContour, Point2D, PolygonWithHoles } from '../types/sculpture';

export function signedArea2D(ring: Point2D[]): number {
  let sum = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    sum += x0 * y1 - x1 * y0;
  }
  return 0.5 * sum;
}

export function closestPointOnSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [number, number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-18) {
    return [x0, y0, Math.hypot(px - x0, py - y0)];
  }
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
  const projX = x0 + t * dx;
  const projY = y0 + t * dy;
  return [projX, projY, Math.hypot(px - projX, py - projY)];
}

export function pointToSegmentDistance(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  return closestPointOnSegment(px, py, x0, y0, x1, y1)[2];
}

export function closestPointOnRing(
  px: number,
  py: number,
  ring: Point2D[]
): [number, number, number] {
  let bestX = px;
  let bestY = py;
  let minDist = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const [qx, qy, d] = closestPointOnSegment(px, py, x0, y0, x1, y1);
    if (d < minDist) {
      minDist = d;
      bestX = qx;
      bestY = qy;
    }
  }
  return [bestX, bestY, minDist];
}

export function distanceToRing(px: number, py: number, ring: Point2D[]): number {
  return closestPointOnRing(px, py, ring)[2];
}

export function pointInRing(px: number, py: number, ring: Point2D[]): boolean {
  if (distanceToRing(px, py, ring) <= 1e-7) {
    return true;
  }
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygonWithHoles(
  px: number,
  py: number,
  poly: PolygonWithHoles
): boolean {
  if (!pointInRing(px, py, poly.exterior)) {
    return false;
  }
  for (const hole of poly.holes) {
    // Si está estrictamente dentro del hueco (no sobre el borde), está fuera del material
    if (pointInRing(px, py, hole) && distanceToRing(px, py, hole) > 1e-7) {
      return false;
    }
  }
  return true;
}

export function distanceToPolygonBoundary(
  px: number,
  py: number,
  poly: PolygonWithHoles
): number {
  let minDist = distanceToRing(px, py, poly.exterior);
  for (const hole of poly.holes) {
    const d = distanceToRing(px, py, hole);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Verifica que el disco completo de centro (x, y) y diámetro `diameter`
 * caiga íntegramente dentro del material de al menos un polígono de la placa.
 */
export function isDiscInsidePlate(
  x: number,
  y: number,
  diameter: number,
  plate: PlateContour
): boolean {
  if (!plate || plate.length === 0 || diameter <= 0) return false;
  const radius = diameter * 0.5;
  for (const poly of plate) {
    if (
      pointInPolygonWithHoles(x, y, poly) &&
      distanceToPolygonBoundary(x, y, poly) >= radius - 1e-5
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Un disco en el hueco `gapIndex` une `plates[gapIndex]` y `plates[gapIndex + 1]`.
 * Es válido sí y solo si el disco completo cabe dentro de AMBAS placas.
 */
export function isDiscValidForGap(
  x: number,
  y: number,
  diameter: number,
  gapIndex: number,
  plates: PlateContour[]
): boolean {
  if (gapIndex < 0 || gapIndex >= plates.length - 1) return false;
  const lowerPlate = plates[gapIndex];
  const upperPlate = plates[gapIndex + 1];
  if (!lowerPlate || lowerPlate.length === 0) return false;
  if (!upperPlate || upperPlate.length === 0) return false;
  return (
    isDiscInsidePlate(x, y, diameter, lowerPlate) &&
    isDiscInsidePlate(x, y, diameter, upperPlate)
  );
}

/**
 * Proyecta un punto (cx, cy) hacia adentro del polígono de `plate` que contiene
 * a (refX, refY) para que respete una distancia mínima `radius` a todos los bordes.
 */
function projectPointIntoPlate(
  cx: number,
  cy: number,
  refX: number,
  refY: number,
  radius: number,
  plate: PlateContour
): Point2D {
  const targetPoly =
    plate.find((p) => pointInPolygonWithHoles(refX, refY, p)) ?? plate[0];
  if (!targetPoly) return [cx, cy];

  let x = cx;
  let y = cy;
  const safeR = radius + 1e-4;
  const rings = [targetPoly.exterior, ...targetPoly.holes];

  // 1. Si el punto salió fuera del exterior o entró en un hueco, empujarlo al lado válido del anillo
  if (!pointInRing(x, y, targetPoly.exterior)) {
    const [qx, qy, dist] = closestPointOnRing(x, y, targetPoly.exterior);
    if (dist > 1e-9) {
      x = qx - ((x - qx) / dist) * safeR;
      y = qy - ((y - qy) / dist) * safeR;
    }
  }
  for (const hole of targetPoly.holes) {
    if (pointInRing(x, y, hole) && distanceToRing(x, y, hole) > 1e-7) {
      const [qx, qy, dist] = closestPointOnRing(x, y, hole);
      if (dist > 1e-9) {
        x = qx - ((x - qx) / dist) * safeR;
        y = qy - ((y - qy) / dist) * safeR;
      }
    }
  }

  // 2. Empujar perpendicularmente de cualquier segmento a distancia < safeR
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % n];
      const [qx, qy, dist] = closestPointOnSegment(x, y, x0, y0, x1, y1);
      if (dist < safeR) {
        let vx = x - qx;
        let vy = y - qy;
        let vLen = Math.hypot(vx, vy);
        if (vLen <= 1e-9) {
          vx = refX - qx;
          vy = refY - qy;
          vLen = Math.hypot(vx, vy);
        }
        if (vLen > 1e-9) {
          const push = safeR - dist;
          x += (vx / vLen) * push;
          y += (vy / vLen) * push;
        }
      }
    }
  }

  return [x, y];
}

/**
 * Proyecta (targetX, targetY) al punto válido más cercano dentro de la intersección
 * de `plates[gapIndex]` y `plates[gapIndex + 1]` para evitar que el disco se congele
 * al arrastrarlo rápidamente pegado al borde.
 */
export function clampDiscPositionToGap(
  targetX: number,
  targetY: number,
  prevValidX: number,
  prevValidY: number,
  diameter: number,
  gapIndex: number,
  plates: PlateContour[]
): Point2D {
  if (isDiscValidForGap(targetX, targetY, diameter, gapIndex, plates)) {
    return [targetX, targetY];
  }
  if (gapIndex < 0 || gapIndex >= plates.length - 1) {
    return [prevValidX, prevValidY];
  }

  const lowerPlate = plates[gapIndex];
  const upperPlate = plates[gapIndex + 1];
  const radius = diameter * 0.5;

  // Proyección alternante sobre ambas placas (converge en 1-4 pasos en bordes y esquinas)
  let cx = targetX;
  let cy = targetY;
  for (let iter = 0; iter < 4; iter++) {
    [cx, cy] = projectPointIntoPlate(cx, cy, prevValidX, prevValidY, radius, lowerPlate);
    [cx, cy] = projectPointIntoPlate(cx, cy, prevValidX, prevValidY, radius, upperPlate);
    if (isDiscValidForGap(cx, cy, diameter, gapIndex, plates)) {
      return [cx, cy];
    }
  }

  // Candidatos de deslizamiento axial y bisección hacia el punto proyectado o target
  const candidates: Point2D[] = [];
  if (isDiscValidForGap(targetX, prevValidY, diameter, gapIndex, plates)) {
    candidates.push([targetX, prevValidY]);
  }
  if (isDiscValidForGap(prevValidX, targetY, diameter, gapIndex, plates)) {
    candidates.push([prevValidX, targetY]);
  }

  for (const [endX, endY] of [
    [cx, cy],
    [targetX, targetY],
  ] as Point2D[]) {
    let lo = 0;
    let hi = 1;
    let bestX = prevValidX;
    let bestY = prevValidY;
    for (let step = 0; step < 12; step++) {
      const mid = 0.5 * (lo + hi);
      const mx = prevValidX + (endX - prevValidX) * mid;
      const my = prevValidY + (endY - prevValidY) * mid;
      if (isDiscValidForGap(mx, my, diameter, gapIndex, plates)) {
        bestX = mx;
        bestY = my;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    candidates.push([bestX, bestY]);
  }

  let bestCandidate: Point2D = [prevValidX, prevValidY];
  let bestDistSq = Infinity;
  for (const [px, py] of candidates) {
    if (!isDiscValidForGap(px, py, diameter, gapIndex, plates)) continue;
    const dSq = (px - targetX) * (px - targetX) + (py - targetY) * (py - targetY);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestCandidate = [px, py];
    }
  }

  return bestCandidate;
}
```

---

#### Chunk 2.2: Ensamblado de Segmentos O(n) y Unión Booleana con Clipper2 (`src/core/polygonStitcher.ts`) (Correcciones #4, #8, A2, A3, A5, A7)

- **Corrección A2 (API real de `clipper2-js@1.2.4` y `ClipType.Union`)**:
  - *Qué estaba mal*: El plan llamaba a `Clipper.booleanOpPolyTree(1, ...)` que **no existe** en `clipper2-js@1.2.4` y además pasaba `1` (`ClipType.Intersection = 1` en lugar de `ClipType.Union = 2`), lo que con `clip` vacío producía siempre una intersección vacía (todas las placas salían vacías).
  - *Regla nueva*: Importar `{ Clipper64, PolyTree64, ClipType, FillRule, Point64, Path64, Paths64, type PolyPathBase }` de `'clipper2-js'`. Instanciar `new Clipper64()`, llamar `clipper.addSubjectPaths(subjectPaths)` y `clipper.executePolyTree(ClipType.Union, FillRule.NonZero, polyTree)`. Recorrer recursivamente `polyTree.children` verificando `node.isHole` y extrayendo `node.polygon`.
  - *Criterio de aceptación*: Test unitario ejecuta `stitchAndUnionSegments` sobre los segmentos de `test_l_block.obj` y obtiene polígonos con área idéntica a `web/golden/l_block_slice_z.json`.
- **Corrección A3 (`FillRule.NonZero` con segmentos dirigidos por la normal del triángulo)**:
  - *Qué estaba mal*: `FillRule.EvenOdd` hacía XOR sobre regiones superpuestas en modelos multi-objeto (OBJ/3MF), dejando huecos falsos en la intersección, y afirmaba erróneamente que `EvenOdd` equivale a `shapely.make_valid`.
  - *Regla nueva*: Orientar cada segmento de corte $(\mathbf{p}_{\text{start}} \to \mathbf{p}_{\text{end}})$ de forma que la normal del triángulo $\mathbf{n} = (\mathbf{v}_1 - \mathbf{v}_0) \times (\mathbf{v}_2 - \mathbf{v}_0)$ apunte hacia la derecha del segmento dirigido:
    $$(\mathbf{p}_{\text{end}} - \mathbf{p}_{\text{start}}) \times \mathbf{n}_{xy} < 0 \implies \text{invertir } (\mathbf{p}_{\text{start}}, \mathbf{p}_{\text{end}})$$
    De esta manera todo contorno exterior queda orientado en sentido antihorario (CCW, área positiva) y todo hueco interior queda en sentido horario (CW, área negativa), permitiendo usar `FillRule.NonZero`.
  - *Criterio de aceptación*: Dos cubos solapados parcialmente producen `1` único polígono exterior sin huecos interiores; un sólido con cavidad que contiene una isla que contiene otra cavidad preserva los 3 niveles de anidación.
- **Corrección #4 + A5 (Unión de cadenas abiertas por hash espacial de radio `MAX_REPAIR_GAP_MM` antes de decidir cierre o descarte)**:
  - *Qué estaba mal*: Si un lazo cerrado de 100 segmentos tenía una micro-brecha de $0.01\text{ mm}$ en el segmento 50 y el recorrido comenzaba en el segmento 0, se generaban dos cadenas abiertas (`0..50` y `50..100`) cuyos extremos propios distaban mucho más que `MAX_REPAIR_GAP_MM`, provocando que **ambas** cadenas se descartaran en lugar de unirse entre sí.
  - *Regla nueva*:
    1. Construir cadenas iniciales por adyacencia topológica (`SNAP_TOLERANCE = 1e-3 mm`). Las que cierran exactamente (`currVertex === startVertex`) pasan directo a `closedLoops`; las demás se guardan en `openChains`.
    2. **Paso de fusión entre cadenas abiertas**: Indexar los vértices de inicio (`head`) de todas las `openChains` activas en un hash espacial 2D de celda `MAX_REPAIR_GAP_MM` (`0.05 mm`). Mientras haya fusiones posibles, buscar para el final (`tail`) de cada cadena abierta otra cadena activa cuyo `head` esté en las $3 \times 3$ celdas vecinas a distancia $\le \text{MAX\_REPAIR\_GAP\_MM}$. Si la distancia puenteada es $> \text{SNAP\_TOLERANCE}$, incrementar `openChainsRepaired`. Concatenar ambas cadenas; si tras concatenar el nuevo `tail` coincide con su propio `head`, cerrar el lazo y moverlo a `closedLoops`.
    3. **Decisión final de cierre o descarte**: Para cada cadena que siga abierta tras las fusiones, medir `gapDist = hypot(tail.x - head.x, tail.y - head.y)`:
       - Si `gapDist <= MAX_REPAIR_GAP_MM` (`0.05 mm`) y tiene $\ge 3$ vértices, cerrar el lazo (incrementando `openChainsRepaired` si `gapDist > SNAP_TOLERANCE`).
       - Si `gapDist > MAX_REPAIR_GAP_MM`, **descartar la cadena abierta** (prohibido cerrarla con una diagonal) e incrementar `openChainsDiscarded`.
  - *Criterio de aceptación*:
    1. Un lazo de 100 segmentos con una brecha de $0.01\text{ mm}$ en el segmento 50 produce exactamente `1` lazo reparado y `openChainsRepaired === 1` (`openChainsDiscarded === 0`), **sea cual sea el segmento de arranque (`0..99`)**.
    2. Un cubo sin una cara lateral (brecha $> 0.05\text{ mm}$) descarta la cadena abierta (`openChainsDiscarded === 1`).
- **Corrección #8 + A7 (Hash espacial 2D $O(n)$, regla determinista para vértices de grado $> 2$ y umbral unificado de benchmark `< 50 ms`)**:
  - *Qué estaba mal*: El documento tenía una discrepancia de umbral (`< 25 ms` en Chunk 2.2 vs `< 50 ms` en tests) y trataba los tests de tiempo como aserciones bloqueantes sensibles a la carga de CPU en CI.
  - *Regla nueva*: Unificar el objetivo de referencia del stitcher con `10,000` segmentos en **`< 50 ms`** en todo el documento y marcar todos los tests de tiempo como **benchmarks informativos no bloqueantes** (`describe.skipIf(process.env.CI === 'true')` o registro de métrica sin romper el build por fluctuaciones de reloj).
  - *Criterio de aceptación*: Benchmark con `10,000` segmentos registra el tiempo con meta `< 50 ms` como benchmark no bloqueante.

##### Archivo `web/src/core/polygonStitcher.ts`
```ts
import {
  Clipper64,
  PolyTree64,
  ClipType,
  FillRule,
  Point64,
  Path64,
  Paths64,
  type PolyPathBase,
} from 'clipper2-js';
import { signedArea2D } from './geometry2d';
import type { Point2D, PolygonWithHoles } from '../types/sculpture';

export interface DirectedSegment2D {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface StitchFloorResult {
  polygons: PolygonWithHoles[];
  openChainsDiscarded: number;
  openChainsRepaired: number;
}

const SNAP_TOLERANCE = 1e-3;       // 0.001 mm
const MAX_REPAIR_GAP_MM = 0.05;    // 0.05 mm máxima micro-brecha reparable
const CLIPPER_SCALE = 100_000;     // Precisión 1e-5 mm en enteros de Clipper64
const MIN_POLYGON_AREA_MM2 = 1e-3; // Igual que slicer.py:296 (poly.area >= 1e-3)

interface VertexNode {
  x: number;
  y: number;
  outEdges: number[];
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * Une segmentos dirigidos en lazos cerrados en tiempo O(n) usando hash espacial 2D,
 * fusiona cadenas abiertas cuyos extremos (tail -> head) disten <= MAX_REPAIR_GAP_MM
 * independientemente del segmento de arranque, y ejecuta Clipper64.executePolyTree
 * con ClipType.Union y FillRule.NonZero.
 */
export function stitchAndUnionSegments(
  segments: DirectedSegment2D[]
): StitchFloorResult {
  if (segments.length === 0) {
    return { polygons: [], openChainsDiscarded: 0, openChainsRepaired: 0 };
  }

  const invCell = 1.0 / SNAP_TOLERANCE;
  const grid = new Map<string, number[]>();
  const vertices: VertexNode[] = [];
  const tolSq = SNAP_TOLERANCE * SNAP_TOLERANCE;

  function getOrCreateVertex(x: number, y: number): number {
    const cx = Math.floor(x * invCell);
    const cy = Math.floor(y * invCell);

    let bestIdx = -1;
    let bestDistSq = tolSq;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(cellKey(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const vIdx of bucket) {
          const v = vertices[vIdx];
          const dSq = (v.x - x) * (v.x - x) + (v.y - y) * (v.y - y);
          if (dSq <= bestDistSq) {
            bestDistSq = dSq;
            bestIdx = vIdx;
          }
        }
      }
    }

    if (bestIdx !== -1) {
      return bestIdx;
    }

    const newIdx = vertices.length;
    vertices.push({ x, y, outEdges: [] });
    const key = cellKey(cx, cy);
    const bucket = grid.get(key);
    if (bucket) bucket.push(newIdx);
    else grid.set(key, [newIdx]);
    return newIdx;
  }

  interface Edge {
    from: number;
    to: number;
    dx: number;
    dy: number;
    used: boolean;
  }

  const edges: Edge[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    if (dx * dx + dy * dy <= 1e-16) continue;
    const u = getOrCreateVertex(s.x0, s.y0);
    const v = getOrCreateVertex(s.x1, s.y1);
    if (u === v) continue;
    const edgeIdx = edges.length;
    edges.push({ from: u, to: v, dx, dy, used: false });
    vertices[u].outEdges.push(edgeIdx);
  }

  // Elegir la siguiente arista saliente no usada de forma determinista (giro más a la derecha)
  function pickNextEdge(currVertex: number, inDx: number, inDy: number): number {
    const outList = vertices[currVertex].outEdges;
    let availableCount = 0;
    let singleCandidate = -1;
    for (const eIdx of outList) {
      if (!edges[eIdx].used) {
        availableCount++;
        singleCandidate = eIdx;
      }
    }
    if (availableCount === 0) return -1;
    if (availableCount === 1) return singleCandidate;

    const baseAngle = Math.atan2(-inDy, -inDx);
    let bestEdge = -1;
    let bestDelta = Infinity;

    for (const eIdx of outList) {
      const e = edges[eIdx];
      if (e.used) continue;
      let delta = Math.atan2(e.dy, e.dx) - baseAngle;
      while (delta <= 0) delta += Math.PI * 2;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestEdge = eIdx;
      }
    }
    return bestEdge;
  }

  const closedLoops: Point2D[][] = [];
  const openChains: number[][] = [];
  let openChainsDiscarded = 0;
  let openChainsRepaired = 0;

  // 1. Construir cadenas por conectividad exacta (SNAP_TOLERANCE)
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;

    const startEdge = edges[i];
    startEdge.used = true;
    const startVertex = startEdge.from;
    let currVertex = startEdge.to;
    let prevDx = startEdge.dx;
    let prevDy = startEdge.dy;

    const chainVertices: number[] = [startVertex, currVertex];

    while (currVertex !== startVertex) {
      const nextEdgeIdx = pickNextEdge(currVertex, prevDx, prevDy);
      if (nextEdgeIdx === -1) break;
      const nextEdge = edges[nextEdgeIdx];
      nextEdge.used = true;
      currVertex = nextEdge.to;
      prevDx = nextEdge.dx;
      prevDy = nextEdge.dy;
      chainVertices.push(currVertex);
    }

    if (currVertex === startVertex) {
      chainVertices.pop(); // Quitar el vértice repetido de cierre
      if (chainVertices.length >= 3) {
        closedLoops.push(chainVertices.map((vi) => [vertices[vi].x, vertices[vi].y]));
      }
    } else {
      openChains.push(chainVertices);
    }
  }

  // 2. Unir el final (tail) de una cadena abierta con el inicio (head) de otra
  //    usando un hash espacial 2D con radio MAX_REPAIR_GAP_MM antes de decidir cierre o descarte
  if (openChains.length > 0) {
    const active = new Uint8Array(openChains.length);
    active.fill(1);
    const invRepairCell = 1.0 / MAX_REPAIR_GAP_MM;
    const maxGapSq = MAX_REPAIR_GAP_MM * MAX_REPAIR_GAP_MM;

    let mergedAny = true;
    while (mergedAny) {
      mergedAny = false;

      // Construir hash espacial de los heads de cadenas abiertas activas
      const headGrid = new Map<string, number[]>();
      for (let cIdx = 0; cIdx < openChains.length; cIdx++) {
        if (!active[cIdx]) continue;
        const headV = vertices[openChains[cIdx][0]];
        const hx = Math.floor(headV.x * invRepairCell);
        const hy = Math.floor(headV.y * invRepairCell);
        const key = cellKey(hx, hy);
        const bucket = headGrid.get(key);
        if (bucket) bucket.push(cIdx);
        else headGrid.set(key, [cIdx]);
      }

      for (let i = 0; i < openChains.length; i++) {
        if (!active[i]) continue;
        const chainA = openChains[i];
        const tailIdx = chainA[chainA.length - 1];
        const tailV = vertices[tailIdx];
        const tx = Math.floor(tailV.x * invRepairCell);
        const ty = Math.floor(tailV.y * invRepairCell);

        let bestOther = -1;
        let bestDistSq = maxGapSq;

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const bucket = headGrid.get(cellKey(tx + dx, ty + dy));
            if (!bucket) continue;
            for (const j of bucket) {
              if (j === i || !active[j]) continue;
              const headV = vertices[openChains[j][0]];
              const dSq =
                (tailV.x - headV.x) * (tailV.x - headV.x) +
                (tailV.y - headV.y) * (tailV.y - headV.y);
              if (dSq <= bestDistSq) {
                bestDistSq = dSq;
                bestOther = j;
              }
            }
          }
        }

        if (bestOther !== -1) {
          const chainB = openChains[bestOther];
          const bridgeDist = Math.sqrt(bestDistSq);
          if (bridgeDist > SNAP_TOLERANCE) {
            openChainsRepaired++;
          }
          if (tailIdx === chainB[0]) {
            for (let k = 1; k < chainB.length; k++) {
              chainA.push(chainB[k]);
            }
          } else {
            for (let k = 0; k < chainB.length; k++) {
              chainA.push(chainB[k]);
            }
          }
          active[bestOther] = 0;
          mergedAny = true;

          // Si tras fusionar la cadena cierra exactamente sobre su propio head
          if (chainA[chainA.length - 1] === chainA[0]) {
            chainA.pop();
            if (chainA.length >= 3) {
              closedLoops.push(chainA.map((vi) => [vertices[vi].x, vertices[vi].y]));
            }
            active[i] = 0;
          }
          break; // Reconstruir headGrid y continuar
        }
      }
    }

    // 3. Evaluar cierre o descarte para las cadenas abiertas restantes
    for (let i = 0; i < openChains.length; i++) {
      if (!active[i]) continue;
      const chain = openChains[i];
      const firstV = vertices[chain[0]];
      const lastV = vertices[chain[chain.length - 1]];
      const gapDist = Math.hypot(lastV.x - firstV.x, lastV.y - firstV.y);

      if (chain.length >= 3 && gapDist <= MAX_REPAIR_GAP_MM) {
        if (gapDist > SNAP_TOLERANCE) {
          openChainsRepaired++;
        }
        closedLoops.push(chain.map((vi) => [vertices[vi].x, vertices[vi].y]));
      } else {
        openChainsDiscarded++;
      }
    }
  }

  if (closedLoops.length === 0) {
    return { polygons: [], openChainsDiscarded, openChainsRepaired };
  }

  const subjectPaths = new Paths64();
  for (const loop of closedLoops) {
    const path = new Path64();
    for (const [x, y] of loop) {
      path.push(
        new Point64(
          Math.round(x * CLIPPER_SCALE),
          Math.round(y * CLIPPER_SCALE)
        )
      );
    }
    subjectPaths.push(path);
  }

  const clipper = new Clipper64();
  clipper.preserveCollinear = false;
  clipper.addSubjectPaths(subjectPaths);

  const polyTree = new PolyTree64();
  clipper.executePolyTree(ClipType.Union, FillRule.NonZero, polyTree);

  const resultPolygons: PolygonWithHoles[] = [];
  const invScale = 1.0 / CLIPPER_SCALE;

  function toRing2D(path: Path64, wantCCW: boolean): Point2D[] {
    const ring: Point2D[] = path.map((pt) => [pt.x * invScale, pt.y * invScale]);
    const area = signedArea2D(ring);
    if ((wantCCW && area < 0) || (!wantCCW && area > 0)) {
      ring.reverse();
    }
    return ring;
  }

  function traverseNode(node: PolyPathBase): void {
    for (const child of node.children) {
      if (!child.isHole && child.polygon && child.polygon.length >= 3) {
        const exterior = toRing2D(child.polygon, true); // Exterior siempre CCW
        const holes: Point2D[][] = [];
        let holeAreaSum = 0;

        for (const holeNode of child.children) {
          if (holeNode.isHole && holeNode.polygon && holeNode.polygon.length >= 3) {
            const holeRing = toRing2D(holeNode.polygon, false); // Hueco siempre CW
            holes.push(holeRing);
            holeAreaSum += Math.abs(signedArea2D(holeRing));

            // Islas dentro del hueco son nuevos polígonos exteriores (anidación profunda)
            traverseNode(holeNode);
          }
        }

        const extArea = Math.abs(signedArea2D(exterior));
        const netArea = extArea - holeAreaSum;
        if (netArea >= MIN_POLYGON_AREA_MM2) {
          resultPolygons.push({
            exterior,
            holes,
            area: netArea,
          });
        }
      }
    }
  }

  traverseNode(polyTree);

  // Ordenar de mayor a menor área para estabilidad determinista
  resultPolygons.sort((a, b) => b.area - a.area);

  return {
    polygons: resultPolygons,
    openChainsDiscarded,
    openChainsRepaired,
  };
}
```

---

#### Chunk 2.3: Motor de Slicing Puro con Cache por Eje y Web Worker Delgado (`src/core/slicer.ts` y `src/worker/slicer.worker.ts`) (Correcciones A6, A8, B1, B2, B3)

- **Corrección A6 (Intersección plano-triángulo determinista con orden canónico de aristas)**:
  - *Qué estaba mal*: El plan no especificaba qué ocurría cuando un vértice caía exactamente en `z === zCut` o una arista era coplanar, y calculaba la interpolación lineal de la arista en distinto orden según cada triángulo vecino, produciendo errores de punto flotante (`1e-16`) distintos para el mismo vértice compartido.
  - *Regla nueva*:
    1. Clasificar cada vértice del triángulo con la regla semi-abierta determinista **`above = (z >= zCut)`** (arriba si `z >= zCut`, abajo si `z < zCut`).
    2. Si los 3 vértices están `above` (incluso si 1 o 2 tocan `z === zCut` desde arriba, o el triángulo es coplanar con `z === zCut`) o los 3 están `!above`, el triángulo produce **0 segmentos** (evitando duplicar aristas coplanares).
    3. Exactamente 2 aristas cruzan entre un vértice `above` y un vértice `!above`. Para calcular el punto de cruce entre dos vértices $\mathbf{a}$ y $\mathbf{b}$, **ordenar primero canónicamente** $(\mathbf{p}_{\min}, \mathbf{p}_{\max})$ por $(z, x, y)$ antes de evaluar $t = (z_{\text{cut}} - z_{\min}) / (z_{\max} - z_{\min})$. Así dos triángulos adyacentes que comparten la misma arista evalúan los **mismos operandos IEEE-754 en el mismo orden** y producen un punto bit-a-bit idéntico.
    4. Orientar el segmento $(\mathbf{p}_0 \to \mathbf{p}_1)$ usando el producto cruz con la normal del triángulo para garantizar contornos CCW y huecos CW.
  - *Criterio de aceptación*: Tests unitarios cubren: vértice exactamente sobre `zCut`, arista horizontal exactamente en `zCut`, triángulo coplanar en `zCut`, y coincidencia exacta con `web/golden/l_block_slice_z.json`.
- **Corrección A8 (Equivalencia matemática 1:1 con `slicer.py`)**:
  - *Qué estaba mal*: Las rotaciones de eje X e Y estaban sin verificar contra `slicer.py` y centraban usando el promedio de vértices en vez del centro del bounding box.
  - *Regla nueva*: Aplicar las transformaciones exactas verificadas en la Sección `0.2`:
    - `axis === 'x'` $\implies (x', y', z') = (-z, y, x)$.
    - `axis === 'y'` $\implies (x', y', z') = (x, -z, y)$.
    - `axis === 'z'` $\implies (x', y', z') = (x, y, z)$.
    - Centrar restando `0.5 * (min + max)` del bounding box de la malla rotada.
  - *Criterio de aceptación*: Test unitario compara `sliceMesh` sobre `test_l_block.obj` en los ejes `z`, `x` e `y` contra `l_block_slice_z.json`, `l_block_slice_x.json` y `l_block_slice_y.json` con diferencia de área $< 0.01\%$ y bounding boxes a $< 10^{-4}\text{ mm}$.
- **Corrección B1, B2, B3 (Extracción de `sliceMesh` puro, cache por eje con Z-Bucketing y no transferencia de buffers cacheados)**:
  - *Qué estaba mal*: Toda la lógica vivía dentro de `self.onmessage` en `slicer.worker.ts` (imposible de testear directamente en Vitest), el plan afirmaba que cambiar de eje no tocaba la malla y que el corte tardaba `< 1 ms`, y proponía transferir el buffer dejando un `detached ArrayBuffer` en el segundo corte.
  - *Regla nueva*:
    1. Extraer toda la matemática a `src/core/slicer.ts` (`AxisSliceCache` y `sliceMesh`), dejando `src/worker/slicer.worker.ts` como un wrapper de 45 líneas.
    2. `AxisSliceCache` rota y centra los vértices **en coordenadas unitarias pre-autoScale** (`zMin = -0.5 * origHeight`, `zMax = +0.5 * origHeight`) y construye una tabla de **Z-Buckets** (`NUM_Z_BUCKETS = 128`) una sola vez por eje usado (`cacheByAxis: Partial<Record<Axis, AxisSliceCache>>`).
    3. Cuando el usuario cambia `plates`, `thickness` o `gap` en el mismo eje, **no se rota ni reconstruye la malla**: se corta la malla cacheada en `zUnit = zCut / scaleFactor` filtrando solo los triángulos del bucket correspondiente y se multiplican los puntos 2D resultantes por `scaleFactor`.
    4. Al enviar la geometría al worker en `SET_MESH`, se transfiere un clon dedicado (`positions.slice().buffer`), nunca el buffer del `BufferAttribute` vivo de Three.js.
  - *Criterio de aceptación*: Benchmark en Vitest sobre malla sintética de `500,000` triángulos verifica que construir el `AxisSliceCache` e intersectar 20 planos se ejecuta sin bloquear y que cambiar `plates`/`thickness`/`gap` reutiliza el cache del eje activo.

##### Archivo `web/src/core/slicer.ts`
```ts
import { validateParams, ValidationError } from './validator';
import { stitchAndUnionSegments, type DirectedSegment2D } from './polygonStitcher';
import type {
  Axis,
  PlateContour,
  Point2D,
  SculptureParams,
  SliceResult,
  SliceWarning,
} from '../types/sculpture';

const NUM_Z_BUCKETS = 128;

export function computeCutPositions(
  plates: number,
  thickness: number,
  gap: number
): { totalHeight: number; zPositions: number[] } {
  const step = thickness + gap;
  const totalHeight = plates * thickness + (plates - 1) * gap;
  const zMin = -totalHeight / 2.0;
  const zPositions: number[] = [];
  for (let i = 0; i < plates; i++) {
    zPositions.push(zMin + i * step + thickness / 2.0);
  }
  return { totalHeight, zPositions };
}

/**
 * Cache de geometría rotada, centrada en su bounding box y particionada en Z-buckets
 * para un eje específico ('x', 'y' o 'z') ANTES de aplicar scaleFactor.
 */
export class AxisSliceCache {
  readonly axis: Axis;
  readonly triCount: number;
  readonly coords: Float32Array;   // 9 floats por triángulo (x0,y0,z0, x1,y1,z1, x2,y2,z2)
  readonly normalsXY: Float32Array; // 2 floats por triángulo (nx, ny) de (v1-v0)x(v2-v0)
  readonly triMinZ: Float32Array;
  readonly triMaxZ: Float32Array;
  readonly buckets: Int32Array[];
  readonly boundsMin: [number, number, number];
  readonly boundsMax: [number, number, number];
  readonly origHeight: number;

  constructor(rawPositions: Float32Array, axis: Axis) {
    this.axis = axis;
    this.triCount = Math.floor(rawPositions.length / 9);
    if (this.triCount < 4) {
      throw new ValidationError('La malla tiene menos de 4 triángulos.');
    }

    const rotated = new Float32Array(this.triCount * 9);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    // 1. Rotar para alinear el eje elegido con +Z (idéntico a slicer.py:134-156)
    const nVerts = this.triCount * 3;
    for (let i = 0; i < nVerts; i++) {
      const rx = rawPositions[i * 3];
      const ry = rawPositions[i * 3 + 1];
      const rz = rawPositions[i * 3 + 2];
      let x: number, y: number, z: number;
      if (axis === 'x') {
        // trimesh.transformations.rotation_matrix(-pi/2, [0, 1, 0])
        x = -rz;
        y = ry;
        z = rx;
      } else if (axis === 'y') {
        // trimesh.transformations.rotation_matrix(+pi/2, [1, 0, 0])
        x = rx;
        y = -rz;
        z = ry;
      } else {
        x = rx;
        y = ry;
        z = rz;
      }
      rotated[i * 3] = x;
      rotated[i * 3 + 1] = y;
      rotated[i * 3 + 2] = z;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    // 2. Centrar en el origen usando bounds.mean(axis=0) (idéntico a slicer.py:159)
    const cx = 0.5 * (minX + maxX);
    const cy = 0.5 * (minY + maxY);
    const cz = 0.5 * (minZ + maxZ);

    for (let i = 0; i < nVerts; i++) {
      rotated[i * 3] -= cx;
      rotated[i * 3 + 1] -= cy;
      rotated[i * 3 + 2] -= cz;
    }

    this.boundsMin = [minX - cx, minY - cy, minZ - cz];
    this.boundsMax = [maxX - cx, maxY - cy, maxZ - cz];
    this.origHeight = this.boundsMax[2] - this.boundsMin[2];
    if (this.origHeight < 1e-6) {
      throw new ValidationError(
        `La malla tiene altura 0 en el eje '${axis.toUpperCase()}'.`
      );
    }

    this.coords = rotated;
    this.normalsXY = new Float32Array(this.triCount * 2);
    this.triMinZ = new Float32Array(this.triCount);
    this.triMaxZ = new Float32Array(this.triCount);

    const bucketLists: number[][] = Array.from({ length: NUM_Z_BUCKETS }, () => []);
    const zStart = this.boundsMin[2];
    const invSpan = NUM_Z_BUCKETS / this.origHeight;

    for (let t = 0; t < this.triCount; t++) {
      const base = t * 9;
      const x0 = rotated[base], y0 = rotated[base + 1], z0 = rotated[base + 2];
      const x1 = rotated[base + 3], y1 = rotated[base + 4], z1 = rotated[base + 5];
      const x2 = rotated[base + 6], y2 = rotated[base + 7], z2 = rotated[base + 8];

      // Normal del triángulo n = (v1 - v0) x (v2 - v0)
      const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0;
      const vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
      this.normalsXY[t * 2] = uy * vz - uz * vy;
      this.normalsXY[t * 2 + 1] = uz * vx - ux * vz;

      const tMin = Math.min(z0, z1, z2);
      const tMax = Math.max(z0, z1, z2);
      this.triMinZ[t] = tMin;
      this.triMaxZ[t] = tMax;

      const b0 = Math.max(
        0,
        Math.min(NUM_Z_BUCKETS - 1, Math.floor((tMin - zStart) * invSpan))
      );
      const b1 = Math.max(
        0,
        Math.min(NUM_Z_BUCKETS - 1, Math.floor((tMax - zStart) * invSpan))
      );
      for (let b = b0; b <= b1; b++) {
        bucketLists[b].push(t);
      }
    }

    this.buckets = bucketLists.map((arr) => Int32Array.from(arr));
  }

  /**
   * Intersecta todos los triángulos que cruzan `zUnit` (en coordenadas pre-escala)
   * y multiplica los segmentos 2D resultantes por `scaleFactor`.
   */
  extractSegmentsAtZ(zUnit: number, scaleFactor: number): DirectedSegment2D[] {
    const zStart = this.boundsMin[2];
    const bucketIdx = Math.max(
      0,
      Math.min(
        NUM_Z_BUCKETS - 1,
        Math.floor(((zUnit - zStart) / this.origHeight) * NUM_Z_BUCKETS)
      )
    );
    const candidates = this.buckets[bucketIdx];
    const segments: DirectedSegment2D[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const t = candidates[i];
      // Con la regla above = (z >= zUnit), si triMaxZ < zUnit (todos abajo)
      // o triMinZ >= zUnit (todos arriba, incluyendo triángulos coplanares o que solo tocan desde arriba),
      // no hay cruce.
      if (this.triMaxZ[t] < zUnit || this.triMinZ[t] >= zUnit) {
        continue;
      }

      const base = t * 9;
      const vx = [this.coords[base], this.coords[base + 3], this.coords[base + 6]];
      const vy = [
        this.coords[base + 1],
        this.coords[base + 4],
        this.coords[base + 7],
      ];
      const vz = [
        this.coords[base + 2],
        this.coords[base + 5],
        this.coords[base + 8],
      ];
      const above = [vz[0] >= zUnit, vz[1] >= zUnit, vz[2] >= zUnit];

      const ptsX: number[] = [];
      const ptsY: number[] = [];

      for (let e = 0; e < 3; e++) {
        const a = e;
        const b = (e + 1) % 3;
        if (above[a] === above[b]) continue;

        // Orden canónico (pMin, pMax) por (z, x, y) para que triángulos adyacentes
        // evalúen los mismos operandos IEEE-754 en el mismo orden.
        let iMin = a;
        let iMax = b;
        if (
          vz[a] > vz[b] ||
          (vz[a] === vz[b] &&
            (vx[a] > vx[b] || (vx[a] === vx[b] && vy[a] > vy[b])))
        ) {
          iMin = b;
          iMax = a;
        }

        const zA = vz[iMin];
        const zB = vz[iMax];
        const dz = zB - zA;
        const alpha = dz === 0 ? 0 : (zUnit - zA) / dz;
        const ix = (vx[iMin] + alpha * (vx[iMax] - vx[iMin])) * scaleFactor;
        const iy = (vy[iMin] + alpha * (vy[iMax] - vy[iMin])) * scaleFactor;
        ptsX.push(ix);
        ptsY.push(iy);
      }

      if (ptsX.length !== 2) continue;

      let x0 = ptsX[0], y0 = ptsY[0];
      let x1 = ptsX[1], y1 = ptsY[1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (dx * dx + dy * dy <= 1e-16) continue;

      // Orientar el segmento para que la normal exterior quede a la derecha
      // y el interior sólido quede a la izquierda (contornos exteriores CCW, huecos CW):
      // det([d, n_xy]) = dx * ny - dy * nx < 0
      const nx = this.normalsXY[t * 2];
      const ny = this.normalsXY[t * 2 + 1];
      if (dx * ny - dy * nx > 0) {
        const tx = x0, ty = y0;
        x0 = x1; y0 = y1;
        x1 = tx; y1 = ty;
      }

      segments.push({ x0, y0, x1, y1 });
    }

    return segments;
  }
}

export function sliceMeshFromCache(
  cache: AxisSliceCache,
  params: SculptureParams
): SliceResult {
  validateParams(params);
  const { totalHeight, zPositions } = computeCutPositions(
    params.plates,
    params.thickness,
    params.gap
  );

  const scaleFactor = totalHeight / cache.origHeight;
  const plates: PlateContour[] = new Array(params.plates);
  const warnings: SliceWarning[] = [];

  for (let i = 0; i < params.plates; i++) {
    const zCut = zPositions[i];
    const zUnit = zCut / scaleFactor;
    const segments = cache.extractSegmentsAtZ(zUnit, scaleFactor);
    const stitched = stitchAndUnionSegments(segments);
    plates[i] = stitched.polygons;

    if (stitched.openChainsDiscarded > 0 || stitched.openChainsRepaired > 0) {
      warnings.push({
        floorIndex: i,
        openChainsDiscarded: stitched.openChainsDiscarded,
        openChainsRepaired: stitched.openChainsRepaired,
        message: `Piso ${i}: ${stitched.openChainsDiscarded} cadena(s) abierta(s) descartada(s), ${stitched.openChainsRepaired} micro-brecha(s) cerrada(s).`,
      });
    }
  }

  const scaledBounds: [Point2D, Point2D] = [
    [cache.boundsMin[0] * scaleFactor, cache.boundsMin[1] * scaleFactor],
    [cache.boundsMax[0] * scaleFactor, cache.boundsMax[1] * scaleFactor],
  ];

  return {
    plates,
    zPositions,
    scaleFactor,
    scaledBounds,
    scaledHeight: totalHeight,
    warnings,
  };
}

/**
 * Función pura síncrona para tests y uso directo sin Web Worker.
 */
export function sliceMesh(
  rawPositions: Float32Array,
  params: SculptureParams
): SliceResult {
  validateParams(params);
  const cache = new AxisSliceCache(rawPositions, params.axis);
  return sliceMeshFromCache(cache, params);
}
```

##### Archivo `web/src/worker/slicer.worker.ts`
```ts
import { AxisSliceCache, sliceMeshFromCache } from '../core/slicer';
import type { Axis, WorkerRequest, WorkerResponse } from '../types/sculpture';

let currentMeshId = -1;
let rawPositions: Float32Array | null = null;
let axisCaches: Partial<Record<Axis, AxisSliceCache>> = {};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

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
  }
};
```

---

### FASE 3: Gestor de Discos, Persistencia JSON y Validación de Huérfanos

#### Chunk 3.1: Gestor de Discos con Validación Geométrica, Reescalado y Undo/Redo (`src/core/discs.ts`) (Correcciones #0, #5c, A4, B5, B13, B14)

- **Corrección #0 + #5c + A4 + B13 + B14 (Default `6.0 mm`, reescalado por `newAutoScale / oldAutoScale`, y validación en `addDisc`, `moveDisc`, `setDiameter` y `purgeInvalidDiscs`)**:
  - *Qué estaba mal*: El diámetro por defecto en `DiscManager` era `10.0` en vez de `6.0` (`params.py:28` / `discs.py:25`); al cambiar `plates`, `thickness` o `gap` (lo que cambia `scaleFactor` / `autoScale`), no se reescalaban las coordenadas `(x, y)` de los discos por `newAutoScale / oldAutoScale` antes de `purgeInvalidDiscs`, provocando que discos válidos se desplazaran respecto a las placas reescaladas o se eliminaran erróneamente.
  - *Regla nueva*:
    1. Inicializar `defaultDiameter = DEFAULT_PARAMS.discDiameter` (`6.0 mm`).
    2. `addDisc(x, y, gapIndex, plates, diameter?, autoCopyNext = true)`: valida `isDiscValidForGap(x, y, d, gapIndex, plates)`. Si es válido y `autoCopyNext === true`, solo copia al hueco `gapIndex + 1` si `isDiscValidForGap(x, y, d, gapIndex + 1, plates)` es verdadero.
    3. `setDiameter(discId, newDiameter, plates)`: verifica primero que el nuevo diámetro quepa en `plates[disc.gapIndex]` y `plates[disc.gapIndex + 1]`.
    4. `rescalePositions(scaleRatio)`: multiplica `(x, y)` de cada disco por `scaleRatio = newAutoScale / oldAutoScale` (manteniendo `d.diameter` en mm físicos) antes de invocar `purgeInvalidDiscs(plates)`.
    5. `purgeInvalidDiscs(plates)`: filtra todos los discos verificando `isDiscValidForGap` y devuelve cuántos discos huérfanos fueron retirados.
  - *Criterio de aceptación*: Tests en `discs.test.ts` verifican `defaultDiameter === 6.0`, `addDisc`, auto-copia condicional a `plates[k+2]`, rechazo de `setDiameter` cuando excede el borde, `rescalePositions(newAutoScale / oldAutoScale)` seguido de `purgeInvalidDiscs`, y límite de `MAX_HISTORY = 50` en Undo/Redo.

##### Archivo `web/src/core/discs.ts`
```ts
import { isDiscInsidePlate, isDiscValidForGap } from './geometry2d';
import { DEFAULT_PARAMS, PARAM_BOUNDS } from './params';
import { ValidationError } from './validator';
import type { Disc, PlateContour } from '../types/sculpture';

export const MAX_HISTORY = 50;

export interface AddDiscOutcome {
  primary: Disc;
  autoCopied: Disc | null;
}

export class DiscManager {
  private discs: Disc[] = [];
  private nextId = 1;
  private defaultDiameter: number;
  private undoStack: Disc[][] = [];
  private redoStack: Disc[][] = [];

  constructor(defaultDiameter = DEFAULT_PARAMS.discDiameter) {
    this.defaultDiameter = defaultDiameter;
  }

  private cloneDiscs(list: Disc[] = this.discs): Disc[] {
    return list.map((d) => ({ ...d }));
  }

  saveSnapshot(): void {
    this.undoStack.push(this.cloneDiscs());
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this.cloneDiscs());
    this.discs = this.undoStack.pop()!;
    return true;
  }

  redo(): boolean {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this.cloneDiscs());
    this.discs = this.redoStack.pop()!;
    return true;
  }

  getDefaultDiameter(): number {
    return this.defaultDiameter;
  }

  setDefaultDiameter(diameter: number): void {
    if (
      !Number.isFinite(diameter) ||
      diameter < PARAM_BOUNDS.discDiameter.min ||
      diameter > PARAM_BOUNDS.discDiameter.max
    ) {
      throw new ValidationError(
        `El diámetro por defecto debe estar entre ${PARAM_BOUNDS.discDiameter.min} y ${PARAM_BOUNDS.discDiameter.max} mm.`
      );
    }
    this.defaultDiameter = diameter;
  }

  getAllDiscs(): Disc[] {
    return this.cloneDiscs();
  }

  getDiscsForGap(gapIndex: number): Disc[] {
    return this.discs.filter((d) => d.gapIndex === gapIndex).map((d) => ({ ...d }));
  }

  getDiscsForPlate(plateIndex: number): Disc[] {
    return this.discs
      .filter((d) => d.gapIndex === plateIndex || d.gapIndex === plateIndex - 1)
      .map((d) => ({ ...d }));
  }

  addDisc(
    x: number,
    y: number,
    gapIndex: number,
    plates: PlateContour[],
    diameter?: number,
    autoCopyNext = true
  ): AddDiscOutcome {
    const d = diameter ?? this.defaultDiameter;
    if (gapIndex < 0 || gapIndex >= plates.length - 1) {
      throw new ValidationError(
        `El índice de hueco ${gapIndex} está fuera de rango (0 a ${plates.length - 2}).`
      );
    }
    if (!isDiscInsidePlate(x, y, d, plates[gapIndex])) {
      throw new ValidationError(
        `El disco (Ø${d} mm) no cabe completamente dentro de la placa inferior P${gapIndex}.`
      );
    }
    if (!isDiscInsidePlate(x, y, d, plates[gapIndex + 1])) {
      throw new ValidationError(
        `El disco (Ø${d} mm) no cabe completamente dentro de la placa superior P${gapIndex + 1}.`
      );
    }

    this.saveSnapshot();
    const primary: Disc = {
      id: this.nextId++,
      x,
      y,
      diameter: d,
      gapIndex,
    };
    this.discs.push(primary);

    let autoCopied: Disc | null = null;
    if (
      autoCopyNext &&
      gapIndex + 1 < plates.length - 1 &&
      isDiscValidForGap(x, y, d, gapIndex + 1, plates)
    ) {
      autoCopied = {
        id: this.nextId++,
        x,
        y,
        diameter: d,
        gapIndex: gapIndex + 1,
      };
      this.discs.push(autoCopied);
    }

    return {
      primary: { ...primary },
      autoCopied: autoCopied ? { ...autoCopied } : null,
    };
  }

  /**
   * Mueve un disco validando contra plates[k] y plates[k+1].
   * `recordSnapshot` es false durante pointermove y true (o previo saveSnapshot) al finalizar.
   */
  moveDisc(
    discId: number,
    newX: number,
    newY: number,
    plates: PlateContour[],
    recordSnapshot = true
  ): boolean {
    const target = this.discs.find((d) => d.id === discId);
    if (!target) return false;
    if (!isDiscValidForGap(newX, newY, target.diameter, target.gapIndex, plates)) {
      return false;
    }
    if (Math.abs(target.x - newX) < 1e-6 && Math.abs(target.y - newY) < 1e-6) {
      return true;
    }
    if (recordSnapshot) {
      this.saveSnapshot();
    }
    target.x = newX;
    target.y = newY;
    return true;
  }

  setDiameter(
    discId: number,
    newDiameter: number,
    plates: PlateContour[]
  ): boolean {
    if (
      !Number.isFinite(newDiameter) ||
      newDiameter < PARAM_BOUNDS.discDiameter.min ||
      newDiameter > PARAM_BOUNDS.discDiameter.max
    ) {
      throw new ValidationError(
        `El diámetro debe estar entre ${PARAM_BOUNDS.discDiameter.min} y ${PARAM_BOUNDS.discDiameter.max} mm.`
      );
    }
    const target = this.discs.find((d) => d.id === discId);
    if (!target) return false;
    if (!isDiscValidForGap(target.x, target.y, newDiameter, target.gapIndex, plates)) {
      throw new ValidationError(
        `El diámetro Ø${newDiameter} mm excede el borde de las placas P${target.gapIndex}/P${target.gapIndex + 1} en la posición actual.`
      );
    }
    if (Math.abs(target.diameter - newDiameter) < 1e-6) return true;
    this.saveSnapshot();
    target.diameter = newDiameter;
    return true;
  }

  removeDisc(discId: number): boolean {
    const idx = this.discs.findIndex((d) => d.id === discId);
    if (idx === -1) return false;
    this.saveSnapshot();
    this.discs.splice(idx, 1);
    return true;
  }

  clearGap(gapIndex: number): number {
    const matching = this.discs.filter((d) => d.gapIndex === gapIndex);
    if (matching.length === 0) return 0;
    this.saveSnapshot();
    this.discs = this.discs.filter((d) => d.gapIndex !== gapIndex);
    return matching.length;
  }

  clearAll(recordSnapshot = true): void {
    if (this.discs.length === 0) return;
    if (recordSnapshot) {
      this.saveSnapshot();
    }
    this.discs = [];
  }

  /**
   * Re-escala las coordenadas (x, y) de todos los discos por `scaleRatio = newAutoScale / oldAutoScale`
   * antes de ejecutar `purgeInvalidDiscs` (Corrección #5c, main.py:201-212).
   */
  rescalePositions(scaleRatio: number): void {
    if (
      this.discs.length === 0 ||
      !Number.isFinite(scaleRatio) ||
      scaleRatio <= 0 ||
      Math.abs(scaleRatio - 1.0) <= 1e-9
    ) {
      return;
    }
    this.saveSnapshot();
    for (const d of this.discs) {
      d.x *= scaleRatio;
      d.y *= scaleRatio;
    }
  }

  purgeInvalidDiscs(plates: PlateContour[]): number {
    const valid: Disc[] = [];
    let removedCount = 0;
    for (const d of this.discs) {
      if (isDiscValidForGap(d.x, d.y, d.diameter, d.gapIndex, plates)) {
        valid.push(d);
      } else {
        removedCount++;
      }
    }
    if (removedCount > 0) {
      this.saveSnapshot();
      this.discs = valid;
    }
    return removedCount;
  }

  loadDiscsFromProject(rawDiscs: Disc[]): void {
    this.discs = rawDiscs.map((d) => ({ ...d }));
    const maxId = this.discs.reduce((acc, d) => Math.max(acc, d.id), 0);
    this.nextId = maxId + 1;
    this.undoStack = [];
    this.redoStack = [];
  }
}
```

---

#### Chunk 3.2: Serialización Byte-Compatible de Proyectos JSON y Autosave con Banner (`src/core/project.ts` y `src/core/autosave.ts`) (Correcciones #0, #5f, B15, B16, D)

- **Corrección #0 + B15 (Esquema JSON byte-compatible con `project.py:14-85` y `web/golden/l_block_project.json`, y reinicio de `nextId`)**:
  - *Qué estaba mal*: La versión previa de `project.ts` inventaba un objeto anidado `params: { disc_diameter, sheet_w, ... }` y usaba `gap_index` en lugar del esquema plano real de `project.py:29-39` y `web/golden/l_block_project.json` (`version`, `plates`, `thickness`, `gap`, `axis`, `discs: [{ id, hueco, x, y, diameter }]`). Además, `JSON.stringify` en JS formatea `3.0` como `3` en lugar de `3.0` como `json.dumps(..., indent=2)` en Python.
  - *Regla nueva*:
    1. En `serializeProjectJson` y `parseProjectJson`, usar exactamente la estructura plana de `project.py:29-39` y `web/golden/l_block_project.json`: claves raíz `version`, `plates`, `thickness`, `gap`, `axis`, `discs: [{ id, hueco, x, y, diameter }]`.
    2. Formatear los campos flotantes (`thickness`, `gap`, `x`, `y`, `diameter`) preservando `.0` cuando el valor es entero para que `serializeProjectJson` sea **byte-compatible** con `web/golden/l_block_project.json`.
    3. Al importar en `parseProjectJson(jsonText, baseParams = DEFAULT_PARAMS)`, fusionar `plates`, `thickness`, `gap` y `axis` sobre `baseParams` (igual que `project.py:72-85`), validar todos los campos y cada disco (`id` entero positivo único, `0 <= hueco < plates - 1`, `x`/`y` finitos, `diameter` en `PARAM_BOUNDS.discDiameter`), y fijar `nextId = max(id) + 1`.
  - *Criterio de aceptación*: Test unitario lee `web/golden/l_block_project.json`, ejecuta `parseProjectJson` seguido de `serializeProjectJson` y comprueba igualdad **byte a byte** con el archivo golden original.
- **Corrección B16 (Flujo exacto de incompatibilidad de parámetros de `main.py:312-331`)**:
  - *Qué estaba mal*: El plan citaba `main.py:312-331` sin especificar qué hacía ni qué mensaje mostraba.
  - *Regla nueva*: Implementar `checkParamsCompatibility(fileParams, currentParams)` comparando `plates`, `thickness`, `gap` y `axis` con tolerancia `1e-4`. Cuando retorna `false`, mostrar el diálogo de confirmación con el texto en español neutro:
    > `"Los parámetros del archivo difieren de los actuales. Adaptar el proyecto implica volver a rebanar el modelo 3D. ¿Deseas rebanar y adaptar el proyecto, o cancelar?"`
  - *Criterio de aceptación*: Test unitario verifica `checkParamsCompatibility` cuando difieren `plates`, `thickness`, `gap` o `axis`.
- **Corrección #5f + D (Autosave con banner "Restaurar sesión / Descartar" — prohibido sobrescribir estado sin preguntar)**:
  - *Qué estaba mal*: Al arrancar la aplicación se podía sobrescribir silenciosamente el estado con el autosave previo o descartar sin limpiar `IndexedDB`.
  - *Regla nueva*: Al iniciar la app (`checkAutosaveOnStartup`), únicamente detectar si existe una sesión guardada en `localStorage` / `IndexedDB` y poblar `pendingAutosave` en el store para mostrar el banner **"Sesión anterior encontrada — Restaurar sesión / Descartar"** en `TopProjectBar`. **Prohibido sobrescribir `params`, `discs` o la malla 3D sin que el usuario pulse "Restaurar sesión"**. Al pulsar "Descartar", `clearAutosaveStorage()` limpia tanto `localStorage` como `IndexedDB`.
  - *Criterio de aceptación*: Test E2E y unitario verifican que al cargar la página con un autosave existente, `params` y `discs` permanecen en su estado inicial hasta que el usuario hace clic en `"Restaurar sesión"`, y que `"Descartar"` borra `localStorage` e `IndexedDB`.

##### Archivo `web/src/core/project.ts`
```ts
import { DEFAULT_PARAMS, PARAM_BOUNDS } from './params';
import { validateParams, ValidationError } from './validator';
import type { Axis, Disc, SculptureParams } from '../types/sculpture';

export const FORMAT_VERSION = '1.0';

/**
 * Esquema exacto de project.py:29-39 y web/golden/l_block_project.json (§0.0).
 */
export interface SerializedProjectFile {
  version: string;
  plates: number;
  thickness: number;
  gap: number;
  axis: Axis;
  discs: Array<{
    id: number;
    hueco: number;
    x: number;
    y: number;
    diameter: number;
  }>;
}

export interface ParsedProjectData {
  version: string;
  params: SculptureParams;
  discs: Disc[];
}

function formatPythonFloat(n: number): string {
  return Number.isInteger(n) ? `${n.toFixed(1)}` : `${n}`;
}

/**
 * Serializa el proyecto en el formato exacto de project.py:14-46 y
 * web/golden/l_block_project.json (byte-compatible con json.dumps(..., indent=2)).
 */
export function serializeProjectJson(
  params: SculptureParams,
  discs: Disc[]
): string {
  validateParams(params);
  const discBlocks = discs.map((d) => {
    const lines = [
      '    {',
      `      "id": ${d.id},`,
      `      "hueco": ${d.gapIndex},`,
      `      "x": ${formatPythonFloat(d.x)},`,
      `      "y": ${formatPythonFloat(d.y)},`,
      `      "diameter": ${formatPythonFloat(d.diameter)}`,
      '    }',
    ];
    return lines.join('\n');
  });

  const discsSection =
    discBlocks.length === 0
      ? '  "discs": []'
      : `  "discs": [\n${discBlocks.join(',\n')}\n  ]`;

  return [
    '{',
    `  "version": "${FORMAT_VERSION}",`,
    `  "plates": ${params.plates},`,
    `  "thickness": ${formatPythonFloat(params.thickness)},`,
    `  "gap": ${formatPythonFloat(params.gap)},`,
    `  "axis": "${params.axis}",`,
    discsSection,
    '}',
  ].join('\n');
}

export function parseProjectJson(
  jsonText: string,
  baseParams: SculptureParams = DEFAULT_PARAMS
): ParsedProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new ValidationError('El archivo de proyecto no contiene un JSON válido.');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('El formato del archivo de proyecto es inválido.');
  }

  const obj = raw as Record<string, unknown>;
  if (obj.version !== FORMAT_VERSION) {
    throw new ValidationError(
      `Versión de archivo no soportada: '${String(obj.version ?? 'desconocida')}' (se esperaba '${FORMAT_VERSION}').`
    );
  }

  const requiredKeys = ['plates', 'thickness', 'gap', 'axis', 'discs'] as const;
  for (const key of requiredKeys) {
    if (!(key in obj)) {
      throw new ValidationError(`Falta el campo obligatorio '${key}' en el archivo JSON.`);
    }
  }

  const params: SculptureParams = {
    ...baseParams,
    plates: Number(obj.plates),
    thickness: Number(obj.thickness),
    gap: Number(obj.gap),
    axis: String(obj.axis).toLowerCase() as Axis,
  };

  validateParams(params);

  if (!Array.isArray(obj.discs)) {
    throw new ValidationError("El archivo de proyecto no contiene una lista 'discs' válida.");
  }

  const seenIds = new Set<number>();
  const discs: Disc[] = [];

  for (let i = 0; i < obj.discs.length; i++) {
    const item = obj.discs[i] as Record<string, unknown>;
    if (!item || typeof item !== 'object') {
      throw new ValidationError(`El disco en la posición ${i} es inválido.`);
    }
    const id = Number(item.id);
    const x = Number(item.x);
    const y = Number(item.y);
    const diameter = Number(item.diameter);
    const gapIndex = Number(item.hueco);

    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError(`El disco #${i} tiene un 'id' inválido (${String(item.id)}).`);
    }
    if (seenIds.has(id)) {
      throw new ValidationError(`El archivo contiene IDs de disco duplicados (id=${id}).`);
    }
    seenIds.add(id);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new ValidationError(`El disco id=${id} tiene coordenadas (x, y) no numéricas.`);
    }
    if (
      !Number.isFinite(diameter) ||
      diameter < PARAM_BOUNDS.discDiameter.min ||
      diameter > PARAM_BOUNDS.discDiameter.max
    ) {
      throw new ValidationError(
        `El disco id=${id} tiene un diámetro inválido (${diameter} mm).`
      );
    }
    if (!Number.isInteger(gapIndex) || gapIndex < 0 || gapIndex >= params.plates - 1) {
      throw new ValidationError(
        `El disco id=${id} tiene un hueco fuera de rango (${gapIndex}; máximo permitido ${params.plates - 2}).`
      );
    }

    discs.push({ id, x, y, diameter, gapIndex });
  }

  return {
    version: FORMAT_VERSION,
    params,
    discs,
  };
}

/**
 * Traducción exacta de project.py:88-115 (check_params_compatibility).
 * Verifica si los parámetros geométricos de corte coinciden.
 */
export function checkParamsCompatibility(
  fileParams: Pick<SculptureParams, 'plates' | 'thickness' | 'gap' | 'axis'>,
  currentParams: Pick<SculptureParams, 'plates' | 'thickness' | 'gap' | 'axis'>
): boolean {
  if (fileParams.plates !== currentParams.plates) return false;
  if (Math.abs(fileParams.thickness - currentParams.thickness) > 1e-4) return false;
  if (Math.abs(fileParams.gap - currentParams.gap) > 1e-4) return false;
  if (fileParams.axis !== currentParams.axis) return false;
  return true;
}

export const INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE =
  'Los parámetros del archivo difieren de los actuales. Adaptar el proyecto implica volver a rebanar el modelo 3D. ¿Deseas rebanar y adaptar el proyecto, o cancelar?';
```


##### Archivo `web/src/core/autosave.ts` (Correcciones #5f y D: Persistencia localStorage + IndexedDB con banner de restauración)
```ts
import { serializeProjectJson, parseProjectJson } from './project';
import { DEFAULT_PARAMS } from './params';
import { validateParams } from './validator';
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
}

interface RawAutosaveEnvelope {
  projectJson: string;
  fullParams: SculptureParams;
  meshFileName: string | null;
  savedAt: number;
}

export function saveProjectToLocalStorage(
  params: SculptureParams,
  discs: Disc[],
  meshFileName: string | null
): void {
  try {
    const envelope: RawAutosaveEnvelope = {
      projectJson: serializeProjectJson(params, discs),
      fullParams: { ...params },
      meshFileName,
      savedAt: Date.now(),
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
    return {
      params: project.params,
      discs: project.discs,
      meshFileName: typeof parsed.meshFileName === 'string' ? parsed.meshFileName : null,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
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
    db.close();
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
        buffer: buffer.slice(0),
        savedAt: Date.now(),
      };
      store.put(record, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Si IndexedDB no está disponible (ej. jsdom), no interrumpir el flujo
  }
}

export async function loadMeshBufferFromIndexedDB(): Promise<StoredMeshRecord | null> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return null;
    const db = await openMeshDatabase();
    const record = await new Promise<StoredMeshRecord | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const getReq = store.get(IDB_KEY);
      getReq.onsuccess = () => resolve((getReq.result as StoredMeshRecord) ?? null);
      getReq.onerror = () => reject(getReq.error);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}
```

---

### FASE 4: Acomodo 2D (`layout.ts`) y Exportadores Láser (`svgExporter.ts`, `dxfExporter.ts`)

#### Chunk 4.1: Algoritmo Completo de Acomodo 2D (`src/core/layout.ts`) (Correcciones #0, #2, A1, B13, B16)

- **Corrección #0 + #2 + B16 (Especificación 1:1 completa de `layout.py`, incluyendo `partGap`, `engraveClearance`, `scrapTagEnabled`, y distinción sólido/punteado en `plate.discs`)**:
  - *Qué estaba mal*: El plan anterior usaba `spacing` en vez de `partGap`, omitía `engraveClearance` y `scrapTagEnabled`, y guardaba `plate.discs` sin distinguir entre los discos del hueco superior (`gapIndex === i`, círculo **SÓLIDO**) y los del hueco inferior (`gapIndex === i - 1`, círculo **PUNTEADO**), ni sumaba `params.engraveClearance` al diámetro de grabado (`layout.py:165-177`).
  - *Regla nueva*: Implementar el 100% de la lógica de `layout.py` en el marco CAD unificado ($+X$ derecha, $+Y$ arriba) comenzando en $(x_0, y_0) = (\text{margin}, \text{margin})$ y avanzando estantes hacia $+Y$:
    1. **Mensaje exacto cuando una placa excede el área útil** (`layout.py:183-187`, adaptado a español neutro según C6):
       ```ts
       throw new ValidationError(
         `La placa ${i} (${w.toFixed(1)} x ${h.toFixed(1)} mm) excede el área útil de la hoja (${usableW.toFixed(1)} x ${usableH.toFixed(1)} mm). Ajusta el tamaño de la hoja o escala el modelo 3D.`
       );
       ```
    2. **Círculos de grabado de discos en cada placa (`plate.discs`, `layout.py:165-177`)**:
       - Para la placa `i`, filtrar los discos con `d.gapIndex === i || d.gapIndex === i - 1`.
       - Cada entrada `PlateEngraveDisc` en `plate.discs` conserva:
         - `diameter: d.diameter + params.engraveClearance` (para que radio de grabado sea $r = (d + \text{engraveClearance})/2$).
         - `nominalDiameter: d.diameter`.
         - `gapIndex: d.gapIndex`.
         - `isDashed: d.gapIndex === i - 1` (`false` $\to$ círculo **SÓLIDO** cuando `gapIndex === i`; `true` $\to$ círculo **PUNTEADO** cuando `gapIndex === i - 1`).
    3. **Cálculo de etiqueta de placa (`computePlateLabel`, `layout.py:190-263`)**:
       - `labelText = "P" + plateIdx`.
       - `minDim = Math.min(w, h)`.
       - `textSize = Math.max(2.0, Math.min(8.0, minDim * 0.12))`.
       - `textWidthEst = labelText.length * textSize * 0.65`.
       - Se elige el polígono de mayor área de la placa, se evalúa su centroide geométrico `(cx, cy)` y la distancia mínima al borde del polígono (exterior y huecos) y a los bordes de todos los círculos de grabado de esa placa (`dist(cx, cy, disc) - disc.diameter / 2`).
       - Si el punto está dentro del polígono, fuera de todos los discos y su holgura es $\ge \max(\text{textWidthEst}/2, \text{textSize}/2) + 0.5\text{ mm}$, la etiqueta se coloca adentro (`labelOutside = false`) en `(xOffset + cx, yOffset + cy)`.
       - En caso contrario (`labelOutside = true`), se coloca debajo de la placa en `(xOffset + w / 2, yOffset - outsideSize - 1.0)` con `outsideSize = Math.max(2.0, Math.min(4.0, w * 0.15))`.
    4. **Cálculo de dimensiones usadas y retazo (`finalizeSheetStats`, `layout.py:110-144` y `392-412`)**:
       - Calcula el bounding box de todas las placas colocadas y discos (incluyendo bandejas `discGroups`) sobre la hoja, determina `usedWidth`, `usedHeight`, `usedAreaMm2`, `usableAreaMm2 = (sheetW - 2*margin) * (sheetH - 2*margin)`, `occupancyPct = Math.min(100, (usedAreaMm2 / usableAreaMm2) * 100)`, `remnantWidth`, `remnantHeight` y `remnantAreaMm2 = Math.max(0, usableAreaMm2 - usedAreaMm2)`.
       - Solo si `params.scrapTagEnabled === true`, genera hasta 2 `ScrapTag` (`"SOBRANTE"`, `"{w} x {h} mm"`) cuando la franja derecha (`remRightW >= 50 && usableH >= 50`) o la franja superior (`remTopH >= 50 && usableW >= 50`) superan `MIN_SCRAP_DIM = 50.0 mm`.
    5. **Bandejas de discos por par de placas (`layoutDiscsIntoSheets`, `layout.py:434-648`)**:
       - Usa `effSpacing = params.partGap + params.kerf`.
       - Agrupa los discos por `gapIndex` ordenado ascendentemente (`grpLabel = "P{g}-P{g+1}"`, etiqueta individual de cada disco `"D{g}-{idx+1}"`).
       - `trayOffset = 4.0`, `labelW = Math.max(18.0, grpLabel.length * 3.5)`.
       - Si la bandeja de 1 fila cabe en el ancho útil (`trayW <= usableW`), empaqueta la bandeja en el estante actual o abre un nuevo estante/hoja.
       - Si `trayW > usableW`, divide el grupo en múltiples filas dentro de una bandeja multi-fila tal como `layout.py:553-633`.
  - *Criterio de aceptación*: Test unitario compara la salida de `generateLayouts` sobre `test_l_block.obj` contra `web/golden/l_block_layout.json` y `web/golden/l_block_layout_y.json`, verificando el mismo número de hojas, las mismas coordenadas `(xOffset, yOffset)` de cada placa, la distinción `isDashed` (`gapIndex === i` sólido vs `gapIndex === i - 1` punteado) con `diameter = d.diameter + engraveClearance`, las mismas bandejas `DiscGroup` y el error exacto cuando `sheetW = 120, sheetH = 120`.

##### Archivo `web/src/core/layout.ts`
```ts
import {
  distanceToPolygonBoundary,
  pointInPolygonWithHoles,
} from './geometry2d';
import { getDiscThickness, isDiscsSeparateSheet } from './params';
import { validateParams, ValidationError } from './validator';
import type {
  Disc,
  DiscGroup,
  PlacedDisc,
  PlacedPlate,
  PlateContour,
  PlateEngraveDisc,
  Point2D,
  PolygonWithHoles,
  ScrapTag,
  SculptureParams,
  SheetLayout,
  SliceResult,
} from '../types/sculpture';

const MIN_SCRAP_DIM = 50.0;

function computePolygonCentroid(ring: Point2D[]): Point2D {
  let cx = 0;
  let cy = 0;
  let signedArea2 = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    signedArea2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(signedArea2) < 1e-9) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / n, sy / n];
  }
  const factor = 1.0 / (3.0 * signedArea2);
  return [cx * factor, cy * factor];
}

function getPlateBounds(plate: PlateContour): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const poly of plate) {
    for (const [x, y] of poly.exterior) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function shiftPlatePolygons(
  plate: PlateContour,
  dx: number,
  dy: number
): PolygonWithHoles[] {
  return plate.map((poly) => ({
    exterior: poly.exterior.map(([x, y]) => [x + dx, y + dy]),
    holes: poly.holes.map((h) => h.map(([x, y]) => [x + dx, y + dy])),
    area: poly.area,
  }));
}

/**
 * Traducción 1:1 de _compute_plate_label (layout.py:190-263).
 */
export function computePlateLabel(
  plateIdx: number,
  localPolys: PolygonWithHoles[],
  localDiscs: PlateEngraveDisc[],
  w: number,
  h: number,
  xOffset: number,
  yOffset: number
): {
  labelText: string;
  labelX: number;
  labelY: number;
  labelSize: number;
  labelOutside: boolean;
} {
  const labelText = `P${plateIdx}`;
  const minDim = Math.min(w, h);
  const textSize = Math.max(2.0, Math.min(8.0, minDim * 0.12));
  const textWidthEst = labelText.length * textSize * 0.65;
  const requiredRadius = Math.max(textWidthEst * 0.5, textSize * 0.5) + 0.5;

  // Polígono de mayor área
  let largest = localPolys[0];
  for (const p of localPolys) {
    if (p.area > largest.area) largest = p;
  }

  const [cx, cy] = computePolygonCentroid(largest.exterior);
  let insideOk = pointInPolygonWithHoles(cx, cy, largest);
  let clearance = insideOk ? distanceToPolygonBoundary(cx, cy, largest) : 0;

  if (insideOk) {
    for (const d of localDiscs) {
      const distToDiscEdge = Math.hypot(cx - d.x, cy - d.y) - d.diameter * 0.5;
      if (distToDiscEdge <= 0) {
        insideOk = false;
        break;
      }
      if (distToDiscEdge < clearance) {
        clearance = distToDiscEdge;
      }
    }
  }

  if (insideOk && clearance >= requiredRadius) {
    return {
      labelText,
      labelX: xOffset + cx,
      labelY: yOffset + cy,
      labelSize: Number(textSize.toFixed(2)),
      labelOutside: false,
    };
  }

  const outsideSize = Math.max(2.0, Math.min(4.0, w * 0.15));
  return {
    labelText,
    labelX: xOffset + w * 0.5,
    labelY: yOffset - outsideSize - 1.0,
    labelSize: Number(outsideSize.toFixed(2)),
    labelOutside: true,
  };
}

function createEmptySheet(
  sheetIndex: number,
  sheetType: 'plates' | 'discs',
  materialThickness: number,
  params: SculptureParams
): SheetLayout {
  return {
    sheetIndex,
    sheetType,
    materialThickness,
    width: params.sheetW,
    height: params.sheetH,
    margin: params.sheetMargin,
    kerf: params.kerf,
    engraveClearance: params.engraveClearance,
    plates: [],
    discs: [],
    discGroups: [],
    scrapTags: [],
    usedWidth: 0,
    usedHeight: 0,
    usedAreaMm2: 0,
    usableAreaMm2: 0,
    occupancyPct: 0,
    remnantWidth: 0,
    remnantHeight: 0,
    remnantAreaMm2: 0,
  };
}

/**
 * Traducción 1:1 de calculate_used_dimensions (layout.py:110-144) y _compute_scrap_tags (layout.py:392-412).
 */
function finalizeSheetStats(sheet: SheetLayout, scrapTagEnabled: boolean): void {
  let maxX = 0.0;
  let maxY = 0.0;

  for (const p of sheet.plates) {
    maxX = Math.max(maxX, p.xOffset + p.width);
    maxY = Math.max(maxY, p.yOffset + p.height);
  }
  for (const d of sheet.discs) {
    const r = d.diameter * 0.5;
    maxX = Math.max(maxX, d.x + r);
    maxY = Math.max(maxY, d.y + r);
  }
  for (const grp of sheet.discGroups) {
    maxX = Math.max(maxX, grp.trayX + grp.trayW);
    maxY = Math.max(maxY, grp.trayY + grp.trayH);
  }

  const usableW = Math.max(0.0, sheet.width - 2.0 * sheet.margin);
  const usableH = Math.max(0.0, sheet.height - 2.0 * sheet.margin);
  const usableArea = usableW * usableH;

  if (maxX > sheet.margin && maxY > sheet.margin) {
    sheet.usedWidth = Number((maxX - sheet.margin).toFixed(1));
    sheet.usedHeight = Number((maxY - sheet.margin).toFixed(1));
  } else {
    sheet.usedWidth = 0.0;
    sheet.usedHeight = 0.0;
  }

  sheet.usedAreaMm2 = Number((sheet.usedWidth * sheet.usedHeight).toFixed(1));
  sheet.usableAreaMm2 = Number(usableArea.toFixed(1));
  sheet.occupancyPct =
    usableArea > 0
      ? Number(Math.min(100.0, (sheet.usedAreaMm2 / usableArea) * 100.0).toFixed(1))
      : 0.0;

  sheet.remnantWidth = Number(Math.max(0.0, usableW - sheet.usedWidth).toFixed(1));
  sheet.remnantHeight = Number(Math.max(0.0, usableH - sheet.usedHeight).toFixed(1));
  sheet.remnantAreaMm2 = Number(Math.max(0.0, usableArea - sheet.usedAreaMm2).toFixed(1));

  // ScrapTags (layout.py:392-412)
  sheet.scrapTags = [];
  if (!scrapTagEnabled) return;
  if (sheet.usedWidth <= 0 && sheet.usedHeight <= 0) return;

  const remRightW = usableW - sheet.usedWidth;
  if (remRightW >= MIN_SCRAP_DIM && usableH >= MIN_SCRAP_DIM) {
    sheet.scrapTags.push({
      x: sheet.margin + sheet.usedWidth,
      y: sheet.margin,
      w: Number(remRightW.toFixed(1)),
      h: Number(usableH.toFixed(1)),
      lines: ['SOBRANTE', `${remRightW.toFixed(0)} x ${usableH.toFixed(0)} mm`],
    });
  }

  const remTopH = usableH - sheet.usedHeight;
  if (remTopH >= MIN_SCRAP_DIM && usableW >= MIN_SCRAP_DIM) {
    sheet.scrapTags.push({
      x: sheet.margin,
      y: sheet.margin + sheet.usedHeight,
      w: Number(usableW.toFixed(1)),
      h: Number(remTopH.toFixed(1)),
      lines: ['SOBRANTE', `${usableW.toFixed(0)} x ${remTopH.toFixed(0)} mm`],
    });
  }
}

/**
 * Traducción 1:1 de _layout_discs_into_sheets (layout.py:434-648).
 */
function layoutDiscsIntoSheets(
  discs: Disc[],
  params: SculptureParams,
  sheets: SheetLayout[],
  currentSheet: SheetLayout,
  startCursorX: number,
  startCursorY: number,
  startRowHeight: number,
  sheetCounterStart: number,
  sheetTypeForNew: 'plates' | 'discs',
  discThickness: number
): { currentSheet: SheetLayout; sheetCounter: number } {
  const margin = params.sheetMargin;
  const effSpacing = params.partGap + params.kerf;
  const trayOffset = 4.0;
  const maxX = params.sheetW - margin;
  const maxY = params.sheetH - margin;
  const usableW = params.sheetW - 2.0 * margin;

  let cursorX = startCursorX;
  let cursorY = startCursorY;
  let rowHeight = startRowHeight;
  let sheetCounter = sheetCounterStart;

  const groupsByGap = new Map<number, Disc[]>();
  for (const d of discs) {
    const list = groupsByGap.get(d.gapIndex);
    if (list) list.push(d);
    else groupsByGap.set(d.gapIndex, [d]);
  }

  const sortedGapIndices = Array.from(groupsByGap.keys()).sort((a, b) => a - b);

  for (const gapIdx of sortedGapIndices) {
    const grpDiscs = groupsByGap.get(gapIdx)!;
    const nDiscs = grpDiscs.length;
    const grpLabel = `P${gapIdx}-P${gapIdx + 1}`;
    const labelW = Math.max(18.0, grpLabel.length * 3.5);
    const maxD = grpDiscs.reduce((m, d) => Math.max(m, d.diameter), 0);

    const discsSpanW =
      grpDiscs.reduce((s, d) => s + d.diameter, 0) +
      Math.max(0, nDiscs - 1) * effSpacing;
    const trayW = labelW + trayOffset + discsSpanW + trayOffset * 2.0;
    const trayH = maxD + trayOffset * 2.0;

    if (trayW <= usableW) {
      if (cursorX + trayW > maxX && cursorX > margin) {
        cursorX = margin;
        cursorY += rowHeight + effSpacing;
        rowHeight = 0.0;
      }
      if (cursorY + trayH > maxY) {
        if (currentSheet.plates.length > 0 || currentSheet.discs.length > 0) {
          sheets.push(currentSheet);
          sheetCounter += 1;
        }
        currentSheet = createEmptySheet(
          sheetCounter,
          sheetTypeForNew,
          discThickness,
          params
        );
        cursorX = margin;
        cursorY = margin;
        rowHeight = 0.0;
      }

      const trayX = cursorX;
      const trayY = cursorY;
      const labelSepX = trayX + labelW;
      let discCursorX = labelSepX + trayOffset;
      const placedInGroup: PlacedDisc[] = [];

      for (let idx = 0; idx < grpDiscs.length; idx++) {
        const d = grpDiscs[idx];
        const r = d.diameter * 0.5;
        const cx = discCursorX + r;
        const cy = trayY + trayH * 0.5;
        const pd: PlacedDisc = {
          discId: d.id,
          gapIndex: d.gapIndex,
          x: cx,
          y: cy,
          diameter: d.diameter,
          label: `D${d.gapIndex}-${idx + 1}`,
        };
        currentSheet.discs.push(pd);
        placedInGroup.push(pd);
        discCursorX += d.diameter + effSpacing;
      }

      currentSheet.discGroups.push({
        gapIndex: gapIdx,
        plateA: gapIdx,
        plateB: gapIdx + 1,
        label: grpLabel,
        trayX,
        trayY,
        trayW,
        trayH,
        labelSepX,
        discs: placedInGroup,
      });

      cursorX += trayW + effSpacing;
      rowHeight = Math.max(rowHeight, trayH);
    } else {
      // Bandeja multi-fila cuando el grupo supera el ancho útil de la hoja (layout.py:553-633)
      if (cursorX > margin) {
        cursorX = margin;
        cursorY += rowHeight + effSpacing;
        rowHeight = 0.0;
      }

      const availDiscW = usableW - labelW - trayOffset * 3.0;
      let subRows: Array<Array<{ idx: number; disc: Disc }>> = [];
      let curRow: Array<{ idx: number; disc: Disc }> = [];
      let curW = 0.0;

      for (let idx = 0; idx < grpDiscs.length; idx++) {
        const d = grpDiscs[idx];
        const needed = curRow.length === 0 ? d.diameter : d.diameter + effSpacing;
        if (curW + needed > availDiscW && curRow.length > 0) {
          subRows.push(curRow);
          curRow = [{ idx, disc: d }];
          curW = d.diameter;
        } else {
          curRow.push({ idx, disc: d });
          curW += needed;
        }
      }
      if (curRow.length > 0) subRows.push(curRow);

      let totalTrayH =
        subRows.length * maxD +
        Math.max(0, subRows.length - 1) * effSpacing +
        trayOffset * 2.0;

      if (cursorY + totalTrayH > maxY) {
        if (currentSheet.plates.length > 0 || currentSheet.discs.length > 0) {
          sheets.push(currentSheet);
          sheetCounter += 1;
        }
        currentSheet = createEmptySheet(
          sheetCounter,
          sheetTypeForNew,
          discThickness,
          params
        );
        cursorX = margin;
        cursorY = margin;
        rowHeight = 0.0;
      }

      const trayX = margin;
      const trayY = cursorY;
      const labelSepX = trayX + labelW;
      const placedInGroup: PlacedDisc[] = [];
      let maxRowEndX = labelSepX + trayOffset;

      for (let rIdx = 0; rIdx < subRows.length; rIdx++) {
        const rowDiscs = subRows[rIdx];
        let discCursorX = labelSepX + trayOffset;
        const rowCy =
          trayY + trayOffset + rIdx * (maxD + effSpacing) + maxD * 0.5;

        for (const { idx, disc: d } of rowDiscs) {
          const r = d.diameter * 0.5;
          const cx = discCursorX + r;
          const pd: PlacedDisc = {
            discId: d.id,
            gapIndex: d.gapIndex,
            x: cx,
            y: rowCy,
            diameter: d.diameter,
            label: `D${d.gapIndex}-${idx + 1}`,
          };
          currentSheet.discs.push(pd);
          placedInGroup.push(pd);
          discCursorX += d.diameter + effSpacing;
        }
        maxRowEndX = Math.max(maxRowEndX, discCursorX - effSpacing);
      }

      const actualTrayW = maxRowEndX - trayX + trayOffset;
      currentSheet.discGroups.push({
        gapIndex: gapIdx,
        plateA: gapIdx,
        plateB: gapIdx + 1,
        label: grpLabel,
        trayX,
        trayY,
        trayW: actualTrayW,
        trayH: totalTrayH,
        labelSepX,
        discs: placedInGroup,
      });

      cursorX = margin;
      cursorY += totalTrayH + effSpacing;
      rowHeight = 0.0;
    }
  }

  return { currentSheet, sheetCounter };
}

/**
 * Traducción 1:1 de generate_layouts (layout.py:266-389).
 */
export function generateLayouts(
  sliceResult: SliceResult,
  discs: Disc[],
  params: SculptureParams
): SheetLayout[] {
  validateParams(params);

  const usableW = params.sheetW - 2.0 * params.sheetMargin;
  const usableH = params.sheetH - 2.0 * params.sheetMargin;
  if (usableW <= 0 || usableH <= 0) {
    throw new ValidationError(
      `El margen (${params.sheetMargin} mm) es demasiado grande para la hoja de ${params.sheetW} x ${params.sheetH} mm.`
    );
  }

  const effSpacing = params.partGap + params.kerf;
  const margin = params.sheetMargin;
  const maxX = params.sheetW - margin;
  const maxY = params.sheetH - margin;

  const sheets: SheetLayout[] = [];
  let sheetCounter = 0;
  let currentSheet = createEmptySheet(
    sheetCounter,
    'plates',
    params.thickness,
    params
  );

  let cursorX = margin;
  let cursorY = margin;
  let rowHeight = 0.0;

  for (let i = 0; i < sliceResult.plates.length; i++) {
    const platePolys = sliceResult.plates[i];
    if (!platePolys || platePolys.length === 0) continue;

    const bounds = getPlateBounds(platePolys);
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;

    // Verificación exacta de layout.py:183-187
    if (w > usableW || h > usableH) {
      throw new ValidationError(
        `La placa ${i} (${w.toFixed(1)} x ${h.toFixed(1)} mm) excede el área útil de la hoja (${usableW.toFixed(1)} x ${usableH.toFixed(1)} mm). Ajusta el tamaño de la hoja o escala el modelo 3D.`
      );
    }

    const plateDiscs = discs.filter(
      (d) => d.gapIndex === i || d.gapIndex === i - 1
    );
    const localPolys = shiftPlatePolygons(platePolys, -bounds.minX, -bounds.minY);
    const localDiscs: PlateEngraveDisc[] = plateDiscs.map((d) => ({
      id: d.id,
      x: d.x - bounds.minX,
      y: d.y - bounds.minY,
      diameter: Number((d.diameter + params.engraveClearance).toFixed(4)),
      nominalDiameter: d.diameter,
      gapIndex: d.gapIndex,
      isDashed: d.gapIndex === i - 1, // gapIndex === i -> SÓLIDO (false); gapIndex === i - 1 -> PUNTEADO (true)
    }));

    const preLabel = computePlateLabel(i, localPolys, localDiscs, w, h, 0, 0);
    const labelMarginBottom = preLabel.labelOutside
      ? preLabel.labelSize + 2.0
      : 0.0;
    const effectiveH = h + labelMarginBottom;

    if (cursorX + w > maxX && cursorX > margin) {
      cursorX = margin;
      cursorY += rowHeight + effSpacing;
      rowHeight = 0.0;
    }

    if (cursorY + effectiveH > maxY) {
      if (currentSheet.plates.length > 0) {
        sheets.push(currentSheet);
        sheetCounter += 1;
      }
      currentSheet = createEmptySheet(
        sheetCounter,
        'plates',
        params.thickness,
        params
      );
      cursorX = margin;
      cursorY = margin;
      rowHeight = 0.0;
    }

    const plateYOffset = cursorY + labelMarginBottom;
    const finalLabel = computePlateLabel(
      i,
      localPolys,
      localDiscs,
      w,
      h,
      cursorX,
      plateYOffset
    );

    const placed: PlacedPlate = {
      plateIndex: i,
      xOffset: cursorX,
      yOffset: plateYOffset,
      width: w,
      height: h,
      polygons: localPolys,
      discs: localDiscs,
      labelText: finalLabel.labelText,
      labelX: finalLabel.labelX,
      labelY: finalLabel.labelY,
      labelSize: finalLabel.labelSize,
      labelOutside: finalLabel.labelOutside,
    };

    currentSheet.plates.push(placed);
    cursorX += w + effSpacing;
    rowHeight = Math.max(rowHeight, effectiveH);
  }

  const separateDiscs = isDiscsSeparateSheet(params);
  const discThickness = getDiscThickness(params);

  if (discs.length > 0) {
    if (!separateDiscs) {
      const res = layoutDiscsIntoSheets(
        discs,
        params,
        sheets,
        currentSheet,
        cursorX,
        cursorY,
        rowHeight,
        sheetCounter,
        'plates',
        params.thickness
      );
      currentSheet = res.currentSheet;
      sheetCounter = res.sheetCounter;
      if (currentSheet.plates.length > 0 || currentSheet.discs.length > 0) {
        sheets.push(currentSheet);
      }
    } else {
      if (currentSheet.plates.length > 0) {
        sheets.push(currentSheet);
        sheetCounter += 1;
      }
      const discSheet = createEmptySheet(
        sheetCounter,
        'discs',
        discThickness,
        params
      );
      const res = layoutDiscsIntoSheets(
        discs,
        params,
        sheets,
        discSheet,
        margin,
        margin,
        0.0,
        sheetCounter,
        'discs',
        discThickness
      );
      if (res.currentSheet.discs.length > 0) {
        sheets.push(res.currentSheet);
      }
    }
  } else if (currentSheet.plates.length > 0) {
    sheets.push(currentSheet);
  }

  for (const s of sheets) {
    finalizeSheetStats(s, params.scrapTagEnabled);
  }

  return sheets;
}
```

---

#### Chunk 4.2: Exportadores SVG y DXF `AC1015` (`src/core/svgExporter.ts` y `src/core/dxfExporter.ts`) (Correcciones #2, #6, #7, A1, B8, B16)

- **Corrección #6 + A1 (Quiralidad idéntica entre 3D, SVG y DXF; IDs de grupo SVG unificados `cad-frame`, `corte`, `grabado`)**:
  - *Qué estaba mal*: El plan anterior invertía `Y` en DXF (`yDxf = sheetH - y`) y no en SVG, produciendo archivos espejo, y discrepaba en los IDs de grupos SVG (`CONTENIDO_CAD`/`CORTE`/`GRABADO` vs `cad-frame`/`corte`/`grabado`).
  - *Regla nueva*:
    - `dxfExporter.ts` escribe directamente $(x_{\text{DXF}}, y_{\text{DXF}}) = (x, y)$ en el marco CAD ($+X$ derecha, $+Y$ arriba).
    - `svgExporter.ts` envuelve toda la geometría en `<g id="cad-frame" transform="translate(0, ${fmt(H)}) scale(1, -1)">` y usa los subgrupos `<g id="referencia">`, `<g id="grabado">` y `<g id="corte">` en todo el documento (`§0.2`, `Chunk 4.2` y `exporter.test.ts`).
    - Cada `<text>` dentro de SVG usa `transform="translate(${tx}, ${ty}) scale(1, -1)"` para que las letras se lean al derecho en la posición exacta $(tx, ty)$.
  - *Criterio de aceptación*: Test en `exporter.test.ts` verifica `#cad-frame` con `translate(0, ${sheet.height}) scale(1, -1)` (calculado dinámicamente desde `sheet.height`, sin `2440` fijo), `#corte`, `#grabado`, y que `P0` tiene el mismo bounding box y orientación en SVG, DXF y 3D.
- **Corrección #2 (Círculos sólidos `gapIndex === i` vs punteados `gapIndex === i - 1` con radio $r = (d + \text{engraveClearance})/2$)**:
  - *Qué estaba mal*: Tanto `svgExporter.ts` como `dxfExporter.ts` exportaban todos los discos de `plate.discs` como punteados y sin sumar `engraveClearance`.
  - *Regla nueva*:
    - En `svgExporter.ts`: si `disc.isDashed === false` (`gapIndex === i`, disco sobre la placa), emitir `<circle ... />` **sólido** (sin `stroke-dasharray`); si `disc.isDashed === true` (`gapIndex === i - 1`, disco debajo de la placa), emitir `<circle ... stroke-dasharray="1.5,1" />`. En ambos casos `r = disc.diameter / 2 = (nominalDiameter + engraveClearance) / 2`.
    - En `dxfExporter.ts`: si `disc.isDashed === false` (`gapIndex === i`), emitir `1` entidad `CIRCLE` en capa `GRABADO` con `r = disc.diameter / 2`; si `disc.isDashed === true` (`gapIndex === i - 1`), emitir `N` entidades `ARC` mediante `addDxfDashedCircle` en capa `GRABADO` con `r = disc.diameter / 2` (`exporter.py:341-358`).
  - *Criterio de aceptación*: Una placa con un disco arriba (`gapIndex === i`) y uno abajo (`gapIndex === i - 1`) exporta exactamente `1 CIRCLE` y `N ARC` en capa `GRABADO`, ambos con $r = (d + \text{engraveClearance}) / 2$.
- **Corrección #7 + B8 + B16 (Prueba documentada de `$INSUNITS` en `AC1009` y migración a `AC1015` con `@tarikjabiri/dxf@2.9.0`)**:
  - *Qué estaba mal*: Se asumía que añadir `$INSUNITS = 4` en un cabecera `AC1009` (DXF R12) hacía que los programas CAM/CAD abrieran el archivo en milímetros.
  - *Resultado documentado de la verificación*:
    1. En la especificación oficial de AutoCAD DXF, la variable `$INSUNITS` fue introducida en **AutoCAD 2000 (`AC1015`)** y no existe en R12 (`AC1009`). Al probar con `ezdxf` (`ezdxf.new('R12')`), `ezdxf` emite la advertencia explícita: `"Drawing units ($INSUNITS) are not exported for DXF R12"`.
    2. Al probar con el importador real de Inkscape (`C:\Program Files\Inkscape\share\inkscape\extensions\dxf_input.py`, líneas 24 y 1423), un archivo R12 o sin `$MEASUREMENT = 1` aplica por defecto conversión de pulgadas (`scale = 25.4`), escalando erróneamente una hoja de `600 mm` a `15240 mm`.
    3. Al migrar a **`AC1015` (AutoCAD 2000)** usando **`@tarikjabiri/dxf@2.9.0`** con `dxf.setUnits(Units.Millimeters)` (`$INSUNITS = 4`), `dxf.setVariable('$ACADVER', { 1: 'AC1015' })` y `dxf.setVariable('$MEASUREMENT', { 70: 1 })`:
       - `ezdxf.readfile()` + `doc.audit()` valida el archivo con **`0` errores y `0` fixes** (`$ACADVER = AC1015`, `$INSUNITS = 4`, `$MEASUREMENT = 1`).
       - `dxf_input.py --scalemethod=file` de Inkscape reporta **`scale = 1.000000` (escala 1:1 en milímetros)**.
       - `new DxfParser().parseSync(dxfString)` (`dxf-parser@1.1.2`) parsea todas las entidades (`LWPOLYLINE`, `CIRCLE`, `ARC`, `LINE`, `TEXT`) y capas (`CORTE`, `GRABADO`) sin errores.
    4. **Nota de bloqueo**: Los ejecutables de escritorio de LightBurn y LibreCAD no están instalados en este entorno Windows (`shutil.which('LightBurn') === None`, `shutil.which('librecad') === None`), por lo que la prueba manual/GUI en LightBurn y LibreCAD se declara **BLOQUEANTE** en `§5` y obligatoria en `DoD-5`.
  - *Criterio de aceptación*: `generateSheetDxf` emite un DXF `AC1015` con `@tarikjabiri/dxf@2.9.0` que pasa `dxf-parser`, `ezdxf.audit()` (`0` errores) e importación 1:1 en milímetros.

##### Archivo `web/src/core/svgExporter.ts`
```ts
import type { Point2D, SheetLayout } from '../types/sculpture';

export interface SvgExportOptions {
  includeReference?: boolean; // Bordes de hoja, margen y etiquetas de retazo
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function ringToSvgPath(ring: Point2D[], dx: number, dy: number): string {
  if (ring.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    const cmd = i === 0 ? 'M' : 'L';
    parts.push(`${cmd} ${fmt(x + dx)} ${fmt(y + dy)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

function renderCadText(
  x: number,
  y: number,
  fontSize: number,
  color: string,
  text: string,
  anchor: 'middle' | 'start' = 'middle'
): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<text x="0" y="0" transform="translate(${fmt(x)}, ${fmt(y)}) scale(1, -1)" fill="${color}" font-family="monospace" font-size="${fmt(fontSize)}" text-anchor="${anchor}" dominant-baseline="central">${escaped}</text>`;
}

export function generateSheetSvg(
  sheet: SheetLayout,
  options: SvgExportOptions = { includeReference: true }
): string {
  const W = sheet.width;
  const H = sheet.height;
  const M = sheet.margin;
  const includeRef = options.includeReference ?? true;

  const refElements: string[] = [];
  const engraveElements: string[] = [];
  const cutElements: string[] = [];

  if (includeRef) {
    refElements.push(
      `<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="none" stroke="#888888" stroke-width="0.5" />`
    );
    if (M > 0) {
      refElements.push(
        `<rect x="${fmt(M)}" y="${fmt(M)}" width="${fmt(W - 2 * M)}" height="${fmt(H - 2 * M)}" fill="none" stroke="#CCCCCC" stroke-width="0.3" stroke-dasharray="4,4" />`
      );
    }
    for (const tag of sheet.scrapTags) {
      refElements.push(
        `<rect x="${fmt(tag.x)}" y="${fmt(tag.y)}" width="${fmt(tag.w)}" height="${fmt(tag.h)}" fill="none" stroke="#22C55E" stroke-width="0.35" stroke-dasharray="6,3" />`
      );
      const cx = tag.x + tag.w * 0.5;
      const cy = tag.y + tag.h * 0.5;
      const tSize = Math.max(4.0, Math.min(12.0, Math.min(tag.w, tag.h) * 0.08));
      for (let idx = 0; idx < tag.lines.length; idx++) {
        const lineY =
          cy + (tag.lines.length - 1 - idx * 2) * tSize * 0.65;
        refElements.push(
          renderCadText(cx, lineY, tSize, '#22C55E', tag.lines[idx])
        );
      }
    }
  }

  // Placas (CORTE en #FF0000 y GRABADO en #0000FF)
  for (const plate of sheet.plates) {
    for (const poly of plate.polygons) {
      const subPaths: string[] = [
        ringToSvgPath(poly.exterior, plate.xOffset, plate.yOffset),
      ];
      for (const hole of poly.holes) {
        subPaths.push(ringToSvgPath(hole, plate.xOffset, plate.yOffset));
      }
      cutElements.push(
        `<path d="${subPaths.join(' ')}" fill="none" stroke="#FF0000" stroke-width="0.2" fill-rule="nonzero" />`
      );
    }

    for (const disc of plate.discs) {
      const cx = plate.xOffset + disc.x;
      const cy = plate.yOffset + disc.y;
      // disc.diameter ya incluye params.engraveClearance (layout.ts)
      const r = disc.diameter * 0.5;
      const dashAttr = disc.isDashed ? ' stroke-dasharray="1.5,1"' : '';
      engraveElements.push(
        `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="#0000FF" stroke-width="0.15"${dashAttr} />`
      );
    }

    engraveElements.push(
      renderCadText(
        plate.labelX,
        plate.labelY,
        plate.labelSize,
        '#0000FF',
        plate.labelText
      )
    );
  }

  // Bandejas de discos (GRABADO #0000FF)
  for (const grp of sheet.discGroups) {
    engraveElements.push(
      `<rect x="${fmt(grp.trayX)}" y="${fmt(grp.trayY)}" width="${fmt(grp.trayW)}" height="${fmt(grp.trayH)}" fill="none" stroke="#0000FF" stroke-width="0.2" />`
    );
    engraveElements.push(
      `<line x1="${fmt(grp.labelSepX)}" y1="${fmt(grp.trayY)}" x2="${fmt(grp.labelSepX)}" y2="${fmt(grp.trayY + grp.trayH)}" stroke="#0000FF" stroke-width="0.15" />`
    );
    const labelZoneW = grp.labelSepX - grp.trayX;
    const lblCx = grp.trayX + labelZoneW * 0.5;
    const lblCy = grp.trayY + grp.trayH * 0.5;
    const lblSize = Math.max(
      2.0,
      Math.min(4.0, (labelZoneW * 0.85) / Math.max(1, grp.label.length * 0.6))
    );
    engraveElements.push(
      renderCadText(lblCx, lblCy, lblSize, '#0000FF', grp.label)
    );
  }

  // Discos (CORTE #FF0000 con compensación de kerf + etiqueta en GRABADO #0000FF)
  for (const disc of sheet.discs) {
    const cutRadius = (disc.diameter + sheet.kerf) * 0.5;
    cutElements.push(
      `<circle cx="${fmt(disc.x)}" cy="${fmt(disc.y)}" r="${fmt(cutRadius)}" fill="none" stroke="#FF0000" stroke-width="0.2" />`
    );
    const lblSize = Math.max(1.5, Math.min(3.5, disc.diameter * 0.18));
    engraveElements.push(
      renderCadText(disc.x, disc.y, lblSize, '#0000FF', disc.label)
    );
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}">`,
    `  <g id="cad-frame" transform="translate(0, ${fmt(H)}) scale(1, -1)">`,
    includeRef
      ? `    <g id="referencia">\n      ${refElements.join('\n      ')}\n    </g>`
      : '',
    `    <g id="grabado">`,
    `      ${engraveElements.join('\n      ')}`,
    `    </g>`,
    `    <g id="corte">`,
    `      ${cutElements.join('\n      ')}`,
    `    </g>`,
    `  </g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n');
}
```

##### Archivo `web/src/core/dxfExporter.ts`
```ts
import {
  DxfWriter,
  Units,
  Colors,
  LWPolylineFlags,
  point2d,
  point3d,
} from '@tarikjabiri/dxf';
import JSZip from 'jszip';
import { generateSheetSvg } from './svgExporter';
import type { Point2D, SheetLayout } from '../types/sculpture';

function addDxfClosedPolyline(
  dxf: DxfWriter,
  layerName: 'CORTE' | 'GRABADO',
  points: Point2D[]
): void {
  if (points.length < 2) return;
  dxf.addLWPolyline(
    points.map(([x, y]) => ({ point: point2d(x, y) })),
    {
      flags: LWPolylineFlags.Closed,
      layerName,
    }
  );
}

/**
 * Traducción 1:1 de _draw_dashed_circle_dxf (exporter.py:341-358).
 * Genera entidades ARC en la capa GRABADO para representar un círculo punteado
 * (cuando gapIndex === plateIndex - 1).
 */
function addDxfDashedCircle(
  dxf: DxfWriter,
  layerName: 'GRABADO',
  cx: number,
  cy: number,
  radius: number,
  dashLen = 1.5,
  gapLen = 1.0
): void {
  if (radius <= 0) return;
  const circumference = 2.0 * Math.PI * radius;
  const period = dashLen + gapLen;
  const numSegments = Math.max(4, Math.round(circumference / period));
  const stepDeg = 360.0 / numSegments;
  const dashDeg = stepDeg * (dashLen / period);

  for (let segI = 0; segI < numSegments; segI++) {
    const startAngle = segI * stepDeg;
    const endAngle = startAngle + dashDeg;
    dxf.addArc(point3d(cx, cy, 0), radius, startAngle, endAngle, {
      layerName,
    });
  }
}

function addDxfCenteredText(
  dxf: DxfWriter,
  layerName: 'GRABADO',
  cx: number,
  cy: number,
  height: number,
  text: string
): void {
  const approxHalfW = text.length * height * 0.3;
  const insertX = cx - approxHalfW;
  const insertY = cy - height * 0.5;
  dxf.addText(point3d(insertX, insertY, 0), height, text, {
    layerName,
  });
}

/**
 * Genera un archivo ASCII DXF AC1015 (AutoCAD 2000) mediante @tarikjabiri/dxf@2.9.0
 * con $INSUNITS = 4 (mm) y $MEASUREMENT = 1 (métrico) para que AutoCAD, LightBurn,
 * LibreCAD, RDWorks e Inkscape honren la escala 1:1 en milímetros.
 */
export function generateSheetDxf(sheet: SheetLayout): string {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Millimeters);
  dxf.setVariable('$ACADVER', { 1: 'AC1015' });
  dxf.setVariable('$MEASUREMENT', { 70: 1 });
  dxf.setVariable('$EXTMIN', { 10: 0, 20: 0, 30: 0 });
  dxf.setVariable('$EXTMAX', { 10: sheet.width, 20: sheet.height, 30: 0 });

  dxf.addLayer('CORTE', Colors.Red, 'CONTINUOUS');
  dxf.addLayer('GRABADO', Colors.Blue, 'CONTINUOUS');

  // Placas
  for (const plate of sheet.plates) {
    for (const poly of plate.polygons) {
      const extPts: Point2D[] = poly.exterior.map(([x, y]) => [
        x + plate.xOffset,
        y + plate.yOffset,
      ]);
      addDxfClosedPolyline(dxf, 'CORTE', extPts);

      for (const hole of poly.holes) {
        const holePts: Point2D[] = hole.map(([x, y]) => [
          x + plate.xOffset,
          y + plate.yOffset,
        ]);
        addDxfClosedPolyline(dxf, 'CORTE', holePts);
      }
    }

    // Círculos de alineación de discos en GRABADO (exporter.py:322-338):
    // - gapIndex === plateIndex (isDashed === false) -> 1 CIRCLE sólido
    // - gapIndex === plateIndex - 1 (isDashed === true) -> N ARC punteados
    // Ambos con r = (d.diameter + engraveClearance) / 2
    for (const disc of plate.discs) {
      const cx = plate.xOffset + disc.x;
      const cy = plate.yOffset + disc.y;
      const r = disc.diameter * 0.5;
      if (disc.isDashed) {
        addDxfDashedCircle(dxf, 'GRABADO', cx, cy, r);
      } else {
        dxf.addCircle(point3d(cx, cy, 0), r, { layerName: 'GRABADO' });
      }
    }

    addDxfCenteredText(
      dxf,
      'GRABADO',
      plate.labelX,
      plate.labelY,
      plate.labelSize,
      plate.labelText
    );
  }

  // Bandejas de discos (GRABADO)
  for (const grp of sheet.discGroups) {
    const x0 = grp.trayX;
    const y0 = grp.trayY;
    const x1 = grp.trayX + grp.trayW;
    const y1 = grp.trayY + grp.trayH;
    addDxfClosedPolyline(dxf, 'GRABADO', [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]);
    dxf.addLine(point3d(grp.labelSepX, y0, 0), point3d(grp.labelSepX, y1, 0), {
      layerName: 'GRABADO',
    });

    const labelZoneW = grp.labelSepX - grp.trayX;
    const lblCx = grp.trayX + labelZoneW * 0.5;
    const lblCy = grp.trayY + grp.trayH * 0.5;
    const lblSize = Math.max(
      2.0,
      Math.min(4.0, (labelZoneW * 0.85) / Math.max(1, grp.label.length * 0.6))
    );
    addDxfCenteredText(dxf, 'GRABADO', lblCx, lblCy, lblSize, grp.label);
  }

  // Discos (CORTE con compensación de kerf + etiqueta en GRABADO)
  for (const disc of sheet.discs) {
    const cutRadius = (disc.diameter + sheet.kerf) * 0.5;
    dxf.addCircle(point3d(disc.x, disc.y, 0), cutRadius, {
      layerName: 'CORTE',
    });
    const lblSize = Math.max(1.5, Math.min(3.5, disc.diameter * 0.18));
    addDxfCenteredText(dxf, 'GRABADO', disc.x, disc.y, lblSize, disc.label);
  }

  return dxf.stringify();
}

export function getSheetFileBaseName(sheet: SheetLayout, prefix = 'hoja'): string {
  const num = sheet.sheetIndex + 1;
  const tipo = sheet.sheetType === 'plates' ? 'placas' : 'discos';
  return `${prefix}_${num}_${tipo}`;
}

export async function exportAllSheetsZip(
  sheets: SheetLayout[],
  prefix = 'hoja'
): Promise<Blob> {
  const zip = new JSZip();
  for (const sheet of sheets) {
    const base = getSheetFileBaseName(sheet, prefix);
    zip.file(`${base}.dxf`, generateSheetDxf(sheet));
    zip.file(
      `${base}.svg`,
      generateSheetSvg(sheet, { includeReference: true })
    );
  }
  return zip.generateAsync({ type: 'blob' });
}
```


---

### FASE 5: Store Zustand, Visor 3D React Three Fiber e Interacción de Discos

#### Chunk 5.1: Store Global con Selectores Atómicos, `modeAddDiscs`, Reescalado de Discos y Banner de Autosave (`src/store/useSculptureStore.ts`) (Correcciones #1, #5c, #5f, B1, B5, B13, B14, B16)

- **Corrección B1 (Control de carreras de Worker y clonado seguro del buffer)**:
  - *Qué estaba mal*: Si el usuario cambiaba parámetros dos veces seguidas, respuestas rezagadas del worker podían sobrescribir un corte más reciente, y transferir el `ArrayBuffer` del `BufferAttribute` dejaba la geometría de Three.js con un `detached ArrayBuffer`.
  - *Regla nueva*:
    1. Mantener contadores monotónicos `currentMeshId` y `latestJobId`.
    2. Al cargar una malla, enviar `SET_MESH` transfiriendo **un clon** (`posArray.slice().buffer`), nunca el buffer subyacente del `BufferGeometry`.
    3. Al recibir `SLICE_SUCCESS` o `SLICE_ERROR`, ignorar cualquier mensaje cuyo `jobId !== latestJobId` o `meshId !== currentMeshId`.
  - *Criterio de aceptación*: Test unitario de concurrencia simula dos llamadas consecutivas a `runSlice()` y verifica que una respuesta con `jobId` antiguo es descartada sin mutar `sliceResult`.
- **Corrección #1 + #5c + #5f + B16 (`modeAddDiscs`, reescalado `(x, y)` por `newAutoScale / oldAutoScale`, sincronización `thickness`/`gap` y banner de Autosave)**:
  - *Qué estaba mal*:
    1. Se había eliminado `modeAddDiscs` del store, haciendo que el plano de colocación estuviera activo siempre y creara discos al orbitar.
    2. En `runSlice`, no se reescalaban las coordenadas `(x, y)` de los discos por `result.scaleFactor / prevScaleFactor` antes de `purgeInvalidDiscs`.
    3. Al iniciar la app se sobrescribía el estado con el autosave sin preguntar al usuario.
  - *Regla nueva*:
    1. Reintroducir `modeAddDiscs: boolean` (por defecto `false`) y `setModeAddDiscs(enabled: boolean)` en `useSculptureStore`.
    2. En `runSlice`, si `!axisChanged` y existía un `prevScaleFactor > 0`, invocar `manager.rescalePositions(result.scaleFactor / prevScaleFactor)` **antes** de `manager.purgeInvalidDiscs(result.plates)` (`main.py:201-212`).
    3. En `useSculptureStore`, mantener `pendingAutosave: PendingAutosaveSession | null` y las acciones `checkAutosaveOnStartup()`, `restoreAutosaveSession()` y `discardAutosaveSession()`. `checkAutosaveOnStartup()` solo detecta la sesión guardada para mostrar el banner **"Restaurar sesión / Descartar"** sin sobrescribir el estado sin permiso del usuario.
    4. Sincronizar `thickness` $\to$ `gap` mientras `gapManuallyEdited === false` (`ui.py:265-272`).
  - *Criterio de aceptación*: Tests unitarios verifican `modeAddDiscs`, el reescalado de `(x, y)` por `newAutoScale / oldAutoScale` antes de `purgeInvalidDiscs`, la no-sobrescritura automática en `checkAutosaveOnStartup()` y la sincronización `thickness`/`gap`.

##### Archivo `web/src/store/useSculptureStore.ts`
```ts
import { create } from 'zustand';
import * as THREE from 'three';
import { DEFAULT_PARAMS } from '../core/params';
import { DiscManager } from '../core/discs';
import { loadMeshFromBuffer } from '../core/meshLoader';
import { generateLayouts } from '../core/layout';
import {
  checkParamsCompatibility,
  parseProjectJson,
  serializeProjectJson,
  type ParsedProjectData,
} from '../core/project';
import {
  clearAutosaveStorage,
  loadMeshBufferFromIndexedDB,
  loadProjectFromLocalStorage,
  saveMeshBufferToIndexedDB,
  saveProjectToLocalStorage,
  type AutosaveSessionSnapshot,
  type StoredMeshRecord,
} from '../core/autosave';
import { sliceMesh } from '../core/slicer';
import type {
  Axis,
  Disc,
  MeshMetadata,
  SculptureParams,
  SheetLayout,
  SliceResult,
  WorkerRequest,
  WorkerResponse,
} from '../types/sculpture';

export type CameraPreset = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export type ViewMode = 'original' | 'plates';

export interface PendingAutosaveSession {
  snapshot: AutosaveSessionSnapshot | null;
  meshRecord: StoredMeshRecord | null;
}

export interface SculptureState {
  // Parámetros y banderas
  params: SculptureParams;
  gapManuallyEdited: boolean;
  isResultDirty: boolean;

  // Malla y corte
  meshGeometry: THREE.BufferGeometry | null;
  meshMetadata: MeshMetadata | null;
  sliceResult: SliceResult | null;
  isSlicing: boolean;
  lastSliceAxis: Axis | null;
  lastSliceDurationMs: number | null;

  // Navegación de pisos y vista
  viewMode: ViewMode;
  wireframe: boolean;
  showAllFloors: boolean;
  activeFloor: number; // Índice físico 0 .. params.plates - 1

  // Discos e interacción
  modeAddDiscs: boolean;
  discManager: DiscManager;
  discs: Disc[];
  selectedDiscId: number | null;
  canUndo: boolean;
  canRedo: boolean;

  // Cámara
  cameraPreset: CameraPreset;
  cameraPresetTrigger: number;

  // Modal de previsualización de hojas 2D
  sheetLayouts: SheetLayout[] | null;
  isPreviewModalOpen: boolean;

  // Sesión de autosave pendiente de confirmación (Corrección #5f)
  pendingAutosave: PendingAutosaveSession | null;

  // Mensajes de estado y errores
  statusMessage: string;
  errorMessage: string | null;

  // Acciones
  setParam: <K extends keyof SculptureParams>(key: K, value: SculptureParams[K]) => void;
  loadMeshArrayBuffer: (buffer: ArrayBuffer, fileName: string, autoSlice?: boolean) => void;
  runSlice: () => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  toggleWireframe: () => void;
  setShowAllFloors: (showAll: boolean) => void;
  setActiveFloor: (floorIndex: number) => void;
  stepFloor: (delta: 1 | -1) => void;
  setCameraPreset: (preset: CameraPreset) => void;

  // Acciones de discos
  setModeAddDiscs: (enabled: boolean) => void;
  addDiscAtActiveFloor: (x: number, y: number) => void;
  commitDiscMove: (discId: number, startX: number, startY: number, finalX: number, finalY: number) => boolean;
  selectDisc: (discId: number | null) => void;
  updateSelectedDiscDiameter: (newDiameter: number) => void;
  deleteSelectedDisc: () => void;
  clearActiveFloorDiscs: () => void;
  clearAllDiscs: () => void;
  undoDiscs: () => void;
  redoDiscs: () => void;

  // Proyecto, autosave y exportación
  checkAutosaveOnStartup: () => Promise<void>;
  restoreAutosaveSession: () => Promise<void>;
  discardAutosaveSession: () => Promise<void>;
  exportProjectJsonString: () => string;
  importProjectFromParsed: (parsed: ParsedProjectData, forceAdapt?: boolean) => Promise<{ needsConfirmation: boolean }>;
  openSheetPreviewModal: () => void;
  closeSheetPreviewModal: () => void;
  clearError: () => void;
}

let workerInstance: Worker | null = null;
let currentMeshId = 0;
let latestJobId = 0;

function getNextNonEmptyFloor(
  plates: SliceResult['plates'],
  fromFloor: number,
  delta: 1 | -1
): number {
  let idx = fromFloor + delta;
  while (idx >= 0 && idx < plates.length) {
    if (plates[idx] && plates[idx].length > 0) {
      return idx;
    }
    idx += delta;
  }
  return fromFloor;
}

function getFirstNonEmptyFloor(plates: SliceResult['plates']): number {
  for (let i = 0; i < plates.length; i++) {
    if (plates[i] && plates[i].length > 0) return i;
  }
  return 0;
}

export const useSculptureStore = create<SculptureState>((set, get) => {
  const manager = new DiscManager(DEFAULT_PARAMS.discDiameter);

  function syncDiscsState(statusMsg?: string): void {
    const state = get();
    const allDiscs = manager.getAllDiscs();
    const selectedExists =
      state.selectedDiscId !== null &&
      allDiscs.some((d) => d.id === state.selectedDiscId);

    set({
      discs: allDiscs,
      selectedDiscId: selectedExists ? state.selectedDiscId : null,
      canUndo: manager.canUndo(),
      canRedo: manager.canRedo(),
      ...(statusMsg ? { statusMessage: statusMsg } : {}),
    });

    saveProjectToLocalStorage(
      get().params,
      allDiscs,
      get().meshMetadata?.fileName ?? null
    );
  }

  return {
    params: { ...DEFAULT_PARAMS },
    gapManuallyEdited: false,
    isResultDirty: false,

    meshGeometry: null,
    meshMetadata: null,
    sliceResult: null,
    isSlicing: false,
    lastSliceAxis: null,
    lastSliceDurationMs: null,

    viewMode: 'original',
    wireframe: false,
    showAllFloors: true,
    activeFloor: 0,

    modeAddDiscs: false,
    discManager: manager,
    discs: [],
    selectedDiscId: null,
    canUndo: false,
    canRedo: false,

    cameraPreset: 'iso',
    cameraPresetTrigger: 0,

    sheetLayouts: null,
    isPreviewModalOpen: false,

    pendingAutosave: null,

    statusMessage: 'Carga un modelo 3D (.obj, .stl, .3mf, .ply) para comenzar',
    errorMessage: null,

    setParam: (key, value) => {
      const state = get();
      const nextParams: SculptureParams = { ...state.params, [key]: value };
      let nextGapEdited = state.gapManuallyEdited;

      // Sincronización exacta de ui.py:265-272
      if (key === 'thickness' && !state.gapManuallyEdited) {
        nextParams.gap = value as number;
      } else if (key === 'gap') {
        nextGapEdited = true;
      } else if (key === 'discDiameter') {
        try {
          manager.setDefaultDiameter(value as number);
        } catch {
          // Validado al aplicar
        }
      }

      const geometricKeys: Array<keyof SculptureParams> = [
        'plates',
        'thickness',
        'gap',
        'axis',
      ];
      const marksDirty =
        state.sliceResult !== null && geometricKeys.includes(key);

      set({
        params: nextParams,
        gapManuallyEdited: nextGapEdited,
        isResultDirty: marksDirty ? true : state.isResultDirty,
      });

      saveProjectToLocalStorage(
        nextParams,
        get().discs,
        get().meshMetadata?.fileName ?? null
      );
    },

    loadMeshArrayBuffer: (buffer, fileName, autoSlice = false) => {
      try {
        const prevGeom = get().meshGeometry;
        const { geometry, metadata } = loadMeshFromBuffer(buffer, fileName);
        if (prevGeom) {
          prevGeom.dispose();
        }

        currentMeshId += 1;
        const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
        const clonedPositions = new Float32Array(posAttr.array);

        if (typeof Worker !== 'undefined') {
          if (!workerInstance) {
            workerInstance = new Worker(
              new URL('../worker/slicer.worker.ts', import.meta.url),
              { type: 'module' }
            );
          }
          const msg: WorkerRequest = {
            type: 'SET_MESH',
            meshId: currentMeshId,
            positions: clonedPositions,
          };
          workerInstance.postMessage(msg, [clonedPositions.buffer]);
        }

        manager.clearAll(false);
        void saveMeshBufferToIndexedDB(fileName, buffer);

        set({
          meshGeometry: geometry,
          meshMetadata: metadata,
          sliceResult: null,
          isResultDirty: false,
          viewMode: 'original',
          modeAddDiscs: false,
          discs: [],
          selectedDiscId: null,
          canUndo: false,
          canRedo: false,
          errorMessage: null,
          statusMessage: `Modelo cargado: ${fileName} (${metadata.faceCount.toLocaleString()} caras)`,
          cameraPreset: 'iso',
          cameraPresetTrigger: get().cameraPresetTrigger + 1,
        });

        if (autoSlice) {
          void get().runSlice();
        }
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },

    runSlice: async () => {
      const state = get();
      if (!state.meshGeometry) {
        set({ errorMessage: 'Primero debes cargar un archivo de malla 3D.' });
        return;
      }

      const jobId = ++latestJobId;
      const meshId = currentMeshId;
      const paramsSnapshot = { ...state.params };
      const prevScaleFactor = state.sliceResult?.scaleFactor ?? null;
      const axisChanged =
        state.lastSliceAxis !== null &&
        state.lastSliceAxis !== paramsSnapshot.axis;

      set({
        isSlicing: true,
        errorMessage: null,
        statusMessage: 'Calculando planos de corte...',
      });

      const applySliceOutcome = (result: SliceResult, durationMs: number) => {
        if (jobId !== latestJobId || meshId !== currentMeshId) {
          return; // Resultado obsoleto descartado
        }

        let removedDiscs = 0;
        if (axisChanged) {
          removedDiscs = manager.getAllDiscs().length;
          manager.clearAll(true);
        } else {
          // Corrección #5c: reescalar (x, y) por newAutoScale / oldAutoScale antes de purgeInvalidDiscs
          if (prevScaleFactor !== null && prevScaleFactor > 0) {
            const scaleRatio = result.scaleFactor / prevScaleFactor;
            manager.rescalePositions(scaleRatio);
          }
          removedDiscs = manager.purgeInvalidDiscs(result.plates);
        }

        const firstValidFloor = getFirstNonEmptyFloor(result.plates);
        const currentFloor = get().activeFloor;
        const nextFloor =
          currentFloor < result.plates.length &&
          result.plates[currentFloor]?.length > 0
            ? currentFloor
            : firstValidFloor;

        const validPlatesCount = result.plates.filter((p) => p.length > 0).length;
        const orphanNotice =
          removedDiscs > 0
            ? ` (${removedDiscs} disco(s) fuera de contorno retirados)`
            : '';

        set({
          sliceResult: result,
          isSlicing: false,
          isResultDirty: false,
          lastSliceAxis: paramsSnapshot.axis,
          lastSliceDurationMs: durationMs,
          viewMode: 'plates',
          activeFloor: nextFloor,
        });

        syncDiscsState(
          `Corte completado: ${validPlatesCount}/${result.plates.length} placas válidas en ${durationMs.toFixed(0)} ms${orphanNotice}`
        );
      };

      if (typeof Worker !== 'undefined' && workerInstance) {
        await new Promise<void>((resolve) => {
          const handler = (ev: MessageEvent<WorkerResponse>) => {
            const data = ev.data;
            if (data.jobId !== jobId) return;
            workerInstance?.removeEventListener('message', handler);
            if (data.type === 'SLICE_SUCCESS') {
              applySliceOutcome(data.result, data.durationMs);
            } else {
              set({
                isSlicing: false,
                errorMessage: data.error,
                statusMessage: 'Error durante el corte',
              });
            }
            resolve();
          };
          workerInstance!.addEventListener('message', handler);
          const req: WorkerRequest = {
            type: 'SLICE',
            jobId,
            meshId,
            params: paramsSnapshot,
          };
          workerInstance!.postMessage(req);
        });
      } else {
        // Fallback síncrono (entorno de pruebas Vitest / jsdom)
        try {
          const t0 = performance.now();
          const posAttr = state.meshGeometry.getAttribute(
            'position'
          ) as THREE.BufferAttribute;
          const result = sliceMesh(
            new Float32Array(posAttr.array),
            paramsSnapshot
          );
          applySliceOutcome(result, performance.now() - t0);
        } catch (err) {
          set({
            isSlicing: false,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },

    setViewMode: (mode) => set({ viewMode: mode }),
    toggleWireframe: () => set((s) => ({ wireframe: !s.wireframe })),
    setShowAllFloors: (showAll) => set({ showAllFloors: showAll }),

    setActiveFloor: (floorIndex) => {
      const res = get().sliceResult;
      if (!res) return;
      const clamped = Math.max(0, Math.min(res.plates.length - 1, floorIndex));
      set({ activeFloor: clamped, selectedDiscId: null });
    },

    stepFloor: (delta) => {
      const { sliceResult, activeFloor } = get();
      if (!sliceResult) return;
      const next = getNextNonEmptyFloor(sliceResult.plates, activeFloor, delta);
      set({ activeFloor: next, selectedDiscId: null });
    },

    setCameraPreset: (preset) =>
      set((s) => ({
        cameraPreset: preset,
        cameraPresetTrigger: s.cameraPresetTrigger + 1,
      })),

    setModeAddDiscs: (enabled) => set({ modeAddDiscs: enabled }),

    addDiscAtActiveFloor: (x, y) => {
      const { sliceResult, activeFloor, params } = get();
      if (!sliceResult) return;
      try {
        const outcome = manager.addDisc(
          x,
          y,
          activeFloor,
          sliceResult.plates,
          params.discDiameter,
          true
        );
        set({ selectedDiscId: outcome.primary.id, errorMessage: null });
        const copyMsg = outcome.autoCopied
          ? ` + auto-copia en P${activeFloor + 1}-P${activeFloor + 2}`
          : '';
        syncDiscsState(
          `Disco #${outcome.primary.id} colocado en (${x.toFixed(1)}, ${y.toFixed(1)})${copyMsg}`
        );
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },

    commitDiscMove: (discId, startX, startY, finalX, finalY) => {
      const { sliceResult } = get();
      if (!sliceResult) return false;
      const movedDist = Math.hypot(finalX - startX, finalY - startY);
      if (movedDist < 1e-4) return false;
      const ok = manager.moveDisc(
        discId,
        finalX,
        finalY,
        sliceResult.plates,
        true
      );
      if (ok) {
        syncDiscsState(
          `Disco #${discId} movido a (${finalX.toFixed(1)}, ${finalY.toFixed(1)})`
        );
      }
      return ok;
    },

    selectDisc: (discId) => set({ selectedDiscId: discId }),

    updateSelectedDiscDiameter: (newDiameter) => {
      const { selectedDiscId, sliceResult } = get();
      if (selectedDiscId === null || !sliceResult) return;
      try {
        const ok = manager.setDiameter(
          selectedDiscId,
          newDiameter,
          sliceResult.plates
        );
        if (ok) {
          set({ errorMessage: null });
          syncDiscsState(
            `Diámetro de disco #${selectedDiscId} actualizado a Ø${newDiameter.toFixed(1)} mm`
          );
        }
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },

    deleteSelectedDisc: () => {
      const { selectedDiscId } = get();
      if (selectedDiscId === null) return;
      if (manager.removeDisc(selectedDiscId)) {
        set({ selectedDiscId: null });
        syncDiscsState(`Disco #${selectedDiscId} eliminado`);
      }
    },

    clearActiveFloorDiscs: () => {
      const { activeFloor } = get();
      const count = manager.clearGap(activeFloor);
      if (count > 0) {
        set({ selectedDiscId: null });
        syncDiscsState(
          `Se eliminaron ${count} disco(s) del piso P${activeFloor}-P${activeFloor + 1}`
        );
      }
    },

    clearAllDiscs: () => {
      manager.clearAll(true);
      set({ selectedDiscId: null });
      syncDiscsState('Todos los discos fueron eliminados');
    },

    undoDiscs: () => {
      if (manager.undo()) {
        syncDiscsState('Deshacer aplicado');
      }
    },

    redoDiscs: () => {
      if (manager.redo()) {
        syncDiscsState('Rehacer aplicado');
      }
    },

    checkAutosaveOnStartup: async () => {
      const snapshot = loadProjectFromLocalStorage();
      const meshRecord = await loadMeshBufferFromIndexedDB();
      if (snapshot || meshRecord) {
        set({
          pendingAutosave: { snapshot, meshRecord },
        });
      }
    },

    restoreAutosaveSession: async () => {
      const pending = get().pendingAutosave;
      if (!pending) return;
      set({ pendingAutosave: null });

      if (pending.meshRecord) {
        get().loadMeshArrayBuffer(
          pending.meshRecord.buffer,
          pending.meshRecord.fileName,
          false
        );
      }
      if (pending.snapshot) {
        await get().importProjectFromParsed(
          {
            version: '1.0',
            params: pending.snapshot.params,
            discs: pending.snapshot.discs,
          },
          true
        );
      } else if (pending.meshRecord) {
        await get().runSlice();
      }
      set({ statusMessage: 'Sesión anterior restaurada correctamente' });
    },

    discardAutosaveSession: async () => {
      await clearAutosaveStorage();
      set({
        pendingAutosave: null,
        statusMessage: 'Sesión guardada descartada',
      });
    },

    exportProjectJsonString: () => {
      const { params, discs } = get();
      return serializeProjectJson(params, discs);
    },

    importProjectFromParsed: async (parsed, forceAdapt = false) => {
      const state = get();
      const mergedParams: SculptureParams = {
        ...state.params,
        plates: parsed.params.plates,
        thickness: parsed.params.thickness,
        gap: parsed.params.gap,
        axis: parsed.params.axis,
      };
      const compatible = checkParamsCompatibility(mergedParams, state.params);
      if (!compatible && !forceAdapt && state.sliceResult !== null) {
        return { needsConfirmation: true };
      }

      set({
        params: mergedParams,
        gapManuallyEdited:
          Math.abs(mergedParams.gap - mergedParams.thickness) > 0.01,
      });

      if (state.meshGeometry && (!compatible || state.sliceResult === null)) {
        await get().runSlice();
      }

      manager.loadDiscsFromProject(parsed.discs);
      const currentSlice = get().sliceResult;
      if (currentSlice) {
        manager.purgeInvalidDiscs(currentSlice.plates);
      }
      syncDiscsState('Proyecto cargado correctamente');
      return { needsConfirmation: false };
    },

    openSheetPreviewModal: () => {
      const { sliceResult, discs, params } = get();
      if (!sliceResult) {
        set({ errorMessage: 'Primero debes rebanar el modelo 3D.' });
        return;
      }
      try {
        const layouts = generateLayouts(sliceResult, discs, params);
        set({
          sheetLayouts: layouts,
          isPreviewModalOpen: true,
          errorMessage: null,
        });
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    },

    closeSheetPreviewModal: () => set({ isPreviewModalOpen: false }),
    clearError: () => set({ errorMessage: null }),
  };
});

export { parseProjectJson };
```

---

#### Chunk 5.2: Visor 3D Z-Up, Cámara No-Singular, `modeAddDiscs` (`onClick` con `e.delta <= 5`) y Arrastre con `clampDiscPositionToGap` (`src/components/viewport/*.tsx`) (Correcciones #1, #5d, B4, B5, B7, B9)

- **Corrección B7 (Configuración global `DEFAULT_UP = (0,0,1)`, eliminación de singularidad en Top/Bottom y `logarithmicDepthBuffer`)**:
  - *Qué estaba mal*: Pasar `camera={{ up: [0,0,1] }}` como prop al `<Canvas>` no cambiaba `THREE.Object3D.DEFAULT_UP`, y colocar la cámara en `(0, 0, dist)` mirando a `(0, 0, 0)` con `up = (0, 0, 1)` es colineal ($\mathbf{v}_{\text{look}} \times \mathbf{u}_{\text{up}} = \mathbf{0}$), bloqueando `OrbitControls` en las vistas Superior e Inferior. Además `near: 0.1, far: 50000` producía z-fighting entre los discos y las caras de las placas.
  - *Regla nueva*:
    1. Ejecutar `THREE.Object3D.DEFAULT_UP.set(0, 0, 1)` en `src/main.tsx` antes de montar React.
    2. Activar `gl={{ antialias: true, logarithmicDepthBuffer: true }}` en `<Canvas>` y ajustar `near = Math.max(0.2, span * 0.001)` y `far = Math.max(5000, span * 25)` dinámicamente en `CameraRig.tsx`.
    3. En `CameraRig.tsx`, para el preset `'top'` colocar la cámara en `(0, -1e-4 * dist, dist)` con `up = (0, 1, 0)` (de modo que en pantalla $+X$ quede a la derecha y $+Y$ hacia arriba sin singularidad de producto cruz), y para `'bottom'` en `(0, -1e-4 * dist, -dist)` con `up = (0, 1, 0)`.
  - *Criterio de aceptación*: Al activar la vista `Top`, un punto en $(+10, +20, 0)$ se proyecta en el cuadrante superior-derecho del viewport y `OrbitControls` no devuelve `NaN` en `camera.matrixWorld`.
- **Corrección B9 (Prevención de fugas de VRAM con `useMemo` + `dispose()` y bordes ligeros con `<lineSegments>` en lugar de `<Edges>`)**:
  - *Qué estaba mal*: Crear `new THREE.ExtrudeGeometry(...)` dentro del render sin `useMemo` ni `dispose()` fugaba hasta 200 geometrías en GPU en cada re-render, y `<Edges>` de `@react-three/drei` calculaba ángulos diedros en CPU congelando el hilo principal.
  - *Regla nueva*:
    1. En `SlicedPlatesView.tsx`, construir las geometrías extruidas y las geometrías de bordes (`THREE.BufferGeometry` construida directamente desde los anillos 2D en $z = z_{\text{bottom}}$ y $z = z_{\text{top}}$) dentro de un `useMemo([sliceResult, params.thickness])`, e invocar `.dispose()` sobre todas ellas dentro de un `useEffect` de limpieza.
    2. Nunca usar `<Edges>` de `drei`.
  - *Criterio de aceptación*: Cambiar de piso activo (`activeFloor`) 50 veces seguidas no ejecuta `new THREE.ExtrudeGeometry` ninguna vez adicional (`renderer.info.memory.geometries` permanece constante).
- **Corrección #1 + #5d + B4 + B5 (Colocación de discos solo con `modeAddDiscs === true`, `onClick` y `e.delta <= 5`, y arrastre con `clampDiscPositionToGap`)**:
  - *Qué estaba mal*:
    1. Usar `onPointerDown` sobre un plano receptor siempre activo hacía que cualquier intento de orbitar la cámara con botón izquierdo creara un disco o lanzara `ValidationError` si el rayo caía fuera de la placa.
    2. Las placas superiores translúcidas interceptaban el rayo del puntero cuando `modeAddDiscs` estaba activo.
    3. Al arrastrar un disco rápidamente hacia el borde, `isDiscValidForGap` devolvía `false` y el disco se congelaba lejos del borde.
  - *Regla nueva*:
    1. En `SlicedPlatesView.tsx`, cuando `modeAddDiscs === true`, desactivar el raycast de las mallas de las placas (`raycast={modeAddDiscs ? () => null : undefined}`) para que no bloqueen el plano de colocación. En modo selección (`modeAddDiscs === false`), `Alt+Click` o doble click sobre una placa cambia de piso activo.
    2. En `InteractiveDiscsView.tsx`, el plano receptor en $z_{\text{top}}$ **solo se monta y responde cuando `modeAddDiscs === true`**. En modo selección (`modeAddDiscs === false`), el plano no responde en absoluto.
    3. Colocar discos **únicamente en el evento `onClick`** del plano receptor verificando **`modeAddDiscs === true && e.delta <= 5`**. Así, orbitar o arrastrar la cámara (ej. $100\text{ px}$, `e.delta > 5`) **jamás crea discos ni lanza errores**.
    4. Durante el arrastre de un disco en `handleGlobalPointerMove`, usar `clampDiscPositionToGap(hit.x, hit.y, drag.currentX, drag.currentY, drag.diameter, drag.gapIndex, sliceResult.plates)` para proyectar la posición al punto válido más cercano en cada fotograma sin congelarse en el borde, haciendo un único `commitDiscMove` en `pointerup`.
  - *Criterio de aceptación*: Test E2E en Playwright arrastra la cámara $100\text{ px}$ sobre la placa con `modeAddDiscs = true` y con `modeAddDiscs = false` verificando que se crean `0` discos y `0` errores; un click estático (`e.delta <= 5`) con `modeAddDiscs = true` coloca el disco en `activeFloor`.

##### Archivo `web/src/components/viewport/CameraRig.tsx`
```tsx
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useSculptureStore } from '../../store/useSculptureStore';

export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const camera = useThree((s) => s.camera as THREE.PerspectiveCamera);
  const preset = useSculptureStore((s) => s.cameraPreset);
  const trigger = useSculptureStore((s) => s.cameraPresetTrigger);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);

  useEffect(() => {
    let span = 220;
    if (sliceResult) {
      const [[minX, minY], [maxX, maxY]] = sliceResult.scaledBounds;
      span = Math.max(maxX - minX, maxY - minY, sliceResult.scaledHeight, 50);
    } else if (meshMetadata) {
      span = Math.max(...meshMetadata.extents, 50);
    }

    const dist = span * 1.65;
    camera.near = Math.max(0.2, span * 0.001);
    camera.far = Math.max(5000, span * 25);
    camera.updateProjectionMatrix();

    // Evitar colinealidad con up=(0,0,1) en vistas Top y Bottom
    if (preset === 'top') {
      camera.up.set(0, 1, 0);
      camera.position.set(0, -1e-4 * dist, dist);
    } else if (preset === 'bottom') {
      camera.up.set(0, 1, 0);
      camera.position.set(0, -1e-4 * dist, -dist);
    } else {
      camera.up.set(0, 0, 1);
      if (preset === 'front') camera.position.set(0, -dist, 0);
      else if (preset === 'back') camera.position.set(0, dist, 0);
      else if (preset === 'left') camera.position.set(-dist, 0, 0);
      else if (preset === 'right') camera.position.set(dist, 0, 0);
      else camera.position.set(dist * 0.75, -dist * 0.75, dist * 0.65);
    }

    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [preset, trigger, sliceResult, meshMetadata, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
    />
  );
}
```

##### Archivo `web/src/components/viewport/SlicedPlatesView.tsx`
```tsx
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';
import type { PlateContour, Point2D } from '../../types/sculpture';

interface BuiltPlateGeometry {
  plateIndex: number;
  zCenter: number;
  color: THREE.Color;
  meshGeometry: THREE.BufferGeometry;
  edgesGeometry: THREE.BufferGeometry;
}

const NOOP_RAYCAST = () => null;

function buildPlateEdgesBufferGeometry(
  plate: PlateContour,
  halfThickness: number
): THREE.BufferGeometry {
  const positions: number[] = [];

  const addRingLines = (ring: Point2D[], z: number) => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % n];
      positions.push(x0, y0, z, x1, y1, z);
    }
  };

  for (const poly of plate) {
    addRingLines(poly.exterior, -halfThickness);
    addRingLines(poly.exterior, halfThickness);
    for (const hole of poly.holes) {
      addRingLines(hole, -halfThickness);
      addRingLines(hole, halfThickness);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  return geom;
}

function buildPlateExtrudeGeometry(
  plate: PlateContour,
  thickness: number
): THREE.BufferGeometry {
  const shapes: THREE.Shape[] = [];

  for (const poly of plate) {
    if (poly.exterior.length < 3) continue;
    const shape = new THREE.Shape();
    poly.exterior.forEach(([x, y], idx) => {
      if (idx === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();

    for (const hole of poly.holes) {
      if (hole.length < 3) continue;
      const holePath = new THREE.Path();
      hole.forEach(([x, y], idx) => {
        if (idx === 0) holePath.moveTo(x, y);
        else holePath.lineTo(x, y);
      });
      holePath.closePath();
      shape.holes.push(holePath);
    }
    shapes.push(shape);
  }

  const extrudeGeom = new THREE.ExtrudeGeometry(shapes, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  // Centrar extrusión en [-thickness/2, +thickness/2] alrededor de zCenter
  extrudeGeom.translate(0, 0, -thickness * 0.5);
  return extrudeGeom;
}

export function SlicedPlatesView() {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const thickness = useSculptureStore((s) => s.params.thickness);
  const wireframe = useSculptureStore((s) => s.wireframe);
  const showAllFloors = useSculptureStore((s) => s.showAllFloors);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const modeAddDiscs = useSculptureStore((s) => s.modeAddDiscs);
  const setActiveFloor = useSculptureStore((s) => s.setActiveFloor);

  const builtPlates = useMemo<BuiltPlateGeometry[]>(() => {
    if (!sliceResult) return [];
    const total = sliceResult.plates.length;
    const list: BuiltPlateGeometry[] = [];

    for (let i = 0; i < total; i++) {
      const contour = sliceResult.plates[i];
      if (!contour || contour.length === 0) continue;

      // Color HSV estable basado en índice físico i / total (viewer.py:390)
      const hue = total > 1 ? (i / total) * 0.78 : 0.55;
      const color = new THREE.Color().setHSL(hue, 0.72, 0.56);

      const meshGeometry = buildPlateExtrudeGeometry(contour, thickness);
      const edgesGeometry = buildPlateEdgesBufferGeometry(
        contour,
        thickness * 0.5
      );

      list.push({
        plateIndex: i,
        zCenter: sliceResult.zPositions[i],
        color,
        meshGeometry,
        edgesGeometry,
      });
    }
    return list;
  }, [sliceResult, thickness]);

  // Liberación explícita de VRAM al desmontar o recalcular
  useEffect(() => {
    return () => {
      for (const item of builtPlates) {
        item.meshGeometry.dispose();
        item.edgesGeometry.dispose();
      }
    };
  }, [builtPlates]);

  if (!sliceResult) return null;

  return (
    <group>
      {builtPlates.map((item) => {
        const isCurrent = item.plateIndex === activeFloor;
        const isNextUpper = item.plateIndex === activeFloor + 1;

        if (!showAllFloors && !isCurrent && !isNextUpper) {
          return null;
        }

        const opacity = isCurrent
          ? 0.92
          : isNextUpper && !showAllFloors
            ? 0.24
            : showAllFloors
              ? 0.16
              : 0.0;

        return (
          <group
            key={item.plateIndex}
            position={[0, 0, item.zCenter]}
          >
            <mesh
              geometry={item.meshGeometry}
              // En modo colocación (modeAddDiscs) o en placas no activas, desactivar raycast para no interceptar el plano Z_top
              raycast={modeAddDiscs ? NOOP_RAYCAST : undefined}
              onClick={(e) => {
                if (!modeAddDiscs && e.altKey && e.delta <= 5) {
                  e.stopPropagation();
                  setActiveFloor(item.plateIndex);
                }
              }}
              onDoubleClick={(e) => {
                if (!modeAddDiscs) {
                  e.stopPropagation();
                  setActiveFloor(item.plateIndex);
                }
              }}
            >
              <meshStandardMaterial
                color={isCurrent ? '#6366F1' : item.color}
                wireframe={wireframe}
                transparent={!isCurrent}
                opacity={opacity}
                depthWrite={isCurrent}
                roughness={0.45}
                metalness={0.1}
              />
            </mesh>
            <lineSegments geometry={item.edgesGeometry} raycast={NOOP_RAYCAST}>
              <lineBasicMaterial
                color={isCurrent ? '#E0E7FF' : isNextUpper ? '#F59E0B' : '#3F3F46'}
                transparent={!isCurrent}
                opacity={isCurrent ? 0.95 : isNextUpper ? 0.65 : 0.25}
              />
            </lineSegments>
          </group>
        );
      })}
    </group>
  );
}
```

##### Archivo `web/src/components/viewport/InteractiveDiscsView.tsx`
```tsx
import { useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { clampDiscPositionToGap } from '../../core/geometry2d';
import { useSculptureStore } from '../../store/useSculptureStore';
import type { Disc } from '../../types/sculpture';

interface DragState {
  discId: number;
  gapIndex: number;
  diameter: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  meshGroup: THREE.Group;
}

export function InteractiveDiscsView() {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const thickness = useSculptureStore((s) => s.params.thickness);
  const gap = useSculptureStore((s) => s.params.gap);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const showAllFloors = useSculptureStore((s) => s.showAllFloors);
  const modeAddDiscs = useSculptureStore((s) => s.modeAddDiscs);
  const discs = useSculptureStore((s) => s.discs);
  const selectedDiscId = useSculptureStore((s) => s.selectedDiscId);
  const addDiscAtActiveFloor = useSculptureStore((s) => s.addDiscAtActiveFloor);
  const selectDisc = useSculptureStore((s) => s.selectDisc);
  const commitDiscMove = useSculptureStore((s) => s.commitDiscMove);

  const controls = useThree((s) => s.controls as { enabled?: boolean } | null);
  const dragRef = useRef<DragState | null>(null);
  const discGroupRefs = useRef<Map<number, THREE.Group>>(new Map());

  // Plano matemático en Z_top de la placa activa para colocación y arrastre sin interferencia de placas translúcidas
  const activeMathPlane = useMemo(() => {
    if (!sliceResult || activeFloor >= sliceResult.zPositions.length) {
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    }
    const zTop = sliceResult.zPositions[activeFloor] + thickness * 0.5;
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), -zTop);
  }, [sliceResult, activeFloor, thickness]);

  if (!sliceResult) return null;

  const canPlaceOnActiveFloor = activeFloor < sliceResult.plates.length - 1;
  const activeZTop =
    (sliceResult.zPositions[activeFloor] ?? 0) + thickness * 0.5;

  // Corrección #1: Colocar discos SOLO en onClick, con e.delta <= 5 y modeAddDiscs === true.
  // Orbitar (arrastrar > 5 px) o estar en modo selección (!modeAddDiscs) jamás crea discos ni lanza errores.
  const handlePlaneClick = (e: ThreeEvent<MouseEvent>) => {
    if (!modeAddDiscs || !canPlaceOnActiveFloor) return;
    if (e.button !== 0 || e.altKey) return;
    if (e.delta > 5) return;
    if (dragRef.current) return;
    const hit = new THREE.Vector3();
    if (e.ray.intersectPlane(activeMathPlane, hit)) {
      e.stopPropagation();
      addDiscAtActiveFloor(hit.x, hit.y);
    }
  };

  const handleDiscPointerDown = (e: ThreeEvent<PointerEvent>, disc: Disc) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectDisc(disc.id);

    if (disc.gapIndex !== activeFloor) return;
    const groupObj = discGroupRefs.current.get(disc.id);
    if (!groupObj) return;

    if (controls && 'enabled' in controls) {
      controls.enabled = false;
    }
    (e.target as HTMLElement | null)?.setPointerCapture?.(e.pointerId);

    dragRef.current = {
      discId: disc.id,
      gapIndex: disc.gapIndex,
      diameter: disc.diameter,
      startX: disc.x,
      startY: disc.y,
      currentX: disc.x,
      currentY: disc.y,
      meshGroup: groupObj,
    };
  };

  const handleGlobalPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();

    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(activeMathPlane, hit)) return;

    // Corrección #5d: proyectar al punto válido más cercano con clampDiscPositionToGap
    // para que un arrastre rápido pegado al borde se deslice sin congelarse.
    const [clampedX, clampedY] = clampDiscPositionToGap(
      hit.x,
      hit.y,
      drag.currentX,
      drag.currentY,
      drag.diameter,
      drag.gapIndex,
      sliceResult.plates
    );
    drag.currentX = clampedX;
    drag.currentY = clampedY;
    drag.meshGroup.position.x = clampedX;
    drag.meshGroup.position.y = clampedY;
  };

  const handleGlobalPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();

    if (controls && 'enabled' in controls) {
      controls.enabled = true;
    }

    commitDiscMove(
      drag.discId,
      drag.startX,
      drag.startY,
      drag.currentX,
      drag.currentY
    );
    dragRef.current = null;
  };

  const [[minX, minY], [maxX, maxY]] = sliceResult.scaledBounds;
  const planeW = Math.max(500, (maxX - minX) * 3);
  const planeH = Math.max(500, (maxY - minY) * 3);

  return (
    <group
      onPointerMove={handleGlobalPointerMove}
      onPointerUp={handleGlobalPointerUp}
    >
      {/* Plano receptor en Z_top activo SOLO cuando modeAddDiscs === true (en modo selección no responde) */}
      {modeAddDiscs && canPlaceOnActiveFloor && (
        <mesh
          name="disc-placement-plane"
          position={[0, 0, activeZTop]}
          onClick={handlePlaneClick}
        >
          <planeGeometry args={[planeW, planeH]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {discs.map((disc) => {
        const isCurrentGap = disc.gapIndex === activeFloor;
        if (!showAllFloors && !isCurrentGap) return null;

        const zBase =
          (sliceResult.zPositions[disc.gapIndex] ?? 0) + thickness * 0.5;
        const zCenter = zBase + gap * 0.5;
        const isSelected = disc.id === selectedDiscId;
        const radius = disc.diameter * 0.5;

        return (
          <group
            key={disc.id}
            ref={(node) => {
              if (node) discGroupRefs.current.set(disc.id, node);
              else discGroupRefs.current.delete(disc.id);
            }}
            position={[disc.x, disc.y, zCenter]}
            onPointerDown={(e) => handleDiscPointerDown(e, disc)}
          >
            {/* Cilindro orientado a lo largo de +Z (rotado +90° en X desde el cilindro Y-up de Three.js) */}
            <mesh rotation={[Math.PI * 0.5, 0, 0]}>
              <cylinderGeometry args={[radius, radius, gap, 32]} />
              <meshStandardMaterial
                color={
                  isSelected
                    ? '#FBBF24'
                    : isCurrentGap
                      ? '#F59E0B'
                      : '#78350F'
                }
                transparent={!isCurrentGap}
                opacity={isCurrentGap ? 0.96 : 0.38}
                roughness={0.3}
                metalness={0.2}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
```


##### Archivo `web/src/components/viewport/OriginalMeshView.tsx`
```tsx
import { useMemo } from 'react';
import * as THREE from 'three';
import { useSculptureStore } from '../../store/useSculptureStore';

export function OriginalMeshView() {
  const meshGeometry = useSculptureStore((s) => s.meshGeometry);
  const wireframe = useSculptureStore((s) => s.wireframe);

  // Centrar visualmente la malla original en (0,0,0) sin duplicar el BufferGeometry
  const centerOffset = useMemo<[number, number, number]>(() => {
    if (!meshGeometry) return [0, 0, 0];
    meshGeometry.computeBoundingBox();
    const bb = meshGeometry.boundingBox;
    if (!bb) return [0, 0, 0];
    return [
      -0.5 * (bb.min.x + bb.max.x),
      -0.5 * (bb.min.y + bb.max.y),
      -0.5 * (bb.min.z + bb.max.z),
    ];
  }, [meshGeometry]);

  if (!meshGeometry) return null;

  return (
    <mesh geometry={meshGeometry} position={centerOffset}>
      <meshStandardMaterial
        color="#6366F1"
        wireframe={wireframe}
        roughness={0.42}
        metalness={0.15}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
```

##### Archivo `web/src/components/viewport/Viewport3D.tsx`
```tsx
import { Canvas } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid } from '@react-three/drei';
import { useSculptureStore } from '../../store/useSculptureStore';
import { CameraRig } from './CameraRig';
import { OriginalMeshView } from './OriginalMeshView';
import { SlicedPlatesView } from './SlicedPlatesView';
import { InteractiveDiscsView } from './InteractiveDiscsView';

export function Viewport3D() {
  const viewMode = useSculptureStore((s) => s.viewMode);

  return (
    <div className="relative w-full h-full bg-[#09090B]">
      <Canvas
        gl={{
          antialias: true,
          logarithmicDepthBuffer: true,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: 42, position: [250, -250, 200] }}
      >
        <color attach="background" args={['#09090B']} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[300, -250, 400]} intensity={0.95} />
        <directionalLight position={[-250, 300, -200]} intensity={0.4} />

        {/* Grilla rotada +90° en X para reposar sobre el plano XY (Z=0) */}
        <Grid
          rotation={[Math.PI * 0.5, 0, 0]}
          args={[2000, 2000]}
          cellSize={10}
          cellThickness={0.5}
          cellColor="#18181B"
          sectionSize={100}
          sectionThickness={1}
          sectionColor="#27272A"
          fadeDistance={1800}
          infiniteGrid
        />

        {viewMode === 'original' ? (
          <OriginalMeshView />
        ) : (
          <>
            <SlicedPlatesView />
            <InteractiveDiscsView />
          </>
        )}

        <CameraRig />

        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport
            axisColors={['#EF4444', '#22C55E', '#3B82F6']}
            labelColor="#F4F4F5"
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
```

##### Archivo `web/src/main.tsx`
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';
import App from './App';

// Fijar Z-Up global ANTES de instanciar cámaras, controles o grillas (Corrección B7)
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

---

### FASE 6: Componentes HUD, Teclado Seguro, Accesibilidad y Modal 2D

#### Chunk 6.1: Controles UI Accesibles, Modal 2D y Teclado Seguro (`src/components/ui/NumericInput.tsx`, `src/components/modal/SheetPreviewModal.tsx`, `src/App.tsx`) (Correcciones #5a, #5f, B5, B6, C4, C5, C6, C7, D)

- **Corrección #5a + B6 (Alineación estricta de atajos de teclado en `App.tsx` con `§1.3` y guarda de foco)**:
  - *Qué estaba mal*: `App.tsx` asignaba `W` a wireframe, `S` a vista original, `P` a placas, `L` a capas y `1..7` a presets distintos de los definidos en `§1.3` y `§1.4`. Además en el montaje inicial sobrescribía el estado con el autosave sin mostrar el banner de confirmación.
  - *Regla nueva*:
    1. En el listener global `keydown` de `App.tsx`, ignorar eventos cuando el foco está en `<input>`, `<textarea>`, `<select>` o `isContentEditable`.
    2. Implementar exactamente el mapa de `§1.3` / `§1.4`:
       - `W` / `w` o `ArrowUp`: `stepFloor(1)` (piso siguiente).
       - `S` / `s` o `ArrowDown`: `stepFloor(-1)` (piso anterior).
       - `7` (sin `Shift`) o `T` / `t`: `setCameraPreset('top')` (vista Superior / Arriba).
       - `B` / `b` o `Shift + 7` (`e.shiftKey && e.code === 'Digit7'`): `setCameraPreset('bottom')` (vista Inferior / Abajo).
       - `1` o `F` / `f`: `setCameraPreset('front')` (vista Frontal).
       - `3` o `L` / `l`: `setCameraPreset('right')` (vista Lateral).
       - `0` o `P` / `p`: `setCameraPreset('iso')` (vista 3D Isométrica).
       - `Delete` / `Backspace`: `deleteSelectedDisc()`.
       - `Ctrl/Cmd + Z` y `Ctrl/Cmd + Y` (o `Ctrl/Cmd + Shift + Z`): `undoDiscs()` y `redoDiscs()`.
       - Quitar `toggleWireframe`, `setViewMode('original')` y `setShowAllFloors` de esas teclas.
    3. En `useEffect` de inicio de `App.tsx`, invocar únicamente `checkAutosaveOnStartup()` para mostrar el banner **"Restaurar sesión / Descartar"** (prohibido sobrescribir el estado sin confirmación del usuario, Corrección `#5f`).
  - *Criterio de aceptación*: Test unitario / E2E verifica que `W`/`ArrowUp` avanza piso, `S`/`ArrowDown` retrocede piso, `7` activa `top`, `1` activa `front`, `3` activa `right`, `0` activa `iso`, `B` o `Shift+7` activa `bottom`, y que escribir dentro de un `<input>` no dispara ningún atajo.
- **Corrección C4, C5, C6 y C7 (Eliminación de emojis, contraste WCAG AA, español neutro y targets táctiles)**:
  - *Qué estaba mal*: Se usaban emojis (`📂`, `💾`, `▸`) en botones/acordeones, textos secundarios en `#52525B` con ratio `2.6:1` (falla WCAG AA), mezcla de voseo rioplatense con español neutro, e inputs de `26px` de alto imposibles de tocar en pantallas táctiles.
  - *Regla nueva*:
    1. Usar exclusivamente íconos vectoriales de `lucide-react`.
    2. Textos secundarios en `#A1A1AA` (`zinc-400`, contraste `7.3:1` sobre `#121215`).
    3. Textos 100% en español neutro/mexicano.
    4. `NumericInput` usa altura `h-8` (`32px`, `min-h-10` en dispositivos `pointer: coarse`), `aria-label` conectado al `<label htmlFor={id}>`, y hace commit del valor en `onBlur` o `Enter`.
  - *Criterio de aceptación*: Test unitario / E2E verifica que todos los `<NumericInput>` tienen `<label>` asociado accesible por `getByLabelText` y que cambiar el valor y pulsar `Enter` actualiza el parámetro.

##### Archivo `web/src/components/ui/NumericInput.tsx`
```tsx
import { useEffect, useId, useState } from 'react';

export interface NumericInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (newValue: number) => void;
}

export function NumericInput({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled = false,
  onChange,
}: NumericInputProps) {
  const inputId = useId();
  const [draft, setDraft] = useState<string>(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    const rounded = Number.isInteger(step)
      ? Math.round(clamped)
      : Number(clamped.toFixed(3));
    setDraft(String(rounded));
    if (Math.abs(rounded - value) > 1e-6) {
      onChange(rounded);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        className="text-xs font-medium text-[#A1A1AA] select-none"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        <input
          id={inputId}
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDraft(String(value));
              e.currentTarget.blur();
            }
          }}
          className="w-full h-8 coarse:min-h-10 px-2.5 pr-8 rounded-md bg-[#1C1C21] border border-white/[0.08] text-xs font-mono-tabular text-[#F4F4F5] focus:outline-none focus:border-[#0A84FF] disabled:opacity-50"
        />
        {unit && (
          <span className="absolute right-2 text-[11px] text-[#9CA3AF] pointer-events-none select-none">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
```

##### Archivo `web/src/components/modal/SheetPreviewModal.tsx` (Previsualización 2D Interactiva y Descargas `.dxf` / `.svg` / `.zip`)
```tsx
import { useMemo, useState } from 'react';
import {
  Archive,
  Download,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { generateSheetSvg } from '../../core/svgExporter';
import {
  exportAllSheetsZip,
  generateSheetDxf,
  getSheetFileBaseName,
} from '../../core/dxfExporter';
import { useSculptureStore } from '../../store/useSculptureStore';

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SheetPreviewModal() {
  const isOpen = useSculptureStore((s) => s.isPreviewModalOpen);
  const sheets = useSculptureStore((s) => s.sheetLayouts);
  const closeModal = useSculptureStore((s) => s.closeSheetPreviewModal);

  const [activeTab, setActiveTab] = useState(0);
  const [zoom, setZoom] = useState(1.0);

  const currentSheet = sheets?.[activeTab] ?? sheets?.[0] ?? null;

  const svgMarkup = useMemo(() => {
    if (!currentSheet) return '';
    return generateSheetSvg(currentSheet, { includeReference: true });
  }, [currentSheet]);

  if (!isOpen || !sheets || !currentSheet) return null;

  const handleDownloadCurrentDxf = () => {
    const dxf = generateSheetDxf(currentSheet);
    const base = getSheetFileBaseName(currentSheet);
    triggerBlobDownload(
      new Blob([dxf], { type: 'application/dxf;charset=utf-8' }),
      `${base}.dxf`
    );
  };

  const handleDownloadCurrentSvg = () => {
    const svg = generateSheetSvg(currentSheet, { includeReference: true });
    const base = getSheetFileBaseName(currentSheet);
    triggerBlobDownload(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `${base}.svg`
    );
  };

  const handleDownloadAllZip = async () => {
    const zipBlob = await exportAllSheetsZip(sheets);
    triggerBlobDownload(zipBlob, 'cortes_escultura_dxf_svg.zip');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Previsualización de hojas de corte 2D"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
    >
      <div className="flex flex-col w-full max-w-6xl h-[88vh] rounded-xl bg-[#121215] border border-white/10 shadow-2xl overflow-hidden">
        {/* Encabezado y pestañas */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#18181B]">
          <div className="flex items-center gap-2 overflow-x-auto">
            {sheets.map((s, idx) => {
              const label =
                s.sheetType === 'plates'
                  ? `Hoja ${s.sheetIndex + 1} — Placas (${s.materialThickness} mm)`
                  : `Hoja ${s.sheetIndex + 1} — Discos (${s.materialThickness} mm)`;
              return (
                <button
                  key={s.sheetIndex}
                  type="button"
                  onClick={() => setActiveTab(idx)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    idx === activeTab
                      ? 'bg-[#0A84FF] text-white'
                      : 'bg-white/5 text-[#A1A1AA] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Cerrar previsualización"
            className="p-1.5 rounded-md text-[#A1A1AA] hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barra de métricas seleccionables y zoom */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2.5 border-b border-white/10 bg-[#121215] text-xs text-[#A1A1AA] hud-text-selectable">
          <div className="flex flex-wrap items-center gap-4 font-mono-tabular">
            <span>
              Hoja: {currentSheet.width} × {currentSheet.height} mm
            </span>
            <span>
              Usado: {currentSheet.usedWidth} × {currentSheet.usedHeight} mm (
              {currentSheet.occupancyPct}%)
            </span>
            <span className="text-emerald-400">
              Sobrante: {currentSheet.remnantWidth} ×{' '}
              {currentSheet.remnantHeight} mm
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-[#F4F4F5]"
              title="Alejar"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono-tabular text-[#F4F4F5]">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(4.0, z + 0.25))}
              className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-[#F4F4F5]"
              title="Acercar"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1.0)}
              className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-[#F4F4F5]"
              title="Restablecer zoom"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Lienzo SVG */}
        <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-[#09090B]">
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            className="bg-white/95 rounded shadow-lg p-3"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        </div>

        {/* Pie de acciones de exportación */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-white/10 bg-[#18181B]">
          <div className="flex items-center gap-4 text-xs text-[#A1A1AA]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#FF0000] inline-block" /> CORTE
              (#FF0000)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#0000FF] inline-block" /> GRABADO
              (#0000FF)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadCurrentSvg}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 text-xs font-medium text-[#F4F4F5]"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar esta hoja (.svg)
            </button>
            <button
              type="button"
              onClick={handleDownloadCurrentDxf}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#0A84FF] hover:bg-[#0070E0] text-xs font-medium text-white"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar esta hoja (.dxf)
            </button>
            <button
              type="button"
              onClick={handleDownloadAllZip}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
            >
              <Archive className="w-3.5 h-3.5" />
              Exportar todas (.zip DXF + SVG)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

##### Archivo `web/src/App.tsx` (Listener Global de Teclado según §1.3, Guarda de Foco y Detección de Autosave sin Sobrescritura)
```tsx
import { useEffect } from 'react';
import { useSculptureStore } from './store/useSculptureStore';
import { Viewport3D } from './components/viewport/Viewport3D';
import { TopProjectBar } from './components/hud/TopProjectBar';
import { CameraToolbar } from './components/hud/CameraToolbar';
import { FloorNavigatorHUD } from './components/hud/FloorNavigatorHUD';
import { DiscsDockHUD } from './components/hud/DiscsDockHUD';
import { RightInspector } from './components/hud/RightInspector';
import { StatusBarPill } from './components/hud/StatusBarPill';
import { SheetPreviewModal } from './components/modal/SheetPreviewModal';

export default function App() {
  const stepFloor = useSculptureStore((s) => s.stepFloor);
  const setCameraPreset = useSculptureStore((s) => s.setCameraPreset);
  const deleteSelectedDisc = useSculptureStore((s) => s.deleteSelectedDisc);
  const undoDiscs = useSculptureStore((s) => s.undoDiscs);
  const redoDiscs = useSculptureStore((s) => s.redoDiscs);
  const closeSheetPreviewModal = useSculptureStore(
    (s) => s.closeSheetPreviewModal
  );
  const isPreviewModalOpen = useSculptureStore((s) => s.isPreviewModalOpen);
  const checkAutosaveOnStartup = useSculptureStore(
    (s) => s.checkAutosaveOnStartup
  );

  // Corrección #5f: Detectar sesión guardada para mostrar banner "Restaurar sesión / Descartar".
  // Prohibido sobrescribir el estado sin preguntar al usuario.
  useEffect(() => {
    void checkAutosaveOnStartup();
  }, [checkAutosaveOnStartup]);

  // Advertencia beforeunload si hay malla o discos en sesión (Corrección D)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useSculptureStore.getState();
      if (state.meshGeometry !== null || state.discs.length > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Atajos de teclado seguros alineados con §1.3 y Corrección #5a + B6
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const isEditable =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        Boolean(el?.isContentEditable);
      if (isEditable) return;

      if (e.key === 'Escape' && isPreviewModalOpen) {
        e.preventDefault();
        closeSheetPreviewModal();
        return;
      }

      // Undo / Redo (Ctrl/Cmd + Z, Ctrl/Cmd + Y, Ctrl/Cmd + Shift + Z)
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) redoDiscs();
          else undoDiscs();
          return;
        }
        if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          redoDiscs();
          return;
        }
        return; // Ignorar cualquier otra combinación con Ctrl/Cmd
      }

      if (e.altKey) return;

      // Shift + 7 -> Vista Inferior (Abajo)
      if (e.shiftKey && (e.code === 'Digit7' || e.key === '7' || e.key === '/')) {
        e.preventDefault();
        setCameraPreset('bottom');
        return;
      }

      if (e.shiftKey) return;

      switch (e.key) {
        case 'w':
        case 'W':
        case 'ArrowUp':
          e.preventDefault();
          stepFloor(1);
          break;
        case 's':
        case 'S':
        case 'ArrowDown':
          e.preventDefault();
          stepFloor(-1);
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          deleteSelectedDisc();
          break;
        case '7':
        case 't':
        case 'T':
          e.preventDefault();
          setCameraPreset('top');
          break;
        case 'b':
        case 'B':
          e.preventDefault();
          setCameraPreset('bottom');
          break;
        case '1':
        case 'f':
        case 'F':
          e.preventDefault();
          setCameraPreset('front');
          break;
        case '3':
        case 'l':
        case 'L':
          e.preventDefault();
          setCameraPreset('right');
          break;
        case '0':
        case 'p':
        case 'P':
          e.preventDefault();
          setCameraPreset('iso');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    stepFloor,
    setCameraPreset,
    deleteSelectedDisc,
    undoDiscs,
    redoDiscs,
    closeSheetPreviewModal,
    isPreviewModalOpen,
  ]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#09090B]">
      <Viewport3D />
      <TopProjectBar />
      <CameraToolbar />
      <FloorNavigatorHUD />
      <DiscsDockHUD />
      <RightInspector />
      <StatusBarPill />
      <SheetPreviewModal />
    </main>
  );
}
```

---

#### Chunk 6.2: Código Completo con Props de los 7 Componentes UI/HUD (`Collapsible`, `TopProjectBar`, `CameraToolbar`, `FloorNavigatorHUD`, `DiscsDockHUD`, `RightInspector`, `StatusBarPill`) (Correcciones #0, #1, #2, #5b, #5f)

- **Corrección #5b (Código completo con interfaces de props de los 7 componentes HUD y `Collapsible`)**:
  - *Qué estaba mal*: `App.tsx` importaba `TopProjectBar`, `CameraToolbar`, `FloorNavigatorHUD`, `DiscsDockHUD`, `RightInspector`, `StatusBarPill` y `Collapsible`, pero sus bloques de código completos con props no estaban escritos en la Fase 6.
  - *Regla nueva*: Especificar a continuación el código completo de los 7 archivos `.tsx` con sus interfaces de props explícitas, propagando la tabla de `§0.0` (`plates=10`, `sheetW=600`, `sheetH=400`, `sheetMargin=10`, `partGap=5`, `kerf=0.15`, `discDiameter=6.0`, `engraveClearance=0.3`, `scrapTagEnabled=true`), el botón toggle `modeAddDiscs` en `DiscsDockHUD` (`#1`), y el banner `"Restaurar sesión / Descartar"` en `TopProjectBar` (`#5f`).
  - *Criterio de aceptación*: Los 7 componentes compilan sin errores con `tsc --noEmit` (`strict: true`), usan exclusivamente íconos de `lucide-react` y exponen controles accesibles para todos los campos de `§0.0`.

##### Archivo `web/src/components/ui/Collapsible.tsx`
```tsx
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface CollapsibleProps {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Collapsible({
  title,
  summary,
  defaultOpen = false,
  children,
}: CollapsibleProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-white/[0.08] pt-2.5">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between py-1 text-left text-xs font-semibold text-[#F4F4F5] hover:text-white select-none"
      >
        <span className="flex items-center gap-1.5">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#A1A1AA]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#A1A1AA]" />
          )}
          <span>{title}</span>
        </span>
        {summary && (
          <span className="text-[11px] font-mono-tabular font-normal text-[#A1A1AA]">
            {summary}
          </span>
        )}
      </button>
      {isOpen && <div className="mt-2.5 flex flex-col gap-2.5">{children}</div>}
    </div>
  );
}
```

##### Archivo `web/src/components/hud/TopProjectBar.tsx`
```tsx
import { useRef, type ChangeEvent } from 'react';
import {
  Box,
  FolderOpen,
  RotateCcw,
  Save,
  Upload,
  X,
} from 'lucide-react';
import {
  INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE,
  parseProjectJson,
} from '../../core/project';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface TopProjectBarProps {
  className?: string;
}

export function TopProjectBar({ className = '' }: TopProjectBarProps) {
  const meshInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);

  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
  const params = useSculptureStore((s) => s.params);
  const pendingAutosave = useSculptureStore((s) => s.pendingAutosave);
  const loadMeshArrayBuffer = useSculptureStore((s) => s.loadMeshArrayBuffer);
  const exportProjectJsonString = useSculptureStore(
    (s) => s.exportProjectJsonString
  );
  const importProjectFromParsed = useSculptureStore(
    (s) => s.importProjectFromParsed
  );
  const restoreAutosaveSession = useSculptureStore(
    (s) => s.restoreAutosaveSession
  );
  const discardAutosaveSession = useSculptureStore(
    (s) => s.discardAutosaveSession
  );

  const handleMeshFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    loadMeshArrayBuffer(buffer, file.name, true);
    e.target.value = '';
  };

  const handleProjectFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseProjectJson(text, params);
      const outcome = await importProjectFromParsed(parsed, false);
      if (outcome.needsConfirmation) {
        const accepted = window.confirm(INCOMPATIBLE_PROJECT_CONFIRM_MESSAGE);
        if (accepted) {
          await importProjectFromParsed(parsed, true);
        }
      }
    } catch (err) {
      useSculptureStore.setState({
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveProject = () => {
    try {
      const json = exportProjectJsonString();
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = meshMetadata?.fileName
        ? meshMetadata.fileName.replace(/\.[^.]+$/, '')
        : 'escultura';
      a.download = `${baseName}_proyecto.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      useSculptureStore.setState({
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      className={`fixed top-3 left-3 z-30 flex flex-col gap-2 max-w-[calc(100vw-24px)] ${className}`}
    >
      <div className="hud-surface rounded-lg px-2.5 py-1.5 flex flex-wrap items-center gap-2 shadow-lg">
        <input
          ref={meshInputRef}
          type="file"
          accept=".obj,.stl,.3mf,.ply"
          onChange={handleMeshFileChange}
          className="hidden"
          data-testid="mesh-file-input"
        />
        <input
          ref={projectInputRef}
          type="file"
          accept=".json"
          onChange={handleProjectFileChange}
          className="hidden"
          data-testid="project-file-input"
        />

        <button
          type="button"
          onClick={() => meshInputRef.current?.click()}
          className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-[#0A84FF] hover:bg-[#0070E0] text-xs font-medium text-white flex items-center gap-1.5 select-none"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Cargar modelo 3D</span>
        </button>

        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#1C1C21] border border-white/[0.08] text-xs text-[#A1A1AA] hud-text-selectable">
          <Box className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" />
          <span className="truncate max-w-[160px] font-mono-tabular text-[#F4F4F5]">
            {meshMetadata ? meshMetadata.fileName : 'Sin archivo'}
          </span>
        </div>

        <div className="h-4 w-px bg-white/10 mx-0.5" />

        <button
          type="button"
          onClick={() => projectInputRef.current?.click()}
          title="Cargar proyecto (.json)"
          className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center gap-1.5 select-none"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[#A1A1AA]" />
          <span>Abrir JSON</span>
        </button>

        <button
          type="button"
          onClick={handleSaveProject}
          title="Guardar proyecto (.json)"
          className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center gap-1.5 select-none"
        >
          <Save className="w-3.5 h-3.5 text-[#A1A1AA]" />
          <span>Guardar JSON</span>
        </button>
      </div>

      {/* Banner condicional de Autosave (Corrección #5f: prohibido sobrescribir sin preguntar) */}
      {pendingAutosave && (
        <div
          role="region"
          aria-label="Recuperación de sesión automática"
          data-testid="autosave-banner"
          className="hud-surface rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-3 border-amber-500/40 shadow-lg"
        >
          <span className="text-xs text-[#F4F4F5]">
            Sesión anterior encontrada
            {pendingAutosave.meshRecord?.fileName
              ? ` (${pendingAutosave.meshRecord.fileName})`
              : ''}
            . ¿Deseas restaurarla?
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void restoreAutosaveSession()}
              className="h-7 px-2.5 rounded bg-[#0A84FF] hover:bg-[#0070E0] text-xs font-medium text-white flex items-center gap-1 select-none"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restaurar sesión</span>
            </button>
            <button
              type="button"
              onClick={() => void discardAutosaveSession()}
              className="h-7 px-2.5 rounded bg-white/5 hover:bg-white/10 text-xs font-medium text-[#A1A1AA] hover:text-white flex items-center gap-1 select-none"
            >
              <X className="w-3.5 h-3.5" />
              <span>Descartar</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

##### Archivo `web/src/components/hud/CameraToolbar.tsx`
```tsx
import { Compass, Eye, EyeOff, Grid3X3 } from 'lucide-react';
import {
  useSculptureStore,
  type CameraPreset,
} from '../../store/useSculptureStore';

export interface CameraToolbarProps {
  className?: string;
}

const CAMERA_BUTTONS: Array<{
  preset: CameraPreset;
  label: string;
  shortcut: string;
}> = [
  { preset: 'top', label: 'Arriba', shortcut: '7' },
  { preset: 'front', label: 'Frente', shortcut: '1' },
  { preset: 'right', label: 'Lado', shortcut: '3' },
  { preset: 'bottom', label: 'Abajo', shortcut: 'B' },
  { preset: 'iso', label: '3D', shortcut: '0' },
];

export function CameraToolbar({ className = '' }: CameraToolbarProps) {
  const cameraPreset = useSculptureStore((s) => s.cameraPreset);
  const viewMode = useSculptureStore((s) => s.viewMode);
  const wireframe = useSculptureStore((s) => s.wireframe);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const setCameraPreset = useSculptureStore((s) => s.setCameraPreset);
  const setViewMode = useSculptureStore((s) => s.setViewMode);
  const toggleWireframe = useSculptureStore((s) => s.toggleWireframe);

  const showingOriginal = viewMode === 'original';

  return (
    <div
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-30 hud-surface rounded-lg px-2 py-1.5 flex items-center gap-1.5 shadow-lg max-[1100px]:top-16 max-[1100px]:left-3 max-[1100px]:translate-x-0 ${className}`}
    >
      <Compass className="w-3.5 h-3.5 text-[#A1A1AA] ml-1 mr-0.5 shrink-0" />
      {CAMERA_BUTTONS.map((btn) => {
        const active = cameraPreset === btn.preset;
        return (
          <button
            key={btn.preset}
            type="button"
            onClick={() => setCameraPreset(btn.preset)}
            title={`Vista ${btn.label} (${btn.shortcut})`}
            className={`h-8 coarse:min-h-10 px-2.5 rounded-md text-xs font-medium transition-colors select-none ${
              active
                ? 'bg-[#0A84FF] text-white'
                : 'bg-transparent text-[#A1A1AA] hover:text-white hover:bg-white/5'
            }`}
          >
            {btn.label}
          </button>
        );
      })}

      <div className="h-4 w-px bg-white/10 mx-0.5" />

      <button
        type="button"
        disabled={!sliceResult}
        onClick={() => setViewMode(showingOriginal ? 'plates' : 'original')}
        title="Alternar entre modelo 3D original y placas rebanadas"
        className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40 text-xs font-medium text-[#F4F4F5] flex items-center gap-1.5 select-none"
      >
        {showingOriginal ? (
          <>
            <Eye className="w-3.5 h-3.5 text-[#A1A1AA]" />
            <span>Ver placas</span>
          </>
        ) : (
          <>
            <EyeOff className="w-3.5 h-3.5 text-[#A1A1AA]" />
            <span>Ver modelo original</span>
          </>
        )}
      </button>

      <button
        type="button"
        onClick={toggleWireframe}
        title="Alternar malla de alambre (Wireframe)"
        aria-pressed={wireframe}
        className={`h-8 coarse:min-h-10 px-2 rounded-md text-xs font-medium flex items-center gap-1 select-none ${
          wireframe
            ? 'bg-white/15 text-white'
            : 'bg-white/5 text-[#A1A1AA] hover:text-white'
        }`}
      >
        <Grid3X3 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

##### Archivo `web/src/components/hud/FloorNavigatorHUD.tsx`
```tsx
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface FloorNavigatorHUDProps {
  className?: string;
}

export function FloorNavigatorHUD({ className = '' }: FloorNavigatorHUDProps) {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const showAllFloors = useSculptureStore((s) => s.showAllFloors);
  const setActiveFloor = useSculptureStore((s) => s.setActiveFloor);
  const stepFloor = useSculptureStore((s) => s.stepFloor);
  const setShowAllFloors = useSculptureStore((s) => s.setShowAllFloors);

  if (!sliceResult) return null;

  const totalPlates = sliceResult.plates.length;
  const validIndices: number[] = [];
  for (let i = 0; i < totalPlates; i++) {
    if (sliceResult.plates[i] && sliceResult.plates[i].length > 0) {
      validIndices.push(i);
    }
  }
  const validCount = validIndices.length;

  const handleSliderChange = (rawIndex: number) => {
    if (sliceResult.plates[rawIndex]?.length > 0) {
      setActiveFloor(rawIndex);
      return;
    }
    // Saltar automáticamente a la placa no vacía más cercana (Corrección B13)
    let closest = activeFloor;
    let bestDist = Infinity;
    for (const vi of validIndices) {
      const d = Math.abs(vi - rawIndex);
      if (d < bestDist) {
        bestDist = d;
        closest = vi;
      }
    }
    setActiveFloor(closest);
  };

  return (
    <aside
      aria-label="Navegador de pisos"
      className={`fixed left-3 top-1/2 -translate-y-1/2 z-30 hud-surface rounded-xl p-3 flex flex-col items-center gap-3 w-44 max-[1100px]:w-12 max-[1100px]:p-2 shadow-xl ${className}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#F4F4F5] select-none max-[1100px]:hidden">
        <Layers className="w-3.5 h-3.5 text-[#0A84FF]" />
        <span>
          Piso {activeFloor} ({validCount} de {totalPlates})
        </span>
      </div>

      <button
        type="button"
        onClick={() => stepFloor(1)}
        title="Piso siguiente (W / Flecha arriba)"
        aria-label="Piso siguiente"
        className="w-full h-8 coarse:min-h-10 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center justify-center gap-1 select-none"
      >
        <ChevronUp className="w-4 h-4" />
        <span className="max-[1100px]:hidden">Subir (W)</span>
      </button>

      <div className="h-36 flex items-center justify-center py-2">
        <input
          type="range"
          min={0}
          max={Math.max(0, totalPlates - 1)}
          step={1}
          value={activeFloor}
          aria-label="Selector de piso activo"
          onChange={(e) => handleSliderChange(Number(e.target.value))}
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          className="h-32 accent-[#0A84FF] cursor-pointer"
        />
      </div>

      <button
        type="button"
        onClick={() => stepFloor(-1)}
        title="Piso anterior (S / Flecha abajo)"
        aria-label="Piso anterior"
        className="w-full h-8 coarse:min-h-10 rounded-md bg-white/5 hover:bg-white/10 text-xs font-medium text-[#F4F4F5] flex items-center justify-center gap-1 select-none"
      >
        <ChevronDown className="w-4 h-4" />
        <span className="max-[1100px]:hidden">Bajar (S)</span>
      </button>

      <label className="w-full pt-2 border-t border-white/[0.08] flex items-center justify-between gap-2 text-xs text-[#A1A1AA] cursor-pointer select-none max-[1100px]:hidden">
        <span>Solo piso activo</span>
        <input
          type="checkbox"
          checked={!showAllFloors}
          onChange={(e) => setShowAllFloors(!e.target.checked)}
          className="rounded accent-[#0A84FF] w-4 h-4"
        />
      </label>
    </aside>
  );
}
```

##### Archivo `web/src/components/hud/DiscsDockHUD.tsx`
```tsx
import {
  MousePointer,
  PlusCircle,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { PARAM_BOUNDS } from '../../core/params';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface DiscsDockHUDProps {
  className?: string;
}

export function DiscsDockHUD({ className = '' }: DiscsDockHUDProps) {
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const modeAddDiscs = useSculptureStore((s) => s.modeAddDiscs);
  const discs = useSculptureStore((s) => s.discs);
  const activeFloor = useSculptureStore((s) => s.activeFloor);
  const selectedDiscId = useSculptureStore((s) => s.selectedDiscId);
  const defaultDiscDiameter = useSculptureStore((s) => s.params.discDiameter);
  const canUndo = useSculptureStore((s) => s.canUndo);
  const canRedo = useSculptureStore((s) => s.canRedo);

  const setModeAddDiscs = useSculptureStore((s) => s.setModeAddDiscs);
  const setParam = useSculptureStore((s) => s.setParam);
  const updateSelectedDiscDiameter = useSculptureStore(
    (s) => s.updateSelectedDiscDiameter
  );
  const deleteSelectedDisc = useSculptureStore((s) => s.deleteSelectedDisc);
  const clearActiveFloorDiscs = useSculptureStore(
    (s) => s.clearActiveFloorDiscs
  );
  const undoDiscs = useSculptureStore((s) => s.undoDiscs);
  const redoDiscs = useSculptureStore((s) => s.redoDiscs);

  if (!sliceResult) return null;

  const selectedDisc = discs.find((d) => d.id === selectedDiscId) ?? null;
  const displayedDiameter = selectedDisc
    ? selectedDisc.diameter
    : defaultDiscDiameter;
  const floorDiscCount = discs.filter((d) => d.gapIndex === activeFloor).length;

  const handleDiameterChange = (val: number) => {
    const clamped = Math.max(
      PARAM_BOUNDS.discDiameter.min,
      Math.min(PARAM_BOUNDS.discDiameter.max, val)
    );
    if (selectedDisc) {
      updateSelectedDiscDiameter(clamped);
    } else {
      setParam('discDiameter', clamped);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Herramientas de discos de unión"
      className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-30 hud-surface rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 shadow-2xl ${className}`}
    >
      {/* Selector explícito de modo: Seleccionar vs Poner discos (Corrección #1) */}
      <div className="flex items-center rounded-lg bg-[#1C1C21] p-0.5 border border-white/[0.08]">
        <button
          type="button"
          onClick={() => setModeAddDiscs(false)}
          aria-pressed={!modeAddDiscs}
          className={`h-8 coarse:min-h-10 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors select-none ${
            !modeAddDiscs
              ? 'bg-[#0A84FF] text-white'
              : 'text-[#A1A1AA] hover:text-white'
          }`}
        >
          <MousePointer className="w-3.5 h-3.5" />
          <span>Seleccionar</span>
        </button>
        <button
          type="button"
          onClick={() => setModeAddDiscs(true)}
          aria-pressed={modeAddDiscs}
          data-testid="toggle-add-discs"
          className={`h-8 coarse:min-h-10 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors select-none ${
            modeAddDiscs
              ? 'bg-amber-500 text-black font-semibold'
              : 'text-[#A1A1AA] hover:text-white'
          }`}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Poner discos</span>
        </button>
      </div>

      <div className="h-4 w-px bg-white/10" />

      {/* Diámetro del disco seleccionado o por defecto (6.0 mm, [1..50]) */}
      <label className="flex items-center gap-1.5 text-xs text-[#A1A1AA] select-none">
        <span>{selectedDisc ? `Disco #${selectedDisc.id} Ø` : 'Diámetro Ø'}</span>
        <input
          type="number"
          aria-label="Diámetro"
          min={PARAM_BOUNDS.discDiameter.min}
          max={PARAM_BOUNDS.discDiameter.max}
          step={PARAM_BOUNDS.discDiameter.step}
          value={displayedDiameter}
          onChange={(e) => {
            const parsed = Number.parseFloat(e.target.value);
            if (Number.isFinite(parsed)) {
              handleDiameterChange(parsed);
            }
          }}
          className="w-16 h-8 coarse:min-h-10 px-2 rounded-md bg-[#1C1C21] border border-white/[0.08] text-xs font-mono-tabular text-[#F4F4F5] focus:outline-none focus:border-[#0A84FF]"
        />
        <span className="text-[11px] text-[#9CA3AF]">mm</span>
      </label>

      <button
        type="button"
        disabled={!selectedDisc}
        onClick={deleteSelectedDisc}
        title="Eliminar disco seleccionado (Supr / Backspace)"
        className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-red-500/20 disabled:opacity-40 text-xs font-medium text-red-400 flex items-center gap-1 select-none"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>Borrar</span>
      </button>

      <button
        type="button"
        disabled={floorDiscCount === 0}
        onClick={clearActiveFloorDiscs}
        title="Eliminar todos los discos del piso activo"
        className="h-8 coarse:min-h-10 px-2.5 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40 text-xs font-medium text-[#A1A1AA] hover:text-white select-none"
      >
        Limpiar piso ({floorDiscCount})
      </button>

      <div className="h-4 w-px bg-white/10" />

      <button
        type="button"
        disabled={!canUndo}
        onClick={undoDiscs}
        title="Deshacer (Ctrl+Z)"
        aria-label="Deshacer"
        className="h-8 coarse:min-h-10 px-2 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40 text-[#F4F4F5]"
      >
        <Undo2 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={redoDiscs}
        title="Rehacer (Ctrl+Y)"
        aria-label="Rehacer"
        className="h-8 coarse:min-h-10 px-2 rounded-md bg-white/5 hover:bg-white/10 disabled:opacity-40 text-[#F4F4F5]"
      >
        <Redo2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

##### Archivo `web/src/components/hud/RightInspector.tsx`
```tsx
import { useState } from 'react';
import {
  AlertTriangle,
  FileOutput,
  Layers,
  Loader2,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { getDiscSheetNotice, PARAM_BOUNDS } from '../../core/params';
import { useSculptureStore } from '../../store/useSculptureStore';
import type { Axis } from '../../types/sculpture';
import { Collapsible } from '../ui/Collapsible';
import { NumericInput } from '../ui/NumericInput';

export interface RightInspectorProps {
  className?: string;
}

const AXES: Axis[] = ['z', 'x', 'y'];

export function RightInspector({ className = '' }: RightInspectorProps) {
  const [drawerOpen, setDrawerOpen] = useState(true);

  const params = useSculptureStore((s) => s.params);
  const isResultDirty = useSculptureStore((s) => s.isResultDirty);
  const isSlicing = useSculptureStore((s) => s.isSlicing);
  const meshMetadata = useSculptureStore((s) => s.meshMetadata);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const discs = useSculptureStore((s) => s.discs);
  const setParam = useSculptureStore((s) => s.setParam);
  const runSlice = useSculptureStore((s) => s.runSlice);
  const openSheetPreviewModal = useSculptureStore(
    (s) => s.openSheetPreviewModal
  );

  const validPlatesCount = sliceResult
    ? sliceResult.plates.filter((p) => p.length > 0).length
    : 0;

  const scaledDims = sliceResult
    ? {
        w: (
          sliceResult.scaledBounds[1][0] - sliceResult.scaledBounds[0][0]
        ).toFixed(1),
        d: (
          sliceResult.scaledBounds[1][1] - sliceResult.scaledBounds[0][1]
        ).toFixed(1),
        h: sliceResult.scaledHeight.toFixed(1),
      }
    : null;

  return (
    <>
      {/* Botón toggle para pantallas < 1100px (Corrección C4) */}
      <button
        type="button"
        onClick={() => setDrawerOpen((v) => !v)}
        className="hidden max-[1100px]:flex fixed top-3 right-3 z-40 hud-surface h-8 px-2.5 rounded-md items-center gap-1.5 text-xs font-medium text-[#F4F4F5]"
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-[#0A84FF]" />
        <span>Parámetros</span>
      </button>

      <aside
        aria-label="Inspector de parámetros y exportación"
        className={`fixed top-3 right-3 bottom-14 z-30 w-72 hud-surface rounded-xl p-3.5 flex flex-col gap-3 overflow-y-auto shadow-2xl transition-transform ${
          drawerOpen
            ? 'translate-x-0'
            : 'max-[1100px]:translate-x-[110%]'
        } ${className}`}
      >
        {/* 1. Sección Principal: Corte y Escala (params.py:13-16, ui.py:96-113) */}
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
              Corte y escala
            </h2>
            {isResultDirty && (
              <span className="text-[11px] font-medium text-amber-400">
                Desactualizado
              </span>
            )}
          </div>

          <NumericInput
            label="Número de placas"
            value={params.plates}
            min={PARAM_BOUNDS.plates.min}
            max={PARAM_BOUNDS.plates.max}
            step={PARAM_BOUNDS.plates.step}
            onChange={(v) => setParam('plates', v)}
          />

          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="Grosor de placa"
              value={params.thickness}
              min={PARAM_BOUNDS.thickness.min}
              max={PARAM_BOUNDS.thickness.max}
              step={PARAM_BOUNDS.thickness.step}
              unit="mm"
              onChange={(v) => setParam('thickness', v)}
            />
            <NumericInput
              label="Separación"
              value={params.gap}
              min={PARAM_BOUNDS.gap.min}
              max={PARAM_BOUNDS.gap.max}
              step={PARAM_BOUNDS.gap.step}
              unit="mm"
              onChange={(v) => setParam('gap', v)}
            />
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#1C1C21] border border-white/[0.08] text-[11px] text-[#A1A1AA]">
            <Layers className="w-3.5 h-3.5 text-[#0A84FF] shrink-0" />
            <span>{getDiscSheetNotice(params)}</span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[#A1A1AA] select-none">
              Eje de corte
            </span>
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-md bg-[#1C1C21] border border-white/[0.08]">
              {AXES.map((ax) => (
                <button
                  key={ax}
                  type="button"
                  onClick={() => setParam('axis', ax)}
                  className={`h-7 rounded text-xs font-semibold uppercase transition-colors select-none ${
                    params.axis === ax
                      ? 'bg-[#0A84FF] text-white'
                      : 'text-[#A1A1AA] hover:text-white'
                  }`}
                >
                  Eje {ax.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={!meshMetadata || isSlicing}
            onClick={() => void runSlice()}
            className="w-full h-9 coarse:min-h-10 rounded-md bg-[#0A84FF] hover:bg-[#0070E0] disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow select-none"
          >
            {isSlicing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Rebanando...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>
                  {isResultDirty ? 'Rebanar (actualizar)' : 'Aplicar corte'}
                </span>
              </>
            )}
          </button>
        </section>

        {/* 2. Acordeón: Hoja de Corte (params.py:19-25, ui.py:124-149) */}
        <Collapsible
          title="Hoja de corte"
          summary={`${params.sheetW}×${params.sheetH} mm`}
        >
          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="Ancho de hoja"
              value={params.sheetW}
              min={PARAM_BOUNDS.sheetW.min}
              max={PARAM_BOUNDS.sheetW.max}
              step={PARAM_BOUNDS.sheetW.step}
              unit="mm"
              onChange={(v) => setParam('sheetW', v)}
            />
            <NumericInput
              label="Alto de hoja"
              value={params.sheetH}
              min={PARAM_BOUNDS.sheetH.min}
              max={PARAM_BOUNDS.sheetH.max}
              step={PARAM_BOUNDS.sheetH.step}
              unit="mm"
              onChange={(v) => setParam('sheetH', v)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="Margen"
              value={params.sheetMargin}
              min={PARAM_BOUNDS.sheetMargin.min}
              max={PARAM_BOUNDS.sheetMargin.max}
              step={PARAM_BOUNDS.sheetMargin.step}
              unit="mm"
              onChange={(v) => setParam('sheetMargin', v)}
            />
            <NumericInput
              label="Sep. piezas"
              value={params.partGap}
              min={PARAM_BOUNDS.partGap.min}
              max={PARAM_BOUNDS.partGap.max}
              step={PARAM_BOUNDS.partGap.step}
              unit="mm"
              onChange={(v) => setParam('partGap', v)}
            />
          </div>
          <NumericInput
            label="Compensación láser (Kerf)"
            value={params.kerf}
            min={PARAM_BOUNDS.kerf.min}
            max={PARAM_BOUNDS.kerf.max}
            step={PARAM_BOUNDS.kerf.step}
            unit="mm"
            onChange={(v) => setParam('kerf', v)}
          />
        </Collapsible>

        {/* 3. Acordeón: Discos y Rotulado (params.py:28-33, ui.py:155-169, Corrección #0 y #2) */}
        <Collapsible
          title="Discos y rotulado"
          summary={`Ø${params.discDiameter} mm`}
        >
          <div className="grid grid-cols-2 gap-2">
            <NumericInput
              label="Diámetro por defecto"
              value={params.discDiameter}
              min={PARAM_BOUNDS.discDiameter.min}
              max={PARAM_BOUNDS.discDiameter.max}
              step={PARAM_BOUNDS.discDiameter.step}
              unit="mm"
              onChange={(v) => setParam('discDiameter', v)}
            />
            <NumericInput
              label="Holgura grabado"
              value={params.engraveClearance}
              min={PARAM_BOUNDS.engraveClearance.min}
              max={PARAM_BOUNDS.engraveClearance.max}
              step={PARAM_BOUNDS.engraveClearance.step}
              unit="mm"
              onChange={(v) => setParam('engraveClearance', v)}
            />
          </div>

          <label className="flex items-center justify-between gap-2 pt-1 text-xs text-[#A1A1AA] cursor-pointer select-none">
            <span>Etiquetar sobrante aprovechable</span>
            <input
              type="checkbox"
              checked={params.scrapTagEnabled}
              onChange={(e) => setParam('scrapTagEnabled', e.target.checked)}
              className="rounded accent-[#0A84FF] w-4 h-4"
            />
          </label>
        </Collapsible>

        {/* 4. Sección: Resultado, Métricas seleccionables y Exportación */}
        <section className="border-t border-white/[0.08] pt-2.5 flex flex-col gap-2 hud-text-selectable">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A1A1AA] select-none">
            Resultado
          </h2>

          {sliceResult ? (
            <div className="flex flex-col gap-1 text-xs font-mono-tabular text-[#F4F4F5] bg-[#1C1C21] p-2.5 rounded-md border border-white/[0.08]">
              <div className="flex justify-between">
                <span className="text-[#A1A1AA]">Placas válidas:</span>
                <span>
                  {validPlatesCount} / {sliceResult.plates.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#A1A1AA]">Escala auto:</span>
                <span>{sliceResult.scaleFactor.toFixed(3)}x</span>
              </div>
              {scaledDims && (
                <div className="flex justify-between">
                  <span className="text-[#A1A1AA]">Dimensiones:</span>
                  <span>
                    {scaledDims.w} × {scaledDims.d} × {scaledDims.h} mm
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#A1A1AA]">Discos totales:</span>
                <span>{discs.length}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-[#9CA3AF]">
              Sin corte activo. Carga un modelo y pulsa «Aplicar corte».
            </p>
          )}

          {/* Advertencias de malla y corte */}
          {(meshMetadata?.warnings.length || sliceResult?.warnings.length) ? (
            <div className="flex flex-col gap-1 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
              {meshMetadata?.warnings.map((w, idx) => (
                <div key={`mw-${idx}`} className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
              {sliceResult?.warnings.map((w) => (
                <div
                  key={`sw-${w.floorIndex}`}
                  className="flex items-start gap-1.5"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            disabled={!sliceResult}
            onClick={openSheetPreviewModal}
            className="mt-1 w-full h-9 coarse:min-h-10 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center justify-center gap-1.5 shadow select-none"
          >
            <FileOutput className="w-3.5 h-3.5" />
            <span>Vista previa y exportar</span>
          </button>
        </section>
      </aside>
    </>
  );
}
```

##### Archivo `web/src/components/hud/StatusBarPill.tsx`
```tsx
import { AlertCircle, Info, X } from 'lucide-react';
import { useSculptureStore } from '../../store/useSculptureStore';

export interface StatusBarPillProps {
  className?: string;
}

export function StatusBarPill({ className = '' }: StatusBarPillProps) {
  const statusMessage = useSculptureStore((s) => s.statusMessage);
  const errorMessage = useSculptureStore((s) => s.errorMessage);
  const clearError = useSculptureStore((s) => s.clearError);

  return (
    <div
      className={`fixed bottom-3 left-3 z-30 flex flex-col gap-1.5 max-w-md ${className}`}
    >
      {errorMessage && (
        <div
          role="alert"
          className="hud-surface rounded-lg px-3 py-2 border-red-500/50 bg-red-950/90 text-xs text-red-200 flex items-center justify-between gap-2 shadow-lg hud-text-selectable"
        >
          <span className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Cerrar error"
            className="p-0.5 rounded hover:bg-white/10 text-red-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="hud-surface rounded-full px-3 py-1.5 text-xs text-[#A1A1AA] flex items-center gap-1.5 shadow hud-text-selectable">
        <Info className="w-3.5 h-3.5 text-[#0A84FF] shrink-0" />
        <span className="truncate">{statusMessage}</span>
      </div>
    </div>
  );
}
```

---

### FASE 7: Suite de Pruebas Unitarias, Golden Files de Python y Pruebas E2E Playwright

#### Chunk 7.1: Independencia Total de `./web` con `web/fixtures/` y `web/golden/` (Regla 1 y Corrección A8)

Todos los modelos 3D de prueba y los archivos Golden de referencia generados por el motor Python original ya se encuentran copiados y verificados dentro de `./web/`:

- **`web/fixtures/`**:
  - `test_l_block.obj`, `test_l_block.stl`, `test_l_block.ply`, `test_l_block.3mf`: Bloque asimétrico en forma de L ($40 \times 40 \times 60\text{ mm}$ originales, brazo en $+X$ y brazo en $+Y$).
  - `test_torus.stl`: Toroide cerrado con cavidad central.
  - `Hand.OBJ`: Modelo orgánico complejo (`7,262` vértices, `14,520` caras).
- **`web/golden/`**:
  - `l_block_slice_z.json`, `l_block_slice_x.json`, `l_block_slice_y.json`: Salidas exactas de `slicer.py` para `test_l_block.obj` (`plates=10`, `thickness=3.0`, `gap=3.0`) en los 3 ejes (`z`, `x`, `y`).
  - `torus_slice_z.json` y `hand_slice_z.json`: Salidas exactas de `slicer.py` para el toroide (contornos con huecos interiores `holes`) y la mano 3D.
  - `l_block_project.json`: Proyecto serializado por `project.py` con discos de prueba.
  - `l_block_layout.json` y `l_block_layout_y.json`: Salidas exactas de `layout.py` incluyendo `plates`, `discs`, `disc_groups`, `scrap_tags` y métricas de área.
  - `l_block_hoja_1_placas_python.svg`, `l_block_hoja_1_placas_python.dxf`, `l_block_hoja_2_discos_python.svg`, `l_block_hoja_2_discos_python.dxf`: Archivos de referencia de `exporter.py`.

---

#### Chunk 7.2: Especificación Completa de Tests Unitarios en Vitest (`src/__tests__/*.test.ts`)

1. **`src/__tests__/validator.test.ts`**:
   - **Fuente única de verdad (`§0.0`, Corrección #0 y #2)**: Verifica que `DEFAULT_PARAMS` (`plates: 10`, `thickness: 3.0`, `gap: 3.0`, `axis: 'z'`, `sheetW: 600.0`, `sheetH: 400.0`, `sheetMargin: 10.0`, `partGap: 5.0`, `kerf: 0.15`, `discDiameter: 6.0`, `engraveClearance: 0.3`, `scrapTagEnabled: true`) y `PARAM_BOUNDS` coinciden exactamente con la tabla de `§0.0`.
   - Verifica que `test_l_block.stl` y `test_torus.stl` (archivos STL no indexados) se sueldan con tolerancia relativa `1e-6 * diag` y reportan `isWatertight === true`, `openEdgeCount === 0` y `nonManifoldEdgeCount === 0` (Corrección B10).
   - Verifica detección de aristas abiertas (cubo de 11 triángulos $\implies$ `isWatertight === false`, `openEdgeCount === 3`) y aristas no-manifold (3 caras compartiendo la misma arista $\implies$ `nonManifoldEdgeCount >= 1`).
   - **Tres tests obligatorios de Winding y Profundidad de Anidamiento (Corrección #3 y A3)**:
     1. **Esfera/cubo hueco conserva la cavidad**: Malla compuesta por una carcasa exterior cerrada ($6V > 0$, `nestingDepth === 0`) y una cavidad interior cerrada ($6V < 0$, `nestingDepth === 1`) mantiene intacta la cavidad negativa (`invertedComponentCount === 0`) y al cortarse con `sliceMesh` produce placas con `holes.length === 1`.
     2. **STL invertido se corrige**: Malla 100% cerrada a profundidad `0` cuyas caras tienen normales hacia adentro ($6V < 0$) se invierte automáticamente (`invertedComponentCount === 1`) y produce las mismas placas positivas que el modelo con normales hacia afuera.
     3. **Malla abierta lejos del origen no cambia**: Malla abierta (ej. cubo sin tapa superior) trasladada a $(+5000, +5000, +5000)$ no modifica el orden de vértices de ningún triángulo (`invertedComponentCount === 0`, `openComponentCount === 1`) y agrega una advertencia en `metadata.warnings`.
   - Verifica que un archivo `.ply` sin caras (`element face 0`) y un `.obj` con solo líneas (`l 1 2`) lanzan `ValidationError` claro (Corrección B11).
   - Verifica que un `.3mf` con `unit="inch"` aplica `unitScaleApplied === 25.4` y `matrixWorld` de `<build><item transform="...">` (Corrección B11).
   - Verifica que `validateParams({ ...DEFAULT_PARAMS, gap: 0 })` lanza `ValidationError` (Corrección B12).

2. **`src/__tests__/slicer.test.ts`**:
   - **Golden equivalence (Corrección A8)**: Carga `web/fixtures/test_l_block.obj` y compara `sliceMesh` en los ejes `z`, `x` e `y` contra `web/golden/l_block_slice_z.json`, `l_block_slice_x.json` y `l_block_slice_y.json` (mapeando las claves Python del golden `autoScale` $\to$ `scaleFactor`, `polygons[i]` $\to$ `plates[i]`, `interiors` $\to$ `holes`):
     - `scaleFactor` coincide con `golden.autoScale` con error $< 10^{-5}$.
     - `zPositions` coincide elemento a elemento con error $< 10^{-6}$.
     - `scaledBounds` coincide con error $< 10^{-4}\text{ mm}$ (confirmando las matrices de rotación de ejes `X`/`Y` y el centrado por bounding box).
     - El área de cada placa `plates[i][0].area` coincide con `golden.polygons[i][0].area` dentro de $< 0.01\%$.
   - **Casos degenerados de intersección plano-triángulo (Corrección A6)**:
     - Malla con vértices situados exactamente en `z === zCut`, aristas horizontales en `z === zCut` y caras coplanares con `z === zCut` produce un único polígono cerrado sin segmentos duplicados ni NaN.
   - **Unión booleana `ClipType.Union` + `FillRule.NonZero` (Correcciones A2 y A3)**:
     - Dos cubos solapados parcialmente producen `1` solo polígono exterior con `0` huecos y área igual a la unión geométrica (no XOR).
     - Anidación profunda `exterior -> hueco -> isla -> hueco` preserva los 2 polígonos exteriores cada uno con su respectivo hueco.
   - **Unión de cadenas abiertas independientemente del segmento de arranque (Corrección #4 y A5)**:
     - Construye un lazo circular de `100` segmentos dirigidos con una micro-brecha de `0.01 mm` en el segmento `50`.
     - Ejecuta `stitchAndUnionSegments` rotando el segmento de arranque en las `100` posiciones posibles (`startIdx = 0 .. 99`) y verifica que **en los 100 casos** produce exactamente `1` lazo reparado (`polygons.length === 1`), `openChainsRepaired === 1` y `openChainsDiscarded === 0`.
     - Verifica que un cubo al que le falta una cara lateral (brecha $> 0.05\text{ mm}$) descarta la cadena abierta (`openChainsDiscarded === 1`) sin cerrarla con una diagonal.
   - **Benchmark informativo no bloqueante O(n) (Corrección #8, A7 y B3)**:
     - Benchmark con `10,000` segmentos en un plano registra el tiempo de `stitchAndUnionSegments` con meta unificada de referencia **`< 50 ms`** y se ejecuta como **benchmark no bloqueante** (sin fallar el pipeline de CI por fluctuaciones de carga de CPU).

3. **`src/__tests__/discs.test.ts`**:
   - Verifica `isDiscInsidePlate` e `isDiscValidForGap` (Corrección A4):
     - Rechaza disco cuyo centro está dentro de `plates[k]` pero a distancia $< R$ del borde exterior o de un hueco interior (`test_torus.stl`).
     - Rechaza disco en hueco `k` cuando cabe en `plates[k]` pero se sale de `plates[k+1]`.
     - Verifica que la auto-copia al hueco `k+1` ocurre solo si el disco también cabe en `plates[k+2]`.
   - **Deslizamiento fluido pegado al borde con `clampDiscPositionToGap` (Corrección #5d)**:
     - En una placa cuadrada $[-10, 10]^2$ con un disco de diámetro $6.0\text{ mm}$ ($R = 3.0\text{ mm}$, región válida $[-7, 7]^2$), verifica que arrastrar rápidamente desde `prevValid = (0, 6.5)` hacia `target = (5, 15)` (fuera del borde superior) proyecta la posición a `(5, 7)` (deslizando en $X$ pegado al borde $y = 7$) en vez de congelarse en `(0, 6.5)`.
   - **Reescalado de `(x, y)` por `newAutoScale / oldAutoScale` antes de `purgeInvalidDiscs` (Corrección #5c)**:
     - Verifica que al cambiar `plates`, `thickness` o `gap` en el mismo eje, `runSlice` reescala las coordenadas `(x, y)` de todos los discos por `newAutoScale / oldAutoScale` antes de ejecutar `purgeInvalidDiscs`, conservando los discos dentro de las placas reescaladas.
   - Verifica que `setDiameter` rechaza incrementar el diámetro cuando el nuevo radio invade el borde de `plates[k]` o `plates[k+1]`, y verifica el límite `MAX_HISTORY = 50` en `undo()` / `redo()`.

4. **`src/__tests__/layout.test.ts`**:
   - Compara `generateLayouts` sobre `l_block_slice_z.json` + `l_block_project.json` contra `web/golden/l_block_layout.json` y `web/golden/l_block_layout_y.json`:
     - Mismo número de hojas (`2` hojas cuando `gap !== thickness`: hoja 1 de placas y hoja 2 de discos).
     - Mismas coordenadas `xOffset`, `yOffset`, `width`, `height`, `labelText`, `labelOutside` de cada placa (`placedPlates` en el golden).
     - Verifica en `plate.discs` (Corrección #2): los discos con `gapIndex === plateIndex` tienen `isDashed === false` (SÓLIDO), los discos con `gapIndex === plateIndex - 1` tienen `isDashed === true` (PUNTEADO), y ambos tienen `diameter === d.diameter + params.engraveClearance`.
     - Mismas bandejas `discGroups` (`trayX`, `trayY`, `trayW`, `trayH`, `labelSepX`, etiquetas `P0-P1`, `D0-1`).
     - Mismas etiquetas `scrapTags` (`SOBRANTE`) cuando `scrapTagEnabled === true`, y `scrapTags.length === 0` cuando `scrapTagEnabled === false` (Corrección #2).
   - Verifica el mensaje de error exacto de `layout.py:183-187` cuando una placa excede el área útil de la hoja.

5. **`src/__tests__/exporter.test.ts`**:
   - **Test de Quiralidad / No-Espejo e IDs SVG unificados (Correcciones #6 y A1)**:
     - Ejecuta el pipeline completo (`sliceMesh` $\to$ `generateLayouts` $\to$ `generateSheetSvg` y `generateSheetDxf`) sobre la pieza asimétrica `web/fixtures/test_l_block.obj`.
     - Parsea el DXF con `new DxfParser().parseSync(dxf)` (`dxf-parser@1.1.2`) y extrae los vértices de la primera polilínea (`P0`) en la capa `CORTE`.
     - Parsea el SVG con `DOMParser`, verifica la presencia de los grupos `<g id="cad-frame">`, `<g id="corte">` y `<g id="grabado">`, comprueba que el atributo `transform` de `#cad-frame` es exactamente `` `translate(0, ${sheet.height}) scale(1, -1)` `` (**calculado dinámicamente desde `sheet.height`, sin usar `2440` fijo**), extrae los comandos `M/L` del primer `<path>` en `#corte`, y verifica que las coordenadas $(x, y)$ en SVG y en DXF son idénticas (error $< 10^{-3}\text{ mm}$).
   - **Test de Círculos Sólidos vs Punteados con `engraveClearance` (Corrección #2)**:
     - Genera el layout y la exportación de una placa `P1` que tiene un disco arriba (`gapIndex === 1`, $d = 6.0\text{ mm}$) y un disco abajo (`gapIndex === 0`, $d = 6.0\text{ mm}$) con `engraveClearance = 0.3 mm`.
     - Verifica en el DXF parseado que la capa `GRABADO` contiene exactamente **`1` entidad `CIRCLE`** (correspondiente a `gapIndex === 1`) y **`N` entidades `ARC`** ($N = \max(4, \text{round}(2\pi r / 2.5))$ correspondientes a `gapIndex === 0`), **ambos con radio $r = (6.0 + 0.3) / 2 = 3.15\text{ mm}$**.
     - Verifica en el SVG que `#grabado` contiene `1` `<circle>` sólido (sin `stroke-dasharray`) y `1` `<circle>` punteado (`stroke-dasharray="1.5,1"`), ambos con `r="3.15"`.
   - **Validación estructural DXF `AC1015` (`@tarikjabiri/dxf@2.9.0`, Correcciones #7 y B8)**:
     - Verifica en el objeto parseado por `DxfParser`: `$ACADVER === 'AC1015'`, `$INSUNITS === 4` (mm), `$MEASUREMENT === 1`, capas `CORTE` (`color === 1`) y `GRABADO` (`color === 5`), entidades `LWPOLYLINE` cerradas, y entidades `CIRCLE` en la hoja de discos con radio `(diameter + kerf) / 2`.

6. **`src/__tests__/project.test.ts`**:
   - **Compatibilidad byte a byte con `web/golden/l_block_project.json` (Corrección #0 y B15)**:
     - Lee `web/golden/l_block_project.json`, ejecuta `parseProjectJson`, vuelve a serializar con `serializeProjectJson(parsed.params, parsed.discs)` y verifica que el string resultante es **idéntico byte a byte** al archivo golden (normalizando CRLF/LF).
     - Carga los discos en `DiscManager`, añade un disco nuevo y comprueba que su `id` es `max(id) + 1 === 4`.
   - Verifica que JSONs corruptos (`version: "2.0"`, IDs duplicados, `hueco >= plates - 1`, `diameter: -5`) lanzan `ValidationError`.
   - Verifica `checkParamsCompatibility`, la sincronización de `thickness` $\to$ `gap` (`ui.py:265-272`) y que `checkAutosaveOnStartup` no sobrescribe el estado sin confirmación del usuario (Corrección #5f).

---

#### Chunk 7.3: Suite E2E con Playwright (`web/playwright.config.ts` y `web/e2e/sculpture.spec.ts`)

##### Archivo `web/playwright.config.ts`
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

##### Casos obligatorios en `web/e2e/sculpture.spec.ts`
1. **Carga offline total (Corrección C3)**: Con `await context.setOffline(true)` tras abrir la app, carga `web/fixtures/test_l_block.obj`, ejecuta `Aplicar corte` y verifica `0` peticiones fallidas a dominios externos.
2. **Modo `modeAddDiscs`, orbitar `100 px` sin crear discos, colocación en pisos intermedios y arrastre fluido (Correcciones #1, #5d, B4 y B5)**:
   - Verifica que en modo `"Seleccionar"` (`modeAddDiscs === false` por defecto), hacer click en el canvas no crea discos.
   - Activa el botón `"Poner discos"` (`[data-testid="toggle-add-discs"]`, `modeAddDiscs === true`).
   - **Test obligatorio de órbita (`#1`)**: Arrastra la cámara `100 px` sobre el canvas (`mouse.Down` $\to$ `mouse.Move(+100, 0)` $\to$ `mouse.Up`) con `modeAddDiscs === true` y verifica que **se crean `0` discos y `0` alertas de error**.
   - Cambia a vista `Arriba` (`7`), selecciona el piso `2` mientras las placas superiores están visibles y translúcidas, hace un click corto (`e.delta <= 5`) en el centro del brazo de la L y verifica que se crea el disco `#1` (y su auto-copia `#2` en el piso `3`).
   - Arrastra rápidamente el disco hacia el borde comprobando que se desliza pegado al límite válido sin congelarse (`#5d`), y que `Ctrl+Z` revierte el movimiento en un solo paso.
3. **Atajos de teclado de `§1.3` y aislamiento en inputs (Correcciones #5a y B6)**:
   - Fuera de inputs, verifica que `W` / `ArrowUp` avanza al piso siguiente, `S` / `ArrowDown` retrocede al piso anterior, `7` activa vista Arriba, `1` Frente, `3` Lado, `0` 3D y `B` (o `Shift+7`) Abajo.
   - Con un disco seleccionado, hace foco en el input numérico `Diámetro`, presiona `Backspace`, `Delete`, `W`, `S`, `7` y `1`, y verifica que el disco **no se borra**, el piso no cambia y la cámara no se mueve.
4. **Banner de Autosave sin sobrescritura automática (Corrección #5f)**:
   - Recarga la página tras haber colocado discos y verifica que el estado inicial permanece limpio mientras se muestra el banner `[data-testid="autosave-banner"]` con los botones `"Restaurar sesión"` y `"Descartar"`. Al pulsar `"Restaurar sesión"`, se recuperan la malla, los parámetros y los discos.
5. **Exportación y descarga de `.dxf` (`AC1015`), `.svg` y `.zip` (Correcciones #6 y #7)**:
   - Abre el modal de previsualización de hojas, verifica las pestañas de hojas, las métricas seleccionables y descarga el `.dxf` comprobando que contiene `$ACADVER\n1\nAC1015` y `$INSUNITS\n70\n4`.

---

## 4. Definición de Terminado (Definition of Done)

La migración a `./web` se considera **TERMINADA** únicamente cuando se cumplen de forma simultánea y medible los siguientes 12 criterios:

| # | Criterio Medible | Comando / Verificación Objetiva | Umbral de Aceptación |
|---|---|---|---|
| **DoD-1** | **Cero errores de tipos y compilación limpia** | `cd web && npm run typecheck && npm run build` | Exit code `0`, `0` errores TS (`strict: true`), sin archivos basura de plantilla Vite. |
| **DoD-2** | **Dependencias 100% pineadas y offline** | Inspección de `web/package.json` y test Playwright con `context.setOffline(true)` | `0` versiones con `^` o `~`; `0` peticiones de red a `fonts.googleapis.com` o CDNs externos. |
| **DoD-3** | **Paridad matemática 1:1 con Golden Files de Python** | `cd web && npm test -- src/__tests__/slicer.test.ts` | Coincidencia contra `l_block_slice_{x,y,z}.json`, `torus_slice_z.json` y `hand_slice_z.json` con diferencia de área $< 0.01\%$ y bounds $< 10^{-4}\text{ mm}$. |
| **DoD-4** | **Quiralidad idéntica (No-Espejo) e IDs SVG unificados** | `cd web && npm test -- src/__tests__/exporter.test.ts` | Grupos `#cad-frame` (`translate(0, ${sheetH}) scale(1, -1)` dinámico), `#corte` y `#grabado`; vértices en SVG y DXF coinciden a $< 10^{-3}\text{ mm}$ con la vista Top 3D. |
| **DoD-5** | **DXF `AC1015` válido en parser, auditoría y apertura real en CAD/CAM** | `exporter.test.ts` (`dxf-parser@1.1.2`), `ezdxf.audit()` y **apertura real en LightBurn / LibreCAD / Inkscape** | `DxfParser.parseSync` y `ezdxf.audit()` con `0` errores (`$ACADVER = AC1015`, `$INSUNITS = 4`, `$MEASUREMENT = 1`); placa con disco arriba y abajo exporta `1 CIRCLE` y `N ARC` con $r = (d + \text{clearance})/2$; **apertura real en LightBurn/LibreCAD confirma dimensiones 1:1 en mm** (ver `BLOQUEANTE-1`). |
| **DoD-6** | **Unión booleana Clipper2 y reparación de cadenas abiertas** | `cd web && npm test -- src/__tests__/slicer.test.ts` | `0` huecos falsos en solapes; lazo de 100 segmentos con brecha de `0.01 mm` en el segmento 50 produce `1` lazo reparado y `openChainsRepaired === 1` desde cualquier segmento de arranque; brechas $> 0.05\text{ mm}$ se descartan. |
| **DoD-7** | **Validación geométrica, `clampDiscPositionToGap` y reescalado de discos** | `cd web && npm test -- src/__tests__/discs.test.ts` | Ningún disco sale de `plates[k]` o `plates[k+1]`; `clampDiscPositionToGap` desliza sobre el borde sin congelarse; `runSlice` reescala `(x, y)` por `newAutoScale / oldAutoScale` antes de `purgeInvalidDiscs`. |
| **DoD-8** | **Rendimiento de Slicing (Benchmark no bloqueante) y Arrastre a 60 FPS** | Benchmark en `slicer.test.ts` e inspección de `InteractiveDiscsView.tsx` | Benchmark **no bloqueante** de `stitchAndUnionSegments` con meta `< 50 ms` para `10,000` segmentos; `pointermove` proyecta con `clampDiscPositionToGap` y muta el `THREE.Group` sin pasar por Zustand, con `1` solo commit en `pointerup`. |
| **DoD-9** | **Cero fugas de VRAM, sin `<Edges>` y sin `backdrop-filter`** | Revisión de `SlicedPlatesView.tsx` e `index.css` | Geometrías creadas en `useMemo` con `.dispose()` en `useEffect`; bordes con `<lineSegments>`; `.hud-surface` sin `backdrop-filter`. |
| **DoD-10** | **Validador 3D con winding por profundidad de anidamiento** | `cd web && npm test -- src/__tests__/validator.test.ts` | Esfera hueca conserva la cavidad; STL invertido se corrige; malla abierta lejos del origen no se toca y avisa; `test_l_block.stl` y `test_torus.stl` reportan `isWatertight === true`. |
| **DoD-11** | **Compatibilidad byte a byte de JSON y Banner de Autosave** | `cd web && npm test -- src/__tests__/project.test.ts` | `serializeProjectJson` es byte-compatible con `web/golden/l_block_project.json`; autosave muestra el banner `"Restaurar sesión / Descartar"` sin sobrescribir el estado en silencio. |
| **DoD-12** | **Suite E2E Playwright en verde y accesibilidad WCAG AA** | `cd web && npm run test:e2e` | Todos los tests E2E pasan (`modeAddDiscs`, arrastrar cámara `100 px` no crea discos, atajos `§1.3` aislados de inputs, banner de autosave, contraste $\ge 4.5:1$, cero emojis). |

---

## 5. Lista de BLOQUEANTES

> [!WARNING]
> **Estado de Bloqueantes: `1 BLOQUEANTE DE VERIFICACIÓN EXTERNA (BLOQUEANTE-1)`.**

1. **`BLOQUEANTE-1` — Apertura interactiva de archivos DXF `AC1015` en ejecutables de escritorio LightBurn y LibreCAD (Corrección `#7` y `DoD-5`)**:
   - **Qué se verificó en este entorno**:
     - Se comprobó mediante `ezdxf` (`v1.4.2`) y el importador oficial de Inkscape (`C:\Program Files\Inkscape\share\inkscape\extensions\dxf_input.py`, líneas `24` y `1423`) que en **DXF R12 (`AC1009`) la variable `$INSUNITS` no forma parte del estándar** (`ezdxf` emite `"Drawing units ($INSUNITS) are not exported for DXF R12"`) y sin `$MEASUREMENT = 1` el importador aplica un factor imperial de `25.4x` (pulgadas a mm).
     - Se migró `dxfExporter.ts` a **DXF `AC1015` (AutoCAD 2000)** con la librería **`@tarikjabiri/dxf@2.9.0`** emitiendo `$ACADVER = AC1015`, `$INSUNITS = 4` (mm) y `$MEASUREMENT = 1` (métrico).
     - Se verificó el archivo `AC1015` resultante con:
       1. `ezdxf.readfile()` + `doc.audit()` $\implies$ **`0` errores y `0` fixes**.
       2. `dxf_input.py --scalemethod=file` de Inkscape $\implies$ **`scale = 1.000000` (1:1 milímetros exactos)**.
       3. `dxf-parser@1.1.2` (`new DxfParser().parseSync`) $\implies$ **`0` errores** en capas y entidades.
   - **Por qué es BLOQUEANTE**:
     - Los binarios de escritorio **LightBurn** y **LibreCAD** no están instalados en esta máquina (`shutil.which('LightBurn') === None`, `shutil.which('librecad') === None`), por lo que no es posible ejecutar su apertura GUI en este entorno.
   - **Cómo desbloquearlo al cerrar `DoD-5`**:
     - Abrir un archivo `.dxf` exportado por `./web` en **LightBurn** y en **LibreCAD** y confirmar visualmente que una hoja de `600 × 400 mm` se importa con dimensiones `600.0 × 400.0 mm` (escala 1:1 en milímetros) y con las capas `CORTE` (rojo) y `GRABADO` (azul) intactas.

> [!NOTE]
> **Recursos 100% verificados sin bloqueo**:
> - **Código fuente Python (`./*.py`)**: Leído y verificado al 100% (`params.py`, `project.py`, `ui.py`, `layout.py`, `exporter.py`, `slicer.py`, `discs.py`, `validator.py`, `main.py`, `viewer.py`, `preview_dialog.py`).
> - **Archivos `.d.ts` de dependencias pineadas**: Verificados contra sus paquetes reales (`@tarikjabiri/dxf@2.9.0`, `clipper2-js@1.2.4`, `three@0.186.0`, `@types/three@0.186.0`, `three-stdlib@2.36.1`, `@react-three/fiber@9.8.2`, `@react-three/drei@10.7.9`, `dxf-parser@1.1.2`).
> - **Fixtures y Golden Files (`web/fixtures/` y `web/golden/`)**: Presentes y verificados en `./web`.
