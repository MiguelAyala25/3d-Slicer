# Plan de Implementación — Escultura de Planos Seriados

> Herramienta Python para generar esculturas de planos seriados a partir de modelos 3D.  
> Alcance: cargar → rebanar → visualizar → exportar. Sin features extra.

> [!NOTE]
> **Revisión v2** — Este plan incorpora correcciones de tres auditorías técnicas y configuración inicial:
> - Fase 0: Repositorio GitHub con política de commits y push por cada hito/cambio
> - Pre-escalado del mesh antes de cortar (los polígonos salen directo en mm)
> - Bounding box global en el exportador (preserva alineación entre placas)
> - Marcas de alineación con dos puntos para fijar rotación en ensamble físico
> - Fallback robusto en `path2d_to_shapely` con nesting de huecos y orientación forzada
> - Rotación de ejes corregida para mantener orden intuitivo de placas (+eje → +Z)
> - Invalidación de estado en la UI al cambiar parámetros o cargar nuevo modelo
> - Detección heurística de unidades del modelo

---

## Stack de Librerías

| Librería | Versión mínima | Rol |
|---|---|---|
| `trimesh` | 4.x | Carga OBJ/STL, reparación, slicing (mesh_plane) |
| `numpy` | 1.24+ | Matrices, planos de corte, transformaciones |
| `shapely` | 2.x | Polígonos 2D resultantes, detección de huecos |
| `ezdxf` | 1.x | Escritura de archivos DXF para corte láser/CNC |
| `svgwrite` | 1.4+ | Escritura de archivos SVG |
| `PySide6` | 6.x | UI de escritorio (ventana, controles, diálogos) |
| `pyqtgraph` | 0.13+ | Widget OpenGL 3D embebido en Qt (`GLViewWidget`) |
| `PyOpenGL` | 3.x | Backend OpenGL requerido por pyqtgraph |

> [!NOTE]
> `trimesh` tiene a `shapely` y `numpy` como dependencias directas.
> No se necesita instalar `shapely` por separado si se instala `trimesh[easy]`.
> Pero la declaramos explícitamente en `requirements.txt` porque la usamos directamente.

```
# requirements.txt
trimesh[easy]>=4.0.0
numpy>=1.24.0
shapely>=2.0.0
ezdxf>=1.0.0
svgwrite>=1.4.0
PySide6>=6.5.0
pyqtgraph>=0.13.1
PyOpenGL>=3.1.0
```

---

## Estructura de Archivos

```
sculpture/
├── main.py          # Entry point — instancia la app Qt y lanza la ventana principal
├── slicer.py        # Lógica de corte: carga mesh, calcula planos, extrae polígonos 2D
├── exporter.py      # Escribe DXF y SVG a partir de la lista de polígonos
├── validator.py     # Validaciones de archivo y parámetros numéricos
├── viewer.py        # Widget Qt con dos vistas GLViewWidget (original / rebanado)
├── ui.py            # Panel de controles Qt: inputs, botones, labels de info
└── requirements.txt
```

**Regla:** cada archivo tiene una sola responsabilidad. No hay carpetas anidadas, no hay clases abstractas, no hay config files. Si un archivo supera las 250 líneas, es señal de que algo está mal.

---

## Convenciones Generales

- **Unidades internas:** el slicer pre-escala el mesh a milímetros antes de cortar. Los polígonos 2D resultantes ya están en mm. Ni el visor ni el exportador necesitan aplicar escala adicional.
- **Eje de corte por defecto:** Z. El usuario puede cambiarlo en la UI (X / Y / Z).
- **Idioma de mensajes de error:** español, claros y accionables.
- **Sin globals mutables:** los parámetros viajan como argumentos entre funciones, no como estado global.
- **Sin logging framework:** `print()` para debug en consola durante desarrollo; en producción, los errores van a `QMessageBox`.

---

## Fase 0 — Repositorio GitHub y Control de Versiones

**Objetivo:** Inicializar el repositorio local, configurar `.gitignore`, vincular con GitHub y establecer la política de commits y push continuos por cada hito/cambio implementado.  
**Archivos involucrados:** `.gitignore`, `README.md`, `requirements.txt`

### 1. Configuración de `.gitignore`
Crear un archivo `.gitignore` robusto para entorno Python/Qt:
```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
env/
venv/
.venv/
build/
dist/
*.egg-info/

# IDEs y OS
.idea/
.vscode/
*.swp
*.swo
Thumbs.db
Desktop.ini

# Archivos temporales de test o exports
test_*.obj
test_*.stl
*.dxf
*.svg
!samples/
```

### 2. Creación del repositorio remoto y vinculación
1. Inicializar localmente:
   ```bash
   git init -b main
   ```
2. Crear `requirements.txt` y `README.md` base.
3. Crear el repositorio en GitHub (vía GitHub CLI `gh repo create` o web) y enlazarlo:
   ```bash
   git remote add origin https://github.com/<usuario>/sculpture.git
   git add .
   git commit -m "chore: setup inicial del proyecto, gitignore y plan v2"
   git push -u origin main
   ```

### 3. Política estricta de commits y push ("Push por cada cambio")
- **Regla:** Ningún avance o módulo queda solo en local. Cada fase completada o ajuste verificado debe commitearse y pushearse inmediatamente.
- **Convención de commits:**
  - `chore: ...` (setup inicial, dependencias)
  - `feat(validator): ...` (validaciones de archivo y mesh)
  - `feat(slicer): ...` (corte headless, pre-escalado en mm, nesting de huecos)
  - `feat(exporter): ...` (generación DXF/SVG con bbox global y pines de ensamble)
  - `feat(viewer): ...` (renderizado OpenGL de placas extruidas)
  - `feat(ui): ...` (panel de control PySide6 e invalidación de estado)
  - `feat(app): ...` (ensamble en main.py y UX de errores)
  - `fix: ...` (correcciones de bugs)
- **Flujo en cada paso:**
  ```bash
  git add .
  git commit -m "mensaje descriptivo"
  git push
  ```

---

## Fase 1 — Núcleo de Slicing Headless

**Objetivo:** dado un archivo y parámetros, producir una lista de polígonos 2D (uno por placa).  
**Archivos involucrados:** `validator.py`, `slicer.py`  
**Sin UI.** Testeable desde consola.

---

### `validator.py` — Implementación detallada

**Responsabilidad:** detectar cualquier problema antes de que el código de slicing lo vea.

```python
# Firma pública del módulo
def validate_file(path: str) -> tuple[bool, str]:
    """
    Verifica que el archivo existe y tiene extensión OBJ o STL.
    (La carga real con trimesh se hace después para evitar doble trabajo).
    Retorna (True, "") si todo OK, o (False, "mensaje de error") si falla.
    """

def validate_params(plates: int, gap: float, thickness: float) -> tuple[bool, str]:
    """
    Verifica que:
      - plates >= 2
      - gap >= 0
      - thickness > 0
    Retorna (True, "") o (False, "mensaje de error").
    """

def validate_mesh(mesh) -> tuple[bool, str, bool]:
    """
    Recibe un objeto trimesh.Trimesh ya cargado.
    Verifica que no esté vacío (vértices > 0, caras > 0).
    Intenta reparación automática si no es watertight.
    
    IMPORTANTE: esta función MUTA el mesh recibido (fill_holes, fix_normals).
    El caller debe ser consciente de que el mesh original se modifica.
    Esto es intencional: queremos que slice_mesh trabaje con la versión reparada.
    
    Retorna (es_válido: bool, mensaje: str, fue_reparado: bool).
    """
```

