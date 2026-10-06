"""
viewer.py — Widget Qt para visualización 3D con pyqtgraph / OpenGL.
Muestra dos vistas lado a lado: modelo original y resultado rebanado.
En la vista derecha (view_sliced), incluye herramientas interactivas completas:
- Navegación de cámara estilo Blender (MMB = orbitar, Shift+MMB = pan, rueda = zoom).
- Selección de piso activo con opacidad 100% y resto tenue.
- Hover y selección visual de discos (resaltado dorado y cian de selección).
- Auto-copia independiente al piso siguiente al colocar discos.
- Borrado de discos (botón y tecla Suprimir / Delete).
- Edición individual de diámetro para el disco seleccionado.
"""

import colorsys
import math
from typing import Optional, List, Dict, Tuple
import numpy as np
import pyqtgraph as pg
import pyqtgraph.opengl as gl
from pyqtgraph.opengl import GLViewWidget, GLMeshItem, GLLinePlotItem
from PySide6.QtWidgets import (
    QWidget, QHBoxLayout, QVBoxLayout, QPushButton, QLabel, QDoubleSpinBox
)
from PySide6.QtCore import Signal, Qt, QPoint
from PySide6.QtGui import QVector3D
from shapely.geometry import Point
import trimesh

from slicer import SliceResult
from discs import DiscManager, Disc


def _hue_to_rgb(h: float) -> list[float]:
    """Convierte un valor de tono (0-1) a RGB (0-1) usando hsv_to_rgb."""
    return list(colorsys.hsv_to_rgb(h, 0.8, 0.9))


def _extrude_polygon(polygon, thickness: float, position: float) -> Optional[trimesh.Trimesh]:
    """
    Extruye un shapely Polygon en Z para darle grosor visual.
    Como el modelo ya fue rotado, siempre extruimos en Z.
    Los polígonos ya están en mm — no se aplica escala.
    """
    try:
        extruded = trimesh.creation.extrude_polygon(polygon, height=thickness)
        translation = [0.0, 0.0, float(position)]
        extruded.apply_translation(translation)
        return extruded
    except Exception:
        return None


