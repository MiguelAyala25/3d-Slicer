# Plan de Implementación — Escultura de Planos Seriados

> Herramienta Python para generar esculturas de planos seriados a partir de modelos 3D.  
> Alcance: cargar → rebanar → visualizar → exportar. Sin features extra.

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
pyqtgraph>=0.13.0
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

- **Unidades internas:** todo se maneja en las unidades del archivo fuente. La escala a mm se aplica solo al exportar.
- **Eje de corte por defecto:** Z. El usuario puede cambiarlo en la UI (X / Y / Z).
- **Idioma de mensajes de error:** español, claros y accionables.
- **Sin globals mutables:** los parámetros viajan como argumentos entre funciones, no como estado global.
- **Sin logging framework:** `print()` para debug en consola durante desarrollo; en producción, los errores van a `QMessageBox`.

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
    Verifica que el archivo existe, tiene extensión OBJ o STL,
    y que trimesh puede abrirlo sin errores.
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
# Estructura de datos de salida
@dataclass
class SliceResult:
    polygons: list           # lista de shapely.Polygon (uno por placa)
    empty_plates: list[int]  # índices de placas que resultaron vacías o triviales
    original_bounds: tuple   # (min_axis, max_axis) en el eje de corte
    assembled_height: float  # altura total ensamblada = (n_plates * thickness) + ((n_plates-1) * gap)
    auto_scale: float        # escala calculada para mantener proporción visual
    warnings: list[str]      # advertencias no fatales

# Firma pública del módulo
def slice_mesh(
    mesh,           # trimesh.Trimesh ya validado
    plates: int,    # número de cortes
    gap: float,     # separación entre placas (en unidades físicas)
    thickness: float, # grosor físico de cada placa (en unidades físicas)
    axis: str,      # 'x', 'y' o 'z'
    min_area: float = 1.0 # umbral mínimo de área para considerar una placa válida
) -> SliceResult:
```

**Lógica de `slice_mesh` paso a paso:**

**Paso 1 — Calcular posiciones de corte**
```
# Obtener rango del modelo en el eje elegido
axis_index = {'x': 0, 'y': 1, 'z': 2}[axis]
bounds = mesh.bounds  # shape (2, 3): [[min_x, min_y, min_z], [max_x, max_y, max_z]]
min_val = bounds[0][axis_index]
max_val = bounds[1][axis_index]
total_length = max_val - min_val

# Distribuir los cortes uniformemente dentro del rango
# El primer corte va a min + step/2, el último a max - step/2
# Esto evita cortar exactamente en los extremos (resultado potencialmente vacío)
step = total_length / plates
cut_positions = [min_val + step * (i + 0.5) for i in range(plates)]
```

**Paso 2 — Para cada posición, calcular la sección transversal**
```
plane_normal = [0, 0, 0]
plane_normal[axis_index] = 1  # normal perpendicular al eje

for i, position in enumerate(cut_positions):
    plane_origin = [0, 0, 0]
    plane_origin[axis_index] = position
    
    # trimesh retorna Path3D con las líneas de intersección
    section = mesh.section(
        plane_origin=plane_origin,
        plane_normal=plane_normal
    )
    
    if section is None:
        # No hay intersección en este plano (puede ocurrir con modelos complejos)
        empty_plates.append(i)
        polygons.append(None)
        continue
    
    # Proyectar a 2D — trimesh tiene método built-in
    section_2d, transform = section.to_planar()
    
    # Convertir Path2D de trimesh a shapely Polygon(s)
    polygon = path2d_to_shapely(section_2d)
    
    # Validar área mínima
    if polygon is None or polygon.area < min_area:
        empty_plates.append(i)
        polygons.append(None)
    else:
        polygons.append(polygon)