**Lógica de `validate_mesh` paso a paso:**
1. Verificar `len(mesh.vertices) > 0` y `len(mesh.faces) > 0` → si no, error fatal.
2. Si `not mesh.is_watertight`:
   - Aplicar `trimesh.repair.fill_holes(mesh)`
   - Aplicar `trimesh.repair.fix_normals(mesh)`
   - Verificar nuevamente `mesh.is_watertight`
   - Si sigue sin ser watertight: retornar `(True, "advertencia: modelo no cerrado, resultados pueden ser incompletos", False)`
   - Si ahora es watertight: retornar `(True, "modelo reparado automáticamente", True)`
3. Si era watertight desde el inicio: retornar `(True, "", False)`

---

### `slicer.py` — Implementación detallada

**Responsabilidad:** toda la matemática de corte.

```python
from dataclasses import dataclass

# Estructura de datos de salida
@dataclass
class SliceResult:
    polygons: list           # lista de listas de shapely.Polygon (una lista por placa)
                             # COORDENADAS EN MM — el mesh fue pre-escalado antes de cortar
    empty_plates: list[int]  # índices de placas que resultaron vacías o triviales
    original_bounds: tuple   # (min_axis, max_axis) en el eje de corte, ANTES de escalar
    assembled_height: float  # altura total ensamblada = (n_plates * thickness) + ((n_plates-1) * gap)
    auto_scale: float        # escala calculada (informativo — ya aplicada al mesh)
    warnings: list[str]      # advertencias no fatales

# Firma pública del módulo
def slice_mesh(
    mesh,           # trimesh.Trimesh ya validado
    plates: int,    # número de cortes
    gap: float,     # separación entre placas (mm)
    thickness: float, # grosor físico de cada placa (mm)
    axis: str,      # 'x', 'y' o 'z'
    min_area_mm2: float = 1.0 # umbral mínimo de área en mm² para considerar una placa válida
) -> SliceResult:
```

**Lógica de `slice_mesh` paso a paso:**

**Paso 1 — Copiar, rotar, centrar y pre-escalar el modelo**

> [!IMPORTANT]
> El mesh se escala **antes** de cortar. Esto garantiza que XY y Z escalan por el
> mismo factor, preservando la proporción exacta del modelo original.
> Los polígonos 2D resultantes salen directamente en mm — ni el visor ni el
> exportador necesitan aplicar escala adicional.

```python
import numpy as np
import trimesh.transformations as tx

# IMPORTANTE: Copiar el mesh para no modificar el modelo original guardado en estado
mesh = mesh.copy()

# Rotar el modelo una sola vez para que el eje elegido se convierta en Z
# Esto permite usar section_multiplane y simplifica el visor y exportación
# NOTA: los signos se eligen para que el eje positivo original apunte a +Z,
# así la placa 1 corresponde al inicio del eje y la última al final.
if axis == 'x':
    # Rotar para que +X mire hacia +Z (rot -π/2 alrededor de Y)
    rot = tx.rotation_matrix(-np.pi/2, [0, 1, 0])
    mesh.apply_transform(rot)
elif axis == 'y':
    # Rotar para que +Y mire hacia +Z (rot +π/2 alrededor de X)
    rot = tx.rotation_matrix(np.pi/2, [1, 0, 0])
    mesh.apply_transform(rot)

# --- NUEVO: Centrar el mesh en el origen ---
# Esto evita edge-cases de trimesh con coordenadas muy grandes/negativas
# y simplifica el cálculo de posiciones de corte.
mesh.vertices -= mesh.bounds.mean(axis=0)

# Calcular dimensiones y escala ANTES de escalar
bounds = mesh.bounds  # [[min_x, min_y, min_z], [max_x, max_y, max_z]]
min_z = bounds[0][2]
max_z = bounds[1][2]
total_length = max_z - min_z
original_bounds = (min_z, max_z)  # guardar para info

assembled_height = (plates * thickness) + ((plates - 1) * gap)
auto_scale = assembled_height / total_length if total_length > 0 else 1.0

# --- NUEVO: Pre-escalar el mesh a mm ---
# Después de esto, TODAS las coordenadas del mesh están en mm.
# Los polígonos 2D que salgan de section_multiplane ya estarán en mm.
mesh.apply_scale(auto_scale)

# Recalcular bounds post-escalado (ahora en mm)
bounds_mm = mesh.bounds
min_z_mm = bounds_mm[0][2]
# max_z_mm ≈ min_z_mm + assembled_height (por definición de auto_scale)
```

**Paso 2 — Calcular posiciones de corte (ahora directamente en mm)**
```python
# Como el mesh ya está en mm, las posiciones de corte son directas:
# el centro físico de cada placa, mapeado al espacio del mesh escalado.
cut_positions = []
for i in range(plates):
    # Centro físico de la placa i (en mm desde la base de la escultura)
    physical_center = i * (thickness + gap) + (thickness / 2.0)
    # Trasladado al espacio del mesh (que ahora empieza en min_z_mm)
    pos_in_mesh = min_z_mm + physical_center
    cut_positions.append(pos_in_mesh)
```

**Paso 3 — Cortar con `section_multiplane`**
```python
# El mesh está centrado y escalado. plane_origin=[0,0,0] es seguro.
# heights son coordenadas absolutas Z (offsets desde origin en dirección del normal).
sections_2d = mesh.section_multiplane(
    plane_origin=[0, 0, 0],
    plane_normal=[0, 0, 1],
    heights=cut_positions
)

for i, section_2d in enumerate(sections_2d):
    if section_2d is None:
        empty_plates.append(i)
        polygons.append(None)
        continue
    
    # Convertir Path2D de trimesh a una lista de shapely Polygons simples
    poly_list = path2d_to_shapely(section_2d)
    
    # Filtrar por área mínima — los polígonos YA están en mm, no hace falta escalar
    valid_polys_for_plate = [p for p in poly_list if p.area >= min_area_mm2]
    
    if not valid_polys_for_plate:
        empty_plates.append(i)
        polygons.append(None)
    else:
        polygons.append(valid_polys_for_plate)
```

**Paso 4 — `path2d_to_shapely()` (función interna)**

Para evitar problemas en el visor y la exportación (como usar `.exterior` en un `MultiPolygon`), esta función explota cualquier `MultiPolygon` o `GeometryCollection` en polígonos simples, fuerza orientación CCW en exteriores, e incluye un fallback cuando `polygons_full` falla silenciosamente.

