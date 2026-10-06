"""
preview_dialog.py — Diálogo modal de vista previa SVG antes de la exportación final.

Reglas del proyecto:
1. Diálogo con una pestaña por archivo SVG generado (Hoja 1, Hoja 2, Hoja de Discos).
2. Vista interactiva de la hoja con zoom y pan.
3. Reporte visible de las medidas utilizadas de cada hoja (ancho x alto usado y total de hojas).
4. Botón final para exportar todos los SVG a la carpeta que seleccione el usuario.
"""

from typing import Optional, List
import os

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QPushButton,
    QTabWidget, QWidget, QFileDialog, QMessageBox,
    QGraphicsView, QGraphicsScene, QGraphicsItem, QFrame
)
from PySide6.QtCore import Qt, QByteArray, QRectF, QTimer
from PySide6.QtGui import QPainter, QColor, QPen, QBrush
from PySide6.QtSvg import QSvgRenderer

from layout import LayoutResult, SheetLayout
from exporter import sheet_to_svg_string, export_layout_to_svg_files


class SvgSheetItem(QGraphicsItem):
    """
    Elemento gráfico que renderiza fielmente el archivo SVG a escala exacta en milímetros
    utilizando QSvgRenderer sobre las coordenadas de la escena.
    """
    def __init__(self, renderer: QSvgRenderer, width: float, height: float, parent=None):
        super().__init__(parent)
        self.renderer = renderer
        self.w = width
        self.h = height

    def boundingRect(self) -> QRectF:
        return QRectF(0.0, 0.0, self.w, self.h)

    def paint(self, painter: QPainter, option, widget=None):
        self.renderer.render(painter, QRectF(0.0, 0.0, self.w, self.h))


class SvgSheetView(QGraphicsView):
    """
    Visor interactivo 2D para una hoja SVG con pan por arrastre (manita) y zoom suave.
    """
    def __init__(self, sheet: SheetLayout, parent=None):
        super().__init__(parent)
        self.sheet = sheet
        self._zoom_factor = 1.0
        self._initial_fitted = False

        self.setScene(QGraphicsScene(self))
        self.setRenderHint(QPainter.Antialiasing)
        self.setRenderHint(QPainter.SmoothPixmapTransform)
        self.setDragMode(QGraphicsView.ScrollHandDrag)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.AnchorUnderMouse)
        self.setBackgroundBrush(QBrush(QColor("#f0f0f2")))

        self._load_svg()

    def _load_svg(self):
        # Generar SVG con trazos optimizados para visualización en pantalla
        svg_str = sheet_to_svg_string(self.sheet, preview_mode=True)
        svg_bytes = QByteArray(svg_str.encode("utf-8"))

        # 1. Sombra sutil que da sensación física a la lámina de corte
        shadow_rect = QRectF(4.0, 4.0, self.sheet.sheet_w, self.sheet.sheet_h)
        self.scene().addRect(
            shadow_rect,
            QPen(Qt.NoPen),
            QBrush(QColor("#d2d2d8"))
        )

        # 2. Lámina física de material (fondo blanco con borde gris de corte)
        sheet_rect = QRectF(0.0, 0.0, self.sheet.sheet_w, self.sheet.sheet_h)
        self.scene().addRect(
            sheet_rect,
            QPen(QColor("#9c9ca4"), 1.0),
            QBrush(QColor("#ffffff"))
        )

        # 3. Margen útil de referencia visual (guía punteada sutil)
        margin = 10.0
        usable_rect = QRectF(
            margin,
            margin,
            max(1.0, self.sheet.sheet_w - 2 * margin),
            max(1.0, self.sheet.sheet_h - 2 * margin)
        )
        dashed_pen = QPen(QColor("#e4e4e8"), 0.5, Qt.DashLine)
        self.scene().addRect(usable_rect, dashed_pen, QBrush(Qt.NoBrush))

        # 4. Renderizador y elemento gráfico vectorial del SVG
        self.svg_renderer = QSvgRenderer(svg_bytes, self)
        self.svg_item = SvgSheetItem(self.svg_renderer, self.sheet.sheet_w, self.sheet.sheet_h)
        self.scene().addItem(self.svg_item)

        margin_view = 30.0
        self.setSceneRect(
            -margin_view,
            -margin_view,
            self.sheet.sheet_w + 2 * margin_view,
            self.sheet.sheet_h + 2 * margin_view
        )

    def fit_in_view(self):
        """Ajusta la hoja completa a la ventana."""
        self.fitInView(self.sceneRect(), Qt.KeepAspectRatio)

    def zoom(self, factor: float):
        """Aplica un factor de zoom multiplicativo."""
        self.scale(factor, factor)

    def wheelEvent(self, event):
        """Zoom suave con la rueda del ratón."""
        delta = event.angleDelta().y()
        if delta > 0:
            self.zoom(1.15)
        elif delta < 0:
            self.zoom(1.0 / 1.15)
        event.accept()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if not self._initial_fitted and self.width() > 100:
            self._initial_fitted = True
            self.fit_in_view()