```

**Paso 3 — `path2d_to_shapely()` (función interna)**

Esta es la parte más delicada del slicing. `trimesh.Path2D` puede contener múltiples entidades (líneas, arcos). Necesitamos polígonos cerrados.

```python
def path2d_to_shapely(path2d) -> shapely.Polygon | shapely.MultiPolygon | None:
    """
    Convierte un trimesh.Path2D en un shapely Polygon.
    Maneja el caso de múltiples contornos (polígono con huecos).
    Garantiza que la topología resultante sea válida (sin auto-intersecciones).
    """
    import shapely
    
    # trimesh.Path2D tiene un método .polygons_full que ya resuelve
    # la jerarquía exterior/interior y retorna shapely Polygons
    polygons = path2d.polygons_full
    
    if not polygons:
        return None
    
    # Limpiar geometría (auto-intersecciones comunes en slices de modelos no perfectos)
    valid_polygons = [shapely.make_valid(p) for p in polygons]
    
    if len(valid_polygons) == 1:
        return valid_polygons[0]
    
    # Múltiples polígonos en el mismo corte (modelo con partes separadas)
    # shapely.MultiPolygon los agrupa
    return shapely.MultiPolygon(valid_polygons)
```

> [!IMPORTANT]
> `path2d.polygons_full` es el método correcto de trimesh para obtener polígonos cerrados con huecos resueltos. Usar `path2d.entities` directamente da segmentos sin ensamblar.

**Paso 4 — Calcular metadata del resultado**
```python
assembled_height = (plates * thickness) + ((plates - 1) * gap)
# La escala automática garantiza que el modelo exportado tenga la misma proporción física que el digital
auto_scale = assembled_height / total_length if total_length > 0 else 1.0
```

**Paso 5 — Generar advertencias**
```
Si len(empty_plates) > 0:
    warnings.append(f"Placas {empty_plates} están vacías o demasiado pequeñas (área < {min_area}). Serán omitidas en la exportación.")

Si len(empty_plates) == plates:
    # Error fatal — ningún corte produjo geometría
    raise ValueError("Ningún plano de corte produjo geometría. Verificá el eje de corte seleccionado.")
```

---

### Test manual de Fase 1

Crear `test_slice.py` (temporal, en raíz):

```python
# test_slice.py — borrar después de validar
import trimesh
from validator import validate_file, validate_params, validate_mesh
from slicer import slice_mesh

# Test 1: cubo simple (debería ser watertight)
ok, msg = validate_file("test_cube.obj")
print(f"Archivo válido: {ok} — {msg}")

mesh = trimesh.load("test_cube.obj")
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
```

**Criterio de éxito de Fase 1:**
- [ ] Cubo → 5 polígonos rectangulares, 0 vacíos, sin advertencias
- [ ] Esfera → 5 polígonos elípticos, los extremos pueden ser pequeños pero no vacíos
- [ ] Archivo inválido → mensaje claro, sin traceback
- [ ] plates=1 → mensaje claro `"Se necesitan al menos 2 placas"`

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
    scale: float = 1.0
) -> tuple[bool, str]:
    """
    Escribe un archivo DXF con cada placa en su propio layer (PLACA_01, PLACA_02...).
    Retorna (True, ruta) o (False, mensaje_error).
    """

def export_svg(
    result: SliceResult,
    output_path: str,
    scale: float = 1.0,
    margin_mm: float = 10.0
) -> tuple[bool, str]:
    """
    Escribe un archivo SVG con todas las placas distribuidas en fila.
    Retorna (True, ruta) o (False, mensaje_error).
    """
```

---

### Lógica de `export_dxf` paso a paso

**Paso 1 — Crear documento DXF**
```python
doc = ezdxf.new(dxfversion='R2010')
msp = doc.modelspace()
```

**Paso 2 — Para cada placa, crear un layer y escribir el polígono**
```python
for i, polygon in enumerate(result.polygons):
    if polygon is None:
        continue  # placa vacía, omitir
    
    layer_name = f"PLACA_{i+1:02d}"
    doc.layers.add(name=layer_name, color=i % 7 + 1)  # colores DXF 1-7
    
    # Escribir contorno exterior
    exterior_coords = list(polygon.exterior.coords)
    exterior_scaled = [(x * scale, y * scale) for x, y in exterior_coords]
    msp.add_lwpolyline(exterior_scaled, close=True, dxfattribs={"layer": layer_name})
    
    # Escribir huecos interiores (si existen)
    for interior in polygon.interiors:
        interior_coords = list(interior.coords)
        interior_scaled = [(x * scale, y * scale) for x, y in interior_coords]
        msp.add_lwpolyline(interior_scaled, close=True, dxfattribs={"layer": layer_name})
```

**Paso 3 — Manejar MultiPolygon**
```python
# Si el polígono es un MultiPolygon, iterar sobre sus partes
from shapely.geometry import MultiPolygon
if isinstance(polygon, MultiPolygon):
    for part in polygon.geoms:
        # misma lógica de escritura de exterior + interiors
```

