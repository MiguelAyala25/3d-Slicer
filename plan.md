# Plan de Implementación — Escultura de Planos Seriados con Discos de Acrílico

> Programa de escritorio en Python (PySide6 + OpenGL) para convertir modelos 3D (ej. `Hand.OBJ`) en planos seriados de acrílico cortados en láser, unidos mediante discos de acrílico y cemento solvente capilar.

---

## 1. Contexto y Reglas de Diseño

### 1.1 Ensamblaje Físico
- **Materiales**: Solo placas de acrílico, discos de acrílico cortados en láser y cemento solvente capilar tipo **Weld-On 3** o **Weld-On 4** aplicado en la orilla de la unión (la capilaridad introduce el solvente de forma limpia). Sin varillas ni tornillería.
- **Discos**: Círculos sólidos de acrílico (sin agujero central). Un único disco por hueco entre placas consecutivas (sin apilar).
- **Concepto de "Columna"**: En el modelo de datos **NO existe el objeto "columna"**. Solo existen discos individuales. Si dos discos coinciden en la misma coordenada $(x, y)$ en pisos consecutivos, forman columnas visualmente por consecuencia del armado.
- **Dirección de armado**: Se arma de abajo hacia arriba, placa por placa: el disco se apoya sobre su círculo grabado, se toca la unión con la aguja de solvente y se monta la placa siguiente.

### 1.2 Separación y Grosores
- **Un único parámetro**: Separación entre placas = Grosor del disco (`gap`).
- Se inicializa con el grosor del acrílico de las placas (`thickness`) y es libremente editable.
- Si `gap != thickness`, los discos se cortan en una lámina de material independiente.

### 1.3 Parámetros Globales de Discos (Solo DOS)
1. **Diámetro por defecto**: `6.0 mm` (global, editable individualmente por cada disco).
2. **Holgura de grabado**: `0.3 mm` (global).
- **Importante**: NO existe parámetro "margen al borde" ni ninguna validación o restricción automática de posición.

### 1.4 Grabado
- **Solo en la Cara A** (el acrílico es transparente, no se voltea la hoja, sin espejado ni cara B).
- Las placas conservan la orientación exacta del corte del slicer (vista superior).
- En la placa $k$:
  - Círculos **sólidos** = discos del hueco $k$ (los que van encima de esta placa, $k \to k+1$).
  - Círculos **punteados** = discos del hueco $k-1$ (los que vienen de la placa de abajo, $k-1 \to k$).
- Diámetro del círculo grabado = `diámetro del disco + holgura de grabado` (ej. $6.0 + 0.3 = 6.3\text{ mm}$).
- Cada placa lleva grabado su número como texto vectorial (ej. "PLACA 5").

### 1.5 Nesting en Hojas (`layout.py`)
- **Placas**: Orden numérico estricto ($0, 1, 2, \dots$), en filas de izquierda a derecha, sin rotar ni espejar.
- **Validación de tamaño**: Si el bounding box de una placa no cabe dentro del área útil de la hoja (`sheet_w - 2 * sheet_margin` o `sheet_h - 2 * sheet_margin`), se genera un **error claro**.
- **Zona de discos**: Va después de la última fila de placas. Si no cabe en el espacio restante de la hoja, **pasa a una nueva hoja**.
- Si `gap != thickness`, los discos van en una hoja independiente con su propio nesting.
- Discos agrupados por hueco con etiqueta grabada tipo `"5→6"`.
- Cada hoja calcula sus medidas utilizadas (`used_width`, `used_height`) y total de hojas.

### 1.6 Exportación SVG (`exporter.py`)
- Un archivo SVG por hoja.
- Capas estándar por color:
  - **Corte**: Rojo (`#FF0000`, `stroke-width: 0.1mm`, `fill: none`).
  - **Grabado**: Azul (`#0000FF`, `stroke-width: 0.1mm`, `fill: none`).
