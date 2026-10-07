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
    # Texto de Scrap Tag grabado en el material sobrante
    assert 'PLACA 0' in svg_str
    # Validar que el Scrap Tag está fuera de la placa de corte (en el margen)
    plate = layout.sheets[0].placed_plates[0]
    assert plate.scrap_tag is not None
    assert plate.scrap_tag.text_pos[1] < plate.y


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
    # Etiqueta grabada del grupo de discos
    assert '0→1' in svg_str
    # Recuadro perimetral grabado de la bandeja
    assert '<rect' in svg_str


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


def test_scrap_tags_geometry_never_intersects_plates():
    """Valida que los Scrap Tags estén estrictamente fuera de los contornos de corte."""
    from params import Params
    from layout import compute_layout
    from exporter import sheet_to_svg_string
    from shapely.geometry import Point

    # 3 placas
    p0 = [Polygon([(0, 0), (60, 0), (60, 40), (0, 40)])]
    p1 = [Polygon([(0, 0), (50, 0), (50, 50), (0, 50)])]
    p2 = [Polygon([(0, 0), (70, 0), (70, 30), (0, 30)])]
    res = SliceResult(
        polygons=[p0, p1, p2],
        empty_plates=[],
        original_bounds=(0, 50),
        assembled_height=50.0,
        auto_scale=1.0,
        warnings=[]
    )
    params = Params(sheet_w=600.0, sheet_h=400.0, sheet_margin=10.0, part_gap=5.0)
    layout = compute_layout(res, params)
    sheet = layout.sheets[0]

    assert len(sheet.placed_plates) == 3
    for plate in sheet.placed_plates:
        assert plate.scrap_tag is not None
        assert f"PLACA {plate.plate_idx}" == plate.scrap_tag.text

        # La posición del texto y la flecha NO debe estar dentro de ningún polígono de la placa
        pt_text = Point(plate.scrap_tag.text_pos[0], plate.scrap_tag.text_pos[1])
        pt_arrow_start = Point(plate.scrap_tag.arrow_start[0], plate.scrap_tag.arrow_start[1])
        pt_arrow_end = Point(plate.scrap_tag.arrow_end[0], plate.scrap_tag.arrow_end[1])

        for poly in plate.polygons:
            assert not poly.contains(pt_text), f"El texto de la placa {plate.plate_idx} no debe estar dentro del corte"
            assert not poly.contains(pt_arrow_start)
            assert not poly.contains(pt_arrow_end)

    svg_str = sheet_to_svg_string(sheet)
    assert "PLACA 0" in svg_str
    assert "PLACA 1" in svg_str
    assert "PLACA 2" in svg_str


def test_export_dxf_invalid_inputs():
    from exporter import export_dxf
    ok, msg = export_dxf(None, "dummy.dxf")
    assert not ok and "inválido" in msg

    empty_res = SliceResult(
        polygons=[None, None],
        empty_plates=[0, 1],
        original_bounds=(0, 10),
        assembled_height=10.0,
        auto_scale=1.0,
        warnings=["Vacio"]
    )
    ok, msg = export_dxf(empty_res, "dummy.dxf")
    assert not ok and "No hay placas válidas" in msg

    ok, msg = export_dxf(empty_res, "")
    assert not ok


def test_export_dxf_box(tmp_path):
    import ezdxf
    from exporter import export_dxf
    box = trimesh.creation.box(extents=[20, 20, 20])
    res_box = slice_mesh(box, plates=5, gap=2.0, thickness=3.0, axis='z')

    dxf_box_path = str(tmp_path / "tmp_test_box.dxf")
    ok, path = export_dxf(res_box, dxf_box_path, margin_mm=10.0)
    assert ok and os.path.exists(dxf_box_path)

    doc = ezdxf.readfile(dxf_box_path)
    assert doc.header['$INSUNITS'] == 4  # mm
    assert "CORTE" in doc.layers
    assert "GRABADO" in doc.layers

    msp = doc.modelspace()
    polylines = msp.query('LWPOLYLINE[layer=="CORTE"]')
    assert len(polylines) == 5
    for poly in polylines:
        assert poly.is_closed


def test_export_dxf_torus_holes(tmp_path):
    import ezdxf
    from exporter import export_dxf
    torus = trimesh.creation.torus(major_radius=20, minor_radius=5)
    res_torus = slice_mesh(torus, plates=3, gap=2.0, thickness=3.0, axis='z')

    dxf_torus_path = str(tmp_path / "tmp_test_torus.dxf")
    ok, _ = export_dxf(res_torus, dxf_torus_path)
    assert ok and os.path.exists(dxf_torus_path)

    doc = ezdxf.readfile(dxf_torus_path)
    msp = doc.modelspace()
    polylines = msp.query('LWPOLYLINE[layer=="CORTE"]')
    # Donut slices have an outer ring and an inner hole -> multiple polylines per slice
    assert len(polylines) >= 3


def test_export_dxf_colors_and_layers(tmp_path):
    import ezdxf
    from params import Params
    from layout import compute_layout
    from exporter import export_sheet_to_dxf

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

    dxf_path = str(tmp_path / "test_layers.dxf")
    export_sheet_to_dxf(layout.sheets[0], dxf_path)

    doc = ezdxf.readfile(dxf_path)
    assert doc.layers.get("CORTE").color == 1  # Rojo
    assert doc.layers.get("GRABADO").color == 5  # Azul

    msp = doc.modelspace()
    texts = msp.query('TEXT[layer=="GRABADO"]')
    assert any("PLACA 0" in t.dxf.text for t in texts)

    lines = msp.query('LINE[layer=="GRABADO"]')
    assert len(lines) >= 1  # Scrap tag arrow