**Paso 4 — Guardar**
```python
doc.saveas(output_path)
```

---

### Lógica de `export_svg` paso a paso

**Paso 1 — Calcular bounding box global y layout**

Las placas se distribuyen en fila horizontal con un margen entre ellas. Esto permite ver todos los contornos en un solo archivo.

```python
# Calcular tamaño de cada placa (bounding box individual)
# Distribuir horizontalmente: placa_1 | margen | placa_2 | margen | ...

max_height = max(p.bounds[3] - p.bounds[1] for p in valid_polygons) * scale
total_width = sum((p.bounds[2] - p.bounds[0]) * scale for p in valid_polygons) + margin_mm * (n_valid - 1)

dwg = svgwrite.Drawing(
    output_path,
    size=(f"{total_width + 2*margin_mm}mm", f"{max_height + 2*margin_mm}mm"),
    viewBox=f"0 0 {total_width + 2*margin_mm} {max_height + 2*margin_mm}"
)
```

**Paso 2 — Para cada placa, crear un grupo `<g>` y escribir el path**
```python
x_offset = margin_mm
for i, polygon in enumerate(result.polygons):
    if polygon is None:
        continue
    
    group = dwg.g(id=f"placa_{i+1:02d}", stroke="black", fill="none", stroke_width=0.1)
    
    path_data = polygon_to_svg_path(polygon, scale, x_offset, margin_mm)
    group.add(dwg.path(d=path_data))
    dwg.add(group)
    
    # Avanzar el offset horizontal
    x_offset += (polygon.bounds[2] - polygon.bounds[0]) * scale + margin_mm
```

**Paso 3 — `polygon_to_svg_path()` (función interna)**
```python
def polygon_to_svg_path(polygon, scale, x_offset, y_offset) -> str:
    """
    Convierte un shapely Polygon a un string de path SVG.
    Usa la regla evenodd para que los huecos se rendericen correctamente.
    """
    # Exterior: M x,y L x,y L x,y ... Z
    exterior = list(polygon.exterior.coords)
    d = f"M {(exterior[0][0]*scale)+x_offset},{(exterior[0][1]*scale)+y_offset} "
    d += " ".join(f"L {(x*scale)+x_offset},{(y*scale)+y_offset}" for x, y in exterior[1:])
    d += " Z"
    
    # Huecos interiores: append al mismo path con "M" nuevo
    for interior in polygon.interiors:
        coords = list(interior.coords)
        d += f" M {(coords[0][0]*scale)+x_offset},{(coords[0][1]*scale)+y_offset} "
        d += " ".join(f"L {(x*scale)+x_offset},{(y*scale)+y_offset}" for x, y in coords[1:])
        d += " Z"
    
    return d
```

**Paso 4 — Escribir el archivo**
```python
dwg['fill-rule'] = 'evenodd'  # Para que los huecos sean transparentes
dwg.save()
```

---

### Criterio de éxito de Fase 2

- [ ] DXF se abre en AutoCAD / DraftSight / Inkscape sin errores
- [ ] SVG se abre en Inkscape con todos los contornos cerrados
- [ ] Polígonos con huecos (ej: modelo en forma de dona) exportan correctamente el hueco
- [ ] MultiPolygon (modelo con partes separadas) exporta todas las partes

---

## Fase 3 — Visor 3D y UI

**Objetivo:** ventana Qt con dos vistas 3D y panel de controles.  
**Archivos involucrados:** `viewer.py`, `ui.py`, `main.py`

---

### `viewer.py` — Implementación detallada

**Responsabilidad:** renderizar la geometría en OpenGL sin lógica de negocio.

