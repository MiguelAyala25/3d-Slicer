"""
supports.py — Cálculo de columnas de discos entre placas (headless).

Cada "columna" en un nivel es UN disco acrílico de grosor = separación entre placas.
Discos en la misma posición XY en niveles consecutivos forman columnas continuas;
si la posición cambia, la columna es escalonada.

Algoritmo por nivel k (placa k abajo, placa k+1 arriba), de abajo hacia arriba:
  1. inter    = placa_k ∩ placa_k+1
  2. feasible = inter erosionada por (disc_min/2 + edge_margin)
  3. Reutilizar columnas del nivel anterior que sigan dentro de feasible.
  4. Por cada isla de la placa de arriba: avisos (flotante / delgada) y,
     si no tiene columna, poner una en el polo de inaccesibilidad de su feasible.
  5. Cobertura D: mientras algún punto de la isla esté a > D de una columna
     de esa isla, agregar columna en el punto de feasible más cercano.
  6. Diámetro = clamp(round(disc_frac × Ø_inscrito), disc_min, disc_max).

Uso de depuración:
    python -m supports --demo Hand.OBJ [--axis y] [--plates 15]
"""

from __future__ import annotations

import sys
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import math
from dataclasses import dataclass, field
from typing import List, Optional, Sequence

import numpy as np
import shapely
from shapely.geometry import Point, Polygon, MultiPolygon
from shapely.ops import unary_union, polylabel, nearest_points

from params import Params


# ---------------------------------------------------------------------------
# Estructuras de datos
# ---------------------------------------------------------------------------

@dataclass
class Column:
    """Un disco en un nivel (entre placa `level` y `level + 1`, índices 0-based)."""
    level: int
    x: float
    y: float
    diameter: float      # mm, entero
    reused: bool         # True si continúa la columna del nivel anterior


@dataclass
class SupportWarning:
    kind: str            # 'floating' | 'thin' | 'uncovered' | 'gap_in_stack'
    level: int
    x: Optional[float]
    y: Optional[float]
    message: str


@dataclass
class SupportResult:
    columns: List[Column] = field(default_factory=list)
    warnings: List[SupportWarning] = field(default_factory=list)

    @property
    def discs_total(self) -> int:
        """1 disco por columna por nivel."""
        return len(self.columns)

    def columns_at(self, level: int) -> List[Column]:
        return [c for c in self.columns if c.level == level]

    def diameter_histogram(self) -> dict:
        hist: dict = {}
        for c in self.columns:
            hist[c.diameter] = hist.get(c.diameter, 0) + 1
        return dict(sorted(hist.items()))


# ---------------------------------------------------------------------------
# Utilidades geométricas
# ---------------------------------------------------------------------------

_EPS = 1e-6


def _largest_polygon(geom) -> Optional[Polygon]:
    if geom is None or geom.is_empty:
        return None
    if isinstance(geom, Polygon):
        return geom
    polys = [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]
    if not polys:
        return None
    return max(polys, key=lambda p: p.area)


def _polygons_of(geom) -> List[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]


def _sample_grid(poly, step: float) -> np.ndarray:
    """Puntos de rejilla dentro del polígono + vértices del contorno (para no perder puntas)."""
    minx, miny, maxx, maxy = poly.bounds
    xs = np.arange(minx + step / 2, maxx, step)
    ys = np.arange(miny + step / 2, maxy, step)
    pts = np.empty((0, 2))
    if len(xs) and len(ys):
        gx, gy = np.meshgrid(xs, ys)
        gx, gy = gx.ravel(), gy.ravel()
        inside = shapely.contains_xy(poly, gx, gy)
        pts = np.column_stack([gx[inside], gy[inside]])
    boundary_pts = []
    for p in _polygons_of(poly):
        boundary_pts.append(np.asarray(p.exterior.coords)[:-1])
    if boundary_pts:
        pts = np.vstack([pts] + boundary_pts)
    return pts


def _disc_diameter(inter, x: float, y: float, p: Params) -> float:
    dist = inter.boundary.distance(Point(x, y))
    r_ins = max(0.0, dist - p.edge_margin)
    max_fit = 2.0 * r_ins
    target_d = p.disc_frac * max_fit
    d = round(target_d)
    # Limitar entre mínimo y máximo
    if max_fit >= p.disc_min - 0.2:
        d = max(p.disc_min, min(p.disc_max, d))
    else:
        d = max(1.0, math.floor(max_fit))
    return float(d)


