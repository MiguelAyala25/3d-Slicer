# Escultura de Planos Seriados (Web)

Aplicación web interactiva para generar esculturas de planos seriados y ensambles tipo waffle a partir de modelos 3D (formatos OBJ, STL, PLY y 3MF).

## Flujo principal
1. **Cargar:** Modelos 3D en formato OBJ, STL, PLY o 3MF.
2. **Rebanar:** Slicing paramétrico configurable en cualquier eje (X, Y, Z) con grosor y separación definidos (incluyendo uniones por discos o ensamble waffle interlock).
3. **Visualizar:** Viewport 3D en tiempo real del modelo original y las placas ensambladas.
4. **Exportar:** Archivos de fabricación DXF (por capas) y SVG (con layout global, marcas de alineación y planillas de corte).

## Requisitos e Instalación
Requiere Node.js 18+:

```bash
cd web
npm install
npm run dev
```

Para ejecutar pruebas:
```bash
cd web
npm test
```

## Kerf (Compensación de corte láser)

El parámetro `kerf` representa el ancho de material consumido por el haz láser durante el corte. Su comportamiento en la exportación (DXF y SVG) sigue la siguiente política:

1. **Contornos de placa en geometría nominal (sin offset de kerf):**
   Los contornos exteriores e interiores (huecos) de las placas en la capa `CORTE` se exportan a escala 1:1 con su geometría nominal exacta (`web/src/core/dxfExporter.ts:89-106`, `web/src/core/svgExporter.ts:78-89`), sin aplicar desplazamiento por kerf. Si se requiere compensar el contorno exterior/interior de las placas, dicha compensación debe aplicarla la máquina o el software CAM de corte (p. ej. LightBurn o RDWorks).

2. **Piezas que sí incluyen compensación de `kerf` en el archivo exportado:**
   El parámetro `kerf` ya se aplica directamente en la geometría exportada de las siguientes piezas de unión; por ello, **no se debe aplicar compensación adicional de kerf en la máquina/software de corte sobre estas piezas** (evitando doble compensación):
   - **Discos de unión (capa `CORTE`):** el diámetro de corte se expande en `+kerf`, exportando círculos con radio `cutRadius = (disc.diameter + sheet.kerf) * 0.5` (`web/src/core/dxfExporter.ts:172-175` y `web/src/core/svgExporter.ts:147-150`) para que el disco físico resultante conserve `disc.diameter` tras el corte. *(Los círculos guía en la capa `GRABADO` no usan `kerf`, sino `engraveClearance`: `r = (disc.diameter + engraveClearance) / 2` en `web/src/core/dxfExporter.ts:108-121` y `web/src/core/svgExporter.ts:91-100`).*
   - **Ranuras de ensamble Waffle (`waffle` + `slots`) y hoja de calibración:** el ancho dibujado de cada ranura descuenta el `kerf` según `drawnSlotWidth = thickness + slotClearance - kerf` (con un mínimo válido `> 0.05 mm`), ya que el haz láser ensancha la cavidad interior al cortar (`web/src/core/waffle/waffleSlicer.ts:60, 129-132`, `web/src/core/build/validateBuild.ts:47-51`, `web/src/core/waffle/calibrationSheet.ts:53, 69` y `web/src/core/waffle/types.ts:33, 84`).

3. **Valor por defecto y rango (`web/src/core/params.ts`):**
   - **Valor por defecto:** `0.15 mm` (`DEFAULT_PARAMS.kerf` en `web/src/core/params.ts:31`).
   - **Rango permitido:** `0.0 mm` a `5.0 mm`, con paso de `0.01 mm` (`PARAM_BOUNDS.kerf` en `web/src/core/params.ts:14`, validado en `web/src/core/paramValidation.ts:102-108`).
