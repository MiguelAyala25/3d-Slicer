"""
layout.py — Acomodo (nesting) de placas y zona de discos en hojas de material para corte láser.

Reglas del proyecto:
1. Validación de tamaño: si una placa excede las dimensiones útiles de la hoja
   (sheet_w - 2 * sheet_margin o sheet_h - 2 * sheet_margin), emite un ValueError claro.
2. Acomodo de placas: orden numérico estricto (0, 1, 2, ...), filas de izquierda a derecha,
   sin rotación ni espejado (orientación exacta del corte).
3. Grabado en Cara A:
   - Círculos sólidos: discos del hueco k (k → k+1, encima de la placa).
   - Círculos punteados: discos del hueco k-1 (k-1 → k, debajo de la placa).
   - Diámetro grabado: diámetro del disco + holgura de grabado (engrave_clearance).
   - Texto grabado con número de placa: "PLACA k".
4. Zona de discos:
   - Se ubica después de la última fila de placas.
   - Si no cabe en la hoja actual, pasa a una nueva hoja.
   - Si gap != thickness (discs_separate_sheet), va en una hoja independiente con su propio espesor.
   - Discos agrupados por hueco con etiqueta grabada "k→k+1".
   - Contorno de corte con compensación de kerf: diámetro_corte = diámetro_disco + kerf.
5. Reporte de dimensiones: cálculo de used_width, used_height y total de hojas.
"""

from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Dict
import math
from shapely.geometry import Polygon
from shapely import affinity

from slicer import SliceResult
from params import Params
from discs import DiscManager, Disc


@dataclass
class EngraveCircle:
    """Círculo grabado en una placa para posicionar un disco."""
    center_x: float
    center_y: float
    diameter: float
    is_dashed: bool   # False = sólido (hueco k), True = punteado (hueco k-1)
    hueco: int
    disc_id: int


@dataclass
class PlacedPlate:
    """Placa posicionada en una hoja de material."""
    plate_idx: int
    polygons: List[Polygon]
    bounds: Tuple[float, float, float, float]  # (minx, miny, maxx, maxy) en coords de hoja
    x: float
    y: float
    w: float
    h: float
    label_text: str
    label_pos: Tuple[float, float]
    engrave_circles: List[EngraveCircle] = field(default_factory=list)


@dataclass
class PlacedDisc:
    """Disco posicionado en la zona de discos de una hoja."""
    disc_id: int
    hueco: int
    center_x: float
    center_y: float
    cut_diameter: float       # diámetro real de corte = diámetro + kerf
    nominal_diameter: float   # diámetro nominal del disco


@dataclass
class DiscGroup:
    """Grupo de discos pertenecientes a un mismo hueco."""
    hueco: int
    label_text: str           # ej. "0→1", "1→2"
    label_pos: Tuple[float, float]
    discs: List[PlacedDisc] = field(default_factory=list)


@dataclass
class SheetLayout:
    """Distribución completa de una hoja de material."""
    sheet_index: int
    sheet_type: str           # "plates" o "discs"
    sheet_w: float
    sheet_h: float
    thickness: float
    placed_plates: List[PlacedPlate] = field(default_factory=list)
    disc_groups: List[DiscGroup] = field(default_factory=list)
    used_width: float = 0.0
    used_height: float = 0.0

    @property
    def total_discs(self) -> int:
        return sum(len(g.discs) for g in self.disc_groups)

    def calculate_used_dimensions(self, margin: float):
        """Calcula el ancho y alto efectivamente ocupados en la hoja."""
        max_x = 0.0
        max_y = 0.0
        has_elements = False

        for plate in self.placed_plates:
            has_elements = True
            max_x = max(max_x, plate.bounds[2])
            max_y = max(max_y, plate.bounds[3])
            # Considerar también el label
            max_x = max(max_x, plate.label_pos[0] + 30.0)
            max_y = max(max_y, plate.label_pos[1] + 5.0)

        for group in self.disc_groups:
            has_elements = True
            max_x = max(max_x, group.label_pos[0] + 25.0)
            max_y = max(max_y, group.label_pos[1] + 6.0)
            for d in group.discs:
                r = d.cut_diameter / 2.0
                max_x = max(max_x, d.center_x + r)
                max_y = max(max_y, d.center_y + r)

        if has_elements:
            self.used_width = min(self.sheet_w, round(max_x + margin, 2))
            self.used_height = min(self.sheet_h, round(max_y + margin, 2))
        else:
            self.used_width = 0.0
            self.used_height = 0.0