- Escala 1:1, medidas en milímetros.
- Compensación de kerf: el contorno de corte de los discos se agranda por kerf ($\text{diámetro\_corte} = \text{diámetro\_disco} + \text{kerf}$) para que el disco físico salga del tamaño exacto.

### 1.7 Vista Previa de Exportación (`preview_dialog.py`)
- Diálogo modal con una pestaña por archivo SVG.
- Muestra el dibujo de la hoja y las medidas utilizadas (`ancho x alto` usado de la hoja y total de hojas).
- Botón final de exportación desde el diálogo.

### 1.8 Guía de Ensamble (`ASSEMBLY.md`)
- Documento técnico corto con especificaciones de pegamento Weld-On 3 o 4, técnica capilar, tiempos de curado, lectura de círculos sólidos/punteados y secuencia de armado.

---

## 2. Política de Trabajo y Checkpoints

1. **Tests básicos y enfocados**: Pruebas esenciales con `pytest` que verifiquen el comportamiento medular sin sobrecargar con tests redundantes.
2. **Commit y Pausa obligatoria**: Al terminar cada etapa o fase, hacer `git commit` local y **DETENERSE** a esperar el visto bueno del usuario antes de hacer `git push` o comenzar la siguiente etapa.
3. **Cero funcionalidades no solicitadas**: No añadir opciones que no estén expresamente descritas en este plan.

---

## 3. Fases y Etapas de Implementación

---

### Paso 0: Limpieza Previa del Repositorio y Parámetros

**Objetivo:** Dejar el repositorio en un estado base completamente limpio, eliminando parámetros antiguos y pruebas residuales.

1. **Parámetros (`params.py`)**:
   - Dejar únicamente los dos parámetros globales para discos:
     ```python
     disc_diameter: float = 6.0       # mm (por defecto 6.0 mm)
     engrave_clearance: float = 0.3   # mm (por defecto 0.3 mm)
     ```
   - Eliminar `edge_margin`, `D_max`, `disc_frac`, `disc_min`, `disc_max`.
2. **UI (`ui.py`)**:
   - Renombrar sección a **"Discos"** con únicamente dos controles:
     - `Diámetro del disco:` (6.0 mm)
     - `Holgura grabado:` (0.3 mm)
   - Eliminar campo `spin_edge_margin` y referencias residuales.
3. **Tests base**:
   - Ajustar `test_params.py` y `test_ui_params.py` para validar estos dos parámetros limpios.
   - Correr `pytest` y asegurar 100% verde en las pruebas base existentes.
4. **Checkpoint Paso 0**:
   - Commit local: `"chore: paso 0 - limpieza de parametros a solo 2 globales y tests base"`
   - *Pausa para visto bueno.*

---

### Fase 1: Herramienta Manual de Colocación de Discos

*Todo es manual: sin autocolocador, sin reglas de distancia, sin validación de bordes.*

#### Etapa 1.A: Colocación y Edición Directa en Vista 3D
*Nota: Todo se añade reutilizando el visor 3D que ya existe para el modelo rebanado (`view_sliced`), sin crear un visor ni ventana nueva.*

- **Modelo de Datos (`discs.py`)**:
  - `Disc(id: int, hueco: int, x: float, y: float, diameter: float)` (id es un entero incremental).
  - `DiscManager`: almacena discos por hueco, métodos `add_disc(hueco, x, y, diameter)`, `move_disc(id, x, y)`, `get_discs_for_gap(hueco)`.
- **Selección de Piso Activo en 3D (`viewer.py`)**:
  - Un piso = una placa $k$. El piso activo se dibuja con opacidad 100%; todos los demás con opacidad baja.
  - Los huecos con discos van de $0$ a $N-2$. Si la placa seleccionada es la última ($N-1$), el modo "Poner discos" no coloca nada, ya que no hay hueco arriba.
  - Cambio de piso activo:
    - Click en una placa del modelo 3D (cuando el modo "Poner discos" está apagado).
    - Botones en la interfaz: **"Piso anterior"** / **"Piso siguiente"** (y atajos de teclado si es sencillo).
