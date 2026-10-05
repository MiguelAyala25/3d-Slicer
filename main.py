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
from exporter import export_svg
from viewer import SculptureViewer
from ui import ControlPanel
from params import Params
from supports import compute_supports


class MainWindow(QMainWindow):

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Escultura de Planos Seriados")
        self.resize(1400, 800)

        self._mesh = None
        self._result = None
        self._supports = None
        self._current_params = None

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
        self.panel.warning_selected.connect(self._on_warning_selected)

    def _on_file_loaded(self, path: str):
        # Invalidar estado anterior por completo
        self._result = None
        self._supports = None
        self._current_params = None
        self.panel.btn_export_svg.setEnabled(False)
        self.panel.lbl_info.setText("—")
        self.panel.lbl_warnings.setText("")
        self.panel.list_warnings.clear()
        self.viewer.view_sliced.clear()

        # 1. Validar archivo
        ok, msg = validate_file(path)
        if not ok:
            self.panel.show_error(msg)
            return

        # 2. Cargar mesh
        try:
            mesh = trimesh.load(path, force='mesh')
            if isinstance(mesh, trimesh.Scene):
                if len(mesh.geometry) == 0:
                    self.panel.show_error("El modelo cargado no tiene geometría (0 vértices).")
                    return
                mesh = trimesh.util.concatenate(list(mesh.geometry.values()))
        except Exception:
            self.panel.show_error("No se pudo leer el archivo. Verificá que sea un OBJ o STL válido.")
            return

        if mesh is None or not isinstance(mesh, trimesh.Trimesh):
            self.panel.show_error("No se pudo leer el archivo. Verificá que sea un OBJ o STL válido.")
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

        warnings_to_show = []
        if not repaired and msg:
            warnings_to_show.append(msg)
            self.panel.show_warning(msg)

        if unit_warning:
            warnings_to_show.append(unit_warning)
            self.panel.show_warning(unit_warning)

        if multi_obj_warning:
            warnings_to_show.append(multi_obj_warning)

        combined_warning = "\n".join(warnings_to_show)

        self.panel.set_file_label(
            os.path.basename(path),
            repaired=repaired,
            warning=combined_warning
        )
        self.viewer.show_original_mesh(mesh)

    def _on_params_changed(
        self,
        params: Optional[Params] = None,
        plates: Optional[int] = None,
        gap: Optional[float] = None,
        thickness: Optional[float] = None,
        axis: Optional[str] = None
    ):
        if self._mesh is None:
            self.panel.show_error("Primero cargá un modelo 3D.")
            return

        if isinstance(params, Params):
            p = params
        elif params is not None and isinstance(params, (int, float)):
            p = Params(plates=int(params), gap=gap, thickness=thickness, axis=axis)
        elif plates is not None:
            p = Params(plates=plates, gap=gap, thickness=thickness, axis=axis)
        else:
            p = self.panel.get_params()

        # Validar parámetros
        ok, msg = validate_params(p.plates, p.gap, p.thickness)
        if not ok:
            self.panel.show_error(msg)
            return

        # Ejecutar slicing
        try:
            result = slice_mesh(
                self._mesh,
                plates=p.plates,
                gap=p.gap,
                thickness=p.thickness,
                axis=p.axis
            )
        except ValueError as e:
            self.panel.show_error(str(e))
            return
        except Exception:
            self.panel.show_error("Error inesperado durante el corte. Verificá los parámetros y la geometría del modelo.")
            return

        # Calcular soportes (columnas y discos)
        try:
            supports = compute_supports(result.polygons, p)
        except Exception:
            supports = None

        # Guardar resultado y actualizar UI
        self._result = result
        self._supports = supports
        self._current_params = p

        self.panel.set_result_info(result, p.plates, p.gap, p.thickness, supports=supports)
        wireframe_count = self.viewer.show_sliced_result(result, p.thickness, p.gap, supports=supports)

        # Mostrar advertencia si hubo placas que cayeron a wireframe
        if wireframe_count > 0:
            self.panel.show_warning(
                f"{wireframe_count} placa(s) no pudieron renderizarse como sólidos "
                f"y se muestran como líneas. Esto no afecta la exportación."
            )

    def _on_warning_selected(self, level: int, x: Optional[float], y: Optional[float]):
        if self._current_params is not None:
            self.viewer.highlight_position(
                level=level,
                x=x,
                y=y,
                thickness=self._current_params.thickness,
                gap=self._current_params.gap
            )

    def _on_export_requested(self, format_type: str = 'svg', file_path: Optional[str] = None):
        if self._result is None:
            self.panel.show_error("Primero aplicá el corte antes de exportar.")
            return

        path = file_path
        if not path:
            path, _ = QFileDialog.getSaveFileName(self, "Guardar SVG", "", "SVG (*.svg)")

        if not path:
            return

        ok, msg = export_svg(self._result, path)

        if ok:
            QMessageBox.information(self, "Exportación exitosa", f"Archivo guardado en:\n{msg}")
        else:
            self.panel.show_error(msg)


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Escultura de Planos Seriados")
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
