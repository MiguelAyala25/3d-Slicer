"""
ui.py — Panel de controles lateral PySide6 para Escultura de Planos Seriados.
Gestiona inputs del usuario, validaciones visuales e invalidación de estado.
"""

from typing import Optional
from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QFormLayout, QHBoxLayout, QLabel,
    QPushButton, QSpinBox, QDoubleSpinBox, QComboBox, QFileDialog,
    QMessageBox, QScrollArea, QGroupBox
)
from PySide6.QtCore import Signal, Qt
from slicer import SliceResult
from params import Params


class CollapsibleSection(QWidget):
    """
    Sección colapsable estilo desplegable con botón toggle (▶ / ▼).
    Permite abrir/cerrar secciones para evitar sobrecargar la interfaz.
    """
    def __init__(self, title: str, collapsed: bool = True, parent=None):
        super().__init__(parent)
        self._is_collapsed = collapsed
        self._title = title

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 2, 0, 2)
        main_layout.setSpacing(4)

        self.toggle_btn = QPushButton()
        self.toggle_btn.setCursor(Qt.PointingHandCursor)
        self.toggle_btn.setStyleSheet("""
            QPushButton {
                text-align: left;
                font-weight: bold;
                padding: 6px 10px;
                border: 1px solid #555;
                border-radius: 4px;
                background-color: palette(button);
            }
            QPushButton:hover {
                background-color: palette(midlight);
            }
        """)
        self.toggle_btn.clicked.connect(self.toggle)
        main_layout.addWidget(self.toggle_btn)

        self.content_widget = QWidget()
        self.content_widget.setVisible(not collapsed)
        main_layout.addWidget(self.content_widget)

        self._update_header()

    def set_content_layout(self, layout):
        self.content_widget.setLayout(layout)

    def toggle(self):
        self._is_collapsed = not self._is_collapsed
        self.content_widget.setVisible(not self._is_collapsed)
        self._update_header()

    def _update_header(self):
        icon = "▶" if self._is_collapsed else "▼"
        self.toggle_btn.setText(f"{icon}  {self._title}")