class SheetTabWidget(QWidget):
    """Pestaña individual que contiene la vista de una hoja y sus métricas."""
    def __init__(self, sheet: SheetLayout, parent=None):
        super().__init__(parent)
        self.sheet = sheet

        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(6)

        # Barra de métricas y controles de zoom de la hoja
        info_bar = QHBoxLayout()
        info_bar.setContentsMargins(0, 0, 0, 0)

        tipo_str = "Discos" if sheet.sheet_type == "discs" else "Placas"
        n_placas = len(sheet.placed_plates)
        n_discos = sheet.total_discs

        elem_desc = f"{n_placas} placas" if sheet.sheet_type == "plates" else f"{n_discos} discos"
        if sheet.sheet_type == "plates" and n_discos > 0:
            elem_desc += f", {n_discos} discos"

        self.lbl_metrics = QLabel(
            f"<b>Hoja {sheet.sheet_index + 1} ({tipo_str})</b> — {elem_desc} | "
            f"Tamaño hoja: <b>{sheet.sheet_w:.1f} × {sheet.sheet_h:.1f} mm</b> | "
            f"Espesor: <b>{sheet.thickness:.1f} mm</b> | "
            f"Espacio utilizado: <span style='color: #2e7d32; font-weight: bold;'>"
            f"{sheet.used_width:.1f} × {sheet.used_height:.1f} mm</span>"
        )
        self.lbl_metrics.setStyleSheet("font-size: 12px;")

        btn_zoom_in = QPushButton("➕ Zoom +")
        btn_zoom_in.setFixedWidth(80)
        btn_zoom_out = QPushButton("➖ Zoom -")
        btn_zoom_out.setFixedWidth(80)
        btn_fit = QPushButton("🔍 Ajustar")
        btn_fit.setFixedWidth(80)

        info_bar.addWidget(self.lbl_metrics, stretch=1)
        info_bar.addWidget(btn_zoom_in)
        info_bar.addWidget(btn_zoom_out)
        info_bar.addWidget(btn_fit)

        # Visor gráfico
        self.viewer = SvgSheetView(sheet, self)

        btn_zoom_in.clicked.connect(lambda: self.viewer.zoom(1.2))
        btn_zoom_out.clicked.connect(lambda: self.viewer.zoom(1.0 / 1.2))
        btn_fit.clicked.connect(self.viewer.fit_in_view)

        layout.addLayout(info_bar)
        layout.addWidget(self.viewer, stretch=1)

    def showEvent(self, event):
        super().showEvent(event)
        QTimer.singleShot(20, self.viewer.fit_in_view)


