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
