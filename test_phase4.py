"""
test_phase4.py — Suite de pruebas exhaustivas para la Fase 4 (Validaciones y Mensajes de Error UX).
Verifica que cada uno de los 16 casos de la tabla de errores y las reglas de presentación
de mensajes (Error fatal, Advertencia, Info, UI) se cumplan a cabalidad, sin tracebacks
visibles al usuario y con textos accionables en español.
"""

import sys
import os
import shutil
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

# Instancia de QApplication para tests Qt
app = QApplication.instance() or QApplication(sys.argv)

from validator import validate_file, validate_params, validate_mesh
from slicer import slice_mesh, SliceResult
from exporter import export_svg
from viewer import SculptureViewer
from ui import ControlPanel
from main import MainWindow


def test_file_validations():
    print("\n[1] Probando validaciones de archivo (existencia y extensión)...")

    # 1.1 Archivo no existe
    ok, msg = validate_file("ruta_inexistente_123.obj")
    assert not ok, "Debe fallar si el archivo no existe"
    assert "El archivo no existe" in msg, f"Mensaje incorrecto: {msg}"
    assert "ruta_inexistente_123.obj" in msg

    # 1.2 Extensión no soportada
    temp_txt = "temp_invalid.txt"
    with open(temp_txt, "w", encoding="utf-8") as f:
        f.write("contenido plano")
    try:
        ok, msg = validate_file(temp_txt)
        assert not ok, "Debe fallar con extension no soportada"
        assert "Solo se aceptan archivos OBJ o STL" in msg, f"Mensaje incorrecto: {msg}"
        assert ".txt" in msg
    finally:
        if os.path.exists(temp_txt):
            os.remove(temp_txt)

    # 1.3 Extensión válida (.obj y .stl)
    temp_obj = "temp_valid.obj"
    with open(temp_obj, "w", encoding="utf-8") as f:
        f.write("# valid dummy obj\nv 0 0 0\n")
    try:
        ok, msg = validate_file(temp_obj)
        assert ok and msg == "", f"Debe pasar con extension OBJ: {msg}"
    finally:
        if os.path.exists(temp_obj):
            os.remove(temp_obj)

    print("[OK] Validaciones de archivo verificadas.")


def test_param_validations():
    print("\n[2] Probando validaciones de parámetros de corte...")

    # 2.1 plates < 2
    ok, msg = validate_params(plates=1, gap=2.0, thickness=3.0)
    assert not ok, "plates=1 debe ser rechazado"
    assert "Se necesitan al menos 2 placas." == msg, f"Mensaje incorrecto: {msg}"

    ok, msg = validate_params(plates=0, gap=2.0, thickness=3.0)
    assert not ok and "Se necesitan al menos 2 placas." == msg

    ok, msg = validate_params(plates=-3, gap=2.0, thickness=3.0)
    assert not ok and "Se necesitan al menos 2 placas." == msg

    # 2.2 thickness <= 0
    ok, msg = validate_params(plates=5, gap=2.0, thickness=0.0)
    assert not ok, "thickness=0 debe ser rechazado"
    assert "El grosor debe ser mayor a 0." == msg, f"Mensaje incorrecto: {msg}"

    ok, msg = validate_params(plates=5, gap=2.0, thickness=-1.5)
    assert not ok and "El grosor debe ser mayor a 0." == msg

    # 2.3 gap < 0
    ok, msg = validate_params(plates=5, gap=-0.5, thickness=3.0)
    assert not ok, "gap < 0 debe ser rechazado"
    assert "La separación entre placas no puede ser negativa." == msg, f"Mensaje incorrecto: {msg}"

    # 2.4 Parámetros válidos
    ok, msg = validate_params(plates=10, gap=0.0, thickness=3.0)
    assert ok and msg == "", "gap=0 debe ser válido"

    ok, msg = validate_params(plates=2, gap=5.0, thickness=1.0)
    assert ok and msg == "", "plates=2 debe ser válido"

    print("[OK] Validaciones de parámetros verificadas.")