class PreviewDialog(QDialog):
    """
    Diálogo modal de vista previa antes de la exportación SVG final.
    """
    def __init__(self, layout: LayoutResult, parent=None):
        super().__init__(parent)
        self.layout = layout
        self.exported_files: List[str] = []

        self.setWindowTitle("Vista Previa de Exportación SVG — Planos Seriados")
        self.resize(1050, 720)
        self.setMinimumSize(800, 550)

        self._setup_ui()

    def _setup_ui(self):
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(12, 12, 12, 12)
        root_layout.setSpacing(10)

        # Encabezado
        header_layout = QHBoxLayout()
        header_title = QLabel(
            f"<h3 style='margin:0;'>Vista Previa de Hojas ({self.layout.total_sheets} Hoja(s) en total)</h3>"
        )
        header_hint = QLabel(
            "<span style='color: #666;'>Corte: <b style='color:#d32f2f;'>Rojo</b> | "
            "Grabado: <b style='color:#1976d2;'>Azul</b> (sólido: encima, punteado: abajo) | "
            "Arrastra para desplazar, rueda para zoom</span>"
        )
        header_layout.addWidget(header_title)
        header_layout.addStretch(1)
        header_layout.addWidget(header_hint)

        root_layout.addLayout(header_layout)

        # Pestañas por hoja
        self.tabs = QTabWidget()
        for sheet in self.layout.sheets:
            tab_title = (
                f"Hoja {sheet.sheet_index + 1}: Discos"
                if sheet.sheet_type == "discs"
                else f"Hoja {sheet.sheet_index + 1}: Placas"
            )
            sheet_tab = SheetTabWidget(sheet, self.tabs)
            self.tabs.addTab(sheet_tab, tab_title)

        self.tabs.currentChanged.connect(self._on_tab_changed)
        root_layout.addWidget(self.tabs, stretch=1)

    def _on_tab_changed(self, index: int):
        widget = self.tabs.widget(index)
        if isinstance(widget, SheetTabWidget):
            QTimer.singleShot(20, widget.viewer.fit_in_view)

        # Barra inferior de acciones
        footer_layout = QHBoxLayout()
        footer_layout.setContentsMargins(0, 4, 0, 0)

        # Resumen general de medidas usadas
        sheets_summary = " | ".join(
            f"H{s.sheet_index + 1}: {s.used_width:.0f}×{s.used_height:.0f}mm"
            for s in self.layout.sheets
        )
        lbl_summary = QLabel(f"<b>Medidas usadas:</b> {sheets_summary}")
        lbl_summary.setStyleSheet("color: #444; font-size: 11px;")

        self.btn_export_all = QPushButton("💾 Exportar todos los archivos SVG...")
        self.btn_export_all.setStyleSheet("""
            QPushButton {
                background-color: #2e7d32;
                color: white;
                font-weight: bold;
                padding: 6px 16px;
                border-radius: 4px;
            }
            QPushButton:hover {
                background-color: #388e3c;
            }
        """)

        self.btn_close = QPushButton("Cerrar")
        self.btn_close.setFixedWidth(90)

        footer_layout.addWidget(lbl_summary, stretch=1)
        footer_layout.addWidget(self.btn_export_all)
        footer_layout.addWidget(self.btn_close)

        root_layout.addLayout(footer_layout)

        self.btn_export_all.clicked.connect(self._on_export_all)
        self.btn_close.clicked.connect(self.reject)

    def _on_export_all(self):
        """Abre selector de carpeta y exporta todos los archivos SVG."""
        chosen_dir = QFileDialog.getExistingDirectory(
            self,
            "Seleccionar carpeta de destino para los archivos SVG",
            ""
        )
        if not chosen_dir:
            return

        try:
            files = export_layout_to_svg_files(self.layout, chosen_dir, base_name="escultura")
            self.exported_files = files

            filenames_str = "\n".join(f"• {os.path.basename(f)}" for f in files)
            QMessageBox.information(
                self,
                "Exportación Exitosa",
                f"Se han exportado exitosamente {len(files)} archivo(s) SVG en:\n{chosen_dir}\n\n{filenames_str}"
            )
            self.accept()
        except Exception as e:
            QMessageBox.critical(
                self,
                "Error al exportar",
                f"No se pudieron guardar los archivos SVG:\n{e}"
            )
