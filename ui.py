"""
ui.py — Panel de controles lateral PySide6 para Escultura de Planos Seriados.
Gestiona inputs del usuario, validaciones visuales e invalidación de estado.
"""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QFormLayout, QHBoxLayout, QLabel,
    QPushButton, QSpinBox, QDoubleSpinBox, QComboBox, QFileDialog,
    QMessageBox, QScrollArea
)
from PySide6.QtCore import Signal, Qt
from slicer import SliceResult


class ControlPanel(QWidget):
    """
    Panel lateral con todos los controles de la aplicación.
    Emite señales Qt cuando el usuario realiza acciones.
    """

    # Señales
    file_loaded = Signal(str)                          # ruta del archivo cargado
    params_changed = Signal(int, float, float, str)    # plates, gap, thickness, axis
    export_requested = Signal(str)                     # 'dxf' o 'svg'

    def __init__(self, parent=None):
        super().__init__(parent)
        self._build_ui()

    def _build_ui(self):
        outer_layout = QVBoxLayout(self)
        outer_layout.setContentsMargins(0, 0, 0, 0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setFrameShape(QScrollArea.NoFrame)

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setAlignment(Qt.AlignTop)

        # --- Sección: Cargar archivo ---
        layout.addWidget(QLabel("<b>Modelo 3D</b>"))

        self.btn_load = QPushButton("Cargar OBJ / STL...")
        self.lbl_file = QLabel("Ningún archivo cargado")
        self.lbl_file.setWordWrap(True)

        layout.addWidget(self.btn_load)
        layout.addWidget(self.lbl_file)

        # --- Sección: Parámetros ---
        layout.addSpacing(12)
        layout.addWidget(QLabel("<b>Parámetros de corte</b>"))

        form = QFormLayout()

        self.spin_plates = QSpinBox()
        self.spin_plates.setRange(2, 200)
        self.spin_plates.setValue(10)
        self.spin_plates.setSuffix(" placas")
        form.addRow("Número de placas:", self.spin_plates)

        self.spin_gap = QDoubleSpinBox()
        self.spin_gap.setRange(0.0, 1000.0)
        self.spin_gap.setValue(5.0)
        self.spin_gap.setSuffix(" mm")
        self.spin_gap.setSingleStep(0.5)
        form.addRow("Separación entre placas:", self.spin_gap)

        self.spin_thickness = QDoubleSpinBox()
        self.spin_thickness.setRange(0.1, 100.0)
        self.spin_thickness.setValue(3.0)
        self.spin_thickness.setSuffix(" mm")
        self.spin_thickness.setSingleStep(0.5)
        form.addRow("Grosor del acrílico:", self.spin_thickness)

        self.combo_axis = QComboBox()
        self.combo_axis.addItems(["Z (vertical)", "X (lateral)", "Y (frontal)"])
        form.addRow("Eje de corte:", self.combo_axis)

        layout.addLayout(form)

        # --- Botón: Aplicar ---
        self.btn_apply = QPushButton("✓ Aplicar corte")
        self.btn_apply.setEnabled(False)  # se habilita solo cuando hay archivo cargado
        layout.addWidget(self.btn_apply)

        # --- Sección: Info de resultado ---
        layout.addSpacing(12)
        layout.addWidget(QLabel("<b>Información del resultado</b>"))
        self.lbl_info = QLabel("—")
        self.lbl_info.setWordWrap(True)
        layout.addWidget(self.lbl_info)

        # --- Sección: Exportar ---
        layout.addSpacing(12)
        layout.addWidget(QLabel("<b>Exportar</b>"))

        self.btn_export_dxf = QPushButton("Exportar DXF")
        self.btn_export_svg = QPushButton("Exportar SVG")
        self.btn_export_dxf.setEnabled(False)
        self.btn_export_svg.setEnabled(False)

        layout.addWidget(self.btn_export_dxf)
        layout.addWidget(self.btn_export_svg)

        # --- Sección: Advertencias ---
        self.lbl_warnings = QLabel("")
        self.lbl_warnings.setWordWrap(True)
        self.lbl_warnings.setStyleSheet("color: orange;")
        layout.addWidget(self.lbl_warnings)

        # --- Conectar señales internas ---
        self.btn_load.clicked.connect(self._on_load_clicked)
        self.btn_apply.clicked.connect(self._on_apply_clicked)
        self.btn_export_dxf.clicked.connect(lambda: self.export_requested.emit('dxf'))
        self.btn_export_svg.clicked.connect(lambda: self.export_requested.emit('svg'))

        # --- Invalidar resultado cuando los parámetros cambian ---
        self.spin_plates.valueChanged.connect(self._invalidate_result)
        self.spin_gap.valueChanged.connect(self._invalidate_result)
        self.spin_thickness.valueChanged.connect(self._invalidate_result)
        self.combo_axis.currentIndexChanged.connect(self._invalidate_result)

        scroll.setWidget(container)
        outer_layout.addWidget(scroll)

    def _on_load_clicked(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Cargar modelo 3D", "", "Modelos 3D (*.obj *.stl)"
        )
        if path:
            self.file_loaded.emit(path)

    def _on_apply_clicked(self):
        axis_map = {0: 'z', 1: 'x', 2: 'y'}
        self.params_changed.emit(
            self.spin_plates.value(),
            self.spin_gap.value(),
            self.spin_thickness.value(),
            axis_map[self.combo_axis.currentIndex()]
        )

    def _invalidate_result(self):
        """
        Se llama cuando cualquier parámetro cambia.
        Deshabilita los botones de exportación para forzar al usuario a re-aplicar el corte.
        """
        self.btn_export_dxf.setEnabled(False)
        self.btn_export_svg.setEnabled(False)
        self.lbl_info.setText("⟳ Parámetros modificados — aplicá el corte para actualizar.")

    def set_file_label(self, filename: str, repaired: bool, warning: str):
        text = f"✓ {filename}"
        if repaired:
            text += " (reparado automáticamente)"
        self.lbl_file.setText(text)
        if warning:
            self.lbl_warnings.setText(f"⚠ {warning}")
        else:
            self.lbl_warnings.setText("")
        self.btn_apply.setEnabled(True)

    def set_result_info(self, result: SliceResult, plates: int, gap: float, thickness: float):
        valid_plates = [plist for plist in result.polygons if plist is not None]
        n_valid = len(valid_plates)

        if valid_plates:
            min_x = min(min(p.bounds[0] for p in plist) for plist in valid_plates)
            max_x = max(max(p.bounds[2] for p in plist) for plist in valid_plates)
            min_y = min(min(p.bounds[1] for p in plist) for plist in valid_plates)
            max_y = max(max(p.bounds[3] for p in plist) for plist in valid_plates)

            w_mm = max_x - min_x
            d_mm = max_y - min_y
            h_mm = result.assembled_height
            dim_text = f"Tamaño final: {w_mm:.1f} x {d_mm:.1f} x {h_mm:.1f} mm\n"
        else:
            dim_text = "Tamaño final: N/A\n"

        info = (
            f"Placas válidas: {n_valid} / {plates}\n"
            f"{dim_text}"
            f"Escala aplicada: {result.auto_scale:.2f}x"
        )
        self.lbl_info.setText(info)

        if result.warnings:
            self.lbl_warnings.setText("⚠ " + "\n⚠ ".join(result.warnings))

        self.btn_export_dxf.setEnabled(True)
        self.btn_export_svg.setEnabled(True)

    def show_error(self, message: str):
        QMessageBox.critical(self, "Error", message)

    def show_warning(self, message: str):
        QMessageBox.warning(self, "Advertencia", message)