@dataclass
class LayoutResult:
    """Resultado del acomodo en hojas."""
    sheets: List[SheetLayout] = field(default_factory=list)
    total_sheets: int = 0
    warnings: List[str] = field(default_factory=list)


def validate_plate_sizes(result: SliceResult, params: Params):
    """
    Verifica que cada placa quepa en el área útil de la hoja.
    Lanza ValueError con mensaje claro si alguna placa excede las medidas.
    """
    if not result or not result.polygons:
        return

    usable_w = params.sheet_w - (2.0 * params.sheet_margin)
    usable_h = params.sheet_h - (2.0 * params.sheet_margin)

    if usable_w <= 0 or usable_h <= 0:
        raise ValueError(
            f"El margen ({params.sheet_margin} mm) es demasiado grande para la hoja "
            f"de {params.sheet_w} x {params.sheet_h} mm."
        )

    for i, plist in enumerate(result.polygons):
        if not plist:
            continue
        minx = min(p.bounds[0] for p in plist)
        miny = min(p.bounds[1] for p in plist)
        maxx = max(p.bounds[2] for p in plist)
        maxy = max(p.bounds[3] for p in plist)

        w = maxx - minx
        h = maxy - miny

        if w > usable_w or h > usable_h:
            raise ValueError(
                f"La placa {i} ({w:.1f} x {h:.1f} mm) excede el área útil de la hoja "
                f"({usable_w:.1f} x {usable_h:.1f} mm). Ajusta el tamaño de la hoja "
                f"o escala el modelo 3D."
            )


