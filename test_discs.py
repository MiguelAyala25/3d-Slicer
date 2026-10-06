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
