"""
test_ui_params.py — Pruebas unitarias para la interfaz de parámetros y sincronización (Fase 1).
"""

import sys
import os
import pytest
from PySide6.QtWidgets import QApplication

# Configurar entorno headless / offscreen para Qt
os.environ["QT_QPA_PLATFORM"] = "offscreen"
app = QApplication.instance() or QApplication(sys.argv)

from ui import ControlPanel
from params import Params


def test_gap_follows_thickness_until_manually_edited():
    panel = ControlPanel()
    assert panel.spin_thickness.value() == 3.0
    assert panel.spin_gap.value() == 3.0
    assert "misma lámina" in panel.lbl_disc_sheet.text()

    # Cambiar grosor sin haber editado separación -> separación debe sincronizarse
    panel.spin_thickness.setValue(4.0)
    assert panel.spin_gap.value() == 4.0
    assert "misma lámina" in panel.lbl_disc_sheet.text()

    # Editar separación manualmente
    panel.spin_gap.setValue(6.0)
    assert panel.spin_gap.value() == 6.0
    assert "lámina aparte de 6.0 mm" in panel.lbl_disc_sheet.text()

    # Cambiar grosor de nuevo -> separación NO debe cambiar
    panel.spin_thickness.setValue(5.0)
    assert panel.spin_gap.value() == 6.0
    assert "lámina aparte de 6.0 mm" in panel.lbl_disc_sheet.text()

    # Si se vuelve a poner el mismo valor en separación
    panel.spin_gap.setValue(5.0)
    assert "misma lámina" in panel.lbl_disc_sheet.text()


def test_get_params_returns_valid_dataclass():
    panel = ControlPanel()
    panel.spin_plates.setValue(15)
    panel.spin_thickness.setValue(4.0)
    panel.spin_gap.setValue(6.0)
    panel.combo_axis.setCurrentIndex(1)  # X
    panel.spin_sheet_w.setValue(800.0)
    panel.spin_sheet_h.setValue(500.0)
    panel.spin_sheet_margin.setValue(15.0)
    panel.spin_part_gap.setValue(6.0)
    panel.spin_kerf.setValue(0.18)
    panel.spin_D_max.setValue(45.0)
    panel.spin_disc_frac.setValue(0.6)
    panel.spin_disc_min.setValue(6.0)
    panel.spin_disc_max.setValue(18.0)
    panel.spin_edge_margin.setValue(1.5)
    panel.spin_engrave_clearance.setValue(0.4)

    p = panel.get_params()
    assert isinstance(p, Params)
    assert p.plates == 15
    assert p.thickness == 4.0
    assert p.gap == 6.0
    assert p.axis == 'x'
    assert p.sheet_w == 800.0
    assert p.sheet_h == 500.0
    assert p.sheet_margin == 15.0
    assert p.part_gap == 6.0
    assert p.kerf == 0.18
    assert p.D_max == 45.0
    assert p.disc_frac == 0.6
    assert p.disc_min == 6.0
    assert p.disc_max == 18.0
    assert p.edge_margin == 1.5
    assert p.engrave_clearance == 0.4
    assert p.disc_thickness == 6.0
    assert p.discs_separate_sheet is True


def test_params_changed_signal_emits_params():
    panel = ControlPanel()
    panel.btn_apply.setEnabled(True)
    panel.spin_plates.setValue(8)
    panel.spin_thickness.setValue(3.0)

    emitted_params = []
    panel.params_changed.connect(lambda p: emitted_params.append(p))

    panel.btn_apply.click()
    assert len(emitted_params) == 1
    assert isinstance(emitted_params[0], Params)
    assert emitted_params[0].plates == 8
    assert emitted_params[0].thickness == 3.0


def test_new_controls_invalidate_result():
    panel = ControlPanel()
    # Simular exportación habilitada
    panel.btn_export_svg.setEnabled(True)

    panel.spin_sheet_w.setValue(900.0)
    assert not panel.btn_export_svg.isEnabled()
    assert "Parámetros modificados" in panel.lbl_info.text()

    panel.btn_export_svg.setEnabled(True)
    panel.spin_D_max.setValue(35.0)
    assert not panel.btn_export_svg.isEnabled()

    panel.btn_export_svg.setEnabled(True)
    panel.spin_kerf.setValue(0.20)
    assert not panel.btn_export_svg.isEnabled()


def test_collapsible_sections_toggle():
    panel = ControlPanel()
    # Ambas secciones inician colapsadas
    assert panel.section_sheet.content_widget.isHidden()
    assert "▶" in panel.section_sheet.toggle_btn.text()
    assert panel.section_cols.content_widget.isHidden()
    assert "▶" in panel.section_cols.toggle_btn.text()

    # Abrir sección Hoja
    panel.section_sheet.toggle_btn.click()
    assert not panel.section_sheet.content_widget.isHidden()
    assert "▼" in panel.section_sheet.toggle_btn.text()

    # Cerrar sección Hoja
    panel.section_sheet.toggle_btn.click()
    assert panel.section_sheet.content_widget.isHidden()
    assert "▶" in panel.section_sheet.toggle_btn.text()