```python
def path2d_to_shapely(path2d) -> list:
    """
    Convierte un trimesh.Path2D en una lista de polígonos simples (shapely.Polygon).
    Resuelve huecos, fuerza orientación CCW y descarta geometrías inválidas.
    Incluye fallback si polygons_full retorna vacío a pesar de tener vértices.
    """
    import shapely
    from shapely.geometry import Polygon, MultiPolygon, GeometryCollection
    from shapely.geometry.polygon import orient
    
    # --- Ruta principal: usar polygons_full de trimesh ---
    try:
        polys_full = path2d.polygons_full
    except Exception:
        polys_full = []
    
    # --- Fallback: si polygons_full falló pero hay vértices, reconstruir ---
    # IMPORTANTE: el fallback con discrete pierde la distinción exterior/hueco.
    # Se necesita lógica de nesting para reconstruir la jerarquía.
    if not polys_full and hasattr(path2d, 'discrete') and len(path2d.discrete) > 0:
        try:
            raw_polys = []
            for contour in path2d.discrete:
                if len(contour) >= 3:
                    candidate = Polygon(contour)
                    if not candidate.is_valid:
                        candidate = shapely.make_valid(candidate)
                    if isinstance(candidate, Polygon) and not candidate.is_empty:
                        raw_polys.append(candidate)
            
            # --- Nesting: reconstruir jerarquía exterior/hueco ---
            # Ordenar por área descendente (los más grandes son exteriores)
            raw_polys.sort(key=lambda p: p.area, reverse=True)
            used = set()
            nested_polys = []
            
            for i, outer in enumerate(raw_polys):
                if i in used:
                    continue
                # Buscar polígonos contenidos dentro de este (son huecos)
                holes = []
                for j, inner in enumerate(raw_polys):
                    if j <= i or j in used:
                        continue
                    if outer.contains(inner):
                        holes.append(inner.exterior.coords)
                        used.add(j)
                
                # Reconstruir polígono con huecos
                if holes:
                    nested = Polygon(outer.exterior.coords, holes)
                    if nested.is_valid and not nested.is_empty:
                        nested_polys.append(nested)
                    else:
                        nested_polys.append(outer)  # fallback sin huecos
                else:
                    nested_polys.append(outer)
            
            polys_full = nested_polys
        except Exception:
            return []
    
    if not polys_full:
        return []
    
    result = []
    for p in polys_full:
        valid_p = shapely.make_valid(p)
        
        # Extraer solo los Polygon simples y forzar orientación CCW
        # orient(sign=1.0) → exterior CCW, interiors CW (convención estándar)
        if isinstance(valid_p, Polygon):
            if not valid_p.is_empty:
                result.append(orient(valid_p, sign=1.0))
        elif isinstance(valid_p, MultiPolygon):
            for geom in valid_p.geoms:
                if not geom.is_empty:
                    result.append(orient(geom, sign=1.0))
        elif isinstance(valid_p, GeometryCollection):
            for geom in valid_p.geoms:
                if isinstance(geom, Polygon) and not geom.is_empty:
                    result.append(orient(geom, sign=1.0))
    
    return result
```

**Paso 5 — Generar advertencias**
```
Si len(empty_plates) > 0:
    shown = empty_plates[:5] + ['...'] + empty_plates[-3:] if len(empty_plates) > 10 else empty_plates
    warnings.append(f"Placas {shown} están vacías o demasiado pequeñas (área < {min_area_mm2} mm²). Serán omitidas en la exportación.")

Si len(empty_plates) == plates:
    # Error fatal — ningún corte produjo geometría
    raise ValueError("Ningún plano de corte produjo geometría. Verificá el eje de corte seleccionado.")
```

> [!TIP]
> **Verificación de orientación:** Al implementar, crear un test con un modelo
> asimétrico en forma de "L". Las rotaciones usan `-π/2` para eje X y `+π/2` para
> eje Y, elegidos para que `+eje → +Z` (placa 1 = inicio del eje original).
> Verificar que: (a) los contornos 2D no están espejados, y (b) la placa 1
> corresponde al extremo esperado del modelo.

---

### Test manual de Fase 1

Crear `test_slice.py` (temporal, en raíz):

```python
# test_slice.py — borrar después de validar
import trimesh
from validator import validate_file, validate_params, validate_mesh
from slicer import slice_mesh

# Test 1: L-block asimétrico (para validar alineación y espejado)
ok, msg = validate_file("test_l_block.obj")
print(f"Archivo válido: {ok} — {msg}")

# La carga con trimesh se hace aquí porque validate_file ya no lo hace
mesh = trimesh.load("test_l_block.obj", force='mesh')
ok, msg, repaired = validate_mesh(mesh)
print(f"Mesh válido: {ok}, reparado: {repaired} — {msg}")

ok, msg = validate_params(plates=5, gap=2.0, thickness=3.0)
print(f"Params válidos: {ok} — {msg}")

result = slice_mesh(mesh, plates=5, gap=2.0, thickness=3.0, axis='z')
print(f"Polígonos generados: {len([p for p in result.polygons if p is not None])}")
print(f"Placas vacías: {result.empty_plates}")
print(f"Altura ensamblada: {result.assembled_height}")
print(f"Escala auto-calculada: {result.auto_scale}")
print(f"Advertencias: {result.warnings}")

# Test 2: Verificar que los polígonos ya están en mm
if result.polygons[2] is not None:
    poly = result.polygons[2][0]
    minx, miny, maxx, maxy = poly.bounds
    print(f"Placa 2 bounds: ({minx:.1f}, {miny:.1f}) → ({maxx:.1f}, {maxy:.1f}) mm")
    print(f"(Deben ser valores razonables en mm, no en unidades del modelo)")

# Test 3: Verificar que la posición relativa se preserva entre placas
# Las placas de un L-block deben tener centroides desplazados, no todos en (0,0)
for i, plist in enumerate(result.polygons):
    if plist is None:
        continue
    centroid = plist[0].centroid
    print(f"Placa {i}: centroide en ({centroid.x:.1f}, {centroid.y:.1f}) mm")
```

**Criterio de éxito de Fase 1:**
- [ ] L-block asimétrico → Las coordenadas 2D de los polígonos preservan la posición relativa entre placas (centroides NO todos iguales si el modelo es asimétrico)
- [ ] L-block → Los contornos NO están espejados respecto al modelo 3D
- [ ] Cubo → 5 polígonos rectangulares, 0 vacíos, sin advertencias
- [ ] Esfera → 5 polígonos elípticos, los extremos pueden ser pequeños pero no vacíos
- [ ] Archivo inválido → mensaje claro, sin traceback
- [ ] plates=1 → mensaje claro `"Se necesitan al menos 2 placas"`
- [ ] Los polígonos tienen coordenadas en mm (verificar con bounds razonables)

---

## Fase 2 — Exportación DXF y SVG

**Objetivo:** tomar el `SliceResult` y escribir archivos de fabricación listos para corte láser/CNC.  
**Archivo involucrado:** `exporter.py`

---

### `exporter.py` — Implementación detallada

```python
# Firma pública del módulo
def export_dxf(
    result: SliceResult,
    output_path: str,
    add_alignment_marks: bool = True
) -> tuple[bool, str]:
    """
    Escribe un archivo DXF con cada placa en su propio layer (PLACA_01, PLACA_02...).
    Los polígonos ya vienen en mm desde el slicer — no se aplica escala adicional.
    Retorna (True, ruta) o (False, mensaje_error).
    """

def export_svg(
    result: SliceResult,
    output_path: str,
    margin_mm: float = 10.0,
    add_alignment_marks: bool = True
) -> tuple[bool, str]:
    """
    Escribe un archivo SVG con todas las placas distribuidas en fila.
    Los polígonos ya vienen en mm desde el slicer — no se aplica escala adicional.
    Retorna (True, ruta) o (False, mensaje_error).
    """
```

