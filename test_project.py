"""
test_project.py — Pruebas unitarias para persistencia JSON y compatibilidad de parámetros (Etapa 1.C).
"""

import os
import json
import tempfile
import pytest
from discs import Disc, DiscManager
from project import (
    project_to_dict,
    save_project,
    load_project,
    load_project_from_dict,
    check_params_compatibility,
    PROJECT_VERSION
)


def test_project_dict_roundtrip():
    manager = DiscManager()
    id1 = manager.add_disc(hueco=0, x=10.5, y=20.25, diameter=6.0)
    id2 = manager.add_disc(hueco=1, x=-5.0, y=15.0, diameter=8.0)

    data = project_to_dict(plates=12, thickness=3.0, gap=4.5, disc_manager=manager)
    assert data["version"] == PROJECT_VERSION
    assert data["plates"] == 12
    assert data["thickness"] == 3.0
    assert data["gap"] == 4.5
    assert len(data["discs"]) == 2

    # Cargar en un gestor nuevo
    new_manager = DiscManager()
    plates, thickness, gap = load_project_from_dict(data, new_manager)

    assert plates == 12
    assert thickness == 3.0
    assert gap == 4.5
    assert len(new_manager.discs) == 2

    d1 = new_manager.get_disc(id1)
    d2 = new_manager.get_disc(id2)
    assert d1 is not None and d1.x == 10.5 and d1.y == 20.25 and d1.diameter == 6.0
    assert d2 is not None and d2.x == -5.0 and d2.y == 15.0 and d2.diameter == 8.0

    # Verificar que el siguiente id no colisione
    id3 = new_manager.add_disc(hueco=0, x=0, y=0, diameter=6.0)
    assert id3 > max(id1, id2)


def test_save_and_load_file_roundtrip(tmp_path):
    manager = DiscManager()
    manager.add_disc(hueco=2, x=1.0, y=2.0, diameter=5.5)

    filepath = str(tmp_path / "test_project.json")
    save_project(filepath, plates=8, thickness=2.5, gap=2.5, disc_manager=manager)

    assert os.path.exists(filepath)

    loaded_manager = DiscManager()
    plates, thickness, gap = load_project(filepath, loaded_manager)

    assert plates == 8
    assert thickness == 2.5
    assert gap == 2.5
    assert len(loaded_manager.discs) == 1
    assert loaded_manager.discs[0].diameter == 5.5


def test_params_compatibility_check():
    # Parámetros idénticos -> compatible
    assert check_params_compatibility(
        loaded_plates=10, loaded_gap=3.0,
        current_plates=10, current_gap=3.0
    ) is True

    # Tolerancia flotante pequeña -> compatible
    assert check_params_compatibility(
        loaded_plates=10, loaded_gap=3.005,
        current_plates=10, current_gap=3.0
    ) is True

    # Placas diferentes -> incompatible
    assert check_params_compatibility(
        loaded_plates=12, loaded_gap=3.0,
        current_plates=10, current_gap=3.0
    ) is False

    # Gap diferente -> incompatible
    assert check_params_compatibility(
        loaded_plates=10, loaded_gap=4.0,
        current_plates=10, current_gap=3.0
    ) is False
