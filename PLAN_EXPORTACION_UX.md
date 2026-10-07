# Plan de Implementación: Exportación Ergonómica y Legibilidad de Ensamble

> **Objetivo:** Transformar el sistema de exportación y acomodo (*layout*) para que ensamblar físicamente la escultura en acrílico sea intuitivo, ordenado y libre de confusiones en taller, priorizando la **experiencia de usuario (UX)** y la **facilidad de armado** sobre la optimización extrema del espacio (*crameado*), sin alterar ni romper la arquitectura actual.

---

## 1. Alcance y Decisiones de Diseño

Con base en la retroalimentación directa y la realidad del proceso de corte láser:

| Elemento propuesto | Estado | Razón técnica / física |
| :--- | :---: | :--- |
| **Etiquetas en material sobrante (*Scrap Tags*)** | **APROBADO** | Rótulo grabado en el desperdicio del acrílico (`PLACA k ↓`) justo arriba de cada placa. La pieza queda 100% limpia para la escultura y el operador sabe el número exacto antes de levantarla. |
| **Bandejas y etiquetas para grupos de discos** | **APROBADO** | Recuadro grabado con rótulo `HUECO k→k+1 (N discos)` que delimita cada piso. Evita mezclar discos entre diferentes niveles. |
| **Espaciado ergonómico de piezas (*part_gap*)** | **APROBADO** | Aumento del margen entre piezas para dar respiro al rotulado, evitar calentamiento térmico del láser y permitir desmolde manual cómodo. |
| **Marcas de orientación / Cara A en la pieza** | **DESCARTADO** | Innecesario: los círculos grabados definen inequívocamente la cara superior (Cara A). |
| **Micro-puentes (*tabs*) en discos** | **DESCARTADO (Futuro)** | Los discos se cortan completos como hasta ahora, compensados por kerf. |
| **Encabezado técnico de hoja y regla de 50 mm** | **DESCARTADO (Futuro)** | No se añaden cabezales ni reglas accesorias; el foco está exclusivamente en las piezas y su orden de armado. |

---

## 2. Especificación Técnica por Componente

### 2.1 Módulo de Acomodo (`layout.py`)

#### A. Geometría de *Scrap Tags* (Placas)
1. **Espacio reservado:**
   - Para cada placa $k$, se reserva una franja superior de `8.0 mm` de altura dentro del espaciado de fila para la etiqueta de desperdicio.
2. **Posición del rótulo:**
   - Coordenada $X$: Centrada con respecto al polígono de la placa (`center_x = minx + w / 2`).
   - Coordenada $Y$: Ubicada `3.5 mm` por encima del borde superior del corte (`miny - 3.5 mm`), garantizando que esté completamente en el negativo/desperdicio.
3. **Contenido visual:**
   - Texto vectorial en capa grabado: `"PLACA k"`.
   - Flecha indicadora grabada apuntando hacia abajo: `↓` o un pequeño conector geométrico grabado en azul que señala inequívocamente a qué contorno pertenece la etiqueta.
4. **Cálculo de altura de fila:**
   - `row_h` ahora toma en cuenta la altura física de la placa más el espacio de su *Scrap Tag*, evitando cualquier solapamiento con la fila superior o con el margen de la hoja.

#### B. Delimitación de Grupos de Discos (Zona de Discos)
1. **Bandeja grabada por hueco:**
   - Para cada grupo de discos correspondiente al hueco $k \to k+1$:
     - Se agrupan los discos horizontalmente.
     - Se calcula el *bounding box* del grupo.
     - Se genera un rectángulo grabado en azul con esquinas redondeadas o líneas limpias que encierra el grupo:
       `dwg.rect(insert=(box_x, box_y), size=(box_w, box_h), stroke='#0000FF')`
2. **Etiqueta del grupo:**
   - Ubicada en la parte superior izquierda del recuadro del grupo:
     `"HUECO k→k+1  (N discos Ød mm)"`
   - Tamaño de fuente legible (2.8 mm - 3.2 mm) en capa grabado azul.
3. **Separación entre bandejas:**
   - Un espacio generoso (`part_gap * 1.5`) entre el recuadro del hueco $k$ y el hueco $k+1$, para que el operador no confunda un grupo con otro en la mesa de corte.

#### C. Dataclasses Extendidas (Retrocompatibles)
```python
@dataclass
class ScrapTag:
    """Etiqueta grabada en el material de desecho de la hoja."""
    text: str
    text_pos: Tuple[float, float]
    arrow_start: Tuple[float, float]
    arrow_end: Tuple[float, float]
    font_size: float = 3.0

@dataclass
class PlacedPlate:
    plate_idx: int
    polygons: List[Polygon]
    bounds: Tuple[float, float, float, float]
    x: float
    y: float
    w: float
    h: float
    label_text: str
    label_pos: Tuple[float, float]
    scrap_tag: Optional[ScrapTag] = None   # Nuevo campo opcional
    engrave_circles: List[EngraveCircle] = field(default_factory=list)
    font_size: float = 3.0

@dataclass
class DiscGroup:
    hueco: int
    label_text: str
    label_pos: Tuple[float, float]
    bounds: Tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0) # Bounding box de la bandeja
    discs: List[PlacedDisc] = field(default_factory=list)
```