class SlicedGLView(GLViewWidget):
    """
    Visor 3D interactivo para el modelo rebanado con navegación estilo Blender.
    - Botón Central (MMB): Orbitar cámara
    - Shift + Botón Central (o Shift + Click Derecho): Pan (desplazar vista)
    - Rueda del mouse: Zoom suave
    - Click Izquierdo (LMB): Selección de piso, hover/selección de discos, colocación y arrastre
    """
    floor_changed = Signal(int)
    discs_changed = Signal()
    disc_selected = Signal(object)  # Emite Disc o None
    status_message = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMouseTracking(True)

        self.disc_manager: Optional[DiscManager] = None
        self.active_floor: int = 0
        self.only_active_floor: bool = False
        self.mode_add_discs: bool = False
        self.default_disc_diameter: float = 6.0

        self.hovered_disc_id: Optional[int] = None
        self.selected_disc_id: Optional[int] = None

        self.plates_polygons = []
        self.thickness: float = 3.0
        self.gap: float = 3.0

        # Lista de tuplas: (plate_idx, item, base_rgb)
        self._plate_items: List[Tuple[int, GLMeshItem, list]] = []
        # Diccionario: disc_id -> GLMeshItem
        self._disc_items: Dict[int, GLMeshItem] = {}

        self._mouse_press_pos: Optional[QPoint] = None
        self._is_dragging_disc: bool = False
        self._drag_disc_id: Optional[int] = None

    def set_disc_manager(self, manager: DiscManager):
        self.disc_manager = manager
        self.update_discs_render()

    def set_active_floor(self, floor: int):
        total = len(self.plates_polygons)
        if total == 0:
            self.active_floor = 0
            return
        floor = max(0, min(floor, total - 1))
        if floor != self.active_floor:
            self.active_floor = floor
            # Deseleccionar disco si pertenecía a otro piso
            if self.selected_disc_id is not None and self.disc_manager:
                sel_disc = self.disc_manager.get_disc(self.selected_disc_id)
                if sel_disc is None or sel_disc.hueco != self.active_floor:
                    self.deselect_disc()

            self.update_opacities()
            self.floor_changed.emit(self.active_floor)
            if self.mode_add_discs and self.active_floor == total - 1:
                self.status_message.emit("Última placa: no hay hueco arriba para colocar discos.")
            elif self.mode_add_discs:
                self.status_message.emit(f"Piso {self.active_floor}: Click para colocar disco | Arrastra para mover")

    def prev_floor(self):
        if self.active_floor > 0:
            self.set_active_floor(self.active_floor - 1)

    def next_floor(self):
        if self.active_floor < len(self.plates_polygons) - 1:
            self.set_active_floor(self.active_floor + 1)

    def set_only_active_floor(self, enabled: bool):
        self.only_active_floor = enabled
        self.update_opacities()

    def set_mode_add_discs(self, enabled: bool):
        self.mode_add_discs = enabled
        total = len(self.plates_polygons)
        if enabled:
            if total > 0 and self.active_floor == total - 1:
                self.status_message.emit("Última placa: no hay hueco arriba para colocar discos.")
            else:
                self.status_message.emit(f"Piso {self.active_floor}: Click para colocar disco | Arrastra para mover")
        else:
            self.status_message.emit("Click sobre una placa para seleccionar ese piso, o sobre un disco para editarlo.")

    def select_disc(self, disc_id: Optional[int]):
        self.selected_disc_id = disc_id
        self.update_opacities()
        if disc_id is not None and self.disc_manager:
            disc = self.disc_manager.get_disc(disc_id)
            self.disc_selected.emit(disc)
            if disc:
                self.status_message.emit(f"Disco #{disc.id} seleccionado (Ø {disc.diameter:.1f} mm)")
        else:
            self.disc_selected.emit(None)

    def deselect_disc(self):
        self.select_disc(None)

    def delete_selected_disc(self) -> bool:
        if self.selected_disc_id is not None and self.disc_manager:
            target_id = self.selected_disc_id
            deleted = self.disc_manager.remove_disc(target_id)
            if deleted:
                self.deselect_disc()
                self.update_discs_render()
                self.discs_changed.emit()
                self.status_message.emit(f"Disco #{target_id} eliminado.")
                return True
        return False

    def update_selected_disc_diameter(self, new_diameter: float):
        if self.selected_disc_id is not None and self.disc_manager:
            ok = self.disc_manager.set_diameter(self.selected_disc_id, new_diameter)
            if ok:
                # Re-crear mesh del disco con nuevo diámetro
                disc = self.disc_manager.get_disc(self.selected_disc_id)
                if disc and disc.id in self._disc_items:
                    old_item = self._disc_items[disc.id]
                    self.removeItem(old_item)
                    new_item = self._create_disc_cylinder(disc)
                    self.addItem(new_item)
                    self._disc_items[disc.id] = new_item
                    self.update_opacities()
                    self.discs_changed.emit()

    def update_opacities(self):
        """Actualiza la opacidad y visibilidad de placas y discos según el piso activo, hover y selección."""
        # 1. Placas
        for p_idx, item, base_rgb in self._plate_items:
            is_active = (p_idx == self.active_floor)
            if self.only_active_floor:
                item.setVisible(is_active)
                alpha = 1.0
            else:
                item.setVisible(True)
                alpha = 1.0 if is_active else 0.18

            if isinstance(item, GLMeshItem):
                item.setColor((*base_rgb, alpha))
            elif isinstance(item, GLLinePlotItem):
                item.setData(color=[*base_rgb, alpha])

        # 2. Discos
        if self.disc_manager:
            for disc in self.disc_manager.discs:
                item = self._disc_items.get(disc.id)
                if item is not None:
                    is_active = (disc.hueco == self.active_floor)
                    if self.only_active_floor:
                        item.setVisible(is_active)
                    else:
                        item.setVisible(True)

                    if not is_active:
                        item.setColor((0.95, 0.65, 0.15, 0.25))
                    elif disc.id == self.selected_disc_id:
                        # Selección: azul eléctrico / cian luminoso
                        item.setColor((0.15, 0.85, 1.0, 1.0))
                    elif disc.id == self.hovered_disc_id:
                        # Hover: dorado brillante
                        item.setColor((1.0, 0.88, 0.35, 1.0))
                    else:
                        # Normal activo: ámbar cálido
                        item.setColor((0.95, 0.65, 0.15, 1.0))

    def _create_disc_cylinder(self, disc: Disc) -> GLMeshItem:
        radius = disc.diameter / 2.0
        cyl = trimesh.creation.cylinder(radius=radius, height=self.gap, sections=24)
        verts = cyl.vertices.astype(np.float32)
        faces = cyl.faces.astype(np.uint32)

        is_active = (disc.hueco == self.active_floor)
        alpha = 1.0 if is_active else (0.0 if self.only_active_floor else 0.25)

        mesh_item = GLMeshItem(
            vertexes=verts,
            faces=faces,
            smooth=True,
            drawEdges=True,
            edgeColor=(0.15, 0.1, 0.05, 0.8),
            glOptions='translucent'
        )
        z_center = disc.hueco * (self.thickness + self.gap) + self.thickness + (self.gap / 2.0)
        mesh_item.translate(disc.x, disc.y, z_center)
        if self.only_active_floor and not is_active:
            mesh_item.setVisible(False)
        return mesh_item

    def update_discs_render(self):
        """Sincroniza los cilindros 3D con DiscManager."""
        if not self.disc_manager:
            return

        current_discs = {d.id: d for d in self.disc_manager.discs}

        # Eliminar items de discos que ya no existan
        for d_id in list(self._disc_items.keys()):
            if d_id not in current_discs:
                self.removeItem(self._disc_items[d_id])
                del self._disc_items[d_id]

        # Añadir o actualizar posiciones
        for d_id, disc in current_discs.items():
            z_center = disc.hueco * (self.thickness + self.gap) + self.thickness + (self.gap / 2.0)
            if d_id not in self._disc_items:
                item = self._create_disc_cylinder(disc)
                self.addItem(item)
                self._disc_items[d_id] = item
            else:
                item = self._disc_items[d_id]
                item.resetTransform()
                item.translate(disc.x, disc.y, z_center)

        self.update_opacities()

    def clear(self):
        super().clear()
        self._plate_items.clear()
        self._disc_items.clear()
        self.plates_polygons.clear()
        self.active_floor = 0
        self.hovered_disc_id = None
        self.selected_disc_id = None

    def _get_ray(self, pos: QPoint):
        w = self.width()
        h = self.height()
        if w <= 0 or h <= 0:
            return None, None
        viewport = (0, 0, w, h)
        proj = self.projectionMatrix(viewport, viewport)
        view = self.viewMatrix()
        mvp = proj * view
        inv, ok = mvp.inverted()
        if not ok:
            return None, None

        ndc_x = (2.0 * pos.x() / w) - 1.0
        ndc_y = 1.0 - (2.0 * pos.y() / h)

        p_near = inv.map(QVector3D(ndc_x, ndc_y, -1.0))
        p_far = inv.map(QVector3D(ndc_x, ndc_y, 1.0))

        p0 = np.array([p_near.x(), p_near.y(), p_near.z()], dtype=float)
        p1 = np.array([p_far.x(), p_far.y(), p_far.z()], dtype=float)
        dir_vec = p1 - p0
        return p0, dir_vec

    def _intersect_z(self, p0, dir_vec, z_target: float):
        if abs(dir_vec[2]) < 1e-7:
            return None
        t = (z_target - p0[2]) / dir_vec[2]
        return p0 + t * dir_vec, t

    def _find_disc_at_point(self, pos: QPoint, hueco: int) -> Optional[Disc]:
        """Detecta si el rayo del cursor apunta a un disco del piso activo."""
        if not self.disc_manager:
            return None
        discs_active = self.disc_manager.get_discs_for_gap(hueco)
        if not discs_active:
            return None

        p0, dir_vec = self._get_ray(pos)
        if p0 is None:
            return None

        z_center = hueco * (self.thickness + self.gap) + self.thickness + (self.gap / 2.0)
        res = self._intersect_z(p0, dir_vec, z_center)
        if res is None:
            return None

        hit, _ = res
        for d in discs_active:
            dist = math.hypot(d.x - hit[0], d.y - hit[1])
            if dist <= (d.diameter / 2.0 + 2.0):  # 2mm tolerancia de selección
                return d
        return None

    def _find_clicked_plate(self, pos: QPoint) -> Optional[int]:
        p0, dir_vec = self._get_ray(pos)
        if p0 is None:
            return None

        best_t = float('inf')
        best_plate = None

        for i, plist in enumerate(self.plates_polygons):
            if not plist:
                continue
            z_top = i * (self.thickness + self.gap) + self.thickness
            z_bot = i * (self.thickness + self.gap)

            for z in (z_top, z_bot):
                res = self._intersect_z(p0, dir_vec, z)
                if res is None:
                    continue
                hit, t = res
                if 0 < t < best_t:
                    pt = Point(hit[0], hit[1])
                    if any(poly.contains(pt) or poly.distance(pt) < 1.0 for poly in plist):
                        best_t = t
                        best_plate = i
        return best_plate

    def mousePressEvent(self, event):
        self._mouse_press_pos = event.pos()
        self.mousePos = event.pos()
        self._is_dragging_disc = False
        self._drag_disc_id = None

        # Si el usuario hace click izquierdo:
        if event.button() == Qt.LeftButton and self.disc_manager:
            total = len(self.plates_polygons)
            if 0 <= self.active_floor < total - 1:
                # Verificar si tocó un disco existente del piso activo
                clicked_disc = self._find_disc_at_point(event.pos(), self.active_floor)
                if clicked_disc:
                    self.select_disc(clicked_disc.id)
                    self._is_dragging_disc = True
                    self._drag_disc_id = clicked_disc.id
                    event.accept()
                    return

        # Si presiona MMB o RMB, o LMB para cámara:
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        diff = event.pos() - self.mousePos
        self.mousePos = event.pos()

        # 1. Si estamos arrastrando un disco con LMB
        if self._is_dragging_disc and self._drag_disc_id is not None and self.disc_manager:
            p0, dir_vec = self._get_ray(event.pos())
            if p0 is not None:
                z_center = self.active_floor * (self.thickness + self.gap) + self.thickness + (self.gap / 2.0)
                res = self._intersect_z(p0, dir_vec, z_center)
                if res is not None:
                    hit, _ = res
                    self.disc_manager.move_disc(self._drag_disc_id, float(hit[0]), float(hit[1]))
                    if self._drag_disc_id in self._disc_items:
                        item = self._disc_items[self._drag_disc_id]
                        item.resetTransform()
                        item.translate(float(hit[0]), float(hit[1]), z_center)
                    self.discs_changed.emit()
            event.accept()
            return

        # 2. Navegación estilo Blender con el Botón Central (MMB)
        if event.buttons() & Qt.MiddleButton:
            if event.modifiers() & Qt.ShiftModifier:
                # Shift + MMB = Pan (desplazar vista suavemente)
                self.pan(diff.x(), diff.y(), 0, 'view')
            elif event.modifiers() & Qt.ControlModifier:
                # Ctrl + MMB = Zoom suave
                self.opts['distance'] *= 0.999 ** diff.y()
                self.update()
            else:
                # MMB = Orbitar suavemente estilo Blender
                self.orbit(-diff.x(), diff.y())
            event.accept()
            return

        # Pan alternativo: Shift + Click Derecho
        if (event.buttons() & Qt.RightButton) and (event.modifiers() & Qt.ShiftModifier):
            self.pan(diff.x(), diff.y(), 0, 'view')
            event.accept()
            return

        # 3. Detección de Hover cuando ningún botón está presionado
        if event.buttons() == Qt.NoButton and self.disc_manager:
            total = len(self.plates_polygons)
            if 0 <= self.active_floor < total - 1:
                disc_under_cursor = self._find_disc_at_point(event.pos(), self.active_floor)
                new_hover_id = disc_under_cursor.id if disc_under_cursor else None
                if new_hover_id != self.hovered_disc_id:
                    self.hovered_disc_id = new_hover_id
                    if new_hover_id is not None:
                        self.setCursor(Qt.PointingHandCursor)
                    else:
                        self.setCursor(Qt.ArrowCursor)
                    self.update_opacities()

        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self._is_dragging_disc:
            self._is_dragging_disc = False
            self._drag_disc_id = None
            event.accept()
            return

        if event.button() == Qt.LeftButton and self._mouse_press_pos is not None:
            drag_dist = (event.pos() - self._mouse_press_pos).manhattanLength()
            if drag_dist < 6:
                total = len(self.plates_polygons)
                # Primero: comprobar si clickeó un disco para seleccionarlo
                disc_clicked = self._find_disc_at_point(event.pos(), self.active_floor)
                if disc_clicked is not None:
                    self.select_disc(disc_clicked.id)
                elif self.mode_add_discs:
                    # Modo poner discos activo y no clickeó disco: colocar uno nuevo
                    if total > 0 and self.active_floor >= total - 1:
                        self.status_message.emit("La última placa no tiene hueco arriba para colocar discos.")
                    elif self.disc_manager and total > 0:
                        z_top = self.active_floor * (self.thickness + self.gap) + self.thickness
                        p0, dir_vec = self._get_ray(event.pos())
                        if p0 is not None:
                            res = self._intersect_z(p0, dir_vec, z_top)
                            if res is not None:
                                hit, _ = res
                                pt = Point(hit[0], hit[1])
                                plist = self.plates_polygons[self.active_floor]
                                if any(poly.contains(pt) or poly.distance(pt) < 1.0 for poly in plist):
                                    max_gap = total - 2
                                    new_id = self.disc_manager.add_disc(
                                        hueco=self.active_floor,
                                        x=float(hit[0]),
                                        y=float(hit[1]),
                                        diameter=float(self.default_disc_diameter),
                                        max_gap=max_gap
                                    )
                                    self.update_discs_render()
                                    self.select_disc(new_id)
                                    self.discs_changed.emit()
                else:
                    # Modo poner discos OFF y no clickeó disco: seleccionar placa de piso
                    clicked_floor = self._find_clicked_plate(event.pos())
                    if clicked_floor is not None:
                        self.set_active_floor(clicked_floor)
                        self.deselect_disc()
                    else:
                        self.deselect_disc()

        super().mouseReleaseEvent(event)

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Up, Qt.Key_Right, Qt.Key_BracketRight):
            self.next_floor()
            event.accept()
            return
        elif event.key() in (Qt.Key_Down, Qt.Key_Left, Qt.Key_BracketLeft):
            self.prev_floor()
            event.accept()
            return
        elif event.key() in (Qt.Key_Delete, Qt.Key_Backspace):
            if self.delete_selected_disc():
                event.accept()
                return
        super().keyPressEvent(event)