def _plate_geom(plate) -> Optional[object]:
    if not plate:
        return None
    g = unary_union(plate)
    return None if g.is_empty else g


# ---------------------------------------------------------------------------
# Algoritmo principal
# ---------------------------------------------------------------------------

def compute_supports(plates: Sequence[Optional[list]], params: Params) -> SupportResult:
    """
    plates: lista (una entrada por placa, de abajo hacia arriba) de listas de
            shapely.Polygon en mm, o None si la placa está vacía.
    """
    p = params
    result = SupportResult()
    r_min = p.disc_min / 2.0 + p.edge_margin
    step = max(1.0, p.D_max / 8.0)

    prev_centers: List[tuple] = []

    for k in range(len(plates) - 1):
        lower_g = _plate_geom(plates[k])
        upper_list = plates[k + 1]
        upper_g = _plate_geom(upper_list)

        if lower_g is None or upper_g is None:
            if lower_g is not None or upper_g is not None:
                result.warnings.append(SupportWarning(
                    "gap_in_stack", k, None, None,
                    f"Nivel {k + 1}->{k + 2}: una de las placas está vacía; no se puede apoyar."
                ))
            prev_centers = []
            continue

        inter = lower_g.intersection(upper_g)
        feasible = inter.buffer(-r_min) if not inter.is_empty else inter

        level_cols: List[Column] = []

        # 3. Reutilizar columnas del nivel anterior
        for (cx, cy) in prev_centers:
            if not feasible.is_empty and feasible.buffer(_EPS).contains(Point(cx, cy)):
                level_cols.append(Column(k, cx, cy, 0.0, True))

        # 4-5. Por isla de la placa de arriba
        for isl in upper_list:
            isl_inter = isl.intersection(lower_g)
            c = isl.representative_point()
            if isl_inter.is_empty or isl_inter.area < _EPS:
                result.warnings.append(SupportWarning(
                    "floating", k, c.x, c.y,
                    f"Nivel {k + 1}->{k + 2}: isla en placa {k + 2} sin contacto con la placa {k + 1} (isla flotante)."
                ))
                continue

            isl_feas = feasible.intersection(isl) if not feasible.is_empty else feasible
            if isl_feas.is_empty or isl_feas.area < _EPS:
                result.warnings.append(SupportWarning(
                    "thin", k, c.x, c.y,
                    f"Nivel {k + 1}->{k + 2}: zona demasiado delgada o intersección muy chica "
                    f"para un disco de {p.disc_min:.0f} mm."
                ))
                continue

            isl_buf = isl.buffer(_EPS)

            def cols_in_island():
                return [col for col in level_cols if isl_buf.contains(Point(col.x, col.y))]

            if not cols_in_island():
                target = _largest_polygon(isl_feas)
                pt = polylabel(target, tolerance=0.1)
                if not isl_feas.buffer(_EPS).contains(pt):
                    pt = target.representative_point()
                level_cols.append(Column(k, pt.x, pt.y, 0.0, False))

            # Cobertura D
            samples = _sample_grid(isl, step)
            if len(samples) == 0:
                continue
            active = np.ones(len(samples), dtype=bool)
            uncovered_reported = False
            for _ in range(500):
                cols = cols_in_island()
                centers = np.array([(col.x, col.y) for col in cols])
                d = np.min(np.linalg.norm(samples[:, None, :] - centers[None, :, :], axis=2), axis=1)
                d_masked = np.where(active, d, -1.0)
                i_far = int(np.argmax(d_masked))
                if d_masked[i_far] <= p.D_max:
                    break
                far = Point(samples[i_far])
                tgt = nearest_points(isl_feas, far)[0]
                dist_to_existing = np.min(np.linalg.norm(centers - np.array([tgt.x, tgt.y]), axis=1))
                if dist_to_existing < max(p.disc_min, 1.0):
                    # No hay dónde poner una columna que ayude a ese punto
                    near = np.linalg.norm(samples - samples[i_far], axis=1) <= p.D_max / 2.0
                    active &= ~near
                    if not uncovered_reported:
                        result.warnings.append(SupportWarning(
                            "uncovered", k, far.x, far.y,
                            f"Nivel {k + 1}->{k + 2}: zona de la placa {k + 2} a más de "
                            f"{p.D_max:.0f} mm de cualquier disco (no hay intersección donde poner otro)."
                        ))
                        uncovered_reported = True
                    continue
                level_cols.append(Column(k, tgt.x, tgt.y, 0.0, False))

        # 6. Diámetros
        for col in level_cols:
            col.diameter = _disc_diameter(inter, col.x, col.y, p)

        result.columns.extend(level_cols)
        prev_centers = [(c.x, c.y) for c in level_cols]

    return result