---

### 2.2 Módulo de Exportación (`exporter.py`)

En `sheet_to_svg_string(sheet, preview_mode)`:
1. **Capa de Corte (`id="corte"`, Rojo `#FF0000`):**
   - Se mantiene intacta al 100%:
     - Contornos exteriores e interiores de las placas.
     - Contornos de corte de los discos con compensación de kerf.
2. **Capa de Grabado (`id="grabado"`, Azul `#0000FF`):**
   - **Círculos de discos en placas:**
     - Sólidos para hueco $k$ (encima, $k \to k+1$).
     - Punteados para hueco $k-1$ (abajo, $k-1 \to k$).
   - **Scrap Tags de placas:**
     - Texto de placa en la zona de descarte:
       ```python
       if plate.scrap_tag:
           group_engrave.add(dwg.text(
               plate.scrap_tag.text,
               insert=plate.scrap_tag.text_pos,
               fill="#0000FF",
               font_size=f"{plate.scrap_tag.font_size:.2f}mm",
               font_family="Arial, Helvetica, sans-serif",
               font_weight="bold",
               text_anchor="middle"
           ))
           # Flecha/guía hacia la placa
           group_engrave.add(dwg.line(
               start=plate.scrap_tag.arrow_start,
               end=plate.scrap_tag.arrow_end,
               stroke="#0000FF",
               stroke_width="0.1mm"
           ))
       ```
   - **Bandejas y Rótulos de Discos:**
     - Rectángulo perimetral delimitador de cada hueco.
     - Texto de identificación de grupo: `"0→1 (3 discos)"`.

---

### 2.3 Previsualización en Tiempo Real (`preview_dialog.py`)

1. Al generar la vista previa, `sheet_to_svg_string(sheet, preview_mode=True)` renderiza inmediatamente las etiquetas en el sobrante y las bandejas de discos.
2. La leyenda superior del diálogo se actualiza con un recordatorio claro:
   - *"Corte: Rojo | Grabado: Azul (Círculos sólidos = cara superior; punteados = cara inferior; Rótulos = material sobrante)"*.
3. En la barra de métricas de cada pestaña se indica con precisión:
   - Número de placas, número de discos y dimensiones usadas.

---

### 2.4 Parámetros y Valores por Defecto (`params.py` y `ui.py`)

- `part_gap`: Aumentar el valor por defecto de `5.0 mm` a `8.0 mm` (o `10.0 mm`) para garantizar suficiente espacio físico entre piezas para los *Scrap Tags* y manipulación sin aprieto térmico.
- Mantiene total compatibilidad con la deserialización y carga de proyectos existentes.

---

## 3. Plan de Verificación y No-Regresión

Para asegurar que **nada se rompa**:

1. **Pruebas de Acomodo (`test_layout.py`):**
   - Verificar que cada placa contenga su `ScrapTag` con coordenadas válidas.
   - Verificar que ninguna coordenada de `ScrapTag` intercepte el área interior de las placas.
   - Validar que los grupos de discos generen sus límites de bandeja.
2. **Pruebas de Exportación (`test_exporter.py`):**
   - Actualizar el test que tenía `'<text' not in svg_str` (que era un parche temporal tras el borrado agresivo anterior) para validar:
     - Que exista el texto de las placas en la capa de grabado azul.
     - Que los textos de placas estén situados en la zona de descarte exterior.
     - Que las bandejas de discos contengan sus etiquetas `"k→k+1"`.
3. **Suite Completa:**
   - Ejecución de los 59 tests con `pytest` asegurando 100% de éxito.

---

## 4. Fases de Ejecución

1. **Fase 1 — Lógica de Layout (`layout.py` y `params.py`):**
   - Implementar cálculo de coordenadas para `ScrapTag` por encima de cada placa.
   - Implementar cálculo de rectángulos y etiquetas de bandejas para discos.
   - Ajustar altura de filas y avances de cursor.
2. **Fase 2 — Generador SVG (`exporter.py`):**
   - Incorporar renderizado de los *Scrap Tags* y bandejas de discos en la capa `#0000FF`.
3. **Fase 3 — Suite de Pruebas Automatizadas:**
   - Actualizar `test_exporter.py` y `test_layout.py`.
   - Ejecutar `pytest` y confirmar que todos los tests pasen.
4. **Fase 4 — Revisión Visual en `PreviewDialog`:**
   - Probar la vista previa con un modelo de prueba (ej. `test_l_block.obj` o `Hand.OBJ`) y verificar legibilidad y ausencia total de colisiones.
