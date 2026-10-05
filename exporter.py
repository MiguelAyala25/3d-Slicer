"""
exporter.py — Exportación de placas rebanadas a SVG para fabricación digital.
"""

from typing import Tuple, List, Optional
import os
import svgwrite
from slicer import SliceResult


def _coords_to_svg_path(coords) -> str:
    """Convierte una lista de (x, y) a un string de path SVG: 'M x,y L x,y ... Z'"""
    parts = []
    for j, (x, y) in enumerate(coords):
        prefix = "M" if j == 0 else "L"
        parts.append(f"{prefix} {x:.3f},{y:.3f}")
    parts.append("Z")
    return " ".join(parts)


def export_svg(
    result: SliceResult,
    output_path: str,
    margin_mm: float = 10.0
) -> Tuple[bool, str]:
    """
    Escribe un archivo SVG con todas las placas distribuidas en fila.
    Los polígonos ya vienen en mm desde el slicer — no se aplica escala adicional.
    Retorna (True, ruta) o (False, mensaje_error).
    """
    if result is None or not hasattr(result, 'polygons'):
        return False, "Resultado de corte inválido o ausente."

    if not output_path or not isinstance(output_path, str):
        return False, "Ruta de archivo de salida inválida."

    valid_plates = [plist for plist in result.polygons if plist is not None and len(plist) > 0]
    if not valid_plates:
        return False, "No hay placas válidas para exportar."

    try:
        dirname = os.path.dirname(os.path.abspath(output_path))
        if dirname:
            os.makedirs(dirname, exist_ok=True)

        global_min_x = min(min(p.bounds[0] for p in plist) for plist in valid_plates)
        global_min_y = min(min(p.bounds[1] for p in plist) for plist in valid_plates)
        global_max_x = max(max(p.bounds[2] for p in plist) for plist in valid_plates)
        global_max_y = max(max(p.bounds[3] for p in plist) for plist in valid_plates)

        slot_width = global_max_x - global_min_x
        slot_height = global_max_y - global_min_y
        if slot_width <= 0:
            slot_width = 1.0
        if slot_height <= 0:
            slot_height = 1.0

        n_valid = len(valid_plates)
        total_width = (n_valid * slot_width) + ((n_valid + 1) * margin_mm)
        total_height = slot_height + (margin_mm * 2)

        dwg = svgwrite.Drawing(output_path, size=(f"{total_width:.3f}mm", f"{total_height:.3f}mm"))
        dwg.viewbox(0, 0, total_width, total_height)

        group = dwg.g(id="plates", style="fill-rule:evenodd; fill:none; stroke:black; stroke-width:0.1mm;")
        dwg.add(group)

        x_offset = margin_mm

        for i, plist in enumerate(result.polygons):
            if plist is None or len(plist) == 0:
                continue

            for polygon in plist:
                def transform_coords(coords):
                    res = []
                    for x, y in coords:
                        tx = (x - global_min_x) + x_offset
                        ty = (slot_height - (y - global_min_y)) + margin_mm
                        res.append((tx, ty))
                    return res

                exterior = transform_coords(polygon.exterior.coords)
                interiors = [transform_coords(h.coords) for h in polygon.interiors]

                path_d = _coords_to_svg_path(exterior)
                for interior in interiors:
                    path_d += " " + _coords_to_svg_path(interior)
                group.add(dwg.path(d=path_d))

            x_offset += slot_width + margin_mm

        dwg.save()
        return True, output_path
    except Exception:
        return False, "No se pudo guardar el archivo. Verificá que tenés permisos en la carpeta."
