"""
test_viewer_3d.py — Pruebas unitarias para la interacción 3D de discos, cámara y pisos (Etapa 1.A y 1.B).
"""

import sys
import os
import pytest
import numpy as np
from shapely.geometry import Polygon, box

os.environ["QT_QPA_PLATFORM"] = "offscreen"
from PySide6.QtWidgets import QApplication
from PySide6.QtCore import QPoint, QPointF, Qt, QEvent
from PySide6.QtGui import QMouseEvent

app = QApplication.instance() or QApplication(sys.argv)

from discs import DiscManager, Disc
from viewer import SlicedGLView, SculptureViewer
from slicer import SliceResult


def test_floor_navigation_and_bounds():
    view = SlicedGLView()
    # 4 placas de prueba
    view.plates_polygons = [[box(0, 0, 10, 10)] for _ in range(4)]
    view.thickness = 3.0
    view.gap = 3.0

    view.set_active_floor(0)
    assert view.active_floor == 0

    view.next_floor()
    assert view.active_floor == 1

    view.next_floor()
    assert view.active_floor == 2

    view.next_floor()
    assert view.active_floor == 3

    # No debe pasar de la última placa (3)
    view.next_floor()
    assert view.active_floor == 3

    view.prev_floor()
    assert view.active_floor == 2

    # Intentar asignar fuera de rango
    view.set_active_floor(-5)
    assert view.active_floor == 0

    view.set_active_floor(100)
    assert view.active_floor == 3


def test_mode_add_discs_status_message():
    view = SlicedGLView()
    view.plates_polygons = [[box(0, 0, 10, 10)] for _ in range(3)]
    messages = []
    view.status_message.connect(lambda msg: messages.append(msg))

    # Piso 0 (hueco 0 disponible)
    view.set_active_floor(0)
    view.set_mode_add_discs(True)
    assert len(messages) > 0
    assert "Click para colocar disco" in messages[-1]

    # En la última placa (piso 2), no hay hueco arriba
    view.set_active_floor(2)
    assert "Última placa" in messages[-1]


def test_discs_render_sync():
    view = SlicedGLView()
    manager = DiscManager()
    view.set_disc_manager(manager)
    view.thickness = 3.0
    view.gap = 4.0
    view.plates_polygons = [[box(0, 0, 20, 20)] for _ in range(3)]

    # Añadir discos
    id1 = manager.add_disc(hueco=0, x=5.0, y=5.0, diameter=6.0)
    id2 = manager.add_disc(hueco=1, x=10.0, y=10.0, diameter=6.0)

    view.update_discs_render()
    assert id1 in view._disc_items
    assert id2 in view._disc_items

    # Verificar que el toggle "Solo piso activo" actualice visibilidad
    view.set_active_floor(0)
    view.set_only_active_floor(True)
    assert view._disc_items[id1].visible() is True
    assert view._disc_items[id2].visible() is False

    view.set_only_active_floor(False)
    assert view._disc_items[id1].visible() is True
    assert view._disc_items[id2].visible() is True

    # Eliminar disco
    manager.remove_disc(id1)
    view.update_discs_render()
    assert id1 not in view._disc_items
    assert id2 in view._disc_items


def test_intersect_z():
    view = SlicedGLView()
    p0 = np.array([0.0, 0.0, 50.0])
    dir_vec = np.array([0.0, 0.0, -10.0])

    hit, t = view._intersect_z(p0, dir_vec, z_target=10.0)
    assert np.isclose(hit[2], 10.0)
    assert np.isclose(t, 4.0)

    # Rayo paralelo a Z
    dir_parallel = np.array([10.0, 0.0, 0.0])
    res = view._intersect_z(p0, dir_parallel, z_target=10.0)
    assert res is None


