"""
slicer.py — Lógica de corte (slicing) headless de modelos 3D a polígonos 2D.
"""

from dataclasses import dataclass
from typing import List, Tuple, Optional
import numpy as np
import shapely
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection
from shapely.geometry.polygon import orient
import trimesh
import trimesh.transformations as tx


@dataclass
class SliceResult:
    polygons: list           # lista de listas de shapely.Polygon (una lista por placa)
                             # COORDENADAS EN MM — el mesh fue pre-escalado antes de cortar
    empty_plates: list[int]  # índices de placas que resultaron vacías o triviales
    original_bounds: tuple   # (min_axis, max_axis) en el eje de corte, ANTES de escalar
    assembled_height: float  # altura total ensamblada = (n_plates * thickness) + ((n_plates-1) * gap)
    auto_scale: float        # escala calculada (informativo — ya aplicada al mesh)
    warnings: list[str]      # advertencias no fatales


def path2d_to_shapely(path2d) -> List[Polygon]:
    """
    Convierte un trimesh.Path2D en una lista de polígonos simples (shapely.Polygon).
    Resuelve huecos, fuerza orientación CCW y descarta geometrías inválidas.
    Incluye fallback si polygons_full retorna vacío a pesar de tener vértices.
    """
    # --- Ruta principal: usar polygons_full de trimesh ---
    try:
        polys_full = list(path2d.polygons_full)
    except Exception:
        polys_full = []

    # --- Fallback: si polygons_full falló pero hay contornos discretos, reconstruir ---
    if not polys_full and hasattr(path2d, 'discrete') and len(path2d.discrete) > 0:
        try:
            raw_polys = []
            for contour in path2d.discrete:
                if len(contour) >= 3:
                    candidate = Polygon(contour)
                    if not candidate.is_valid:
                        candidate = shapely.make_valid(candidate)
                    if isinstance(candidate, Polygon) and not candidate.is_empty:
                        raw_polys.append(candidate)
                    elif isinstance(candidate, MultiPolygon):
                        for g in candidate.geoms:
                            if isinstance(g, Polygon) and not g.is_empty:
                                raw_polys.append(g)

            # --- Nesting: reconstruir jerarquía exterior/hueco ---
            raw_polys.sort(key=lambda p: p.area, reverse=True)
            used = set()
            nested_polys = []

            for i, outer in enumerate(raw_polys):
                if i in used:
                    continue
                holes = []
                for j, inner in enumerate(raw_polys):
                    if j <= i or j in used:
                        continue
                    if outer.contains(inner):
                        holes.append(inner.exterior.coords)
                        used.add(j)

                if holes:
                    nested = Polygon(outer.exterior.coords, holes)
                    if nested.is_valid and not nested.is_empty:
                        nested_polys.append(nested)
                    else:
                        nested_polys.append(outer)
                else:
                    nested_polys.append(outer)

            polys_full = nested_polys
        except Exception:
            return []

    if not polys_full:
        return []

    result = []
    for p in polys_full:
        valid_p = shapely.make_valid(p)

        # Extraer solo polígonos simples y forzar orientación CCW
        if isinstance(valid_p, Polygon):
            if not valid_p.is_empty:
                result.append(orient(valid_p, sign=1.0))
        elif isinstance(valid_p, MultiPolygon):
            for geom in valid_p.geoms:
                if isinstance(geom, Polygon) and not geom.is_empty:
                    result.append(orient(geom, sign=1.0))
        elif isinstance(valid_p, GeometryCollection):
            for geom in valid_p.geoms:
                if isinstance(geom, Polygon) and not geom.is_empty:
                    result.append(orient(geom, sign=1.0))

    return result


def slice_mesh(
    mesh: trimesh.Trimesh,
    plates: int,
    gap: float,
    thickness: float,
    axis: str = 'z',
    min_area_mm2: float = 1.0
) -> SliceResult:
    """
    Corta un modelo 3D en planos seriados a lo largo del eje indicado.
    Pre-escala el mesh a mm según la altura ensamblada requerida.
    Retorna SliceResult con los polígonos 2D en mm.
    """
    axis = axis.lower()
    if axis not in ('x', 'y', 'z'):
        raise ValueError(f"Eje de corte inválido: '{axis}'. Debe ser 'x', 'y' o 'z'.")

    # Copiar para no alterar el mesh original recibido
    mesh = mesh.copy()

    # Rotar el modelo para que el eje seleccionado se alinee con +Z
    if axis == 'x':
        rot = tx.rotation_matrix(-np.pi / 2, [0, 1, 0])
        mesh.apply_transform(rot)
    elif axis == 'y':
        rot = tx.rotation_matrix(np.pi / 2, [1, 0, 0])
        mesh.apply_transform(rot)

    # Centrar en el origen para evitar problemas con coordenadas desplazadas
    mesh.vertices -= mesh.bounds.mean(axis=0)

    # Dimensiones antes de escalar
    bounds = mesh.bounds
    min_z = float(bounds[0][2])
    max_z = float(bounds[1][2])
    total_length = max_z - min_z
    original_bounds = (min_z, max_z)

    assembled_height = (plates * thickness) + ((plates - 1) * gap)
    auto_scale = assembled_height / total_length if total_length > 0 else 1.0

    # Pre-escalar el mesh a milímetros
    mesh.apply_scale(auto_scale)

    # Bounds post-escalado en mm
    bounds_mm = mesh.bounds
    min_z_mm = float(bounds_mm[0][2])

    # Posiciones de corte en mm
    cut_positions = []
    for i in range(plates):
        physical_center = i * (thickness + gap) + (thickness / 2.0)
        pos_in_mesh = min_z_mm + physical_center
        cut_positions.append(pos_in_mesh)

    # Slicing con section_multiplane
    sections_2d = mesh.section_multiplane(
        plane_origin=[0, 0, 0],
        plane_normal=[0, 0, 1],
        heights=cut_positions
    )

    if sections_2d is None:
        sections_2d = [None] * plates

    polygons = []
    empty_plates = []

    for i, section_2d in enumerate(sections_2d):
        if section_2d is None:
            empty_plates.append(i)
            polygons.append(None)
            continue

        poly_list = path2d_to_shapely(section_2d)
        valid_polys_for_plate = [p for p in poly_list if p.area >= min_area_mm2]

        if not valid_polys_for_plate:
            empty_plates.append(i)
            polygons.append(None)
        else:
            polygons.append(valid_polys_for_plate)

    warnings = []
    if len(empty_plates) > 0:
        shown = empty_plates[:5] + ['...'] + empty_plates[-3:] if len(empty_plates) > 10 else empty_plates
        warnings.append(
            f"Placas {shown} están vacías o demasiado pequeñas (área < {min_area_mm2} mm²). Serán omitidas en la exportación."
        )

    if len(empty_plates) == plates:
        raise ValueError("Ningún plano de corte produjo geometría. Verificá el eje de corte seleccionado.")

    return SliceResult(
        polygons=polygons,
        empty_plates=empty_plates,
        original_bounds=original_bounds,
        assembled_height=assembled_height,
        auto_scale=auto_scale,
        warnings=warnings
    )
