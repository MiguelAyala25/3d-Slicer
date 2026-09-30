"""
main.py — Entry point de la aplicación Escultura de Planos Seriados.
Orquesta el visor 3D, el panel de controles, la carga, el slicing y la exportación.
"""

import sys
import os
from typing import Optional
import trimesh
from PySide6.QtWidgets import QApplication, QMainWindow, QHBoxLayout, QWidget, QFileDialog, QMessageBox

from validator import validate_file, validate_params, validate_mesh
from slicer import slice_mesh
from exporter import export_dxf, export_svg
from viewer import SculptureViewer
from ui import ControlPanel


class MainWindow(QMainWindow):

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Escultura de Planos Seriados")
        self.resize(1400, 800)

        self._mesh = None
        self._result = None
        self._current_params = {}

        self._build_ui()

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        layout = QHBoxLayout(central)

        self.panel = ControlPanel()
        self.panel.setMinimumWidth(280)
        self.viewer = SculptureViewer()

        layout.addWidget(self.panel, stretch=0)   # panel lateral ~300px
        layout.addWidget(self.viewer, stretch=1)  # visor ocupa el resto

        # Conectar señales del panel de control
        self.panel.file_loaded.connect(self._on_file_loaded)
        self.panel.params_changed.connect(self._on_params_changed)
        self.panel.export_requested.connect(self._on_export_requested)

    def _on_file_loaded(self, path: str):
        # Invalidar estado anterior por completo
        self._result = None
        self._current_params = {}
        self.panel.btn_export_dxf.setEnabled(False)
        self.panel.btn_export_svg.setEnabled(False)
        self.panel.lbl_info.setText("—")
        self.panel.lbl_warnings.setText("")
        self.viewer.view_sliced.clear()

        # 1. Validar archivo
        ok, msg = validate_file(path)
        if not ok:
            self.panel.show_error(msg)
            return

        # 2. Cargar mesh
        try:
            mesh = trimesh.load(path, force='mesh')
        except Exception as e:
            self.panel.show_error(f"No se pudo cargar el archivo:\n{e}")
            return

        # 3. Validar mesh
        ok, msg, repaired = validate_mesh(mesh)
        if not ok:
            self.panel.show_error(msg)
            return

        # Detección heurística de unidades
        max_dim = max(mesh.extents) if len(mesh.extents) > 0 else 0.0
        unit_warning = ""
        if max_dim > 2000:
            unit_warning = (
                f"El modelo mide {max_dim:.0f} unidades en su dimensión mayor. "
                f"Si no está en milímetros, los resultados pueden ser inesperados."
            )
        elif max_dim < 0.1:
            unit_warning = (
                f"El modelo mide {max_dim:.4f} unidades en su dimensión mayor. "
                f"Podría estar en metros. Verificá las unidades del archivo."
            )

        # Detección informativa sobre múltiples objetos
        multi_obj_warning = ""
        try:
            scene = trimesh.load(path)
            if hasattr(scene, 'geometry') and len(scene.geometry) > 1:
                n_objs = len(scene.geometry)
                multi_obj_warning = (
                    f"El archivo contiene {n_objs} objetos. Se usarán todos. "
                    f"Si hay objetos no deseados (suelo, luces), limpiá el modelo "
                    f"en Blender y dejá solo el objeto deseado."
                )
        except Exception:
            pass  # Si falla la detección, el mesh ya se cargó correctamente

        # 4. Guardar y mostrar en el visor
        self._mesh = mesh

        combined_warning = msg if (repaired or "advertencia" in msg.lower()) else ""
        if unit_warning:
            combined_warning += ("\n" if combined_warning else "") + unit_warning
        if multi_obj_warning:
            combined_warning += ("\n" if combined_warning else "") + multi_obj_warning

        self.panel.set_file_label(
            os.path.basename(path),
            repaired=repaired,
            warning=combined_warning
        )
        self.viewer.show_original_mesh(mesh)

    def _on_params_changed(self, plates: int, gap: float, thickness: float, axis: str):
        if self._mesh is None:
            self.panel.show_error("Primero cargá un modelo 3D.")
            return

        # Validar parámetros
        ok, msg = validate_params(plates, gap, thickness)
        if not ok:
            self.panel.show_error(msg)
            return

        # Ejecutar slicing
        try:
            result = slice_mesh(
                self._mesh,
                plates=plates,
                gap=gap,
                thickness=thickness,
                axis=axis
            )
        except ValueError as e:
            self.panel.show_error(str(e))
            return
        except Exception as e:
            self.panel.show_error(f"Error inesperado durante el corte:\n{e}")
            return

        # Guardar resultado y actualizar UI
        self._result = result
        self._current_params = {
            'plates': plates, 'gap': gap,
            'thickness': thickness, 'axis': axis
        }

        self.panel.set_result_info(result, plates, gap, thickness)
        wireframe_count = self.viewer.show_sliced_result(result, thickness, gap)

        # Mostrar advertencia si hubo placas que cayeron a wireframe
        if wireframe_count > 0:
            self.panel.show_warning(
                f"{wireframe_count} placa(s) no pudieron renderizarse como sólidos "
                f"y se muestran como líneas. Esto no afecta la exportación."
            )

    def _on_export_requested(self, format_type: str, file_path: Optional[str] = None):
        if self._result is None:
            self.panel.show_error("Primero aplicá el corte antes de exportar.")
            return

        path = file_path
        if not path:
            if format_type == 'dxf':
                path, _ = QFileDialog.getSaveFileName(self, "Guardar DXF", "", "DXF (*.dxf)")
            else:
                path, _ = QFileDialog.getSaveFileName(self, "Guardar SVG", "", "SVG (*.svg)")

        if not path:
            return

        if format_type == 'dxf':
            ok, msg = export_dxf(self._result, path)
        else:
            ok, msg = export_svg(self._result, path)

        if ok:
            QMessageBox.information(self, "Exportación exitosa", f"Archivo guardado en:\n{msg}")
        else:
            self.panel.show_error(f"Error al exportar:\n{msg}")


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Escultura de Planos Seriados")
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