---

### Lógica de exportación paso a paso

> [!IMPORTANT]
> **Bounding box GLOBAL, no individual.** Para preservar la alineación relativa entre
> placas (crítico para que la escultura se ensamble correctamente), todas las placas
> se posicionan usando un bounding box global. Cada "slot" tiene el mismo ancho/alto,
> y las placas más pequeñas simplemente tienen más espacio vacío alrededor.

**Paso 1 — Calcular bounding box global**

```python
valid_plates = [plist for plist in result.polygons if plist is not None]
if not valid_plates:
    return False, "No hay placas válidas para exportar."

# Bounding box GLOBAL — igual para TODAS las placas
# Esto preserva la posición relativa de los contornos entre placas
global_min_x = min(min(p.bounds[0] for p in plist) for plist in valid_plates)
global_min_y = min(min(p.bounds[1] for p in plist) for plist in valid_plates)
global_max_x = max(max(p.bounds[2] for p in plist) for plist in valid_plates)
global_max_y = max(max(p.bounds[3] for p in plist) for plist in valid_plates)

slot_width = global_max_x - global_min_x    # mismo ancho para cada slot
slot_height = global_max_y - global_min_y    # mismo alto para cada slot
```

**Paso 2 — Crear documento (doc/dwg)**

```python
n_valid = len(valid_plates)
total_width = (n_valid * slot_width) + ((n_valid + 1) * margin_mm)
total_height = slot_height + (margin_mm * 2)

if formato == 'svg':
    dwg = svgwrite.Drawing(output_path, size=(f"{total_width}mm", f"{total_height}mm"))
    dwg.viewbox(0, 0, total_width, total_height)
    
    # Configuración de fill-rule
    group = dwg.g(style="fill-rule:evenodd; fill:none; stroke:black; stroke-width:0.1mm;")
    dwg.add(group)
    
    align_group = dwg.g(id="alignment-marks")
    dwg.add(align_group)

elif formato == 'dxf':
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()
    doc.layers.add("ALINEACION", color=1)
```

**Paso 3 — Escribir geometría con offset global**

```python
x_offset = margin_mm

for i, plist in enumerate(result.polygons):
    if plist is None:
        continue
        
    layer_name = f"PLACA_{i+1:02d}"
    
    for polygon in plist:
        def transform_coords(coords, form):
            res = []
            for x, y in coords:
                tx = (x - global_min_x) + x_offset
                ty = (y - global_min_y)
                if form == 'svg':
                    ty = slot_height - ty
                res.append((tx, ty))
            return res
            
        exterior = transform_coords(polygon.exterior.coords, formato)
        interiors = [transform_coords(h.coords, formato) for h in polygon.interiors]
        
        if formato == 'dxf':
            msp.add_lwpolyline(exterior, close=True, dxfattribs={"layer": layer_name})
            for interior in interiors:
                msp.add_lwpolyline(interior, close=True, dxfattribs={"layer": layer_name})
        elif formato == 'svg':
            path_d = _coords_to_svg_path(exterior)
            for interior in interiors:
                path_d += " " + _coords_to_svg_path(interior)
            group.add(dwg.path(d=path_d))
    
    if add_alignment_marks:
        pin_radius = 1.5
        ax = (slot_width * 0.25) + x_offset
        ay_base = slot_height / 2.0
        ay = ay_base if formato == 'dxf' else (slot_height - ay_base)
        bx = (slot_width * 0.75) + x_offset
        by_base = slot_height * 0.75
        by = by_base if formato == 'dxf' else (slot_height - by_base)
        
        if formato == 'dxf':
            msp.add_circle((ax, ay), radius=pin_radius, dxfattribs={"layer": "ALINEACION"})
            msp.add_circle((bx, by), radius=pin_radius, dxfattribs={"layer": "ALINEACION"})
        elif formato == 'svg':
            align_group.add(dwg.circle(center=(ax, ay), r=pin_radius, stroke="red", fill="none", stroke_width="0.2mm"))
            align_group.add(dwg.circle(center=(bx, by), r=pin_radius, stroke="red", fill="none", stroke_width="0.2mm"))
    
    x_offset += slot_width + margin_mm
```

**Paso 4 — Guardar archivo (con manejo de errores)**

```python
try:
    if formato == 'svg':
        dwg.save()
    elif formato == 'dxf':
        doc.saveas(output_path)
    return True, output_path
except Exception as e:
    return False, f"Error al guardar: {e}"
```

**Función auxiliar para paths SVG:**
```python
def _coords_to_svg_path(coords) -> str:
    """Convierte una lista de (x, y) a un string de path SVG: 'M x,y L x,y ... Z'"""
    parts = []
    for j, (x, y) in enumerate(coords):
        prefix = "M" if j == 0 else "L"
        parts.append(f"{prefix} {x:.3f},{y:.3f}")
    parts.append("Z")
    return " ".join(parts)
```

---

### Criterio de éxito de Fase 2

- [ ] DXF se abre en AutoCAD / DraftSight / Inkscape sin errores
- [ ] SVG se abre en Inkscape con todos los contornos cerrados
- [ ] Polígonos con huecos (ej: modelo en forma de dona) exportan correctamente el hueco
- [ ] MultiPolygon (modelo con partes separadas) exporta todas las partes
- [ ] **NUEVO:** Las placas de un modelo asimétrico mantienen su posición relativa (los contornos NO están todos centrados en su propio slot)
- [ ] **NUEVO:** Las marcas de alineación aparecen en la misma posición en cada slot
- [ ] **NUEVO:** Los huecos se ven correctamente en Inkscape (fill-rule evenodd funciona)

---

## Fase 3 — Visor 3D y UI

**Objetivo:** ventana Qt con dos vistas 3D y panel de controles.  
**Archivos involucrados:** `viewer.py`, `ui.py`, `main.py`

---

### `viewer.py` — Implementación detallada

**Responsabilidad:** renderizar la geometría en OpenGL sin lógica de negocio.