def test_sculpture_viewer_toolbar_and_signals():
    viewer = SculptureViewer()
    manager = DiscManager()
    viewer.set_disc_manager(manager)

    assert viewer.disc_manager is manager
    assert viewer.view_sliced.disc_manager is manager

    polys = [
        [box(-10, -10, 10, 10)],
        [box(-8, -8, 8, 8)],
        [box(-6, -6, 6, 6)]
    ]
    res = SliceResult(
        polygons=polys,
        empty_plates=[],
        original_bounds=(0.0, 18.0),
        assembled_height=18.0,
        auto_scale=1.0,
        warnings=[]
    )
    viewer.show_sliced_result(res, thickness=3.0, gap=3.0)

    assert len(viewer.view_sliced.plates_polygons) == 3
    assert viewer.view_sliced.active_floor == 0
    assert "1 / 3" in viewer.lbl_floor.text()

    # Click siguiente
    viewer.btn_next_floor.click()
    assert viewer.view_sliced.active_floor == 1
    assert "2 / 3" in viewer.lbl_floor.text()

    # Toggle Solo piso activo
    viewer.btn_solo_piso.click()
    assert viewer.view_sliced.only_active_floor is True

    # Toggle Poner discos
    viewer.btn_poner_discos.click()
    assert viewer.view_sliced.mode_add_discs is True
    assert "ON" in viewer.btn_poner_discos.text()


def test_disc_selection_hover_and_toolbar_controls():
    viewer = SculptureViewer()
    manager = DiscManager()
    viewer.set_disc_manager(manager)

    polys = [
        [box(-10, -10, 10, 10)],
        [box(-8, -8, 8, 8)]
    ]
    res = SliceResult(
        polygons=polys,
        empty_plates=[],
        original_bounds=(0.0, 12.0),
        assembled_height=12.0,
        auto_scale=1.0,
        warnings=[]
    )
    viewer.show_sliced_result(res, thickness=3.0, gap=3.0)

    # Añadir un disco en piso 0
    disc_id = manager.add_disc(hueco=0, x=0.0, y=0.0, diameter=6.0)
    viewer.view_sliced.update_discs_render()

    # Estado inicial de controles de selección
    assert viewer.btn_delete_disc.isEnabled() is False
    assert viewer.spin_selected_diam.isEnabled() is False

    # Seleccionar disco
    viewer.view_sliced.select_disc(disc_id)
    assert viewer.view_sliced.selected_disc_id == disc_id
    assert viewer.btn_delete_disc.isEnabled() is True
    assert viewer.spin_selected_diam.isEnabled() is True
    assert viewer.spin_selected_diam.value() == 6.0

    # Modificar diámetro mediante control en la UI
    viewer.spin_selected_diam.setValue(9.0)
    assert manager.get_disc(disc_id).diameter == 9.0

    # Borrar disco mediante botón en la UI
    viewer.btn_delete_disc.click()
    assert manager.get_disc(disc_id) is None
    assert viewer.view_sliced.selected_disc_id is None
    assert viewer.btn_delete_disc.isEnabled() is False
    assert viewer.spin_selected_diam.isEnabled() is False


def test_camera_orbit_mouse_drag():
    view = SlicedGLView()
    view.resize(600, 400)
    view.show()

    initial_azim = view.opts['azimuth']
    initial_elev = view.opts['elevation']

    # 1. Simular arrastre con botón izquierdo (LMB) para orbitar
    press_event = QMouseEvent(
        QEvent.Type.MouseButtonPress,
        QPointF(100, 100),
        QPointF(100, 100),
        Qt.MouseButton.LeftButton,
        Qt.MouseButton.LeftButton,
        Qt.KeyboardModifier.NoModifier
    )
    view.mousePressEvent(press_event)

    move_event = QMouseEvent(
        QEvent.Type.MouseMove,
        QPointF(130, 120),
        QPointF(130, 120),
        Qt.MouseButton.LeftButton,
        Qt.MouseButton.LeftButton,
        Qt.KeyboardModifier.NoModifier
    )
    view.mouseMoveEvent(move_event)

    # Debe haber orbitado la cámara
    assert view.opts['azimuth'] != initial_azim or view.opts['elevation'] != initial_elev

    # 2. Simular arrastre con botón central (MMB estilo Blender)
    azim_before_mmb = view.opts['azimuth']
    press_mmb = QMouseEvent(
        QEvent.Type.MouseButtonPress,
        QPointF(100, 100),
        QPointF(100, 100),
        Qt.MouseButton.MiddleButton,
        Qt.MouseButton.MiddleButton,
        Qt.KeyboardModifier.NoModifier
    )
    view.mousePressEvent(press_mmb)

    move_mmb = QMouseEvent(
        QEvent.Type.MouseMove,
        QPointF(150, 100),
        QPointF(150, 100),
        Qt.MouseButton.MiddleButton,
        Qt.MouseButton.MiddleButton,
        Qt.KeyboardModifier.NoModifier
    )
    view.mouseMoveEvent(move_mmb)

    assert view.opts['azimuth'] != azim_before_mmb
