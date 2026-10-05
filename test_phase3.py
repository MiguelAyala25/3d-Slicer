"""
test_phase3.py — Suite de pruebas automatizadas para la Fase 3 (Visor 3D y UI).
Verifica viewer.py, ui.py y main.py incluyendo invalidación de estado,
detección de unidades, fallback a wireframe y orquestación completa.
"""

import sys
import os
from unittest.mock import patch, MagicMock

# Configurar entorno headless / offscreen para Qt
os.environ["QT_QPA_PLATFORM"] = "offscreen"

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import numpy as np
import trimesh
from shapely.geometry import Polygon
from PySide6.QtWidgets import QApplication

# Asegurar instancia única de QApplication para todo el test suite
app = QApplication.instance() or QApplication(sys.argv)

from slicer import slice_mesh, SliceResult
from viewer import SculptureViewer, _hue_to_rgb, _extrude_polygon
from ui import ControlPanel
from main import MainWindow
from supports import Column, SupportResult, SupportWarning


def test_viewer_utilities():
    print("[1] Probando utilidades del visor (_hue_to_rgb, _extrude_polygon)...")
    # Hue to RGB
    rgb = _hue_to_rgb(0.5)
    assert len(rgb) == 3, "Debe retornar 3 componentes RGB"
    assert all(0.0 <= c <= 1.0 for c in rgb), "Componentes RGB deben estar entre 0 y 1"

    # Extrusión de polígono simple
    poly = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    extruded = _extrude_polygon(poly, thickness=3.0, position=5.0)
    assert extruded is not None, "Extrusión de polígono simple no debe ser None"
    assert len(extruded.vertices) > 0, "El mesh extruido debe tener vértices"
    # Verificar que esté trasladado en Z a position (z min debe ser ~5.0 y max ~8.0)
    z_min = extruded.bounds[0][2]
    z_max = extruded.bounds[1][2]
    assert np.isclose(z_min, 5.0, atol=1e-3), f"z_min esperado 5.0, obtenido {z_min}"
    assert np.isclose(z_max, 8.0, atol=1e-3), f"z_max esperado 8.0, obtenido {z_max}"

    # Extrusión de polígono con hueco
    poly_hole = Polygon([(0, 0), (20, 0), (20, 20), (0, 20)], [[(5, 5), (15, 5), (15, 15), (5, 15)]])
    extruded_hole = _extrude_polygon(poly_hole, thickness=2.0, position=0.0)
    assert extruded_hole is not None, "Extrusión con hueco debe funcionar"
    assert len(extruded_hole.vertices) > 8, "Debe tener más vértices por el hueco"

    # Geometría inválida debe retornar None sin lanzar excepción
    assert _extrude_polygon(None, 3.0, 0.0) is None
    print("[OK] Utilidades del visor verificadas con éxito.")


def test_sculpture_viewer():
    print("\n[2] Probando widget SculptureViewer...")
    viewer = SculptureViewer()
    assert viewer.view_original is not None
    assert viewer.view_sliced is not None

    # Renderizar mesh original
    box = trimesh.creation.box(extents=[10, 10, 10])
    viewer.show_original_mesh(box)
    assert len(viewer.view_original.items) > 0, "view_original debe contener items después de show_original_mesh"

    # Renderizar resultado rebanado sin soportes
    res = slice_mesh(box, plates=3, gap=2.0, thickness=3.0, axis='z')
    wireframe_count = viewer.show_sliced_result(res, thickness=3.0, gap=2.0)
    assert wireframe_count == 0, f"No se esperaban wireframes en cubo simple, obtenidos {wireframe_count}"
    assert len(viewer.view_sliced.items) >= 3, "view_sliced debe tener al menos 3 items"

    # Renderizar con soportes (columnas continuas y escalonadas)
    col_reused = Column(level=0, x=0.0, y=0.0, diameter=6.0, reused=True)
    col_stepped = Column(level=1, x=2.0, y=2.0, diameter=8.0, reused=False)
    sup = SupportResult(columns=[col_reused, col_stepped], warnings=[])
    viewer.show_sliced_result(res, thickness=3.0, gap=2.0, supports=sup)
    # Deben estar las 3 placas + 2 cilindros = al menos 5 items
    assert len(viewer.view_sliced.items) >= 5, "view_sliced debe contener placas y cilindros de soporte"

    # Probar highlight_position
    viewer.highlight_position(level=0, x=0.0, y=0.0, thickness=3.0, gap=2.0)
    assert viewer._highlight_item is not None, "highlight_item debe crearse"
    first_hl = viewer._highlight_item
    # Re-highlight en otra posición debe reemplazar el anterior
    viewer.highlight_position(level=1, x=2.0, y=2.0, thickness=3.0, gap=2.0)
    assert viewer._highlight_item is not None
    assert viewer._highlight_item is not first_hl, "highlight_item anterior debe haber sido reemplazado"

    # Probar fallback a wireframe forzando un polígono problemático
    mock_res = SliceResult(
        polygons=[[Polygon([(0, 0), (1, 1), (0, 0)])]],  # polígono colapsado / degenerate
        empty_plates=[],
        original_bounds=(0, 10),
        assembled_height=10.0,
        auto_scale=1.0,
        warnings=[]
    )
    with patch("viewer._extrude_polygon", return_value=None):
        wf_count = viewer.show_sliced_result(mock_res, thickness=3.0, gap=2.0)
        assert wf_count == 1, f"Debe registrar 1 wireframe fallback, obtenido {wf_count}"

    print("[OK] SculptureViewer verificado con éxito.")


