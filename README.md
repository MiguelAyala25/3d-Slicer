# Escultura de Planos Seriados

Herramienta en Python para generar esculturas de planos seriados a partir de modelos 3D (archivos OBJ y STL).

## Flujo principal
1. **Cargar:** Modelos 3D en formato OBJ o STL.
2. **Rebanar:** Slicing paramétrico configurable en cualquier eje (X, Y, Z) con grosor y separación definidos.
3. **Visualizar:** Vista 3D lado a lado del modelo original y las placas ensambladas.
4. **Exportar:** Archivos de fabricación DXF (por capas) y SVG (con layout global y marcas de alineación).

## Requisitos e Instalación
Instalar las dependencias con Python 3.10+:
```bash
pip install -r requirements.txt
```
