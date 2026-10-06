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


def test_export_svg_colors_and_layers():
    """Valida capas estándar de corte (rojo #FF0000) y grabado (azul #0000FF)."""
    from params import Params
    from discs import DiscManager
    from layout import compute_layout
    from exporter import sheet_to_svg_string

    p0 = [Polygon([(0, 0), (50, 0), (50, 50), (0, 50)])]
    res = SliceResult(
        polygons=[p0],
        empty_plates=[],
        original_bounds=(0, 50),
        assembled_height=50.0,
        auto_scale=1.0,
        warnings=[]
    )
    params = Params(sheet_w=600.0, sheet_h=400.0)
    layout = compute_layout(res, params)
    svg_str = sheet_to_svg_string(layout.sheets[0])

    # Capa corte (rojo)
    assert 'stroke:#FF0000' in svg_str
    # Capa grabado (azul)
    assert 'stroke:#0000FF' in svg_str
    # Texto grabado
    assert 'PLACA 0' in svg_str


def test_export_engrave_circles_solid_and_dashed():
    """Valida que los círculos grabados sean sólidos (arriba) y punteados (abajo) con holgura."""
    from params import Params
    from discs import DiscManager
    from layout import compute_layout
    from exporter import sheet_to_svg_string

    p0 = [Polygon([(0, 0), (60, 0), (60, 60), (0, 60)])]
    p1 = [Polygon([(0, 0), (60, 0), (60, 60), (0, 60)])]
    res = SliceResult(
        polygons=[p0, p1],
        empty_plates=[],
        original_bounds=(0, 60),
        assembled_height=60.0,
        auto_scale=1.0,
        warnings=[]
    )
    params = Params(sheet_w=600.0, sheet_h=400.0, engrave_clearance=0.3)
    dm = DiscManager()
    # Disco en hueco 0 entre placa 0 y 1
    dm.add_disc(hueco=0, x=20.0, y=20.0, diameter=6.0, max_gap=0)

    layout = compute_layout(res, params, dm)
    svg_str = sheet_to_svg_string(layout.sheets[0])

    # Debe contener círculo sólido con radio 3.15 mm (diámetro 6.3 mm)
    assert 'r="3.15"' in svg_str
    # Debe contener círculo punteado con stroke-dasharray
    assert 'stroke-dasharray="1.5,1.0"' in svg_str


def test_export_discs_with_kerf():
    """Valida que los discos en la zona de corte tengan kerf compensado (diámetro + kerf)."""
    from params import Params
    from discs import DiscManager
    from layout import compute_layout
    from exporter import sheet_to_svg_string

    p0 = [Polygon([(0, 0), (40, 0), (40, 40), (0, 40)])]
    res = SliceResult(
        polygons=[p0],
        empty_plates=[],
        original_bounds=(0, 40),
        assembled_height=40.0,
        auto_scale=1.0,
        warnings=[]
    )
    # kerf = 0.20 mm, diámetro nominal = 6.0 mm -> diámetro corte = 6.20 mm -> r = 3.10 mm
    params = Params(sheet_w=600.0, sheet_h=400.0, kerf=0.20)
    dm = DiscManager()
    dm.add_disc(hueco=0, x=10.0, y=10.0, diameter=6.0, max_gap=0)

    layout = compute_layout(res, params, dm)
    svg_str = sheet_to_svg_string(layout.sheets[0])

    # Radio compensado de corte: 3.1
    assert 'r="3.1"' in svg_str
    assert '0→1' in svg_str


def test_export_layout_to_multiple_files(tmp_path):
    """Valida la exportación de múltiples hojas a archivos independientes."""
    from params import Params
    from discs import DiscManager
    from layout import compute_layout
    from exporter import export_layout_to_svg_files

    # gap != thickness genera 2 hojas independientes
    params = Params(sheet_w=600.0, sheet_h=400.0, thickness=3.0, gap=5.0)
    p0 = [Polygon([(0, 0), (40, 0), (40, 40), (0, 40)])]
    res = SliceResult(
        polygons=[p0],
        empty_plates=[],
        original_bounds=(0, 40),
        assembled_height=40.0,
        auto_scale=1.0,
        warnings=[]
    )
    dm = DiscManager()
    dm.add_disc(hueco=0, x=10.0, y=10.0, diameter=6.0, max_gap=0)

    layout = compute_layout(res, params, dm)
    assert layout.total_sheets == 2

    out_dir = str(tmp_path / "svg_out")
    files = export_layout_to_svg_files(layout, out_dir, base_name="test_proj")
    assert len(files) == 2
    assert all(os.path.exists(f) for f in files)
    assert "hoja_1_placas.svg" in files[0]
    assert "hoja_2_discos.svg" in files[1]