def test_control_panel_signals_and_invalidation():
    print("\n[3] Probando ControlPanel, señales e invalidación de estado...")
    panel = ControlPanel()

    # Estado inicial
    assert not panel.btn_apply.isEnabled(), "btn_apply debe iniciar deshabilitado"
    assert not panel.btn_export_svg.isEnabled(), "btn_export_svg debe iniciar deshabilitado"
    assert panel.spin_plates.value() == 10
    assert panel.spin_gap.value() == 3.0
    assert panel.spin_thickness.value() == 3.0
    assert panel.combo_axis.currentIndex() == 0  # Z

    # Cargar archivo simulado
    panel.set_file_label("modelo.obj", repaired=False, warning="")
    assert panel.btn_apply.isEnabled(), "btn_apply debe habilitarse tras cargar archivo"
    assert "✓ modelo.obj" in panel.lbl_file.text()

    # Simular resultado exitoso
    box = trimesh.creation.box(extents=[10, 10, 10])
    res = slice_mesh(box, plates=4, gap=2.0, thickness=3.0, axis='z')
    panel.set_result_info(res, plates=4, gap=2.0, thickness=3.0)
    assert panel.btn_export_svg.isEnabled(), "btn_export_svg debe habilitarse tras set_result_info"
    assert "Placas válidas: 4 / 4" in panel.lbl_info.text()

    # Probar invalidación al cambiar número de placas
    panel.spin_plates.setValue(12)
    assert not panel.btn_export_svg.isEnabled(), "Exportación SVG debe invalidarse al cambiar plates"
    assert "Parámetros modificados" in panel.lbl_info.text()

    # Re-habilitar y probar invalidación al cambiar separación
    panel.set_result_info(res, plates=4, gap=2.0, thickness=3.0)
    panel.spin_gap.setValue(6.0)
    assert not panel.btn_export_svg.isEnabled(), "Exportación SVG debe invalidarse al cambiar gap"

    # Re-habilitar y probar invalidación al cambiar grosor
    panel.set_result_info(res, plates=4, gap=2.0, thickness=3.0)
    panel.spin_thickness.setValue(4.0)
    assert not panel.btn_export_svg.isEnabled(), "Exportación SVG debe invalidarse al cambiar thickness"

    # Re-habilitar y probar invalidación al cambiar eje
    panel.set_result_info(res, plates=4, gap=2.0, thickness=3.0)
    panel.combo_axis.setCurrentIndex(1)  # X
    assert not panel.btn_export_svg.isEnabled(), "Exportación SVG debe invalidarse al cambiar axis"

    # Re-habilitar mediante resultado para probar emisión de señales
    panel.set_result_info(res, plates=4, gap=2.0, thickness=3.0)

    # Probar emisión de señales
    received_params = []
    panel.params_changed.connect(lambda p: received_params.append(p))
    panel.btn_apply.click()
    assert len(received_params) == 1, "btn_apply debe emitir params_changed"
    assert (received_params[0].plates, received_params[0].gap, received_params[0].thickness, received_params[0].axis) == (12, 6.0, 4.0, 'x')

    export_events = []
    panel.export_requested.connect(lambda fmt: export_events.append(fmt))
    panel.btn_export_svg.click()
    assert export_events == ['svg']

    # Probar avisos interactivos y emisión de warning_selected
    warn1 = SupportWarning(kind="thin", level=0, x=1.5, y=2.5, message="Nivel 0: zona estrecha en (1.5, 2.5)")
    sup_warn = SupportResult(columns=[Column(0, 0.0, 0.0, 6.0, True)], warnings=[warn1])
    panel.set_result_info(res, plates=4, gap=2.0, thickness=3.0, supports=sup_warn)
    assert panel.list_warnings.count() == 1, "Debe haber 1 aviso en list_warnings"
    assert "Discos totales: 1" in panel.lbl_info.text()

    selected_warnings = []
    panel.warning_selected.connect(lambda lvl, x, y: selected_warnings.append((lvl, x, y)))
    item = panel.list_warnings.item(0)
    panel.list_warnings.itemClicked.emit(item)
    assert len(selected_warnings) == 1
    assert selected_warnings[0] == (0, 1.5, 2.5)

    print("[OK] ControlPanel e invalidación de estado verificados con éxito.")