def test_export_dxf_engrave_circles_solid_and_dashed(tmp_path):
    import ezdxf
    from params import Params
    from discs import DiscManager
    from layout import compute_layout
    from exporter import export_sheet_to_dxf

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
    dm = DiscManager()
    dm.add_disc(hueco=0, x=30.0, y=30.0, diameter=6.0, max_gap=0)

    params = Params(sheet_w=600.0, sheet_h=400.0, engrave_clearance=0.3)
    layout = compute_layout(res, params, dm)

    dxf_path = str(tmp_path / "test_circles.dxf")
    export_sheet_to_dxf(layout.sheets[0], dxf_path)

    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    circles = msp.query('CIRCLE[layer=="GRABADO"]')
    # Placa 0 tiene círculo sólido (hueco 0, arriba), Placa 1 tiene punteado (hueco 0, abajo)
    assert len(circles) == 2
    # Radio esperado = (6.0 + 0.3) / 2 = 3.15
    for c in circles:
        assert round(c.dxf.radius, 2) == 3.15

    dashed = [c for c in circles if c.dxf.linetype == "DASHED"]
    solid = [c for c in circles if c.dxf.linetype != "DASHED"]
    assert len(dashed) == 1
    assert len(solid) == 1


def test_export_layout_to_dxf_files(tmp_path):
    import ezdxf
    from params import Params
    from discs import DiscManager
    from layout import compute_layout
    from exporter import export_layout_to_dxf_files

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

    out_dir = str(tmp_path / "dxf_out")
    files = export_layout_to_dxf_files(layout, out_dir, base_name="test_proj")
    assert len(files) == 2
    assert all(os.path.exists(f) for f in files)
    assert "hoja_1_placas.dxf" in files[0]
    assert "hoja_2_discos.dxf" in files[1]

    # Validar hoja de discos
    doc_discs = ezdxf.readfile(files[1])
    msp = doc_discs.modelspace()
    cut_circles = msp.query('CIRCLE[layer=="CORTE"]')
    assert len(cut_circles) == 1
    rects = msp.query('LWPOLYLINE[layer=="GRABADO"]')
    assert len(rects) >= 1  # Bandeja de discos


def test_disc_trays_single_rect_per_plate_and_widened_offset():
    """
    Valida que:
    1. Hay un único rectángulo delimitador grabado por cada placa (hueco).
    2. El offset es amplio (al menos 4.0 mm) y ningún rectángulo azul toca ni cruza círculos rojos.
    3. Ninguna bandeja se solapa con otra bandeja en la hoja.
    """
    from shapely.geometry import box as s_box, Point
    from discs import DiscManager
    from params import Params
    from layout import compute_layout
    from exporter import sheet_to_svg_string

    # Simular escultura con 8 placas
    plates = 8
    boxes = [[Polygon([(0, 0), (60, 0), (60, 40), (0, 40)])] for _ in range(plates)]
    res = SliceResult(
        polygons=boxes,
        empty_plates=[],
        original_bounds=(0, 60),
        assembled_height=60.0,
        auto_scale=1.0,
        warnings=[]
    )
    dm = DiscManager()
    # Agregar discos en placas 0, 1, 2, 3, 4 con diferentes diámetros
    for h in range(5):
        for idx in range(3):
            dm.add_disc(hueco=h, x=15.0 + idx * 10, y=15.0 + idx * 5, diameter=6.0 + h * 1.0, max_gap=0)

    params = Params(plates=plates, thickness=3.0, gap=3.0, sheet_w=600.0, sheet_h=400.0, sheet_margin=10.0, part_gap=5.0)
    layout = compute_layout(res, params, dm)

    all_trays = []
    for s in layout.sheets:
        for g in s.disc_groups:
            assert g.bounds != (0.0, 0.0, 0.0, 0.0)
            gx1, gy1, gx2, gy2 = g.bounds
            tray_poly = s_box(gx1, gy1, gx2, gy2)
            all_trays.append((g.hueco, tray_poly, g))

            # Verificar que los círculos de corte (rojos) tienen al menos 4.0 mm de margen del rectángulo (azul)
            for d in g.discs:
                r = d.cut_diameter / 2.0
                assert d.center_x - r >= gx1 + 3.99, f"Placa {g.hueco}: disco demasiado cerca del borde izquierdo del rectángulo"
                assert d.center_x + r <= gx2 - 3.99, f"Placa {g.hueco}: disco demasiado cerca del borde derecho del rectángulo"
                assert d.center_y - r >= gy1 + 3.99, f"Placa {g.hueco}: disco demasiado cerca del borde superior del rectángulo"
                assert d.center_y + r <= gy2 - 3.99, f"Placa {g.hueco}: disco demasiado cerca del borde inferior del rectángulo"

    # Verificar que los rectángulos nunca se solapan entre sí
    for i in range(len(all_trays)):
        h1, poly1, g1 = all_trays[i]
        for j in range(i + 1, len(all_trays)):
            h2, poly2, g2 = all_trays[j]
            assert poly1.intersection(poly2).area == 0.0, f"Bandejas de placa {h1} y {h2} no deben solaparse"
            for d in g1.discs:
                r = d.cut_diameter / 2.0
                disc_circle = Point(d.center_x, d.center_y).buffer(r)
                assert not disc_circle.intersects(poly2.boundary), f"Círculo de placa {h1} no debe tocar contorno de placa {h2}"

    # Validar representación SVG
    for s in layout.sheets:
        if s.disc_groups:
            svg_str = sheet_to_svg_string(s)
            assert '<rect' in svg_str
            for g in s.disc_groups:
                assert g.label_text in svg_str