```python
import numpy as np
import pyqtgraph as pg
import pyqtgraph.opengl as gl
from pyqtgraph.opengl import GLViewWidget, GLMeshItem, GLLinePlotItem
from PySide6.QtWidgets import QWidget, QHBoxLayout
import trimesh
from slicer import SliceResult

def _hue_to_rgb(h: float) -> list[float]:
    """Convierte un valor de tono (0-1) a RGB (0-1) usando hsv_to_rgb."""
    import colorsys
    return list(colorsys.hsv_to_rgb(h, 0.8, 0.9))

class SculptureViewer(QWidget):
    """
    Widget con dos GLViewWidget lado a lado:
    - izquierda: mesh original
    - derecha: placas rebanadas y separadas por gap
    """
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_layout()
    
    def _setup_layout(self):
        layout = QHBoxLayout(self)
        
        # Vista izquierda — modelo original
        self.view_original = GLViewWidget()
        self.view_original.setWindowTitle("Modelo Original")
        
        # Vista derecha — resultado rebanado
        self.view_sliced = GLViewWidget()
        self.view_sliced.setWindowTitle("Resultado Rebanado")
        
        layout.addWidget(self.view_original)
        layout.addWidget(self.view_sliced)
    
    def show_original_mesh(self, mesh):
        """
        Renderiza el mesh original en la vista izquierda.
        Usa wireframe semitransparente para ver la forma.
        """
        self.view_original.clear()
        
        verts = mesh.vertices.astype(np.float32)
        faces = mesh.faces.astype(np.uint32)
        colors = np.ones((len(faces), 4), dtype=np.float32)
        colors[:, :3] = [0.7, 0.85, 1.0]  # azul claro
        colors[:, 3] = 0.7  # semitransparente
        
        mesh_item = GLMeshItem(
            vertexes=verts,
            faces=faces,
            faceColors=colors,
            smooth=True,
            drawEdges=True,
            edgeColor=(0.3, 0.5, 0.8, 1.0),
            glOptions='translucent'
        )
        self.view_original.addItem(mesh_item)
        self._fit_camera(self.view_original, mesh.bounding_box)
    
    def show_sliced_result(self, result: SliceResult, thickness: float, gap: float):
        """
        Renderiza las placas como cajas planas separadas por el gap.
        Cada placa es un sólido extruido con el grosor indicado.
        
        Los polígonos en result.polygons ya están en mm (pre-escalados por el slicer).
        No se aplica escala adicional.
        """
        self.view_sliced.clear()
        wireframe_count = 0  # contador de placas que cayeron a wireframe
        
        for i, plist in enumerate(result.polygons):
            if plist is None:
                continue
            
            # Posición de la placa en Z (en mm)
            plate_position = i * (thickness + gap)
            
            # Color alternado por placa
            hue = (i / len(result.polygons))
            color = _hue_to_rgb(hue) + [0.85]
            
            for polygon in plist:
                # Los polígonos ya están en mm — usar directo, sin escalar
                plate_mesh = _extrude_polygon(polygon, thickness, plate_position)
                
                if plate_mesh is None:
                    # Fallback a wireframe — acumular advertencia
                    wireframe_count += 1
                    coords = np.array(polygon.exterior.coords)
                    z_coords = np.full((len(coords), 1), plate_position)
                    pts = np.hstack([coords, z_coords])
                    
                    item = GLLinePlotItem(pos=pts, color=color, width=2.0, antialias=True)
                    self.view_sliced.addItem(item)
                    continue
                
                verts = plate_mesh.vertices.astype(np.float32)
                faces = plate_mesh.faces.astype(np.uint32)
                colors = np.tile(color, (len(faces), 1)).astype(np.float32)
                
                item = GLMeshItem(
                    vertexes=verts, faces=faces, faceColors=colors,
                    smooth=False, drawEdges=True, edgeColor=(0, 0, 0, 0.5),
                    glOptions='translucent'
                )
                self.view_sliced.addItem(item)
        
        self._fit_camera_to_result(self.view_sliced, result, thickness, gap)
        
        # Retornar conteo de wireframes para que la UI muestre advertencia
        return wireframe_count
    
    def _fit_camera(self, view: GLViewWidget, bounding_box):
        """Ajusta la cámara para ver el objeto completo."""
        center = bounding_box.centroid
        extent = np.max(bounding_box.extents)
        view.setCameraPosition(distance=extent * 2.5, elevation=30, azimuth=45)
        view.opts['center'] = pg.Vector(center[0], center[1], center[2])
    
    def _fit_camera_to_result(self, view, result, thickness, gap):
        """Ajusta cámara centrándola en el bounding box del resultado."""
        valid_plates = [plist for plist in result.polygons if plist is not None]
        if not valid_plates:
            return
        
        # Los polígonos ya están en mm — usar directo
        min_x = min(min(p.bounds[0] for p in plist) for plist in valid_plates)
        max_x = max(max(p.bounds[2] for p in plist) for plist in valid_plates)
        min_y = min(min(p.bounds[1] for p in plist) for plist in valid_plates)
        max_y = max(max(p.bounds[3] for p in plist) for plist in valid_plates)
        
        center_x = (min_x + max_x) / 2.0
        center_y = (min_y + max_y) / 2.0
        center_z = result.assembled_height / 2.0
        
        extent = max(max_x - min_x, max_y - min_y, result.assembled_height)
        view.setCameraPosition(distance=extent * 2.0, elevation=30, azimuth=45)
        view.opts['center'] = pg.Vector(center_x, center_y, center_z)
```

**Función interna `_extrude_polygon()`:**
```python
def _extrude_polygon(polygon, thickness, position) -> trimesh.Trimesh | None:
    """
    Extruye un shapely Polygon en Z para darle grosor visual.
    Como el modelo ya fue rotado, siempre extruimos en Z.
    Los polígonos ya están en mm — no se aplica escala.
    """
    try:
        extruded = trimesh.creation.extrude_polygon(polygon, height=thickness)
        
        # Trasladar a la posición correcta en Z
        translation = [0, 0, position]
        extruded.apply_translation(translation)
        
        return extruded
    except Exception:
        return None
```

> [!TIP]
> **Optimización para modelos con muchas placas (>50):** Si el rendimiento del preview
> es inaceptable, concatenar todos los meshes extruidos en uno solo con
> `trimesh.util.concatenate()` y renderizar un solo `GLMeshItem` en vez de uno por
> polígono. Esto reduce draw calls de ~150 a 1.

---

### `ui.py` — Implementación detallada

**Responsabilidad:** controles del usuario. Sin lógica de negocio.

