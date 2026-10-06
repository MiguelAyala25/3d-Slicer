"""
exporter.py — Exportación de placas rebanadas y discos a archivos SVG para corte láser.

Reglas del proyecto:
1. Un archivo SVG por hoja.
2. Capas y colores estándar de corte láser:
   - Corte: Rojo (#FF0000, 0.1 mm, sin relleno).
   - Grabado: Azul (#0000FF, 0.1 mm, sin relleno para líneas, azul para texto).
3. Elementos en placas:
   - Contornos exteriores e interiores: Corte (Rojo).
   - Número de placa: Grabado (Azul).
   - Círculos de grabado en placa k:
     - Sólidos (azul continuo): discos del hueco k (k → k+1, encima).
     - Punteados (azul discontinuo stroke-dasharray): discos del hueco k-1 (k-1 → k, abajo).
     - Diámetro grabado: diámetro del disco + holgura de grabado (0.3 mm).
4. Elementos en zona de discos:
   - Contorno de corte del disco: Corte (Rojo) con kerf compensado (diámetro + kerf).
   - Etiquetas de grupo: Grabado (Azul) con formato "k→k+1".
5. Unidades y escala: escala 1:1, medidas en milímetros.
"""

from typing import Tuple, List, Optional
import os
import svgwrite

from slicer import SliceResult
from params import Params
from discs import DiscManager
from layout import SheetLayout, LayoutResult, compute_layout


def _coords_to_svg_path(coords) -> str:
    """Convierte una lista de (x, y) a un string de path SVG: 'M x,y L x,y ... Z'"""
    parts = []
    for j, (x, y) in enumerate(coords):
        prefix = "M" if j == 0 else "L"
        parts.append(f"{prefix} {x:.3f},{y:.3f}")
    parts.append("Z")
    return " ".join(parts)


def sheet_to_svg_string(sheet: SheetLayout, preview_mode: bool = False) -> str:
    """
    Genera el contenido XML SVG de una hoja según las especificaciones de corte y grabado láser.
    Si preview_mode es True, usa anchos de trazo aumentados para una óptima visualización en pantalla.
    """
    dwg = svgwrite.Drawing(
        size=(f"{sheet.sheet_w:.3f}mm", f"{sheet.sheet_h:.3f}mm")
    )
    dwg.viewbox(0, 0, sheet.sheet_w, sheet.sheet_h)

    cut_stroke_width = "0.45" if preview_mode else "0.1mm"
    engrave_stroke_width = "0.25" if preview_mode else "0.1mm"
    dash_pattern = "1.5,1.0"

    # 1. Grupo de CORTE — Rojo (#FF0000)
    group_cut = dwg.g(
        id="corte",
        style=f"fill-rule:evenodd; fill:none; stroke:#FF0000; stroke-width:{cut_stroke_width};"
    )

    # Contornos de placas
    for plate in sheet.placed_plates:
        for polygon in plate.polygons:
            exterior = [(x, y) for x, y in polygon.exterior.coords]
            interiors = [[(x, y) for x, y in h.coords] for h in polygon.interiors]

            path_d = _coords_to_svg_path(exterior)
            for interior in interiors:
                path_d += " " + _coords_to_svg_path(interior)
            group_cut.add(dwg.path(d=path_d))

    # Círculos de corte de discos (con kerf)
    for group in sheet.disc_groups:
        for disc in group.discs:
            r = disc.cut_diameter / 2.0
            group_cut.add(dwg.circle(
                center=(disc.center_x, disc.center_y),
                r=r
            ))

    # 2. Grupo de GRABADO — Azul (#0000FF)
    group_engrave = dwg.g(
        id="grabado",
        style=f"fill:none; stroke:#0000FF; stroke-width:{engrave_stroke_width};"
    )

    # Círculos grabados en placas (sólidos para hueco k, punteados para hueco k-1)
    for plate in sheet.placed_plates:
        for circle_info in plate.engrave_circles:
            r = circle_info.diameter / 2.0
            if circle_info.is_dashed:
                # Círculo punteado (discos provenientes de abajo k-1)
                group_engrave.add(dwg.circle(
                    center=(circle_info.center_x, circle_info.center_y),
                    r=r,
                    stroke_dasharray=dash_pattern
                ))
            else:
                # Círculo sólido (discos colocados arriba k)
                group_engrave.add(dwg.circle(
                    center=(circle_info.center_x, circle_info.center_y),
                    r=r
                ))

    dwg.add(group_cut)
    dwg.add(group_engrave)
    return dwg.tostring()


def export_sheet_to_svg(sheet: SheetLayout, output_path: str) -> str:
    """Escribe un archivo SVG a partir de un SheetLayout."""
    dirname = os.path.dirname(os.path.abspath(output_path))
    if dirname:
        os.makedirs(dirname, exist_ok=True)

    svg_content = sheet_to_svg_string(sheet)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    return output_path


def export_layout_to_svg_files(
    layout: LayoutResult,
    output_dir: str,
    base_name: str = "escultura"
) -> List[str]:
    """
    Exporta todas las hojas del layout a archivos SVG independientes.
    Retorna la lista de rutas generadas.
    """
    os.makedirs(output_dir, exist_ok=True)
    generated_files = []

    for sheet in layout.sheets:
        sheet_num = sheet.sheet_index + 1
        sheet_suffix = "discos" if sheet.sheet_type == "discs" else "placas"
        filename = f"{base_name}_hoja_{sheet_num}_{sheet_suffix}.svg"
        full_path = os.path.join(output_dir, filename)

        export_sheet_to_svg(sheet, full_path)
        generated_files.append(full_path)

    return generated_files


def export_svg(
    result: SliceResult,
    output_path: str,
    params: Optional[Params] = None,
    disc_manager: Optional[DiscManager] = None,
    margin_mm: float = 10.0
) -> Tuple[bool, str]:
    """
    Función de compatibilidad para exportar el resultado de rebanado a SVG.
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
        if params is None:
            # Calcular dimensiones mínimas de hoja para contener las placas
            global_max_w = max(max(p.bounds[2] - p.bounds[0] for p in plist) for plist in valid_plates)
            global_max_h = max(max(p.bounds[3] - p.bounds[1] for p in plist) for plist in valid_plates)
            needed_w = max(600.0, (global_max_w + margin_mm) * len(valid_plates) + margin_mm * 2)
            needed_h = max(400.0, global_max_h + margin_mm * 3)
            active_params = Params(
                sheet_w=needed_w,
                sheet_h=needed_h,
                sheet_margin=margin_mm
            )
        else:
            active_params = params

        layout = compute_layout(result, active_params, disc_manager)
        if not layout.sheets:
            return False, "No se generaron hojas válidas en el layout."

        # Exportar la primera hoja o todas si corresponde
        export_sheet_to_svg(layout.sheets[0], output_path)
        return True, output_path
    except Exception as e:
        return False, "No se pudo guardar el archivo. Verificá que tenés permisos en la carpeta."
