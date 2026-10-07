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
import ezdxf
from ezdxf.enums import TextEntityAlignment

from slicer import SliceResult
from params import Params
from discs import DiscManager
from layout import SheetLayout, LayoutResult, compute_layout


def _clean_poly_points(coords) -> List[Tuple[float, float]]:
    """Convierte coordenadas a lista de tuplas (x, y) float, omitiendo punto final redundante."""
    pts = [(float(x), float(y)) for x, y in coords]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


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

    cut_stroke_width = "0.45" if preview_mode else "0.1"
    engrave_stroke_width = "0.25" if preview_mode else "0.1"
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

    # Círculos grabados en placas y etiquetas en material sobrante (Scrap Tags)
    for plate in sheet.placed_plates:
        # Círculos grabados (sólidos para hueco k, punteados para hueco k-1)
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

        # Scrap Tag en material sobrante (fuera de la placa de corte)
        if getattr(plate, 'scrap_tag', None) is not None:
            st = plate.scrap_tag
            font_size_str = f"{st.font_size:.2f}"
            group_engrave.add(dwg.text(
                st.text,
                insert=(st.text_pos[0], st.text_pos[1]),
                fill="#0000FF",
                stroke="none",
                font_size=font_size_str,
                font_family="Arial, Helvetica, sans-serif",
                font_weight="bold",
                text_anchor="middle"
            ))
            # Flecha / línea indicadora hacia la placa
            group_engrave.add(dwg.line(
                start=st.arrow_start,
                end=st.arrow_end,
                stroke="#0000FF",
                stroke_width=engrave_stroke_width
            ))

    # Bandejas y etiquetas para grupos de discos
    for group in sheet.disc_groups:
        font_size_grp = "2.6" if preview_mode else "2.8"
        group_engrave.add(dwg.text(
            group.label_text,
            insert=(group.label_pos[0], group.label_pos[1]),
            fill="#0000FF",
            stroke="none",
            font_size=font_size_grp,
            font_family="Arial, Helvetica, sans-serif",
            font_weight="bold",
            dominant_baseline="hanging"
        ))

        # Recuadro perimetral grabado de la bandeja de discos
        if hasattr(group, 'bounds') and group.bounds != (0.0, 0.0, 0.0, 0.0):
            gx, gy, g_maxx, g_maxy = group.bounds
            gw = max(1.0, g_maxx - gx)
            gh = max(1.0, g_maxy - gy)
            group_engrave.add(dwg.rect(
                insert=(gx, gy),
                size=(gw, gh),
                rx=1.5,
                ry=1.5,
                stroke="#0000FF",
                stroke_width=engrave_stroke_width,
                fill="none"
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


def sheet_to_dxf(sheet: SheetLayout) -> ezdxf.document.Drawing:
    """
    Genera un objeto Drawing de ezdxf con las capas CORTE y GRABADO
    para corte láser a escala 1:1 en milímetros.
    """
    doc = ezdxf.new("R2010", setup=True)
    doc.header['$INSUNITS'] = 4  # 4 = mm
    doc.header['$MEASUREMENT'] = 1  # 1 = Métrico
    doc.header['$LIMMIN'] = (0.0, 0.0)
    doc.header['$LIMMAX'] = (float(sheet.sheet_w), float(sheet.sheet_h))

    msp = doc.modelspace()

    # Capas estándar de corte láser:
    # CORTE (Rojo - ACI 1)
    if "CORTE" not in doc.layers:
        doc.layers.add("CORTE", color=1)
    else:
        doc.layers.get("CORTE").color = 1

    # GRABADO (Azul - ACI 5)
    if "GRABADO" not in doc.layers:
        doc.layers.add("GRABADO", color=5)
    else:
        doc.layers.get("GRABADO").color = 5

    # 1. ELEMENTOS DE CORTE (Rojo)
    # Contornos de placas (exteriores e interiores/huecos)
    for plate in sheet.placed_plates:
        for polygon in plate.polygons:
            ext_pts = _clean_poly_points(polygon.exterior.coords)
            if len(ext_pts) >= 2:
                msp.add_lwpolyline(ext_pts, close=True, dxfattribs={"layer": "CORTE", "color": 1})

            for interior in polygon.interiors:
                int_pts = _clean_poly_points(interior.coords)
                if len(int_pts) >= 2:
                    msp.add_lwpolyline(int_pts, close=True, dxfattribs={"layer": "CORTE", "color": 1})

    # Círculos de corte de discos (con kerf compensado)
    for group in sheet.disc_groups:
        for disc in group.discs:
            r = float(disc.cut_diameter) / 2.0
            msp.add_circle(
                center=(float(disc.center_x), float(disc.center_y)),
                radius=r,
                dxfattribs={"layer": "CORTE", "color": 1}
            )

    # 2. ELEMENTOS DE GRABADO (Azul)
    for plate in sheet.placed_plates:
        # Círculos grabados en placas (sólidos para hueco k, punteados para hueco k-1)
        for circle_info in plate.engrave_circles:
            r = float(circle_info.diameter) / 2.0
            dxfattribs = {"layer": "GRABADO", "color": 5}
            if circle_info.is_dashed:
                dxfattribs["linetype"] = "DASHED"
            msp.add_circle(
                center=(float(circle_info.center_x), float(circle_info.center_y)),
                radius=r,
                dxfattribs=dxfattribs
            )

        # Scrap Tag en material sobrante (rótulo y flecha indicadora)
        if getattr(plate, 'scrap_tag', None) is not None:
            st = plate.scrap_tag
            txt = msp.add_text(
                st.text,
                dxfattribs={
                    "layer": "GRABADO",
                    "color": 5,
                    "height": float(st.font_size)
                }
            )
            txt.set_placement(
                (float(st.text_pos[0]), float(st.text_pos[1])),
                align=TextEntityAlignment.MIDDLE_CENTER
            )
            msp.add_line(
                start=(float(st.arrow_start[0]), float(st.arrow_start[1])),
                end=(float(st.arrow_end[0]), float(st.arrow_end[1])),
                dxfattribs={"layer": "GRABADO", "color": 5}
            )

    # Bandejas y etiquetas para grupos de discos
    for group in sheet.disc_groups:
        font_size_grp = 2.8
        txt = msp.add_text(
            group.label_text,
            dxfattribs={
                "layer": "GRABADO",
                "color": 5,
                "height": font_size_grp
            }
        )
        txt.set_placement(
            (float(group.label_pos[0]), float(group.label_pos[1])),
            align=TextEntityAlignment.TOP_LEFT
        )

        # Recuadro perimetral grabado de la bandeja de discos
        if hasattr(group, 'bounds') and group.bounds != (0.0, 0.0, 0.0, 0.0):
            gx, gy, g_maxx, g_maxy = group.bounds
            gw = max(1.0, g_maxx - gx)
            gh = max(1.0, g_maxy - gy)
            rect_pts = [(gx, gy), (gx + gw, gy), (gx + gw, gy + gh), (gx, gy + gh)]
            msp.add_lwpolyline(
                rect_pts,
                close=True,
                dxfattribs={"layer": "GRABADO", "color": 5}
            )

    return doc


def export_sheet_to_dxf(sheet: SheetLayout, output_path: str) -> str:
    """Escribe un archivo DXF a partir de un SheetLayout."""
    dirname = os.path.dirname(os.path.abspath(output_path))
    if dirname:
        os.makedirs(dirname, exist_ok=True)

    doc = sheet_to_dxf(sheet)
    doc.saveas(output_path)
    return output_path


def export_layout_to_dxf_files(
    layout: LayoutResult,
    output_dir: str,
    base_name: str = "escultura"
) -> List[str]:
    """
    Exporta todas las hojas del layout a archivos DXF independientes.
    Retorna la lista de rutas generadas.
    """
    os.makedirs(output_dir, exist_ok=True)
    generated_files = []

    for sheet in layout.sheets:
        sheet_num = sheet.sheet_index + 1
        sheet_suffix = "discos" if sheet.sheet_type == "discs" else "placas"
        filename = f"{base_name}_hoja_{sheet_num}_{sheet_suffix}.dxf"
        full_path = os.path.join(output_dir, filename)

        export_sheet_to_dxf(sheet, full_path)
        generated_files.append(full_path)

    return generated_files


def export_dxf(
    result: SliceResult,
    output_path: str,
    params: Optional[Params] = None,
    disc_manager: Optional[DiscManager] = None,
    margin_mm: float = 10.0
) -> Tuple[bool, str]:
    """
    Exporta el resultado de rebanado a archivo DXF para corte láser.
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

        export_sheet_to_dxf(layout.sheets[0], output_path)
        return True, output_path
    except Exception as e:
        return False, "No se pudo guardar el archivo. Verificá que tenés permisos en la carpeta."