def compute_layout(
    result: SliceResult,
    params: Params,
    disc_manager: Optional[DiscManager] = None
) -> LayoutResult:
    """
    Calcula el acomodo secuencial de placas y zona de discos en hojas de material.
    """
    # 1. Validar tamaños antes de iniciar el acomodo
    validate_plate_sizes(result, params)

    sheets: List[SheetLayout] = []
    warnings: List[str] = []

    usable_w = params.sheet_w - (2.0 * params.sheet_margin)
    usable_h = params.sheet_h - (2.0 * params.sheet_margin)
    margin = params.sheet_margin
    gap_parts = params.part_gap

    # Mapeo de discos por hueco
    discs_by_hueco: Dict[int, List[Disc]] = {}
    if disc_manager:
        for d in disc_manager.discs:
            discs_by_hueco.setdefault(d.hueco, []).append(d)

    total_plates_count = len(result.polygons) if result and result.polygons else 0

    # Hoja actual para placas
    current_sheet_idx = 0
    current_sheet = SheetLayout(
        sheet_index=current_sheet_idx,
        sheet_type="plates",
        sheet_w=params.sheet_w,
        sheet_h=params.sheet_h,
        thickness=params.thickness
    )
    sheets.append(current_sheet)

    curr_x = margin
    curr_y = margin
    row_h = 0.0

    # 2. Acomodo secuencial de placas (0, 1, 2, ...)
    if result and result.polygons:
        for i, plist in enumerate(result.polygons):
            if not plist:
                continue

            minx = min(p.bounds[0] for p in plist)
            miny = min(p.bounds[1] for p in plist)
            maxx = max(p.bounds[2] for p in plist)
            maxy = max(p.bounds[3] for p in plist)

            w = maxx - minx
            h = maxy - miny

            # ¿Cabe horizontalmente en la fila actual?
            if curr_x + w > params.sheet_w - margin and curr_x > margin:
                # Pasar a siguiente fila
                curr_x = margin
                curr_y += row_h + gap_parts
                row_h = 0.0

            # ¿Cabe verticalmente en la hoja actual?
            if curr_y + h > params.sheet_h - margin and len(current_sheet.placed_plates) > 0:
                # Cerrar hoja actual y abrir nueva hoja
                current_sheet.calculate_used_dimensions(margin)
                current_sheet_idx += 1
                current_sheet = SheetLayout(
                    sheet_index=current_sheet_idx,
                    sheet_type="plates",
                    sheet_w=params.sheet_w,
                    sheet_h=params.sheet_h,
                    thickness=params.thickness
                )
                sheets.append(current_sheet)
                curr_x = margin
                curr_y = margin
                row_h = 0.0

            # Trasladar geometrías a la posición en hoja
            dx = curr_x - minx
            dy = curr_y - miny
            placed_polys = [affinity.translate(p, xoff=dx, yoff=dy) for p in plist]
            placed_bounds = (curr_x, curr_y, curr_x + w, curr_y + h)

            # Círculos grabados en la placa i:
            # - Sólidos: discos del hueco i (encima de la placa: i → i+1)
            # - Punteados: discos del hueco i-1 (debajo de la placa: i-1 → i)
            engrave_circles: List[EngraveCircle] = []

            # Hueco i (encima, sólidos)
            if i in discs_by_hueco:
                for d in discs_by_hueco[i]:
                    engrave_circles.append(EngraveCircle(
                        center_x=d.x + dx,
                        center_y=d.y + dy,
                        diameter=d.diameter + params.engrave_clearance,
                        is_dashed=False,
                        hueco=i,
                        disc_id=d.id
                    ))

            # Hueco i-1 (abajo, punteados)
            if (i - 1) in discs_by_hueco:
                for d in discs_by_hueco[i - 1]:
                    engrave_circles.append(EngraveCircle(
                        center_x=d.x + dx,
                        center_y=d.y + dy,
                        diameter=d.diameter + params.engrave_clearance,
                        is_dashed=True,
                        hueco=i - 1,
                        disc_id=d.id
                    ))

            # Posición de la etiqueta grabada "PLACA i"
            label_pos = (curr_x + min(8.0, w * 0.1), curr_y + min(12.0, h * 0.2))

            plate_obj = PlacedPlate(
                plate_idx=i,
                polygons=placed_polys,
                bounds=placed_bounds,
                x=curr_x,
                y=curr_y,
                w=w,
                h=h,
                label_text=f"PLACA {i}",
                label_pos=label_pos,
                engrave_circles=engrave_circles
            )
            current_sheet.placed_plates.append(plate_obj)

            # Avanzar cursor
            curr_x += w + gap_parts
            row_h = max(row_h, h)

    # 3. Zona de discos
    all_discs_list: List[Disc] = []
    if disc_manager and disc_manager.discs:
        all_discs_list = sorted(disc_manager.discs, key=lambda d: (d.hueco, d.id))

    if all_discs_list:
        # Agrupar discos por hueco
        groups_to_place: List[Tuple[int, List[Disc]]] = []
        unique_huecos = sorted(set(d.hueco for d in all_discs_list))
        for h_idx in unique_huecos:
            h_discs = [d for d in all_discs_list if d.hueco == h_idx]
            groups_to_place.append((h_idx, h_discs))

        # Determinar si los discos van en hoja separada por espesor distinto
        separate_sheet_needed = params.discs_separate_sheet

        # Estimación de altura requerida para discos
        label_w = 26.0
        label_h = 8.0
        max_d_cut = max((d.diameter + params.kerf) for d in all_discs_list)
        approx_disc_row_h = max(max_d_cut, label_h)

        # Espacio vertical restante en la hoja actual
        y_after_plates = curr_y + row_h + gap_parts if row_h > 0 else curr_y
        remaining_h = (params.sheet_h - margin) - y_after_plates

        if separate_sheet_needed:
            # Forzar hoja separada de discos con el grosor del gap
            current_sheet.calculate_used_dimensions(margin)
            current_sheet_idx += 1
            disc_sheet = SheetLayout(
                sheet_index=current_sheet_idx,
                sheet_type="discs",
                sheet_w=params.sheet_w,
                sheet_h=params.sheet_h,
                thickness=params.gap
            )
            sheets.append(disc_sheet)
            disc_curr_x = margin
            disc_curr_y = margin
            disc_row_h = 0.0
            target_sheet = disc_sheet
        elif remaining_h < (approx_disc_row_h + gap_parts):
            # No cabe en la hoja actual de placas => pasar a nueva hoja
            current_sheet.calculate_used_dimensions(margin)
            current_sheet_idx += 1
            disc_sheet = SheetLayout(
                sheet_index=current_sheet_idx,
                sheet_type="discs",
                sheet_w=params.sheet_w,
                sheet_h=params.sheet_h,
                thickness=params.thickness
            )
            sheets.append(disc_sheet)
            disc_curr_x = margin
            disc_curr_y = margin
            disc_row_h = 0.0
            target_sheet = disc_sheet
        else:
            # Cabe después de la última fila de placas en la hoja actual
            disc_curr_x = margin
            disc_curr_y = y_after_plates
            disc_row_h = 0.0
            target_sheet = current_sheet

        # Acomodar cada grupo de discos
        for hueco_idx, d_list in groups_to_place:
            grp_label = f"{hueco_idx}→{hueco_idx + 1}"

            # ¿Cabe la etiqueta en la fila actual?
            if disc_curr_x + label_w > params.sheet_w - margin and disc_curr_x > margin:
                disc_curr_x = margin
                disc_curr_y += disc_row_h + gap_parts
                disc_row_h = 0.0

            # ¿Cabe verticalmente?
            if disc_curr_y + approx_disc_row_h > params.sheet_h - margin:
                target_sheet.calculate_used_dimensions(margin)
                current_sheet_idx += 1
                target_sheet = SheetLayout(
                    sheet_index=current_sheet_idx,
                    sheet_type="discs",
                    sheet_w=params.sheet_w,
                    sheet_h=params.sheet_h,
                    thickness=params.gap if separate_sheet_needed else params.thickness
                )
                sheets.append(target_sheet)
                disc_curr_x = margin
                disc_curr_y = margin
                disc_row_h = 0.0

            # Posición de la etiqueta del grupo
            group_obj = DiscGroup(
                hueco=hueco_idx,
                label_text=grp_label,
                label_pos=(disc_curr_x, disc_curr_y + 4.0),
                discs=[]
            )
            target_sheet.disc_groups.append(group_obj)

            disc_curr_x += label_w + gap_parts
            disc_row_h = max(disc_row_h, label_h)

            for d in d_list:
                d_cut = d.diameter + params.kerf
                r_cut = d_cut / 2.0

                # ¿Cabe horizontalmente?
                if disc_curr_x + d_cut > params.sheet_w - margin:
                    disc_curr_x = margin
                    disc_curr_y += disc_row_h + gap_parts
                    disc_row_h = 0.0

                # ¿Cabe verticalmente?
                if disc_curr_y + d_cut > params.sheet_h - margin:
                    target_sheet.calculate_used_dimensions(margin)
                    current_sheet_idx += 1
                    target_sheet = SheetLayout(
                        sheet_index=current_sheet_idx,
                        sheet_type="discs",
                        sheet_w=params.sheet_w,
                        sheet_h=params.sheet_h,
                        thickness=params.gap if separate_sheet_needed else params.thickness
                    )
                    sheets.append(target_sheet)
                    disc_curr_x = margin
                    disc_curr_y = margin
                    disc_row_h = 0.0
                    # Reconectar grupo a la nueva hoja
                    group_obj = DiscGroup(
                        hueco=hueco_idx,
                        label_text=f"{grp_label} (cont.)",
                        label_pos=(disc_curr_x, disc_curr_y + 4.0),
                        discs=[]
                    )
                    target_sheet.disc_groups.append(group_obj)
                    disc_curr_x += label_w + gap_parts
                    disc_row_h = max(disc_row_h, label_h)

                center_x = disc_curr_x + r_cut
                center_y = disc_curr_y + r_cut

                group_obj.discs.append(PlacedDisc(
                    disc_id=d.id,
                    hueco=d.hueco,
                    center_x=center_x,
                    center_y=center_y,
                    cut_diameter=d_cut,
                    nominal_diameter=d.diameter
                ))

                disc_curr_x += d_cut + gap_parts
                disc_row_h = max(disc_row_h, d_cut)

            # Separador extra al terminar el grupo
            disc_curr_x += gap_parts * 1.5

    # Calcular dimensiones usadas de todas las hojas
    for s in sheets:
        s.calculate_used_dimensions(margin)

    # Filtrar hojas vacías si las hubiera
    sheets = [s for s in sheets if (len(s.placed_plates) > 0 or len(s.disc_groups) > 0)]
    for idx, s in enumerate(sheets):
        s.sheet_index = idx

    return LayoutResult(
        sheets=sheets,
        total_sheets=len(sheets),
        warnings=warnings
    )