def test_main_window_integration():
    print("\n[4] Probando integración de MainWindow...")
    window = MainWindow()

    mock_critical = MagicMock()
    mock_warning = MagicMock()
    mock_info = MagicMock()

    with patch.object(window.panel, "show_error", mock_critical), \
         patch.object(window.panel, "show_warning", mock_warning), \
         patch("PySide6.QtWidgets.QMessageBox.information", mock_info):

        # 4.1 Carga de archivo inexistente
        window._on_file_loaded("archivo_que_no_existe.obj")
        assert mock_critical.called, "Debe mostrar error con archivo inexistente"
        assert window._mesh is None
        mock_critical.reset_mock()

        # 4.2 Carga de archivo no soportado
        window._on_file_loaded("README.md")
        assert mock_critical.called, "Debe mostrar error con extensión no soportada"
        mock_critical.reset_mock()

        # 4.3 Carga de modelo válido: test_l_block.obj
        assert os.path.exists("test_l_block.obj"), "test_l_block.obj debe existir"
        window._on_file_loaded("test_l_block.obj")
        assert window._mesh is not None, "El mesh debe haberse cargado"
        assert window.panel.btn_apply.isEnabled(), "btn_apply debe estar habilitado"
        assert not window.panel.btn_export_svg.isEnabled(), "Exportación no debe habilitarse antes de cortar"

        # 4.4 Intentar exportar antes de cortar
        window._on_export_requested("svg")
        assert mock_critical.called, "Debe mostrar error al intentar exportar sin cortar"
        mock_critical.reset_mock()

        # 4.5 Ejecutar corte con parámetros inválidos
        window._on_params_changed(plates=1, gap=2.0, thickness=3.0, axis='z')
        assert mock_critical.called, "Debe mostrar error con plates=1"
        mock_critical.reset_mock()

        # 4.6 Ejecutar corte exitoso
        window._on_params_changed(plates=5, gap=2.0, thickness=3.0, axis='z')
        assert window._result is not None, "Resultado de corte debe existir"
        assert window._supports is not None, "Supports deben haberse calculado"
        assert len(window._supports.columns) > 0, "Debe haber columnas generadas para el modelo"
        assert window.panel.btn_export_svg.isEnabled(), "Botón exportar SVG debe estar habilitado"

        # 4.6b Probar selección de aviso y resaltado en visor
        window._on_warning_selected(level=0, x=0.0, y=0.0)
        assert window.viewer._highlight_item is not None, "El visor debe resaltar la posición seleccionada"

        # 4.7 Exportar SVG desde MainWindow
        svg_out = "tmp_phase3_test.svg"
        if os.path.exists(svg_out):
            os.remove(svg_out)

        window._on_export_requested("svg", file_path=svg_out)
        assert os.path.exists(svg_out), f"SVG debe haber sido creado en {svg_out}"
        assert mock_info.called, "Debe informar éxito de exportación SVG"
        mock_info.reset_mock()

        # Limpiar archivo temporal
        if os.path.exists(svg_out):
            os.remove(svg_out)

        # 4.8 Invalidación al cargar un segundo modelo
        # Crear modelo temporal
        temp_obj = "tmp_second_model.obj"
        box = trimesh.creation.box(extents=[15, 15, 15])
        box.export(temp_obj)

        window._on_file_loaded(temp_obj)
        assert window._result is None, "Resultado anterior debe ser invalidado al cargar nuevo archivo"
        assert window._supports is None, "Supports anteriores deben ser invalidados al cargar nuevo archivo"
        assert window.panel.list_warnings.count() == 0, "Lista de avisos debe limpiarse al recargar"
        assert not window.panel.btn_export_svg.isEnabled(), "Exportación debe ser deshabilitada"

        if os.path.exists(temp_obj):
            os.remove(temp_obj)

        # 4.9 Detección de unidades heurística
        # Modelo gigante (>2000 unidades)
        giant_obj = "tmp_giant.obj"
        giant_mesh = trimesh.creation.box(extents=[3000, 100, 100])
        giant_mesh.export(giant_obj)
        window._on_file_loaded(giant_obj)
        assert "3000" in window.panel.lbl_warnings.text() or "milímetros" in window.panel.lbl_warnings.text()

        if os.path.exists(giant_obj):
            os.remove(giant_obj)

        # Modelo diminuto (<0.1 unidades)
        tiny_obj = "tmp_tiny.obj"
        tiny_mesh = trimesh.creation.box(extents=[0.05, 0.05, 0.05])
        tiny_mesh.export(tiny_obj)
        window._on_file_loaded(tiny_obj)
        assert "metros" in window.panel.lbl_warnings.text() or "0.05" in window.panel.lbl_warnings.text()

        if os.path.exists(tiny_obj):
            os.remove(tiny_obj)

    print("[OK] Integración de MainWindow y flujos de usuario verificados con éxito.")


def run_tests():
    print("=" * 60)
    print("EJECUTANDO PRUEBAS DE FASE 3 -- Visor 3D y UI")
    print("=" * 60)
    test_viewer_utilities()
    test_sculpture_viewer()
    test_control_panel_signals_and_invalidation()
    test_main_window_integration()
    print("\n" + "=" * 60)
    print("TODAS LAS PRUEBAS DE FASE 3 PASARON EXITOSAMENTE")
    print("=" * 60)


if __name__ == "__main__":
    run_tests()