- **Visibilidad y Representación**:
  - Un botón toggle **"Solo piso activo"** que oculta todo lo que no sea el piso activo (placas y discos). Apagado, vuelve a mostrar todo con la opacidad baja para los inactivos.
  - Los discos se dibujan en el visor 3D como **cilindros** con su diámetro real y altura igual a la separación (`gap`). Se actualizan en tiempo real al colocar o mover.
  - Los discos respetan la regla de opacidad del piso al que pertenecen (piso activo opaco, el resto bajo).
- **Colocar y Mover Discos (Interacción 3D)**:
  - Botón toggle **"Poner discos"**. Con el modo activo, un click sobre la placa del piso activo coloca un disco ahí: el $(x, y)$ sale de proyectar el click sobre la cara superior de esa placa.
  - Arrastrar un disco lo mueve sobre ese mismo plano.
  - La cámara sigue funcionando normal (rotar, zoom, pan). Distingue click de arrastre de cámara para no colocar discos al mover la vista.
- **Tests básicos**:
  - Creación y movimiento de discos en el gestor `DiscManager`.
- **Checkpoint 1.A**:
  - Commit local: `"feat(fase1): colocacion manual y arrastre de discos directo en visor 3D"`
  - *Pausa para que el usuario pruebe la colocación y el piso activo en 3D antes de seguir.*

#### Etapa 1.B: Auto-copia al Piso Siguiente, Borrado y Edición de Diámetro
- **Auto-copia en `DiscManager`**:
  - Al colocar un disco en hueco $k$ (si no es el último hueco $N-2$):
    - Si no existe un disco en esa misma $(x, y)$ en el hueco $k+1$, se crea una copia en $k+1$ con nuevo `id` único, misma $(x, y)$ y mismo diámetro.
    - Si ya existe en esa $(x, y)$, no se duplica.
    - En el último hueco no hay copia.
    - **Independencia total**: Mover, editar o borrar un disco no afecta a ningún otro.
- **Borrado**:
  - Click en disco para seleccionar + botón **"Borrar disco"** (o tecla Suprimir).
- **Edición de Tamaño**:
  - Campo numérico en la UI para cambiar el diámetro del disco seleccionado individualmente.
- **Tests básicos**:
  - Auto-copia a $k+1$, no duplicación, sin copia en el último hueco, independencia al mover/editar/borrar.
- **Checkpoint 1.B**:
  - Commit local: `"feat(fase1): auto-copia independiente al piso siguiente, borrado y edicion de diametro"`
  - *Pausa para visto bueno.*

#### Etapa 1.C: Guardado y Carga JSON (con Alerta Explícita de Re-slicing)
- **Persistencia JSON**:
  - Guardar y cargar: versión, plates, gap, thickness, y lista de discos con `(id, hueco, x, y, diameter)`.
- **Alerta al Cargar si Difieren Parámetros**:
  - Si el número de placas o la separación del archivo difieren de los actuales, abrir diálogo `QMessageBox` advirtiendo explícitamente:
    > *"Los parámetros del archivo difieren de los actuales. Adaptar el proyecto implica volver a rebanar el modelo 3D. ¿Deseas rebanar y adaptar el proyecto, o cancelar?"*
- **Tests básicos**:
  - Guardar y cargar ida y vuelta, detección de parámetros incompatibles.
- **Checkpoint 1.C**:
  - Commit local: `"feat(fase1): guardado y carga JSON con alerta explicita de rebanado"`
  - *Pausa para visto bueno.*

#### Etapa 1.D: Limpieza Final de Fase 1
- Eliminar cualquier resto o referencia a soportes automáticos anteriores.
- Tests básicos 100% verdes.
- **Checkpoint 1.D**:
  - Commit local: `"chore(fase1): consolidacion final de herramienta manual de discos"`
  - *Pausa para visto bueno.*

---

### Fase 2: Layout en Hojas (`layout.py`)

1. **Validación de Tamaño**:
   - Si una placa excede las dimensiones útiles de la hoja (`sheet_w - 2 * sheet_margin` o `sheet_h - 2 * sheet_margin`), emitir **error claro**.
