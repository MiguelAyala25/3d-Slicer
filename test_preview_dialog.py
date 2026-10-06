"""
test_preview_dialog.py — Pruebas unitarias para Fase 4: Vista Previa de Exportación (preview_dialog.py).
"""

import sys
import os
from unittest.mock import patch
import pytest
from shapely.geometry import box, Polygon

os.environ["QT_QPA_PLATFORM"] = "offscreen"
from PySide6.QtWidgets import QApplication

app = QApplication.instance() or QApplication(sys.argv)

from slicer import SliceResult
from params import Params
from discs import DiscManager
from layout import compute_layout
from preview_dialog import PreviewDialog, SvgSheetView, SheetTabWidget


def _make_dummy_slice_result(polygons_list):
    return SliceResult(
        polygons=polygons_list,
        empty_plates=[],
        original_bounds=(0.0, 100.0),
        assembled_height=100.0,
        auto_scale=1.0,
        warnings=[]
    )


def test_preview_dialog_tabs_and_metrics():
    """Valida que el diálogo cree una pestaña por hoja y reporte las medidas correctamente."""
    # gap != thickness genera 2 hojas: 1 de placas y 1 de discos
    params = Params(sheet_w=600.0, sheet_h=400.0, thickness=3.0, gap=5.0)
    p0 = [box(0, 0, 80, 80)]
    res = _make_dummy_slice_result([p0])

    dm = DiscManager()
    dm.add_disc(hueco=0, x=20.0, y=20.0, diameter=6.0, max_gap=0)

    layout = compute_layout(res, params, dm)
    assert layout.total_sheets == 2

    dialog = PreviewDialog(layout)

    # Debe haber 2 pestañas
    assert dialog.tabs.count() == 2
    assert "Placas" in dialog.tabs.tabText(0)
    assert "Discos" in dialog.tabs.tabText(1)

    # Cada pestaña tiene su SheetTabWidget con métricas visibles
    tab0 = dialog.tabs.widget(0)
    assert isinstance(tab0, SheetTabWidget)
    assert "Espacio utilizado:" in tab0.lbl_metrics.text()
    assert f"{layout.sheets[0].used_width:.1f}" in tab0.lbl_metrics.text()

    tab1 = dialog.tabs.widget(1)
    assert isinstance(tab1, SheetTabWidget)
    assert "Discos" in tab1.lbl_metrics.text()
    assert f"{layout.sheets[1].used_width:.1f}" in tab1.lbl_metrics.text()


def test_svg_sheet_view_zoom():
    """Valida los métodos de zoom y ajuste de la vista interactiva SvgSheetView."""
    params = Params(sheet_w=600.0, sheet_h=400.0)
    p0 = [box(0, 0, 50, 50)]
    res = _make_dummy_slice_result([p0])
    layout = compute_layout(res, params)

    view = SvgSheetView(layout.sheets[0])

    transform_before = view.transform()

    # Zoom in
    view.zoom(1.5)
    assert view.transform().m11() > transform_before.m11()

    # Zoom out
    view.zoom(1.0 / 1.5)
    assert abs(view.transform().m11() - transform_before.m11()) < 1e-4

    # Fit in view no debe lanzar errores
    view.fit_in_view()


def test_preview_dialog_export_all(tmp_path):
    """Valida el botón de exportación de todas las hojas a la carpeta elegida."""
    params = Params(sheet_w=600.0, sheet_h=400.0, thickness=3.0, gap=5.0)
    p0 = [box(0, 0, 50, 50)]
    res = _make_dummy_slice_result([p0])

    dm = DiscManager()
    dm.add_disc(hueco=0, x=10.0, y=10.0, diameter=6.0, max_gap=0)

    layout = compute_layout(res, params, dm)
    dialog = PreviewDialog(layout)

    out_folder = str(tmp_path / "svg_export_folder")
    os.makedirs(out_folder, exist_ok=True)

    with patch("PySide6.QtWidgets.QFileDialog.getExistingDirectory", return_value=out_folder), \
         patch("PySide6.QtWidgets.QMessageBox.information") as mock_info:
        dialog._on_export_all()
        assert mock_info.called
        assert len(dialog.exported_files) == 2
        assert all(os.path.exists(f) for f in dialog.exported_files)


def test_sheet_tab_export_this(tmp_path):
    """Valida el botón de exportar esta hoja individual como SVG."""
    params = Params(sheet_w=600.0, sheet_h=400.0)
    p0 = [box(0, 0, 50, 50)]
    res = _make_dummy_slice_result([p0])
    layout = compute_layout(res, params)
    tab = SheetTabWidget(layout.sheets[0])

    target_file = str(tmp_path / "hoja_individual.svg")
    with patch("PySide6.QtWidgets.QFileDialog.getSaveFileName", return_value=(target_file, "SVG")), \
         patch("PySide6.QtWidgets.QMessageBox.information") as mock_info:
        tab._on_export_sheet()
        assert mock_info.called
        assert os.path.exists(target_file)


def test_preview_renders_non_white_elements():
    """Valida que la vista previa SVG renderice elementos visibles (no una hoja completamente en blanco)."""
    from PySide6.QtGui import QImage, QPainter, QColor
    params = Params(sheet_w=600.0, sheet_h=400.0)
    p0 = [box(0, 0, 100, 100)]
    res = _make_dummy_slice_result([p0])
    dm = DiscManager()
    dm.add_disc(hueco=0, x=30.0, y=30.0, diameter=6.0, max_gap=0)
    layout = compute_layout(res, params, dm)

    view = SvgSheetView(layout.sheets[0])
    view.resize(800, 600)
    view.fit_in_view()

    # Renderizar la escena en una imagen
    img = QImage(800, 600, QImage.Format_ARGB32)
    img.fill(QColor("white"))
    painter = QPainter(img)
    view.render(painter)
    painter.end()

    # Debe contener píxeles de corte (rojo) o grabado (azul)
    has_colored_pixels = False
    for y in range(600):
        for x in range(800):
            c = img.pixelColor(x, y)
            # Detectar rojo de corte dominante o azul de grabado dominante
            if (c.red() > c.blue() + 40 and c.red() > c.green() + 40) or \
               (c.blue() > c.red() + 40 and c.blue() > c.green() + 40):
                has_colored_pixels = True
                break
        if has_colored_pixels:
            break

    assert has_colored_pixels, "El visor de hoja SVG debe renderizar elementos visibles (rojo de corte o azul de grabado)."