```python
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QFormLayout, QHBoxLayout, QLabel, QPushButton, QSpinBox, QDoubleSpinBox, QComboBox, QFileDialog, QMessageBox, QScrollArea)
from PySide6.QtCore import Signal, Qt
from slicer import SliceResult

class ControlPanel(QWidget):
    """
    Panel lateral con todos los controles.
    Emite señales Qt cuando el usuario cambia algo.
    """
    
    # Señales
    file_loaded = Signal(str)          # path del archivo
    params_changed = Signal(int, float, float, str)  # plates, gap, thickness, axis
    export_requested = Signal(str)     # 'dxf' o 'svg'
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self._build_ui()
    
    def _build_ui(self):
        outer_layout = QVBoxLayout(self)
        outer_layout.setContentsMargins(0, 0, 0, 0)
        
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setFrameShape(QScrollArea.NoFrame)
        
        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setAlignment(Qt.AlignTop)
        
        # --- Sección: Cargar archivo ---
        layout.addWidget(QLabel("<b>Modelo 3D</b>"))
        
        self.btn_load = QPushButton("Cargar OBJ / STL...")
        self.lbl_file = QLabel("Ningún archivo cargado")
        self.lbl_file.setWordWrap(True)
        
        layout.addWidget(self.btn_load)
        layout.addWidget(self.lbl_file)
        
        # --- Sección: Parámetros ---
        layout.addSpacing(12)
        layout.addWidget(QLabel("<b>Parámetros de corte</b>"))
        
        form = QFormLayout()
        
        self.spin_plates = QSpinBox()
        self.spin_plates.setRange(2, 200)
        self.spin_plates.setValue(10)
        self.spin_plates.setSuffix(" placas")
        form.addRow("Número de placas:", self.spin_plates)
        
        self.spin_gap = QDoubleSpinBox()
        self.spin_gap.setRange(0.0, 1000.0)
        self.spin_gap.setValue(5.0)
        self.spin_gap.setSuffix(" mm")
        self.spin_gap.setSingleStep(0.5)
        form.addRow("Separación entre placas:", self.spin_gap)
        
        self.spin_thickness = QDoubleSpinBox()
        self.spin_thickness.setRange(0.1, 100.0)
        self.spin_thickness.setValue(3.0)
        self.spin_thickness.setSuffix(" mm")
        self.spin_thickness.setSingleStep(0.5)
        form.addRow("Grosor del acrílico:", self.spin_thickness)
        
        self.combo_axis = QComboBox()
        self.combo_axis.addItems(["Z (vertical)", "X (lateral)", "Y (frontal)"])
        form.addRow("Eje de corte:", self.combo_axis)
        
        layout.addLayout(form)
        
        # --- Botón: Aplicar ---
        self.btn_apply = QPushButton("✓ Aplicar corte")
        self.btn_apply.setEnabled(False)  # se habilita solo cuando hay archivo cargado
        layout.addWidget(self.btn_apply)
        
        # --- Sección: Info de resultado ---
        layout.addSpacing(12)
        layout.addWidget(QLabel("<b>Información del resultado</b>"))
        self.lbl_info = QLabel("—")
        self.lbl_info.setWordWrap(True)
        layout.addWidget(self.lbl_info)
        
        # --- Sección: Exportar ---
        layout.addSpacing(12)
        layout.addWidget(QLabel("<b>Exportar</b>"))
        
        self.btn_export_dxf = QPushButton("Exportar DXF")
        self.btn_export_svg = QPushButton("Exportar SVG")
        self.btn_export_dxf.setEnabled(False)
        self.btn_export_svg.setEnabled(False)
        
        layout.addWidget(self.btn_export_dxf)
        layout.addWidget(self.btn_export_svg)
        
        # --- Sección: Advertencias ---
        self.lbl_warnings = QLabel("")
        self.lbl_warnings.setWordWrap(True)
        self.lbl_warnings.setStyleSheet("color: orange;")
        layout.addWidget(self.lbl_warnings)
        
        # --- Conectar señales internas ---
        self.btn_load.clicked.connect(self._on_load_clicked)
        self.btn_apply.clicked.connect(self._on_apply_clicked)
        self.btn_export_dxf.clicked.connect(lambda: self.export_requested.emit('dxf'))
        self.btn_export_svg.clicked.connect(lambda: self.export_requested.emit('svg'))
        
        # --- NUEVO: Invalidar resultado cuando los parámetros cambian ---
        # Esto evita que el usuario exporte un resultado que no corresponde
        # a los parámetros actualmente mostrados en pantalla.
        self.spin_plates.valueChanged.connect(self._invalidate_result)
        self.spin_gap.valueChanged.connect(self._invalidate_result)
        self.spin_thickness.valueChanged.connect(self._invalidate_result)
        self.combo_axis.currentIndexChanged.connect(self._invalidate_result)
        
        scroll.setWidget(container)
        outer_layout.addWidget(scroll)
    
    def _on_load_clicked(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Cargar modelo 3D", "", "Modelos 3D (*.obj *.stl)"
        )
        if path:
            self.file_loaded.emit(path)
    
    def _on_apply_clicked(self):
        axis_map = {0: 'z', 1: 'x', 2: 'y'}
        self.params_changed.emit(
            self.spin_plates.value(),
            self.spin_gap.value(),
            self.spin_thickness.value(),
            axis_map[self.combo_axis.currentIndex()]
        )
    
    def _invalidate_result(self):
        """
        Se llama cuando cualquier parámetro cambia.
        Deshabilita los botones de exportación para forzar al usuario a re-aplicar el corte.
        """
        self.btn_export_dxf.setEnabled(False)
        self.btn_export_svg.setEnabled(False)
        self.lbl_info.setText("⟳ Parámetros modificados — aplicá el corte para actualizar.")
    
    def set_file_label(self, filename: str, repaired: bool, warning: str):
        text = f"✓ {filename}"
        if repaired:
            text += " (reparado automáticamente)"
        self.lbl_file.setText(text)
        if warning:
            self.lbl_warnings.setText(f"⚠ {warning}")
        self.btn_apply.setEnabled(True)
    
    def set_result_info(self, result: SliceResult, plates: int, gap: float, thickness: float):
        valid_plates = [plist for plist in result.polygons if plist is not None]
        n_valid = len(valid_plates)
        
        if valid_plates:
            # Los polígonos ya están en mm — usar directo
            min_x = min(min(p.bounds[0] for p in plist) for plist in valid_plates)
            max_x = max(max(p.bounds[2] for p in plist) for plist in valid_plates)
            min_y = min(min(p.bounds[1] for p in plist) for plist in valid_plates)
            max_y = max(max(p.bounds[3] for p in plist) for plist in valid_plates)
            
            w_mm = max_x - min_x
            d_mm = max_y - min_y
            h_mm = result.assembled_height
            dim_text = f"Tamaño final: {w_mm:.1f} x {d_mm:.1f} x {h_mm:.1f} mm\n"
        else:
            dim_text = "Tamaño final: N/A\n"
            
        info = (
            f"Placas válidas: {n_valid} / {plates}\n"
            f"{dim_text}"
            f"Escala aplicada: {result.auto_scale:.2f}x"
        )
        self.lbl_info.setText(info)
        
        if result.warnings:
            self.lbl_warnings.setText("⚠ " + "\n⚠ ".join(result.warnings))
        
        self.btn_export_dxf.setEnabled(True)
        self.btn_export_svg.setEnabled(True)
    
    def show_error(self, message: str):
        QMessageBox.critical(self, "Error", message)
    
    def show_warning(self, message: str):
        QMessageBox.warning(self, "Advertencia", message)
```

---

### `main.py` — Implementación detallada

**Responsabilidad:** orquestar todo. Es el único lugar donde los módulos se conocen entre sí.

