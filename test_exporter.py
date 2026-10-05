"""
test_exporter.py — Suite de pruebas para la exportación SVG (Fase 0: Solo SVG).
"""

import os
import trimesh
from shapely.geometry import Polygon
from slicer import slice_mesh, SliceResult
from exporter import export_svg


def test_export_svg_invalid_inputs():
    ok, msg = export_svg(None, "dummy.svg")
    assert not ok and "inválido" in msg

    empty_res = SliceResult(
        polygons=[None, None],
        empty_plates=[0, 1],
        original_bounds=(0, 10),
        assembled_height=10.0,
        auto_scale=1.0,
        warnings=["Vacio"]
    )
    ok, msg = export_svg(empty_res, "dummy.svg")
    assert not ok and "No hay placas válidas" in msg

    ok, msg = export_svg(empty_res, "")
    assert not ok


def test_export_svg_box():
    box = trimesh.creation.box(extents=[20, 20, 20])
    res_box = slice_mesh(box, plates=5, gap=2.0, thickness=3.0, axis='z')

    svg_box_path = "tmp_test_box.svg"
    try:
        ok, path = export_svg(res_box, svg_box_path, margin_mm=10.0)
        assert ok and os.path.exists(svg_box_path)

        with open(svg_box_path, "r", encoding="utf-8") as f:
            svg_content = f.read()

        assert "fill-rule:evenodd" in svg_content
        assert svg_content.count("<path") == 5
    finally:
        if os.path.exists(svg_box_path):
            os.remove(svg_box_path)


def test_export_svg_torus_holes():
    torus = trimesh.creation.torus(major_radius=20, minor_radius=8)
    res_torus = slice_mesh(torus, plates=7, gap=1.0, thickness=2.0, axis='z')

    svg_torus_path = "tmp_test_torus.svg"
    try:
        ok, _ = export_svg(res_torus, svg_torus_path)
        assert ok and os.path.exists(svg_torus_path)

        with open(svg_torus_path, "r", encoding="utf-8") as f:
            svg_torus_content = f.read()

        found_subpath = False
        for line in svg_torus_content.splitlines():
            if '<path d="' in line and line.count("M ") >= 2:
                found_subpath = True
                break
        assert found_subpath, "Debe tener al menos un path con múltiples contornos M (exterior + hueco)"
    finally:
        if os.path.exists(svg_torus_path):
            os.remove(svg_torus_path)


def test_export_svg_multipolygon():
    p_a = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    p_b = Polygon([(20, 0), (30, 0), (30, 10), (20, 10)])
    multi_res = SliceResult(
        polygons=[[p_a, p_b]],
        empty_plates=[],
        original_bounds=(0, 10),
        assembled_height=5.0,
        auto_scale=1.0,
        warnings=[]
    )

    svg_m_path = "tmp_test_multi.svg"
    try:
        ok, _ = export_svg(multi_res, svg_m_path)
        assert ok and os.path.exists(svg_m_path)

        with open(svg_m_path, "r", encoding="utf-8") as f:
            svg_m_content = f.read()
        assert svg_m_content.count("<path") == 2
    finally:
        if os.path.exists(svg_m_path):
            os.remove(svg_m_path)