```python
from pyqtgraph.opengl import GLViewWidget, GLMeshItem, GLLinePlotItem
import pyqtgraph.opengl as gl
import numpy as np

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
            edgeColor=(0.3, 0.5, 0.8, 1.0)
        )
        self.view_original.addItem(mesh_item)
        self._fit_camera(self.view_original, mesh.bounding_box)
    
    def show_sliced_result(self, result: SliceResult, axis: str, thickness: float, gap: float):
        """
        Renderiza las placas como cajas planas separadas por el gap.
        Cada placa es un sólido extruido con el grosor indicado.
        """
        self.view_sliced.clear()
        
        axis_index = {'x': 0, 'y': 1, 'z': 2}[axis]
        
        for i, polygon in enumerate(result.polygons):
            if polygon is None:
                continue
            
            # Posición de la placa en el eje de corte
            # Separación visual = posición_original + i * gap (desplazamiento acumulado)
            plate_position = i * (thickness + gap)
            
            # Extruir el polígono 2D para darle grosor visual
            plate_mesh = _extrude_polygon(polygon, thickness, axis, plate_position)
            
            # Color alternado por placa para distinguirlas
            hue = (i / len(result.polygons))
            color = _hue_to_rgb(hue) + [0.85]  # alpha
            
            if plate_mesh is None:
                # Fallback: si la triangulación falla, dibujar el contorno 2D (wireframe)
                from pyqtgraph.opengl import GLLinePlotItem
                coords = np.array(polygon.exterior.coords)
                # Insertar coordenada Z
                z_coords = np.full((len(coords), 1), plate_position)
                if axis == 'z':
                    pts = np.hstack([coords, z_coords])
                elif axis == 'y':
                    pts = np.hstack([coords[:, 0:1], z_coords, coords[:, 1:2]])
                else: # x
                    pts = np.hstack([z_coords, coords])
                    
                item = GLLinePlotItem(pos=pts, color=color, width=2.0, antialias=True)
                self.view_sliced.addItem(item)
                continue
            
            verts = plate_mesh.vertices.astype(np.float32)
            faces = plate_mesh.faces.astype(np.uint32)
            
            colors = np.tile(color, (len(faces), 1)).astype(np.float32)
            
            item = GLMeshItem(
                vertexes=verts,
                faces=faces,
                faceColors=colors,
                smooth=False,
                drawEdges=True,
                edgeColor=(0, 0, 0, 0.5)
            )
            self.view_sliced.addItem(item)
        
        self._fit_camera_to_result(self.view_sliced, result, axis_index, thickness, gap)
    
    def _fit_camera(self, view: GLViewWidget, bounding_box):
        """Ajusta la cámara para ver el objeto completo."""
        center = bounding_box.centroid
        extent = np.max(bounding_box.extents)
        view.setCameraPosition(distance=extent * 2.5, elevation=30, azimuth=45)
        view.opts['center'] = pg.Vector(center[0], center[1], center[2])
    
    def _fit_camera_to_result(self, view, result, axis_index, thickness, gap):
        """Ajusta cámara al bounding box expandido por el gap."""
        n_plates = len([p for p in result.polygons if p is not None])
        total_extent = n_plates * (thickness + gap)
        view.setCameraPosition(distance=total_extent * 2.0, elevation=30, azimuth=45)
```

**Función interna `_extrude_polygon()`:**
```python
def _extrude_polygon(polygon, thickness, axis, position) -> trimesh.Trimesh | None:
    """
    Extruye un shapely Polygon a lo largo del eje dado para darle grosor visual.
    Usa trimesh.creation.extrude_polygon.
    """
    try:
        # trimesh.creation.extrude_polygon extruye en Z por defecto
        extruded = trimesh.creation.extrude_polygon(polygon, height=thickness)
        
        # Rotar al eje correcto si no es Z
        if axis == 'x':
            rotation = trimesh.transformations.rotation_matrix(np.pi/2, [0, 1, 0])
            extruded.apply_transform(rotation)
        elif axis == 'y':
            rotation = trimesh.transformations.rotation_matrix(np.pi/2, [1, 0, 0])
            extruded.apply_transform(rotation)
        
        # Trasladar a la posición correcta en el eje
        translation = [0, 0, 0]
        translation[{'x':0,'y':1,'z':2}[axis]] = position
        extruded.apply_translation(translation)
        
        return extruded
    except Exception:
        return None
```

---

### `ui.py` — Implementación detallada

**Responsabilidad:** controles del usuario. Sin lógica de negocio.