```python
import sys
import os
import trimesh
from PySide6.QtWidgets import QApplication, QMainWindow, QHBoxLayout, QWidget
from PySide6.QtCore import Qt

from validator import validate_file, validate_params, validate_mesh
from slicer import slice_mesh
from exporter import export_dxf, export_svg
from viewer import SculptureViewer
from ui import ControlPanel

class MainWindow(QMainWindow):
    
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Escultura de Planos Seriados")
        self.resize(1400, 800)
        
        self._mesh = None
        self._result = None
        self._current_params = {}
        
        self._build_ui()
    
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        layout = QHBoxLayout(central)
        
        self.panel = ControlPanel()
        self.panel.setMinimumWidth(280)
        self.viewer = SculptureViewer()
        
        layout.addWidget(self.panel, stretch=0)  # panel fijo ~300px
        layout.addWidget(self.viewer, stretch=1)  # viewer ocupa el resto
        
        # Conectar señales
        self.panel.file_loaded.connect(self._on_file_loaded)
        self.panel.params_changed.connect(self._on_params_changed)
        self.panel.export_requested.connect(self._on_export_requested)
    
    def _on_file_loaded(self, path: str):
        # --- NUEVO: Invalidar estado anterior antes de hacer cualquier cosa ---
        self._result = None
        self._current_params = {}
        self.panel.btn_export_dxf.setEnabled(False)
        self.panel.btn_export_svg.setEnabled(False)
        self.panel.lbl_info.setText("—")
        self.panel.lbl_warnings.setText("")
        self.viewer.view_sliced.clear()
        
        # 1. Validar archivo
        ok, msg = validate_file(path)
        if not ok:
            self.panel.show_error(msg)
            return
        
        # 2. Cargar mesh
        try:
            mesh = trimesh.load(path, force='mesh')
        except Exception as e:
            self.panel.show_error(f"No se pudo cargar el archivo:\n{e}")
            return
        
        # 3. Validar mesh
        ok, msg, repaired = validate_mesh(mesh)
        if not ok:
            self.panel.show_error(msg)
            return
        
        # --- NUEVO: Detección heurística de unidades ---
        max_dim = max(mesh.extents)
        unit_warning = ""
        if max_dim > 2000:
            unit_warning = (f"El modelo mide {max_dim:.0f} unidades en su dimensión mayor. "
                          f"Si no está en milímetros, los resultados pueden ser inesperados.")
        elif max_dim < 0.1:
            unit_warning = (f"El modelo mide {max_dim:.4f} unidades en su dimensión mayor. "
                          f"Podría estar en metros. Verificá las unidades del archivo.")
        
        # --- NUEVO: Info sobre multi-objetos ---
        # trimesh.load con force='mesh' concatena todos los objetos silenciosamente
        multi_obj_warning = ""
        try:
            scene = trimesh.load(path)
            if hasattr(scene, 'geometry') and len(scene.geometry) > 1:
                n_objs = len(scene.geometry)
                multi_obj_warning = (f"El archivo contiene {n_objs} objetos. Se usarán todos. "
                                   f"Si hay objetos no deseados (suelo, luces), limpiá el modelo "
                                   f"en Blender y dejá solo el objeto deseado.")
        except Exception:
            pass  # Si falla la detección, no pasa nada — el mesh ya se cargó
        
        # 4. Guardar y mostrar
        self._mesh = mesh
        
        combined_warning = msg if (repaired or "advertencia" in msg.lower()) else ""
        if unit_warning:
            combined_warning += ("\n" if combined_warning else "") + unit_warning
        if multi_obj_warning:
            combined_warning += ("\n" if combined_warning else "") + multi_obj_warning
        
        self.panel.set_file_label(
            os.path.basename(path),
            repaired=repaired,
            warning=combined_warning
        )
        self.viewer.show_original_mesh(mesh)
    
    def _on_params_changed(self, plates, gap, thickness, axis):
        if self._mesh is None:
            self.panel.show_error("Primero cargá un modelo 3D.")
            return
        
        # Validar parámetros
        ok, msg = validate_params(plates, gap, thickness)
        if not ok:
            self.panel.show_error(msg)
            return
        
        # Ejecutar slicing
        try:
            result = slice_mesh(
                self._mesh,
                plates=plates,
                gap=gap,
                thickness=thickness,
                axis=axis
            )
        except ValueError as e:
            self.panel.show_error(str(e))
            return
        except Exception as e:
            self.panel.show_error(f"Error inesperado durante el corte:\n{e}")
            return
        
        # Guardar resultado y mostrar
        self._result = result
        self._current_params = {
            'plates': plates, 'gap': gap,
            'thickness': thickness, 'axis': axis
        }
        
        self.panel.set_result_info(result, plates, gap, thickness)
        wireframe_count = self.viewer.show_sliced_result(result, thickness, gap)
        
        # Mostrar advertencia si hubo placas que cayeron a wireframe
        if wireframe_count > 0:
            self.panel.show_warning(
                f"{wireframe_count} placa(s) no pudieron renderizarse como sólidos "
                f"y se muestran como líneas. Esto no afecta la exportación."
            )
    
    def _on_export_requested(self, format_type: str):
        if self._result is None:
            self.panel.show_error("Primero aplicá el corte antes de exportar.")
            return
        
        from PySide6.QtWidgets import QFileDialog
        
        if format_type == 'dxf':
            path, _ = QFileDialog.getSaveFileName(self, "Guardar DXF", "", "DXF (*.dxf)")
            if not path:
                return
            # Los polígonos ya están en mm — no se pasa escala adicional
            ok, msg = export_dxf(self._result, path)
        else:
            path, _ = QFileDialog.getSaveFileName(self, "Guardar SVG", "", "SVG (*.svg)")
            if not path:
                return
            ok, msg = export_svg(self._result, path)
        
        if ok:
            from PySide6.QtWidgets import QMessageBox
            QMessageBox.information(self, "Exportación exitosa", f"Archivo guardado en:\n{msg}")
        else:
            self.panel.show_error(f"Error al exportar:\n{msg}")


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Escultura de Planos Seriados")
    window = MainWindow()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
```

---

## Fase 4 — Validaciones y Mensajes de Error UX

**Objetivo:** cero crashes silenciosos, mensajes útiles en todos los casos de falla.

### Tabla completa de casos de error

| Situación | Tipo | Mensaje en español | Acción |
|---|---|---|---|
| Archivo no existe | Error fatal | "El archivo no existe: `{ruta}`" | Bloquear |
| Extensión no soportada | Error fatal | "Solo se aceptan archivos OBJ o STL. El archivo tiene extensión `{ext}`" | Bloquear |
| Archivo corrupto / no parseable | Error fatal | "No se pudo leer el archivo. Verificá que sea un OBJ o STL válido." | Bloquear |
| Mesh vacío (0 vértices) | Error fatal | "El modelo cargado no tiene geometría (0 vértices)." | Bloquear |
| Mesh no watertight (no reparable) | Advertencia | "El modelo tiene huecos que no pudieron repararse. Los cortes pueden ser incompletos." | Continuar |
| Mesh no watertight (reparado) | Info | "El modelo tenía huecos y fue reparado automáticamente." | Continuar |
| plates < 2 | Error fatal | "Se necesitan al menos 2 placas." | Bloquear |
| thickness ≤ 0 | Error fatal | "El grosor debe ser mayor a 0." | Bloquear |
| gap < 0 | Error fatal | "La separación entre placas no puede ser negativa." | Bloquear |
| Ningún corte produjo geometría | Error fatal | "Ningún plano de corte produjo geometría. Probá con otro eje de corte." | Bloquear |
| Algunas placas vacías | Advertencia | "Las placas `{lista}` están vacías y serán omitidas." | Continuar |
| Error al escribir DXF/SVG | Error fatal | "No se pudo guardar el archivo. Verificá que tenés permisos en la carpeta." | Bloquear |
| Modelo con dimensiones sospechosas (>2000 o <0.1 unidades) | Advertencia | "El modelo mide `{dim}` unidades. Si no está en mm, los resultados pueden ser inesperados." | Continuar |
| Archivo con múltiples objetos | Info | "El archivo contiene `{n}` objetos. Se usarán todos." | Continuar |
| Placas con extrusión fallida (wireframe) | Info | "`{n}` placa(s) no pudieron renderizarse como sólidos. No afecta la exportación." | Continuar |
| Parámetros cambiados sin re-aplicar corte | UI | "⟳ Parámetros modificados — aplicá el corte para actualizar." | Deshabilitar exportación |