2. **Acomodo de Placas**:
   - Orden numérico ($0, 1, 2, \dots$), filas de izquierda a derecha, **sin rotación**.
   - Al terminar fila pasa a la siguiente; al llenar hoja pasa a nueva hoja.
3. **Zona de Discos**:
   - Se ubica **después de la última fila de placas**.
   - Si no cabe en la hoja actual $\implies$ **se crea una nueva hoja para los discos**.
   - Si `gap != thickness` $\implies$ hoja separada de discos con su propio tamaño de hoja.
   - Discos agrupados por hueco con etiqueta grabada `"5→6"`.
4. **Cálculo de Medidas**:
   - Reportar `used_width`, `used_height` y total de hojas para la vista previa.
5. **Tests básicos**:
   - Error de placa gigante, orden sin rotar, discos al final o en hoja nueva, hoja aparte por grosor distinto.
6. **Checkpoint Fase 2**:
   - Commit local: `"feat(fase2): layout de placas y zona de discos en hojas de material"`
   - *Pausa para visto bueno.*

---

### Fase 3: Exportación SVG (`exporter.py`)

1. **Un SVG por Hoja**:
   - Corte = Rojo (`#FF0000`, `0.1mm`), Grabado = Azul (`#0000FF`, `0.1mm`), unidades en mm, escala 1:1.
2. **Elementos en Placas**:
   - Contornos de placa: **Corte (Rojo)**.
   - Número de placa: **Grabado (Azul)**.
   - Círculos de grabado en placa $k$:
     - **Sólidos** (azul continuo): discos del hueco $k$ (encima, $k \to k+1$).
     - **Punteados** (azul discontinuo): discos del hueco $k-1$ (abajo, $k-1 \to k$).
     - Diámetro grabado = `disco + 0.3 mm`.
3. **Elementos en Zona de Discos**:
   - Contorno de corte del disco: **Corte (Rojo)** con kerf compensado ($\text{diámetro} + \text{kerf}$).
   - Etiquetas de grupo: **Grabado (Azul)**.
4. **Tests básicos**:
   - Colores rojo/azul, círculos sólidos/punteados, diámetro grabado con holgura, discos con kerf.
5. **Checkpoint Fase 3**:
   - Commit local: `"feat(fase3): exportacion SVG con capas corte/grabado, circulos solidos/punteados y kerf"`
   - *Pausa para visto bueno.*

---

### Fase 4: Vista Previa de Exportación (`preview_dialog.py`)

1. **Diálogo con Pestañas**:
   - Una pestaña por SVG generado (`Hoja 1`, `Hoja 2`, `Hoja de Discos`).
   - Muestra la vista de la hoja con zoom/pan y medidas usadas del espacio (`ancho x alto` usado de la hoja y total de hojas).
   - Botón para exportar todos los SVG a la carpeta que elija el usuario.
2. **Tests básicos**:
   - Pestañas generadas por hoja y reporte de medidas.
3. **Checkpoint Fase 4**:
   - Commit local: `"feat(fase4): dialogo modal de vista previa SVG con medidas y exportacion"`
   - *Pausa para visto bueno.*

---

### Fase 5: Guía de Ensamble (`ASSEMBLY.md`)

- Documento técnico `ASSEMBLY.md`:
  - Pegamento: Cemento solvente acrílico capilar tipo Weld-On 3 o 4 (NO cianoacrilato ni silicón).
  - Ventilación y seguridad.
  - Aplicación del cemento en la orilla de la unión por capilaridad.
  - Tiempos de agarre (30 s - 2 min), manipulación (5-10 min) y curado final (24-48 h).
  - Interpretación de círculos sólidos vs punteados (Cara A siempre arriba).
  - Secuencia de armado de abajo hacia arriba.
- **Checkpoint Fase 5**:
  - Commit local: `"docs(fase5): guia de ensamble fisico ASSEMBLY.md"`
  - *Entrega final.*