class ControlPanel(QWidget):
    """
    Panel lateral con todos los controles de la aplicación.
    Emite señales Qt cuando el usuario realiza acciones.
    """

    # Señales
    file_loaded = Signal(str)       # ruta del archivo cargado
    params_changed = Signal(object) # emite instancia de Params
    export_requested = Signal(str)  # 'svg'

    def __init__(self, parent=None):
        super().__init__(parent)
        self._gap_manually_edited = False
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

        # --- Sección: Parámetros de corte principales ---
        layout.addSpacing(12)
        group_slice = QGroupBox("Parámetros de corte")
        form_slice = QFormLayout(group_slice)

        self.spin_plates = QSpinBox()
        self.spin_plates.setRange(2, 200)
        self.spin_plates.setValue(10)
        self.spin_plates.setSuffix(" placas")
        form_slice.addRow("Número de placas:", self.spin_plates)

        self.spin_thickness = QDoubleSpinBox()
        self.spin_thickness.setRange(0.1, 100.0)
        self.spin_thickness.setValue(3.0)
        self.spin_thickness.setSuffix(" mm")
        self.spin_thickness.setSingleStep(0.5)
        form_slice.addRow("Grosor del acrílico:", self.spin_thickness)

        self.spin_gap = QDoubleSpinBox()
        self.spin_gap.setRange(0.1, 1000.0)
        self.spin_gap.setValue(3.0)
        self.spin_gap.setSuffix(" mm")
        self.spin_gap.setSingleStep(0.5)
        form_slice.addRow("Separación entre placas:", self.spin_gap)

        self.lbl_disc_sheet = QLabel("Discos: misma lámina que placas")
        self.lbl_disc_sheet.setStyleSheet("color: #2e7d32; font-size: 11px;")
        form_slice.addRow("", self.lbl_disc_sheet)

        self.combo_axis = QComboBox()
        self.combo_axis.addItems(["Z (vertical)", "X (lateral)", "Y (frontal)"])
        form_slice.addRow("Eje de corte:", self.combo_axis)

        layout.addWidget(group_slice)

        # --- Sección colapsable: Hoja de corte ---
        layout.addSpacing(6)
        self.section_sheet = CollapsibleSection("Hoja de corte", collapsed=True)
        form_sheet = QFormLayout()

        self.spin_sheet_w = QDoubleSpinBox()
        self.spin_sheet_w.setRange(10.0, 5000.0)
        self.spin_sheet_w.setValue(600.0)
        self.spin_sheet_w.setSuffix(" mm")
        form_sheet.addRow("Ancho de hoja:", self.spin_sheet_w)

        self.spin_sheet_h = QDoubleSpinBox()
        self.spin_sheet_h.setRange(10.0, 5000.0)
        self.spin_sheet_h.setValue(400.0)
        self.spin_sheet_h.setSuffix(" mm")
        form_sheet.addRow("Alto de hoja:", self.spin_sheet_h)

        self.spin_sheet_margin = QDoubleSpinBox()
        self.spin_sheet_margin.setRange(0.0, 200.0)
        self.spin_sheet_margin.setValue(10.0)
        self.spin_sheet_margin.setSuffix(" mm")
        form_sheet.addRow("Margen de hoja:", self.spin_sheet_margin)

        self.spin_part_gap = QDoubleSpinBox()
        self.spin_part_gap.setRange(0.0, 100.0)
        self.spin_part_gap.setValue(5.0)
        self.spin_part_gap.setSuffix(" mm")
        form_sheet.addRow("Separación piezas:", self.spin_part_gap)

        self.spin_kerf = QDoubleSpinBox()
        self.spin_kerf.setRange(0.0, 5.0)
        self.spin_kerf.setValue(0.15)
        self.spin_kerf.setSingleStep(0.01)
        self.spin_kerf.setDecimals(3)
        self.spin_kerf.setSuffix(" mm")
        form_sheet.addRow("Kerf láser:", self.spin_kerf)

        self.section_sheet.set_content_layout(form_sheet)
        layout.addWidget(self.section_sheet)

        # --- Sección colapsable: Columnas y discos ---
        layout.addSpacing(6)
        self.section_cols = CollapsibleSection("Columnas y discos", collapsed=True)
        form_cols = QFormLayout()

        self.spin_disc_diameter = QDoubleSpinBox()
        self.spin_disc_diameter.setRange(1.0, 50.0)
        self.spin_disc_diameter.setValue(6.0)
        self.spin_disc_diameter.setSuffix(" mm")
        form_cols.addRow("Diámetro del disco:", self.spin_disc_diameter)

        self.spin_edge_margin = QDoubleSpinBox()
        self.spin_edge_margin.setRange(0.0, 10.0)
        self.spin_edge_margin.setValue(0.5)
        self.spin_edge_margin.setSuffix(" mm")
        form_cols.addRow("Margen al borde:", self.spin_edge_margin)

        self.spin_engrave_clearance = QDoubleSpinBox()
        self.spin_engrave_clearance.setRange(0.0, 10.0)
        self.spin_engrave_clearance.setValue(0.3)
        self.spin_engrave_clearance.setSuffix(" mm")
        form_cols.addRow("Holgura grabado:", self.spin_engrave_clearance)

        # Aliases para compatibilidad hacia atrás
        self.spin_D_max = self.spin_disc_diameter
        self.spin_disc_frac = self.spin_disc_diameter
        self.spin_disc_min = self.spin_disc_diameter
        self.spin_disc_max = self.spin_disc_diameter

        self.section_cols.set_content_layout(form_cols)
        layout.addWidget(self.section_cols)

        # --- Botón: Aplicar ---
        layout.addSpacing(10)
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

        self.btn_export_svg = QPushButton("Exportar SVG")
        self.btn_export_svg.setEnabled(False)
        layout.addWidget(self.btn_export_svg)

        # --- Sección: Advertencias ---
        self.lbl_warnings = QLabel("")
        self.lbl_warnings.setWordWrap(True)
        self.lbl_warnings.setStyleSheet("color: orange;")
        layout.addWidget(self.lbl_warnings)

        # --- Conectar señales internas ---
        self.btn_load.clicked.connect(self._on_load_clicked)
        self.btn_apply.clicked.connect(self._on_apply_clicked)
        self.btn_export_svg.clicked.connect(lambda: self.export_requested.emit('svg'))

        # Lógica de sincronización de separación vs grosor
        self.spin_thickness.valueChanged.connect(self._on_thickness_changed)
        self.spin_gap.valueChanged.connect(self._on_gap_changed)

        # Invalidar resultado cuando los parámetros cambian
        for spin in [
            self.spin_plates, self.spin_sheet_w, self.spin_sheet_h,
            self.spin_sheet_margin, self.spin_part_gap, self.spin_kerf,
            self.spin_disc_diameter, self.spin_edge_margin, self.spin_engrave_clearance
        ]:
            spin.valueChanged.connect(self._invalidate_result)

        self.combo_axis.currentIndexChanged.connect(self._invalidate_result)

        scroll.setWidget(container)
        outer_layout.addWidget(scroll)

    def _on_thickness_changed(self, val: float):
        if not self._gap_manually_edited:
            self.spin_gap.blockSignals(True)
            self.spin_gap.setValue(val)
            self.spin_gap.blockSignals(False)
        self._update_disc_sheet_label()
        self._invalidate_result()

    def _on_gap_changed(self, val: float):
        self._gap_manually_edited = True
        self._update_disc_sheet_label()
        self._invalidate_result()

    def _update_disc_sheet_label(self):
        gap = self.spin_gap.value()
        thickness = self.spin_thickness.value()
        if abs(gap - thickness) <= 0.01:
            self.lbl_disc_sheet.setText("Discos: misma lámina que placas")
            self.lbl_disc_sheet.setStyleSheet("color: #2e7d32; font-size: 11px;")
        else:
            self.lbl_disc_sheet.setText(f"Discos: lámina aparte de {gap:.1f} mm")
            self.lbl_disc_sheet.setStyleSheet("color: #1976d2; font-size: 11px;")

    def get_params(self) -> Params:
        axis_map = {0: 'z', 1: 'x', 2: 'y'}
        return Params(
            plates=self.spin_plates.value(),
            thickness=self.spin_thickness.value(),
            gap=self.spin_gap.value(),
            axis=axis_map[self.combo_axis.currentIndex()],
            sheet_w=self.spin_sheet_w.value(),
            sheet_h=self.spin_sheet_h.value(),
            sheet_margin=self.spin_sheet_margin.value(),
            part_gap=self.spin_part_gap.value(),
            kerf=self.spin_kerf.value(),
            disc_diameter=self.spin_disc_diameter.value(),
            edge_margin=self.spin_edge_margin.value(),
            engrave_clearance=self.spin_engrave_clearance.value()
        )

    def _on_load_clicked(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Cargar modelo 3D", "", "Modelos 3D (*.obj *.stl)"
        )
        if path:
            self.file_loaded.emit(path)

    def _on_apply_clicked(self):
        self.params_changed.emit(self.get_params())

    def _invalidate_result(self):
        """
        Se llama cuando cualquier parámetro cambia.
        Deshabilita los botones de exportación para forzar al usuario a re-aplicar el corte.
        """
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

        self.btn_export_svg.setEnabled(True)

    def show_error(self, message: str):
        QMessageBox.critical(self, "Error", message)

    def show_warning(self, message: str):
        QMessageBox.warning(self, "Advertencia", message)