### Regla de presentación de errores

```
Error fatal    → QMessageBox.critical()   → el flujo se detiene
Advertencia    → QMessageBox.warning()    → el flujo continúa con aviso
Info           → label amarillo en panel  → no interrumpe
UI             → label en panel + deshabilitar botones → guía al usuario
```

---

## Checklist de Criterios de Éxito Global

### Fase 0 — Repositorio y Git Workflow
- [ ] Repositorio inicializado en local (`git init -b main`)
- [ ] Archivo `.gitignore` creado y cubriendo Python, IDEs y temporales
- [ ] Repositorio creado en GitHub y vinculado al remoto `origin`
- [ ] Primer commit y push exitoso (`chore: setup inicial del proyecto, gitignore y plan v2`)

### Fase 1 — Slicing headless
- [ ] L-block asimétrico → Valida que las coordenadas 2D preservan posición relativa (centroides diferentes entre placas)
- [ ] L-block → Los contornos NO están espejados respecto al modelo 3D (probar ejes X, Y, Z)
- [ ] Cubo OBJ → 5 cortes → 5 polígonos rectangulares, 0 vacíos
- [ ] Esfera OBJ → 10 cortes → 10 polígonos elípticos
- [ ] Modelo con hueco (dona/torus) → polígonos con `interiors` correctos
- [ ] Archivo `.txt` renombrado `.obj` → mensaje de error, sin traceback
- [ ] `plates=1` → mensaje `"Se necesitan al menos 2 placas"`
- [ ] `thickness=-1` → mensaje claro
- [ ] Eje X vs Y vs Z → resultados diferentes y correctos
- [ ] **NUEVO:** Los polígonos tienen coordenadas en mm (verificar bounds razonables)
- [ ] **NUEVO:** `polygons_full` vacío con vértices presentes → fallback genera polígonos

### Fase 2 — Exportación
- [ ] DXF abre en AutoCAD / DraftSight / Inkscape sin errores
- [ ] SVG abre en Inkscape con contornos cerrados
- [ ] Polígono con hueco → DXF con dos lwpolyline por placa, SVG con path evenodd
- [ ] **NUEVO:** Modelo asimétrico → las placas en el DXF/SVG preservan su posición relativa (bounding box global)
- [ ] **NUEVO:** Marcas de alineación presentes (dos pines asimétricos para fijar rotación) en cada slot
- [ ] **NUEVO:** Huecos en SVG se ven correctamente en Inkscape (fill-rule evenodd en `<g>`)

### Fase 3 — UI y Visor
- [ ] Ventana abre sin errores
- [ ] Cargar OBJ → mesh se renderiza en vista izquierda
- [ ] Cambiar parámetros → vista derecha se actualiza
- [ ] Botones de exportar deshabilitados hasta que haya resultado
- [ ] Cámara hace fit automático en ambas vistas
- [ ] **NUEVO:** Cargar un segundo modelo → resultado anterior se invalida, botones de exportar se deshabilitan
- [ ] **NUEVO:** Cambiar parámetros sin re-aplicar → exportación deshabilitada con mensaje claro
- [ ] **NUEVO:** Placas con extrusión fallida → wireframe + advertencia al usuario
- [ ] **NUEVO:** Modelo con dimensiones sospechosas → advertencia de unidades

### Fase 4 — Robustez
- [ ] Nunca hay un traceback visible al usuario final
- [ ] Todos los mensajes de error son en español y accionables
- [ ] Modelo no-watertight → advertencia, no crash
- [ ] **NUEVO:** Archivo con múltiples objetos → info al usuario

---

## Orden de Ejecución Sugerido

```
0. FASE 0: 
   - git init -b main
   - Crear .gitignore y requirements.txt
   - Crear repo en GitHub y enlazar (git remote add origin ...)
   - git add . && git commit -m "chore: setup inicial y plan v2" && git push -u origin main
1. Instalar dependencias del proyecto (pip install -r requirements.txt)
2. Implementar validator.py completo
3. Implementar slicer.py completo (con pre-escalado en mm, centrado y rotación corregida)
4. Ejecutar test_slice.py con cubo, esfera y L-block asimétrico:
   -> Verificar polígonos en mm y preservación de posición relativa
   -> Commit & Push Fase 1:
      git add validator.py slicer.py test_slice.py
      git commit -m "feat(slicer): nucleo headless con pre-escalado en mm y nesting de huecos"
      git push
5. Implementar exporter.py completo (layout global, dos pines de alineación, DXF/SVG)
6. Verificar DXF y SVG manualmente en Inkscape:
   -> Confirmar bbox global, marcas asimétricas y huecos
   -> Commit & Push Fase 2:
      git add exporter.py
      git commit -m "feat(exporter): exportacion DXF y SVG con layout global y marcas de alineacion"
      git push
7. Implementar viewer.py (con extrusión y fallback wireframe)
8. Implementar ui.py (panel de control e invalidación de estado al editar parámetros)
9. Implementar main.py (orquestación y validaciones de arranque)
10. Prueba de integración completa: cargar → rebanar → ver → exportar
   -> Commit & Push Fase 3:
      git add viewer.py ui.py main.py
      git commit -m "feat(ui): integracion completa de interfaz PySide6 y visor 3D OpenGL"
      git push
11. Prueba de casos de error (archivos corruptos, fuera de rango, invalidación de estado)
   -> Commit & Push Fase 4 (versión final):
      git add .
      git commit -m "fix(ux): manejo robusto de errores y validaciones finales"
      git push
```

---

## Notas para Iteraciones Futuras (fuera de alcance ahora)

> [!NOTE]
> Estas funcionalidades fueron conscientemente excluidas del alcance actual.
> Se documentan aquí para no olvidarlas y para que la arquitectura las facilite en el futuro.

- **Marcas / grabado:** agregar texto o número de placa al DXF/SVG de cada corte
- **Base ranurada:** calcular y exportar la geometría de la base con ranuras para cada placa
- **Eje de corte rotado:** cortes en ángulo arbitrario, no solo paralelos a los ejes principales
- **Preview de corte en tiempo real:** mover un slider y ver el plano de corte animado sobre el modelo original
- **Múltiples materiales / espesores:** cada placa con un grosor diferente
- **Exportar PDF:** para enviar directamente a servicios de corte láser que aceptan PDF en vez de DXF/SVG
- **Slicing en hilo separado:** mover `slice_mesh()` a un `QThread` con `QProgressBar` para modelos grandes (>100 placas)
- **Cámaras sincronizadas:** sincronizar rotación/elevación entre las dos vistas 3D