```python
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
        layout = QVBoxLayout(self)
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
    
    def set_file_label(self, filename: str, repaired: bool, warning: str):
        text = f"✓ {filename}"
        if repaired:
            text += " (reparado automáticamente)"
        self.lbl_file.setText(text)
        if warning:
            self.lbl_warnings.setText(f"⚠ {warning}")
        self.btn_apply.setEnabled(True)
    
    def set_result_info(self, result: SliceResult, plates: int, gap: float, thickness: float):
        n_valid = len([p for p in result.polygons if p is not None])
        info = (
            f"Placas válidas: {n_valid} / {plates}\n"
            f"Altura ensamblada: {result.assembled_height:.1f} mm\n"
            f"Altura original: {result.original_bounds[1] - result.original_bounds[0]:.1f} unidades\n"
            f"Escala auto-calculada: {result.auto_scale:.2f}x (aplica al exportar)"
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
        self.viewer = SculptureViewer()
        
        layout.addWidget(self.panel, stretch=0)  # panel fijo ~300px
        layout.addWidget(self.viewer, stretch=1)  # viewer ocupa el resto
        
        # Conectar señales
        self.panel.file_loaded.connect(self._on_file_loaded)
        self.panel.params_changed.connect(self._on_params_changed)
        self.panel.export_requested.connect(self._on_export_requested)
    
    def _on_file_loaded(self, path: str):
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
        
        # 4. Guardar y mostrar
        self._mesh = mesh
        import os
        self.panel.set_file_label(
            os.path.basename(path),
            repaired=repaired,
            warning=msg if repaired or "advertencia" in msg.lower() else ""
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
        self.viewer.show_sliced_result(result, axis, thickness, gap)
    
    def _on_export_requested(self, format_type: str):
        if self._result is None:
            self.panel.show_error("Primero aplicá el corte antes de exportar.")
            return
        
        from PySide6.QtWidgets import QFileDialog
        
        if format_type == 'dxf':
            path, _ = QFileDialog.getSaveFileName(self, "Guardar DXF", "", "DXF (*.dxf)")
            if not path:
                return
            ok, msg = export_dxf(self._result, path, scale=self._result.auto_scale)
        else:
            path, _ = QFileDialog.getSaveFileName(self, "Guardar SVG", "", "SVG (*.svg)")
            if not path:
                return
            ok, msg = export_svg(self._result, path, scale=self._result.auto_scale)
        
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

### Regla de presentación de errores

```
Error fatal    → QMessageBox.critical()   → el flujo se detiene
Advertencia    → QMessageBox.warning()    → el flujo continúa con aviso
Info           → label amarillo en panel  → no interrumpe
```

---

## Checklist de Criterios de Éxito Global

### Fase 1 — Slicing headless
- [ ] Cubo OBJ → 5 cortes → 5 polígonos rectangulares, 0 vacíos
- [ ] Esfera OBJ → 10 cortes → 10 polígonos elípticos
- [ ] Modelo con hueco (dona/torus) → polígonos con `interiors` correctos
- [ ] Archivo `.txt` renombrado `.obj` → mensaje de error, sin traceback
- [ ] `plates=1` → mensaje `"Se necesitan al menos 2 placas"`
- [ ] `thickness=-1` → mensaje claro
- [ ] Eje X vs Y vs Z → resultados diferentes y correctos

### Fase 2 — Exportación
- [ ] DXF abre en AutoCAD / DraftSight / Inkscape sin errores
- [ ] SVG abre en Inkscape con contornos cerrados
- [ ] Polígono con hueco → DXF con dos lwpolyline por placa, SVG con path evenodd

### Fase 3 — UI y Visor
- [ ] Ventana abre sin errores
- [ ] Cargar OBJ → mesh se renderiza en vista izquierda
- [ ] Cambiar parámetros → vista derecha se actualiza
- [ ] Botones de exportar deshabilitados hasta que haya resultado
- [ ] Cámara hace fit automático en ambas vistas

### Fase 4 — Robustez
- [ ] Nunca hay un traceback visible al usuario final
- [ ] Todos los mensajes de error son en español y accionables
- [ ] Modelo no-watertight → advertencia, no crash

---

## Orden de Ejecución Sugerido

```
1. Instalar dependencias (requirements.txt)
2. Implementar validator.py completo
3. Implementar slicer.py completo
4. Ejecutar test_slice.py con cubo y esfera
5. Implementar exporter.py completo
6. Verificar DXF y SVG manualmente en Inkscape
7. Implementar viewer.py
8. Implementar ui.py
9. Implementar main.py (conectar todo)
10. Prueba de integración completa: cargar → rebanar → ver → exportar
11. Prueba de casos de error (archivos inválidos, parámetros fuera de rango)
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
