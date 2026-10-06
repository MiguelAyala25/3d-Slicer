"""
test_params.py — Pruebas unitarias para el modelo de parámetros (Fase 0).
"""

import pytest
from params import Params


def test_params_default_values():
    p = Params()
    assert p.plates == 10
    assert p.thickness == 3.0
    assert p.gap == 3.0
    assert p.axis == 'z'
    assert p.sheet_w == 600.0
    assert p.sheet_h == 400.0
    assert p.sheet_margin == 10.0
    assert p.part_gap == 5.0
    assert p.kerf == 0.15
    assert p.disc_diameter == 6.0
    assert p.engrave_clearance == 0.3


def test_disc_thickness_always_equals_gap():
    p = Params(gap=4.5)
    assert p.disc_thickness == 4.5
    p.gap = 6.0
    assert p.disc_thickness == 6.0


def test_discs_separate_sheet():
    # Mismo espesor (tolerancia <= 0.01) -> False (misma lámina)
    p1 = Params(thickness=3.0, gap=3.0)
    assert not p1.discs_separate_sheet

    p1_near = Params(thickness=3.0, gap=3.005)
    assert not p1_near.discs_separate_sheet

    # Distinto espesor -> True (lámina aparte)
    p2 = Params(thickness=3.0, gap=6.0)
    assert p2.discs_separate_sheet

    p3 = Params(thickness=5.0, gap=3.0)
    assert p3.discs_separate_sheet
