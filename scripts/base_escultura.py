"""
base_escultura.py — Genera la base de MDF de 3 mm con encaje para la escultura.

Diseño:
- Materiales: Acrílico de 6 mm (placas y separación/discos) y MDF de 3 mm.
- 6 posiciones de 250 x 200 mm acomodadas en 2 columnas x 3 filas:
    * Fila superior (piezas 1 y 2): 2 bases enteras y lisas (piso).
    * Fila media (piezas 3 y 4): 2 piezas con el hueco de PLACA 23 (muñeca), cortadas a la mitad verticalmente (2 mitades c/u).
    * Fila inferior (piezas 5 y 6): 2 piezas con el hueco de PLACA 22 (penúltima), cortadas a la mitad verticalmente (2 mitades c/u).
- Las mitades permiten ensamblar el collar de MDF alrededor de la mano fácilmente (tipo abrazadera / clamshell)
  y después montarlo/pegarlo sobre la base lisa entera.
- Sin texto en el DXF: únicamente contornos de corte en la capa CORTE (color 1 / rojo).
"""

from collections import defaultdict
import ezdxf
from shapely.geometry import Polygon, box
from shapely.affinity import translate
from shapely.ops import unary_union

# ---------------- Parámetros ----------------
SRC_DXF = "escultura_hoja_1_placas.dxf"
OUT_DXF = "base_placa_grande_mdf_3mm.dxf"                 # Versión con piezas partidas a la mitad
OUT_DXF_ENTERA = "base_placa_grande_mdf_3mm_ENTERA.dxf"  # Versión con piezas enteras (respaldo)

BASE_W = 250.0          # mm, ancho de la placa base
BASE_H = 200.0          # mm, alto/profundidad de la placa base
CORNER_R = 5.0          # mm, radio de redondeo de esquinas
CLEARANCE = 0.2         # mm por lado de holgura para el acrílico
PIECE_GAP = 10.0        # mm, separación entre piezas en la plantilla

# Delimitadores de Placa 22 y 23 en el DXF de origen
BOX_P22 = (468.5, 563.0, 328.0, 428.8)
BOX_P23 = (10.0, 112.7, 181.0, 277.0)


def _inside(x, y, b, tol=0.5):
    return b[0] - tol <= x <= b[1] + tol and b[2] - tol <= y <= b[3] + tol


def load_plate(msp, b):
    """Extrae el polígono exterior de corte y los centros de los discos grabados."""
    outline = None
    for e in msp.query("LWPOLYLINE"):
        if e.dxf.layer != "CORTE":
            continue
        pts = [(x, y) for x, y, *_ in e.get_points()]
        if all(_inside(x, y, b) for x, y in pts):
            poly = Polygon(pts)
            if outline is None or poly.area > outline.area:
                outline = poly

    solid = [(e.dxf.center.x, e.dxf.center.y) for e in msp.query("CIRCLE")
             if e.dxf.layer == "GRABADO" and _inside(e.dxf.center.x, e.dxf.center.y, b)]

    dashed = defaultdict(int)
    for e in msp.query("ARC"):
        c = e.dxf.center
        if _inside(c.x, c.y, b):
            dashed[(round(c.x, 3), round(c.y, 3))] += 1

    return outline, solid, list(dashed.keys())


def align_offset(solid_22, dashed_23):
    """Calcula el offset que alinea Placa 22 con Placa 23 según los discos 22→23."""
    a = sorted(solid_22)
    b = sorted(dashed_23)
    best = None
    for p in a:
        for q in b:
            dx, dy = q[0] - p[0], q[1] - p[1]
            err = sum(min((x + dx - u) ** 2 + (y + dy - v) ** 2 for u, v in b) for x, y in a)
            if best is None or err < best[0]:
                best = (err, dx, dy)
    err, dx, dy = best
    if err > 0.01 * len(a):
        raise RuntimeError(f"Error al alinear discos 22→23: {err:.4f}")
    return dx, dy


def rounded_rect(w, h, r):
    """Genera un rectángulo con esquinas redondeadas."""
    return box(r, r, w - r, h - r).buffer(r, resolution=16)


def add_geom(msp, geom, ox, oy, layer="CORTE"):
    """Inserta geometrías en el DXF sin duplicados."""
    geoms = getattr(geom, "geoms", [geom])
    for g in geoms:
        rings = [g.exterior] + list(g.interiors)
        for ring in rings:
            pts = [(x + ox, y + oy) for x, y in list(ring.coords)[:-1]]
            msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": layer})


def build_dxf(layer1, layer2, layer3, split_halves, out_path):
    """Construye el archivo DXF con las 6 posiciones de base."""
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4  # mm
    doc.layers.add("CORTE", color=1)  # Rojo estándar láser
    msp = doc.modelspace()

    left_box = box(-10, -10, BASE_W / 2, BASE_H + 10)
    right_box = box(BASE_W / 2, -10, BASE_W + 10, BASE_H + 10)

    # Filas:
    # row=2 (arriba): Base sólida lisa (piezas 1 y 2) -> SIEMPRE ENTERAS
    # row=1 (medio): Hueco Placa 23 (piezas 3 y 4)
    # row=0 (abajo):  Hueco Placa 22 (piezas 5 y 6)
    rows_data = [
        (2, layer1, False),             # Bases sólidas lisas: enteras
        (1, layer2, split_halves),      # Placa 23: partidas a la mitad si split_halves=True
        (0, layer3, split_halves),      # Placa 22: partidas a la mitad si split_halves=True
    ]

    for row_idx, geom, do_split in rows_data:
        for col in [0, 1]:
            ox = col * (BASE_W + PIECE_GAP)
            oy = row_idx * (BASE_H + PIECE_GAP)
            if do_split:
                part_L = geom.intersection(left_box)
                part_R = geom.intersection(right_box)
                add_geom(msp, part_L, ox, oy, "CORTE")
                add_geom(msp, part_R, ox, oy, "CORTE")
            else:
                add_geom(msp, geom, ox, oy, "CORTE")

    doc.saveas(out_path)
    print(f"Exportado exitosamente: {out_path} (mitades={split_halves})")


def main():
    src = ezdxf.readfile(SRC_DXF).modelspace()
    p23, _, dashed23 = load_plate(src, BOX_P23)
    p22, solid22, _ = load_plate(src, BOX_P22)

    # Alinear Placa 22 con Placa 23
    dx, dy = align_offset(solid22, dashed23)
    p22 = translate(p22, dx, dy)

    # Centrar ambas placas respecto al centro de la base
    minx, miny, maxx, maxy = unary_union([p22, p23]).bounds
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    p23 = translate(p23, BASE_W / 2 - cx, BASE_H / 2 - cy)
    p22 = translate(p22, BASE_W / 2 - cx, BASE_H / 2 - cy)

    hole23 = p23.buffer(CLEARANCE, join_style=2)
    hole22 = p22.buffer(CLEARANCE, join_style=2)
    base = rounded_rect(BASE_W, BASE_H, CORNER_R)

    layer1 = base                     # Piso sólido
    layer2 = base.difference(hole23)  # Placa 23
    layer3 = base.difference(hole22)  # Placa 22

    # 1. Versión principal: Placas 23 y 22 cortadas a la mitad, bases sólidas enteras
    build_dxf(layer1, layer2, layer3, split_halves=True, out_path=OUT_DXF)

    # 2. Versión respaldo: Con todas las piezas enteras
    build_dxf(layer1, layer2, layer3, split_halves=False, out_path=OUT_DXF_ENTERA)


if __name__ == "__main__":
    main()