class SculptureViewer(QWidget):
    """
    Widget con dos vistas lado a lado:
    - izquierda: mesh original (view_original)
    - derecha: placas rebanadas y herramientas interactivas de discos 3D (view_sliced)
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.disc_manager: Optional[DiscManager] = None
        self._setup_layout()

    def _setup_layout(self):
        main_layout = QHBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)

        # Vista izquierda — modelo original
        self.view_original = GLViewWidget()
        self.view_original.setWindowTitle("Modelo Original")

        # Contenedor derecho: barra de herramientas superior + vista rebanada
        right_container = QWidget()
        right_layout = QVBoxLayout(right_container)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(4)

        # Barra de herramientas del visor 3D
        toolbar = QHBoxLayout()
        toolbar.setContentsMargins(6, 4, 6, 4)

        self.lbl_floor = QLabel("Piso activo: 0 / 0")
        self.lbl_floor.setStyleSheet("font-weight: bold; min-width: 125px;")

        self.btn_prev_floor = QPushButton("◀ Piso ant.")
        self.btn_next_floor = QPushButton("Piso sig. ▶")

        self.btn_solo_piso = QPushButton("Solo piso activo")
        self.btn_solo_piso.setCheckable(True)

        self.btn_poner_discos = QPushButton("Poner discos")
        self.btn_poner_discos.setCheckable(True)
        self.btn_poner_discos.setStyleSheet("""
            QPushButton:checked {
                background-color: #e65100;
                color: white;
                font-weight: bold;
            }
        """)

        # Control de diámetro de disco seleccionado
        toolbar.addSpacing(6)
        self.lbl_diam = QLabel("Ø disco:")
        self.spin_selected_diam = QDoubleSpinBox()
        self.spin_selected_diam.setRange(1.0, 50.0)
        self.spin_selected_diam.setValue(6.0)
        self.spin_selected_diam.setSuffix(" mm")
        self.spin_selected_diam.setSingleStep(0.5)
        self.spin_selected_diam.setEnabled(False)

        # Botón de borrar disco
        self.btn_delete_disc = QPushButton("🗑 Borrar disco")
        self.btn_delete_disc.setEnabled(False)

        self.lbl_status = QLabel("MMB: Orbitar | Shift+MMB: Pan | Click: Seleccionar")
        self.lbl_status.setStyleSheet("color: #666; font-size: 11px;")

        toolbar.addWidget(self.lbl_floor)
        toolbar.addWidget(self.btn_prev_floor)
        toolbar.addWidget(self.btn_next_floor)
        toolbar.addWidget(self.btn_solo_piso)
        toolbar.addWidget(self.btn_poner_discos)
        toolbar.addWidget(self.lbl_diam)
        toolbar.addWidget(self.spin_selected_diam)
        toolbar.addWidget(self.btn_delete_disc)
        toolbar.addWidget(self.lbl_status, stretch=1)

        right_layout.addLayout(toolbar)

        # Vista derecha interactiva
        self.view_sliced = SlicedGLView()
        self.view_sliced.setWindowTitle("Resultado Rebanado")
        right_layout.addWidget(self.view_sliced, stretch=1)

        main_layout.addWidget(self.view_original, stretch=1)
        main_layout.addWidget(right_container, stretch=1)

        # Conectar controles con view_sliced
        self.btn_prev_floor.clicked.connect(self.view_sliced.prev_floor)
        self.btn_next_floor.clicked.connect(self.view_sliced.next_floor)
        self.btn_solo_piso.toggled.connect(self._on_solo_piso_toggled)
        self.btn_poner_discos.toggled.connect(self._on_poner_discos_toggled)
        self.btn_delete_disc.clicked.connect(self.view_sliced.delete_selected_disc)
        self.spin_selected_diam.valueChanged.connect(self._on_selected_diam_changed)

        self.view_sliced.floor_changed.connect(self._update_floor_label)
        self.view_sliced.status_message.connect(self.lbl_status.setText)
        self.view_sliced.disc_selected.connect(self._on_disc_selected)

    def set_disc_manager(self, manager: DiscManager):
        self.disc_manager = manager
        self.view_sliced.set_disc_manager(manager)

    def set_default_disc_diameter(self, diameter: float):
        self.view_sliced.default_disc_diameter = diameter

    def _on_solo_piso_toggled(self, checked: bool):
        self.view_sliced.set_only_active_floor(checked)

    def _on_poner_discos_toggled(self, checked: bool):
        if checked:
            self.btn_poner_discos.setText("● Poner discos: ON")
        else:
            self.btn_poner_discos.setText("Poner discos")
        self.view_sliced.set_mode_add_discs(checked)

    def _on_disc_selected(self, disc: Optional[Disc]):
        if disc is not None:
            self.spin_selected_diam.blockSignals(True)
            self.spin_selected_diam.setValue(disc.diameter)
            self.spin_selected_diam.blockSignals(False)
            self.spin_selected_diam.setEnabled(True)
            self.btn_delete_disc.setEnabled(True)
        else:
            self.spin_selected_diam.setEnabled(False)
            self.btn_delete_disc.setEnabled(False)

    def _on_selected_diam_changed(self, val: float):
        self.view_sliced.update_selected_disc_diameter(val)

    def _update_floor_label(self, floor_idx: int):
        total = len(self.view_sliced.plates_polygons)
        if total > 0:
            self.lbl_floor.setText(f"Piso activo: {floor_idx + 1} / {total}")
        else:
            self.lbl_floor.setText("Piso activo: 0 / 0")

    def show_original_mesh(self, mesh: trimesh.Trimesh):
        """Renderiza el mesh original en la vista izquierda."""
        self.view_original.clear()

        verts = mesh.vertices.astype(np.float32)
        faces = mesh.faces.astype(np.uint32)
        colors = np.ones((len(faces), 4), dtype=np.float32)
        colors[:, :3] = [0.7, 0.85, 1.0]
        colors[:, 3] = 0.7

        mesh_item = GLMeshItem(
            vertexes=verts,
            faces=faces,
            faceColors=colors,
            smooth=True,
            drawEdges=True,
            edgeColor=(0.3, 0.5, 0.8, 1.0),
            glOptions='translucent'
        )
        self.view_original.addItem(mesh_item)
        self._fit_camera(self.view_original, mesh.bounding_box)

    def show_sliced_result(self, result: SliceResult, thickness: float, gap: float) -> int:
        """
        Renderiza las placas como sólidos extruidos y prepara la interacción 3D.
        Retorna el conteo de polígonos que cayeron a wireframe.
        """
        self.view_sliced.clear()
        wireframe_count = 0

        valid_plates = [plist for plist in result.polygons if plist is not None]
        self.view_sliced.plates_polygons = valid_plates
        self.view_sliced.thickness = thickness
        self.view_sliced.gap = gap

        total_plates = len(valid_plates)
        for i, plist in enumerate(valid_plates):
            plate_position = i * (thickness + gap)
            hue = (i / total_plates) if total_plates > 0 else 0.0
            base_rgb = _hue_to_rgb(hue)

            for polygon in plist:
                plate_mesh = _extrude_polygon(polygon, thickness, plate_position)
                if plate_mesh is None:
                    wireframe_count += 1
                    coords = np.array(polygon.exterior.coords)
                    z_coords = np.full((len(coords), 1), plate_position)
                    pts = np.hstack([coords, z_coords])
                    item = GLLinePlotItem(pos=pts, color=[*base_rgb, 1.0], width=2.0, antialias=True)
                    self.view_sliced.addItem(item)
                    self.view_sliced._plate_items.append((i, item, base_rgb))
                    continue

                verts = plate_mesh.vertices.astype(np.float32)
                faces = plate_mesh.faces.astype(np.uint32)
                item = GLMeshItem(
                    vertexes=verts,
                    faces=faces,
                    smooth=False,
                    drawEdges=True,
                    edgeColor=(0.0, 0.0, 0.0, 0.5),
                    glOptions='translucent'
                )
                item.setColor((*base_rgb, 1.0))
                self.view_sliced.addItem(item)
                self.view_sliced._plate_items.append((i, item, base_rgb))

        self.view_sliced.set_active_floor(0)
        self._update_floor_label(0)
        self.view_sliced.update_discs_render()

        self._fit_camera_to_result(self.view_sliced, result, thickness, gap)
        return wireframe_count

    def _fit_camera(self, view: GLViewWidget, bounding_box):
        """Ajusta la cámara para ver el objeto completo."""
        center = bounding_box.centroid
        extents = bounding_box.extents
        extent = float(np.max(extents)) if len(extents) > 0 else 1.0
        extent = max(extent, 1.0)
        view.setCameraPosition(distance=extent * 2.5, elevation=30, azimuth=45)
        view.opts['center'] = pg.Vector(float(center[0]), float(center[1]), float(center[2]))

    def _fit_camera_to_result(self, view: GLViewWidget, result: SliceResult, thickness: float, gap: float):
        """Ajusta la cámara centrándola en el bounding box del resultado."""
        valid_plates = [plist for plist in result.polygons if plist is not None]
        if not valid_plates:
            return

        min_x = min(min(p.bounds[0] for p in plist) for plist in valid_plates)
        max_x = max(max(p.bounds[2] for p in plist) for plist in valid_plates)
        min_y = min(min(p.bounds[1] for p in plist) for plist in valid_plates)
        max_y = max(max(p.bounds[3] for p in plist) for plist in valid_plates)

        center_x = (min_x + max_x) / 2.0
        center_y = (min_y + max_y) / 2.0
        center_z = result.assembled_height / 2.0

        extent = max(max_x - min_x, max_y - min_y, result.assembled_height, 1.0)
        view.setCameraPosition(distance=extent * 2.0, elevation=30, azimuth=45)
        view.opts['center'] = pg.Vector(float(center_x), float(center_y), float(center_z))
