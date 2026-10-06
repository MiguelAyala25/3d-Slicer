import pytest
from discs import DiscManager, Disc


def test_add_disc_incremental_id():
    manager = DiscManager()
    id1 = manager.add_disc(hueco=0, x=10.0, y=20.0, diameter=6.0)
    id2 = manager.add_disc(hueco=0, x=15.0, y=25.0, diameter=6.0)

    assert isinstance(id1, int)
    assert isinstance(id2, int)
    assert id1 == 1
    assert id2 == 2

    discs = manager.get_discs_for_gap(0)
    assert len(discs) == 2
    assert discs[0].id == 1
    assert discs[0].hueco == 0
    assert discs[0].x == 10.0
    assert discs[0].y == 20.0
    assert discs[0].diameter == 6.0


def test_move_disc():
    manager = DiscManager()
    disc_id = manager.add_disc(hueco=1, x=0.0, y=0.0, diameter=6.0)

    ok = manager.move_disc(disc_id, x=15.5, y=-5.0)
    assert ok is True

    discs = manager.get_discs_for_gap(1)
    assert len(discs) == 1
    assert discs[0].x == 15.5
    assert discs[0].y == -5.0


def test_get_discs_for_gap():
    manager = DiscManager()
    manager.add_disc(hueco=0, x=1.0, y=1.0, diameter=6.0)
    manager.add_disc(hueco=0, x=2.0, y=2.0, diameter=6.0)
    manager.add_disc(hueco=1, x=3.0, y=3.0, diameter=6.0)

    assert len(manager.get_discs_for_gap(0)) == 2
    assert len(manager.get_discs_for_gap(1)) == 1
    assert len(manager.get_discs_for_gap(2)) == 0


def test_remove_disc_and_clear():
    manager = DiscManager()
    id1 = manager.add_disc(hueco=0, x=1.0, y=1.0, diameter=6.0)
    id2 = manager.add_disc(hueco=0, x=2.0, y=2.0, diameter=6.0)

    assert manager.remove_disc(id1) is True
    assert len(manager.get_discs_for_gap(0)) == 1
    assert manager.get_disc(id1) is None
    assert manager.get_disc(id2) is not None

    manager.clear()
    assert len(manager.discs) == 0
    new_id = manager.add_disc(hueco=0, x=0.0, y=0.0, diameter=6.0)
    assert new_id == 1


def test_autocopy_to_next_gap():
    manager = DiscManager()
    # 4 huecos en total (0, 1, 2, 3), max_gap = 3
    id1 = manager.add_disc(hueco=0, x=12.0, y=14.0, diameter=6.0, max_gap=3)
    assert id1 == 1

    # Debe haber creado una copia automática en hueco 1
    gap0 = manager.get_discs_for_gap(0)
    gap1 = manager.get_discs_for_gap(1)
    assert len(gap0) == 1
    assert len(gap1) == 1
    assert gap1[0].id == 2
    assert gap1[0].x == 12.0
    assert gap1[0].y == 14.0
    assert gap1[0].diameter == 6.0

    # No debe duplicarse si ya existe un disco en esa misma posición en el piso siguiente
    id3 = manager.add_disc(hueco=0, x=12.0, y=14.0, diameter=8.0, max_gap=3)
    assert len(manager.get_discs_for_gap(1)) == 1  # Sigue habiendo solo 1 en hueco 1


def test_no_autocopy_on_last_gap():
    manager = DiscManager()
    # En el último hueco (max_gap), no hay copia arriba
    id_last = manager.add_disc(hueco=3, x=5.0, y=5.0, diameter=6.0, max_gap=3)
    assert len(manager.get_discs_for_gap(3)) == 1
    assert len(manager.get_discs_for_gap(4)) == 0


def test_total_independence_edit_move_delete():
    manager = DiscManager()
    # Crear disco con copia en piso siguiente
    id1 = manager.add_disc(hueco=0, x=10.0, y=10.0, diameter=6.0, max_gap=2)
    id2 = 2  # copia en hueco 1

    # 1. Modificar diámetro en piso 0 no afecta a la copia en piso 1
    manager.set_diameter(id1, 10.0)
    assert manager.get_disc(id1).diameter == 10.0
    assert manager.get_disc(id2).diameter == 6.0

    # 2. Mover en piso 0 no mueve la copia en piso 1
    manager.move_disc(id1, 20.0, 30.0)
    assert manager.get_disc(id1).x == 20.0
    assert manager.get_disc(id2).x == 10.0

    # 3. Borrar en piso 0 no borra la copia en piso 1
    manager.remove_disc(id1)
    assert manager.get_disc(id1) is None
    assert manager.get_disc(id2) is not None
