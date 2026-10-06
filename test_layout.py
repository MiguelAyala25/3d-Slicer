"""
test_layout.py — Pruebas unitarias para Fase 2: Layout en Hojas (layout.py).
"""

import pytest
from shapely.geometry import box, Polygon

from slicer import SliceResult
from params import Params
from discs import DiscManager, Disc
from layout import compute_layout, validate_plate_sizes, LayoutResult, SheetLayout


def _make_dummy_slice_result(polygons_list):
    """Helper para construir un SliceResult simple."""
    return SliceResult(
        polygons=polygons_list,
        empty_plates=[],
        original_bounds=(0.0, 100.0),
        assembled_height=100.0,
        auto_scale=1.0,
        warnings=[]
    )


def test_giant_plate_raises_clear_error():
    """Valida que una placa que exceda las dimensiones útiles de la hoja emita un error claro."""
    params = Params(sheet_w=600.0, sheet_h=400.0, sheet_margin=10.0)
    # Área útil: 580 x 380 mm

    # Placa que excede el ancho (600 mm de ancho > 580 mm)
    giant_plate_w = [[box(0, 0, 590, 100)]]
    res_w = _make_dummy_slice_result(giant_plate_w)

    with pytest.raises(ValueError) as excinfo:
        compute_layout(res_w, params)
    assert "excede el área útil de la hoja" in str(excinfo.value)
    assert "590" in str(excinfo.value) or "580" in str(excinfo.value)

    # Placa que excede la altura (390 mm de alto > 380 mm)
    giant_plate_h = [[box(0, 0, 100, 390)]]
    res_h = _make_dummy_slice_result(giant_plate_h)

    with pytest.raises(ValueError) as excinfo:
        compute_layout(res_h, params)
    assert "excede el área útil de la hoja" in str(excinfo.value)


def test_plates_ordered_without_rotation():
    """Valida el acomodo secuencial en orden numérico estricto (0, 1, 2...) y sin rotar."""
    params = Params(sheet_w=600.0, sheet_h=400.0, sheet_margin=10.0, part_gap=5.0)

    # 3 placas de tamaños distintivos
    p0 = [box(0, 0, 50, 80)]
    p1 = [box(0, 0, 60, 40)]
    p2 = [box(0, 0, 70, 90)]
    res = _make_dummy_slice_result([p0, p1, p2])

    layout = compute_layout(res, params)
    assert layout.total_sheets == 1
    sheet = layout.sheets[0]
    assert len(sheet.placed_plates) == 3

    # Orden estricto
    assert sheet.placed_plates[0].plate_idx == 0
    assert sheet.placed_plates[1].plate_idx == 1
    assert sheet.placed_plates[2].plate_idx == 2

    # Conservan dimensiones exactas sin rotar (w y h coinciden con original)
    assert sheet.placed_plates[0].w == 50.0
    assert sheet.placed_plates[0].h == 80.0
    assert sheet.placed_plates[1].w == 60.0
    assert sheet.placed_plates[1].h == 40.0
    assert sheet.placed_plates[2].w == 70.0
    assert sheet.placed_plates[2].h == 90.0

    # Posicionadas de izquierda a derecha con part_gap
    # x0 = margin (10)
    # x1 = 10 + 50 + 5 = 65
    # x2 = 65 + 60 + 5 = 130
    assert sheet.placed_plates[0].x == 10.0
    assert sheet.placed_plates[1].x == 65.0
    assert sheet.placed_plates[2].x == 130.0


def test_discs_at_end_when_gap_equals_thickness_and_fits():
    """Valida que los discos se acomodan después de las placas si gap == thickness y caben."""
    params = Params(
        sheet_w=600.0, sheet_h=400.0, sheet_margin=10.0,
        part_gap=5.0, thickness=3.0, gap=3.0, kerf=0.15, engrave_clearance=0.3
    )
    # 2 placas pequeñas
    p0 = [box(0, 0, 50, 50)]
    p1 = [box(0, 0, 50, 50)]
    res = _make_dummy_slice_result([p0, p1])

    # Discos en hueco 0 (sin auto-copia con max_gap=0)
    dm = DiscManager()
    dm.add_disc(hueco=0, x=15.0, y=15.0, diameter=6.0, max_gap=0)

    layout = compute_layout(res, params, disc_manager=dm)
    # Deben caber en la misma hoja (hoja 1)
    assert layout.total_sheets == 1
    sheet = layout.sheets[0]
    assert len(sheet.placed_plates) == 2
    assert len(sheet.disc_groups) == 1

    group = sheet.disc_groups[0]
    assert group.label_text == "0→1"
    assert len(group.discs) == 1
    # Kerf compensado en el diámetro de corte del disco: 6.0 + 0.15 = 6.15
    assert group.discs[0].cut_diameter == 6.15

    # La zona de discos debe comenzar después de la fila de placas
    # placas terminan en y = margin (10) + 50 = 60
    assert sheet.disc_groups[0].label_pos[1] >= 65.0