def test_mesh_validations():
    print("\n[3] Probando validaciones de mesh 3D...")

    # 3.1 Mesh vacío (0 vértices)
    empty_mesh = trimesh.Trimesh(vertices=[], faces=[])
    ok, msg, repaired = validate_mesh(empty_mesh)
    assert not ok, "Mesh vacío debe ser inválido"
    assert "El modelo cargado no tiene geometría (0 vértices)." == msg, f"Mensaje incorrecto: {msg}"
    assert not repaired

    # 3.2 Mesh no watertight que no puede repararse (ej. plano abierto)
    open_mesh = trimesh.Trimesh(
        vertices=[[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0]],
        faces=[[0, 1, 2], [1, 3, 2]]
    )
    ok, msg, repaired = validate_mesh(open_mesh)
    assert ok, "Mesh no watertight no debe crashear, debe continuar"
    assert not repaired, "No debe marcarse como reparado si sigue no watertight"
    assert "El modelo tiene huecos que no pudieron repararse. Los cortes pueden ser incompletos." in msg

    # 3.3 Mesh no watertight reparable
    # Creamos un cubo watertight y quitamos 1 cara pequeña para que fill_holes lo repare
    box = trimesh.creation.box(extents=[10, 10, 10])
    hole_box = trimesh.Trimesh(vertices=box.vertices, faces=box.faces[:-1])
    ok, msg, repaired = validate_mesh(hole_box)
    assert ok, "Debe ser válido"
    assert repaired, "Debe marcarse como reparado exitosamente"
    assert "El modelo tenía huecos y fue reparado automáticamente." in msg

    # 3.4 Mesh watertight desde el inicio
    good_box = trimesh.creation.box(extents=[10, 10, 10])
    ok, msg, repaired = validate_mesh(good_box)
    assert ok and msg == "" and not repaired

    print("[OK] Validaciones de mesh verificadas.")


def test_slicer_error_cases():
    print("\n[4] Probando casos de error y advertencias en slicer...")

    # 4.1 Ningún corte produjo geometría
    # Modelo colapsado a espesor cero en eje Z
    flat_mesh = trimesh.Trimesh(
        vertices=[[0, 0, 0], [10, 0, 0], [5, 10, 0]],
        faces=[[0, 1, 2]]
    )
    # Al cortar en Z un polígono plano en Z=0 con min_area_mm2 alta
    try:
        slice_mesh(flat_mesh, plates=4, gap=2.0, thickness=3.0, axis='z', min_area_mm2=100.0)
        assert False, "Debió lanzar ValueError por falta de geometría"
    except ValueError as e:
        assert "Ningún plano de corte produjo geometría. Probá con otro eje de corte." in str(e), \
            f"Mensaje incorrecto: {e}"

    # 4.2 Algunas placas vacías (advertencia)
    # Modelo cónico o pirámide donde la punta o base con threshold alto genera placas vacías
    sphere = trimesh.creation.icosphere(radius=10.0, subdivisions=2)
    res = slice_mesh(sphere, plates=20, gap=2.0, thickness=1.0, axis='z', min_area_mm2=2000.0)
    assert len(res.empty_plates) > 0, "Debe haber placas vacías con área mínima alta"
    assert len(res.warnings) > 0, "Debe generar advertencia sobre placas vacías"
    assert "están vacías y serán omitidas" in res.warnings[0]

    print("[OK] Casos de error en slicer verificados.")


def test_exporter_error_cases():
    print("\n[5] Probando casos de error en exporter...")

    box = trimesh.creation.box(extents=[10, 10, 10])
    res = slice_mesh(box, plates=3, gap=2.0, thickness=3.0, axis='z')

    # Ruta a carpeta no escribible o archivo con nombre inválido
    # En Windows, caracteres como '?' o '*' en el nombre o ruta imposible causan error de guardado
    invalid_path_svg = "Z:\\ruta_imposible_inexistente_999\\test.svg"
    ok, msg = export_svg(res, invalid_path_svg)
    assert not ok, "Debe fallar al intentar guardar en ruta inválida SVG"
    assert "No se pudo guardar el archivo. Verificá que tenés permisos en la carpeta." in msg, \
        f"Mensaje incorrecto: {msg}"

    print("[OK] Casos de error en exporter verificados.")