# ---------------------------------------------------------------------------
# Demo / depuración: genera un PNG por nivel
# ---------------------------------------------------------------------------

def _plot_level(ax, lower, upper, cols, warnings, p: Params):
    from matplotlib.patches import Circle

    def draw(geom, **kw):
        for poly in _polygons_of(geom):
            x, y = poly.exterior.xy
            ax.fill(x, y, **kw)
            for hole in poly.interiors:
                hx, hy = hole.xy
                ax.fill(hx, hy, color="white")

    lower_g = _plate_geom(lower)
    upper_g = _plate_geom(upper)
    if lower_g is not None:
        draw(lower_g, color="#90caf9", alpha=0.5, label="abajo")
    if upper_g is not None:
        draw(upper_g, color="#ffcc80", alpha=0.5, label="arriba")
    if lower_g is not None and upper_g is not None:
        inter = lower_g.intersection(upper_g)
        draw(inter, color="#a5d6a7", alpha=0.6)
        feas = inter.buffer(-(p.disc_min / 2 + p.edge_margin))
        for poly in _polygons_of(feas):
            x, y = poly.exterior.xy
            ax.plot(x, y, color="green", lw=0.6, ls="--")
    for c in cols:
        ax.add_patch(Circle((c.x, c.y), c.diameter / 2, fill=False,
                            ec="purple" if c.reused else "red", lw=1.2))
        ax.add_patch(Circle((c.x, c.y), p.D_max, fill=False, ec="gray", lw=0.3, ls=":"))
        ax.text(c.x, c.y, f"{c.diameter:.0f}", fontsize=6, ha="center", va="center")
    for w in warnings:
        if w.x is not None:
            ax.plot(w.x, w.y, "kx", ms=8)
    ax.set_aspect("equal")


def _demo(path: str, axis: str, plates: int, out_dir: str):
    import os
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import trimesh
    from slicer import slice_mesh

    p = Params(plates=plates, axis=axis)
    mesh = trimesh.load(path, force="mesh")
    sres = slice_mesh(mesh, plates=p.plates, gap=p.gap, thickness=p.thickness, axis=p.axis)
    sup = compute_supports(sres.polygons, p)

    os.makedirs(out_dir, exist_ok=True)
    for k in range(len(sres.polygons) - 1):
        fig, ax = plt.subplots(figsize=(7, 7))
        cols = sup.columns_at(k)
        warns = [w for w in sup.warnings if w.level == k]
        _plot_level(ax, sres.polygons[k], sres.polygons[k + 1], cols, warns, p)
        n_reused = sum(c.reused for c in cols)
        ax.set_title(f"Nivel {k + 1}->{k + 2}: {len(cols)} discos ({n_reused} continuos), "
                     f"{len(warns)} avisos")
        fig.savefig(os.path.join(out_dir, f"nivel_{k + 1:02d}.png"), dpi=110)
        plt.close(fig)

    print(f"Placas: {p.plates}  eje: {axis}  escala: {sres.auto_scale:.2f}x")
    print(f"Discos totales: {sup.discs_total}   por diámetro: {sup.diameter_histogram()}")
    for w in sup.warnings:
        print(f"  [{w.kind}] {w.message}")
    print(f"PNGs en: {os.path.abspath(out_dir)}")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Demo de columnas de discos")
    ap.add_argument("--demo", required=True, help="Ruta a OBJ/STL")
    ap.add_argument("--axis", default="y")
    ap.add_argument("--plates", type=int, default=15)
    ap.add_argument("--out", default="debug_supports")
    a = ap.parse_args()
    _demo(a.demo, a.axis, a.plates, a.out)