def test_discs_separate_sheet_when_gap_differs_from_thickness():
    """Valida que si gap != thickness, los discos van obligatoriamente en una hoja independiente."""
    params = Params(
        sheet_w=600.0, sheet_h=400.0, sheet_margin=10.0,
        part_gap=5.0, thickness=3.0, gap=4.5, kerf=0.15
    )
    assert params.discs_separate_sheet is True

    p0 = [box(0, 0, 50, 50)]
    p1 = [box(0, 0, 50, 50)]
    res = _make_dummy_slice_result([p0, p1])

    dm = DiscManager()
    dm.add_disc(hueco=0, x=10.0, y=10.0, diameter=6.0, max_gap=0)

    layout = compute_layout(res, params, disc_manager=dm)
    # Debe haber 2 hojas: Hoja 0 (placas, thickness 3.0) y Hoja 1 (discos, thickness 4.5)
    assert layout.total_sheets == 2
    assert layout.sheets[0].sheet_type == "plates"
    assert layout.sheets[0].thickness == 3.0
    assert len(layout.sheets[0].placed_plates) == 2
    assert len(layout.sheets[0].disc_groups) == 0

    assert layout.sheets[1].sheet_type == "discs"
    assert layout.sheets[1].thickness == 4.5
    assert len(layout.sheets[1].placed_plates) == 0
    assert len(layout.sheets[1].disc_groups) == 1


def test_discs_pass_to_new_sheet_when_no_space_on_plate_sheet():
    """Valida que si los discos no caben en la hoja actual de placas, pasan a una nueva hoja."""
    # Hoja de altura ajustada (100 mm) donde las placas ocupan casi toda la altura
    params = Params(
        sheet_w=200.0, sheet_h=100.0, sheet_margin=10.0,
        part_gap=5.0, thickness=3.0, gap=3.0, kerf=0.15
    )
    # Placa de 80 mm de altura en hoja de 100 mm (10 margin + 80 + 10 margin = 100) -> 0 espacio vertical libre
    p0 = [box(0, 0, 80, 78)]
    res = _make_dummy_slice_result([p0])

    dm = DiscManager()
    dm.add_disc(hueco=0, x=20.0, y=20.0, diameter=10.0, max_gap=0)

    layout = compute_layout(res, params, disc_manager=dm)
    assert layout.total_sheets == 2
    assert len(layout.sheets[0].placed_plates) == 1
    assert len(layout.sheets[0].disc_groups) == 0
    assert len(layout.sheets[1].disc_groups) == 1


def test_engrave_circles_on_plates():
    """Valida que las placas lleven círculos grabados sólidos (hueco k) y punteados (hueco k-1)."""
    params = Params(
        sheet_w=600.0, sheet_h=400.0, sheet_margin=10.0,
        part_gap=5.0, thickness=3.0, gap=3.0, engrave_clearance=0.3
    )
    p0 = [box(0, 0, 80, 80)]
    p1 = [box(0, 0, 80, 80)]
    p2 = [box(0, 0, 80, 80)]
    res = _make_dummy_slice_result([p0, p1, p2])

    dm = DiscManager()
    # Disco en hueco 0 (entre placa 0 y placa 1)
    d0 = dm.add_disc(hueco=0, x=30.0, y=30.0, diameter=6.0, max_gap=0)
    # Disco en hueco 1 (entre placa 1 y placa 2)
    d1 = dm.add_disc(hueco=1, x=40.0, y=40.0, diameter=8.0, max_gap=1)

    layout = compute_layout(res, params, disc_manager=dm)
    sheet = layout.sheets[0]

    # Placa 0:
    # Solo tiene hueco 0 arriba -> círculos sólidos (is_dashed=False)
    plate0 = sheet.placed_plates[0]
    assert len(plate0.engrave_circles) == 1
    assert plate0.engrave_circles[0].is_dashed is False
    assert plate0.engrave_circles[0].diameter == 6.3  # 6.0 + 0.3
    assert plate0.label_text == "PLACA 0"

    # Placa 1:
    # Hueco 0 abajo -> círculo punteado (is_dashed=True, diámetro 6.3)
    # Hueco 1 arriba -> círculo sólido (is_dashed=False, diámetro 8.3)
    plate1 = sheet.placed_plates[1]
    assert len(plate1.engrave_circles) == 2
    dashed = [c for c in plate1.engrave_circles if c.is_dashed]
    solid = [c for c in plate1.engrave_circles if not c.is_dashed]
    assert len(dashed) == 1 and dashed[0].diameter == 6.3
    assert len(solid) == 1 and solid[0].diameter == 8.3
    assert plate1.label_text == "PLACA 1"

    # Placa 2:
    # Solo tiene hueco 1 abajo -> círculo punteado (is_dashed=True, diámetro 8.3)
    plate2 = sheet.placed_plates[2]
    assert len(plate2.engrave_circles) == 1
    assert plate2.engrave_circles[0].is_dashed is True
    assert plate2.engrave_circles[0].diameter == 8.3
    assert plate2.label_text == "PLACA 2"


def test_used_dimensions_calculation():
    """Valida el cálculo de used_width y used_height en cada hoja."""
    params = Params(sheet_w=600.0, sheet_h=400.0, sheet_margin=10.0, part_gap=5.0)
    p0 = [box(0, 0, 100, 150)]
    res = _make_dummy_slice_result([p0])

    layout = compute_layout(res, params)
    sheet = layout.sheets[0]
    # Placa colocada en (10, 10) con tamaño 100 x 150 -> max_x = 110, max_y = 160
    # Con margen de 10 mm: used_width = 120 mm, used_height = 170 mm
    assert sheet.used_width == 120.0
    assert sheet.used_height == 170.0
