"""
test_supports.py — Pruebas unitarias para el núcleo de cálculo de soportes (Fase 2).
"""

import os
import numpy as np
import pytest
from shapely.geometry import Polygon, box, Point

from params import Params
from supports import compute_supports, Column, SupportResult, SupportWarning


def test_two_identical_squares_20x20():
    # Cuadrados idénticos de 20x20 mm centrados en el origen
    sq1 = box(-10, -10, 10, 10)
    sq2 = box(-10, -10, 10, 10)
    p = Params(disc_min=5.0, disc_max=15.0, disc_frac=0.5, edge_margin=1.0)

    res = compute_supports([[sq1], [sq2]], p)

    assert len(res.columns) == 1
    col = res.columns[0]
    # Debe estar en el centro aproximado
    assert abs(col.x) < 0.5 and abs(col.y) < 0.5
    # Diámetro: max_fit = 2 * (10 - 1) = 18 mm. 0.5 * 18 = 9 mm -> clamp(9, 5, 15) = 9 mm
    assert 5.0 <= col.diameter <= 15.0
    assert col.level == 0
    assert col.reused is False


def test_long_rectangle_coverage():
    # Rectángulo largo de 200x20 mm
    rect1 = box(0, 0, 200, 20)
    rect2 = box(0, 0, 200, 20)
    p = Params(D_max=40.0, disc_min=5.0, disc_max=15.0)

    res = compute_supports([[rect1], [rect2]], p)

    # Con 200 mm de largo y D=40 mm, se requieren al menos 5 columnas
    assert len(res.columns) >= 5

    # Comprobar que cualquier punto muestreado del rectángulo está a <= D_max de alguna columna
    centers = np.array([[c.x, c.y] for c in res.columns])
    for x in np.linspace(1, 199, 50):
        for y in np.linspace(1, 19, 10):
            dists = np.linalg.norm(centers - np.array([x, y]), axis=1)
            assert np.min(dists) <= p.D_max + 1.0, f"Punto ({x}, {y}) quedó a {np.min(dists)} mm (> {p.D_max})"


def test_synthetic_hand_fingers_and_palm():
    # Mano sintética: palma de 80x80 y 5 dedos separados de 10x60 mm
    palm = box(0, 0, 80, 80)
    fingers = [
        box(10 + i * 14, 80, 10 + i * 14 + 10, 140)
        for i in range(5)
    ]
    # Placa inferior y superior con palma + 5 dedos
    plate_lower = [palm] + fingers
    plate_upper = [palm] + fingers

    p = Params(D_max=40.0, disc_min=5.0, disc_max=15.0, edge_margin=1.0)
    res = compute_supports([plate_lower, plate_upper], p)

    # Cada dedo debe tener al menos una columna
    for i, f in enumerate(fingers):
        cols_in_f = [c for c in res.columns if f.buffer(0.01).contains(Point(c.x, c.y))]
        assert len(cols_in_f) >= 1, f"Dedo {i} no tiene columna"

    # La palma debe tener al menos una columna (y varias por cobertura D_max)
    cols_in_palm = [c for c in res.columns if palm.buffer(0.01).contains(Point(c.x, c.y))]
    assert len(cols_in_palm) >= 1


def test_thin_finger_warning():
    # Dedo de solo 4 mm de ancho (menor que disc_min 5mm + edge_margin 1mm)
    base = box(0, 0, 40, 40)
    thin_finger = box(10, 40, 14, 70)  # ancho 4 mm

    p = Params(disc_min=5.0, edge_margin=1.0)
    res = compute_supports([[base, thin_finger], [base, thin_finger]], p)

    thin_warns = [w for w in res.warnings if w.kind == "thin"]
    assert len(thin_warns) >= 1
    assert "demasiado delgada" in thin_warns[0].message


def test_floating_island_warning():
    # Placa inferior solo tiene un cuadrado
    lower = [box(0, 0, 30, 30)]
    # Placa superior tiene el mismo cuadrado y una isla flotante a 100 mm de distancia
    floating = box(100, 100, 120, 120)
    upper = [box(0, 0, 30, 30), floating]

    p = Params()
    res = compute_supports([lower, upper], p)

    floating_warns = [w for w in res.warnings if w.kind == "floating"]
    assert len(floating_warns) >= 1
    assert "isla flotante" in floating_warns[0].message


def test_identical_stack_continuous_reused():
    # Pila de 5 placas cuadradas idénticas
    sq = box(-20, -20, 20, 20)
    stack = [[sq] for _ in range(5)]
    p = Params()

    res = compute_supports(stack, p)

    # Nivel 0 (entre placa 1 y 2): reused = False
    lvl0 = res.columns_at(0)
    assert len(lvl0) >= 1
    assert all(not c.reused for c in lvl0)

    # Niveles 1, 2, 3: todas deben ser reutilizadas (reused = True)
    for lvl in range(1, 4):
        cols = res.columns_at(lvl)
        assert len(cols) == len(lvl0)
        assert all(c.reused for c in cols), f"Nivel {lvl} tiene columnas no reutilizadas"
        # Verificar que coinciden en posición XY con el nivel 0
        for c0, ci in zip(lvl0, cols):
            assert abs(c0.x - ci.x) < 1e-4 and abs(c0.y - ci.y) < 1e-4


def test_shifting_staircase_stepped():
    # Pila escalonada que se desplaza 15 mm en X cada nivel
    # Ancho 20 mm: solape entre niveles es solo de 5 mm
    p1 = [box(0, 0, 20, 20)]
    p2 = [box(12, 0, 32, 20)]  # solape en [12, 20] -> 8 mm
    p3 = [box(24, 0, 44, 20)]  # solape en [24, 32] -> 8 mm
    p = Params(disc_min=5.0, edge_margin=0.5)

    res = compute_supports([p1, p2, p3], p)
    cols_0 = res.columns_at(0)
    cols_1 = res.columns_at(1)

    assert len(cols_0) >= 1
    assert len(cols_1) >= 1
    # La posición X debe haber cambiado para seguir el solape
    assert cols_1[0].x > cols_0[0].x


def test_discs_total_equals_len_columns():
    sq = box(0, 0, 30, 30)
    res = compute_supports([[sq], [sq], [sq]], Params())
    assert res.discs_total == len(res.columns)


def test_determinism():
    sq = box(-15, -15, 15, 15)
    p = Params()
    res1 = compute_supports([[sq], [sq]], p)
    res2 = compute_supports([[sq], [sq]], p)

    assert len(res1.columns) == len(res2.columns)
    for c1, c2 in zip(res1.columns, res2.columns):
        assert c1.x == c2.x and c1.y == c2.y and c1.diameter == c2.diameter


def test_hand_obj_integration():
    import trimesh
    from slicer import slice_mesh

    assert os.path.exists("Hand.OBJ")
    mesh = trimesh.load("Hand.OBJ", force="mesh")
    p = Params(plates=30, axis="y")

    sres = slice_mesh(mesh, plates=p.plates, gap=p.gap, thickness=p.thickness, axis=p.axis)
    sup = compute_supports(sres.polygons, p)

    # Debe ejecutarse sin excepciones y generar columnas
    assert sup.discs_total > 20
    # Todos los diámetros deben estar dentro del rango configurado o clamp de seguridad
    for c in sup.columns:
        assert 1.0 <= c.diameter <= p.disc_max
    # Debe haber columnas en múltiples niveles
    levels_with_cols = {c.level for c in sup.columns}
    assert len(levels_with_cols) >= 15