def test_main_window_ux_and_error_table():
    print("\n[6] Probando cumplimiento integral de la tabla de UX en MainWindow...")

    window = MainWindow()

    mock_show_error = MagicMock()
    mock_show_warning = MagicMock()

    with patch.object(window.panel, "show_error", mock_show_error), \
         patch.object(window.panel, "show_warning", mock_show_warning):

        # CASO 1: Archivo no existe (Error fatal -> Bloquear)
        window._on_file_loaded("no_existe.obj")
        assert mock_show_error.called
        assert "El archivo no existe" in mock_show_error.call_args[0][0]
        assert window._mesh is None
        mock_show_error.reset_mock()

        # CASO 2: Extensión no soportada (Error fatal -> Bloquear)
        bad_ext = "temp_bad.xyz"
        with open(bad_ext, "w") as f:
            f.write("test")
        try:
            window._on_file_loaded(bad_ext)
            assert mock_show_error.called
            assert "Solo se aceptan archivos OBJ o STL" in mock_show_error.call_args[0][0]
            assert window._mesh is None
            mock_show_error.reset_mock()
        finally:
            if os.path.exists(bad_ext):
                os.remove(bad_ext)

        # CASO 3: Archivo corrupto / no parseable (Error fatal -> Bloquear)
        corrupt_obj = "temp_corrupt.obj"
        with open(corrupt_obj, "w") as f:
            f.write("esto no es un archivo obj valido")
        try:
            window._on_file_loaded(corrupt_obj)
            assert mock_show_error.called
            err_msg = mock_show_error.call_args[0][0]
            assert ("No se pudo leer el archivo. Verificá que sea un OBJ o STL válido." in err_msg or
                    "El modelo cargado no tiene geometría (0 vértices)." in err_msg), \
                f"Mensaje inesperado: {err_msg}"
            assert window._mesh is None
            mock_show_error.reset_mock()
        finally:
            if os.path.exists(corrupt_obj):
                os.remove(corrupt_obj)

        # CASO 4: Mesh vacío (0 vértices) (Error fatal -> Bloquear)
        empty_obj = "temp_empty.obj"
        with open(empty_obj, "w") as f:
            f.write("# empty obj\n")
        try:
            window._on_file_loaded(empty_obj)
            assert mock_show_error.called
            err_msg = mock_show_error.call_args[0][0]
            assert ("El modelo cargado no tiene geometría (0 vértices)." in err_msg or
                    "No se pudo leer el archivo" in err_msg), \
                f"Mensaje inesperado: {err_msg}"
            assert window._mesh is None
            mock_show_error.reset_mock()
        finally:
            if os.path.exists(empty_obj):
                os.remove(empty_obj)

        # CASO 5: Mesh no watertight no reparable (Advertencia -> Continuar)
        open_mesh = trimesh.Trimesh(
            vertices=[[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 10, 0]],
            faces=[[0, 1, 2], [1, 3, 2]]
        )
        open_obj = "temp_open.obj"
        open_mesh.export(open_obj)
        try:
            window._on_file_loaded(open_obj)
            # Advertencia mostrada al usuario y label actualizado
            assert mock_show_warning.called, "Debe emitir advertencia con mesh no cerrado"
            warn_msg = mock_show_warning.call_args[0][0]
            assert "huecos que no pudieron repararse" in warn_msg, f"Mensaje inesperado: {warn_msg}"
            assert "huecos que no pudieron repararse" in window.panel.lbl_warnings.text()
            assert window._mesh is not None, "El flujo debe continuar con el mesh cargado"
            assert window.panel.btn_apply.isEnabled()
            mock_show_warning.reset_mock()
        finally:
            if os.path.exists(open_obj):
                os.remove(open_obj)

        # CASO 6: Mesh no watertight reparado (Info -> Continuar)
        # Probamos llamando _on_file_loaded con un mock o archivo reparable
        box = trimesh.creation.box(extents=[10, 10, 10])
        hole_box = trimesh.Trimesh(vertices=box.vertices, faces=box.faces[:-1])
        repaired_obj = "temp_repaired.obj"
        hole_box.export(repaired_obj)
        try:
            window._on_file_loaded(repaired_obj)
            assert "reparado automáticamente" in window.panel.lbl_file.text(), \
                f"Debe indicar reparación en UI: {window.panel.lbl_file.text()}"
            assert window._mesh is not None
            assert window.panel.btn_apply.isEnabled()
        finally:
            if os.path.exists(repaired_obj):
                os.remove(repaired_obj)

        # CASO 7, 8, 9: Validaciones de parámetros (plates, thickness, gap)
        # Cargar mesh válido primero
        good_box = trimesh.creation.box(extents=[10, 10, 10])
        valid_obj = "temp_valid_box.obj"
        good_box.export(valid_obj)
        try:
            window._on_file_loaded(valid_obj)

            # plates < 2
            window._on_params_changed(plates=1, gap=2.0, thickness=3.0, axis='z')
            assert mock_show_error.called
            assert "Se necesitan al menos 2 placas." in mock_show_error.call_args[0][0]
            mock_show_error.reset_mock()

            # thickness <= 0
            window._on_params_changed(plates=5, gap=2.0, thickness=0.0, axis='z')
            assert mock_show_error.called
            assert "El grosor debe ser mayor a 0." in mock_show_error.call_args[0][0]
            mock_show_error.reset_mock()

            # gap < 0
            window._on_params_changed(plates=5, gap=-2.0, thickness=3.0, axis='z')
            assert mock_show_error.called
            assert "La separación entre placas no puede ser negativa." in mock_show_error.call_args[0][0]
            mock_show_error.reset_mock()

            # CASO 10: Ningún corte produjo geometría
            with patch("main.slice_mesh", side_effect=ValueError("Ningún plano de corte produjo geometría. Probá con otro eje de corte.")):
                window._on_params_changed(plates=5, gap=2.0, thickness=3.0, axis='z')
                assert mock_show_error.called
                assert "Ningún plano de corte produjo geometría. Probá con otro eje de corte." in mock_show_error.call_args[0][0]
                mock_show_error.reset_mock()

            # CASO 11: Algunas placas vacías (Advertencia informativa en panel)
            window._on_params_changed(plates=5, gap=2.0, thickness=3.0, axis='z')
            assert window._result is not None
            assert window.panel.btn_export_svg.isEnabled()

            # CASO 12: Error al exportar (Error fatal -> Bloquear)
            with patch("main.export_svg", return_value=(False, "No se pudo guardar el archivo. Verificá que tenés permisos en la carpeta.")):
                window._on_export_requested("svg", file_path="inaccessible.svg")
                assert mock_show_error.called
                assert "No se pudo guardar el archivo. Verificá que tenés permisos en la carpeta." in mock_show_error.call_args[0][0]
                mock_show_error.reset_mock()

            # CASO 13: Modelo con dimensiones sospechosas (>2000 o <0.1 unidades)
            giant_mesh = trimesh.creation.box(extents=[2500, 10, 10])
            giant_obj = "temp_giant.obj"
            giant_mesh.export(giant_obj)
            try:
                window._on_file_loaded(giant_obj)
                assert mock_show_warning.called
                assert "2500" in mock_show_warning.call_args[0][0]
                assert "2500" in window.panel.lbl_warnings.text()
                mock_show_warning.reset_mock()
            finally:
                if os.path.exists(giant_obj):
                    os.remove(giant_obj)

            # CASO 14: Archivo con múltiples objetos (Info en panel)
            mock_scene = MagicMock()
            mock_scene.geometry = {"obj1": trimesh.creation.box(), "obj2": trimesh.creation.box()}
            with patch("trimesh.load", side_effect=[good_box, mock_scene]):
                window._on_file_loaded(valid_obj)
                assert "contiene" in window.panel.lbl_warnings.text()
                assert "objetos" in window.panel.lbl_warnings.text()

            # CASO 15: Wireframe fallback warning
            window._on_file_loaded(valid_obj)
            with patch.object(window.viewer, "show_sliced_result", return_value=2):
                window._on_params_changed(plates=5, gap=2.0, thickness=3.0, axis='z')
                assert mock_show_warning.called
                assert "2 placa(s) no pudieron renderizarse como sólidos" in mock_show_warning.call_args[0][0]
                mock_show_warning.reset_mock()

            # CASO 16: Invalidación de estado por parámetros
            window._on_params_changed(plates=5, gap=2.0, thickness=3.0, axis='z')
            assert window.panel.btn_export_svg.isEnabled()
            # Usuario cambia slider / spinbox
            window.panel.spin_plates.setValue(8)
            assert not window.panel.btn_export_svg.isEnabled(), "Exportar SVG debe deshabilitarse"
            assert "Parámetros modificados" in window.panel.lbl_info.text()

        finally:
            if os.path.exists(valid_obj):
                os.remove(valid_obj)

    print("[OK] Tabla de UX e integración de MainWindow verificada al 100%.")


def run_tests():
    print("=" * 60)
    print("EJECUTANDO PRUEBAS DE FASE 4 -- Validaciones y Mensajes UX")
    print("=" * 60)
    test_file_validations()
    test_param_validations()
    test_mesh_validations()
    test_slicer_error_cases()
    test_exporter_error_cases()
    test_main_window_ux_and_error_table()
    print("\n" + "=" * 60)
    print("TODAS LAS PRUEBAS DE FASE 4 PASARON EXITOSAMENTE")
    print("=" * 60)


if __name__ == "__main__":
    run_tests()
