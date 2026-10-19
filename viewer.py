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
    QWidget, QHBoxLayout, QVBoxLayout, QPushButton, QLabel, QDoubleSpinBox,
    QSlider, QFrame
)
from PySide6.QtCore import Signal, Qt, QPoint
from PySide6.QtGui import QVector3D, QColor
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


def _event_pos(event) -> QPoint:
    """Retorna la posición del evento como QPoint compatible con Qt6."""
    if hasattr(event, 'position'):
        return event.position().toPoint()
    return event.pos()


class SmoothGLView(GLViewWidget):
    """
    GLViewWidget con navegación simplificada de 3 inputs:
    - Control + Arrastre: Pan (funcionalidad de la manita)
    - Scroll del mouse: Zoom infinito suave
    - Arrastre del mouse: Giro / órbita de cámara libre en 360°
    """
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFocusPolicy(Qt.StrongFocus)
        self.setMouseTracking(True)
        self.setBackgroundColor(pg.mkColor(32, 32, 37))
        self._last_mouse_pos = None

    def orbit(self, azim: float, elev: float):
        """
        Órbita libre continua en 360 grados sin topes invisibles ni restricciones artificiales.
        """
        self.opts['elevation'] = (self.opts['elevation'] + elev) % 360.0
        self.opts['azimuth'] = (self.opts['azimuth'] + azim) % 360.0
        self.update()

    def set_view_top(self):
        """Vista superior alineada (desde arriba en Z, estilo Blender Numpad 7)."""
        self.setCameraPosition(elevation=89.99, azimuth=-90.0)

    def set_view_bottom(self):
        """Vista inferior alineada (desde abajo en Z, estilo Blender Ctrl+Numpad 7)."""
        self.setCameraPosition(elevation=269.99, azimuth=-90.0)

    def set_view_side(self):
        """Vista lateral alineada (desde el lado YZ, estilo Blender Numpad 3)."""
        self.setCameraPosition(elevation=0.0, azimuth=0.0)

    def set_view_front(self):
        """Vista frontal alineada (desde el frente XZ, estilo Blender Numpad 1)."""
        self.setCameraPosition(elevation=0.0, azimuth=-90.0)

    def set_view_3d(self):
        """Vista 3D perspectiva / libre (estilo Blender)."""
        self.setCameraPosition(elevation=30.0, azimuth=45.0)

    def keyPressEvent(self, ev):
        if ev.key() == Qt.Key_Control:
            self.setCursor(Qt.OpenHandCursor)
        if ev.key() in (Qt.Key_7, Qt.Key_T):
            if ev.modifiers() & Qt.ControlModifier:
                self.set_view_bottom()
            else:
                self.set_view_top()
            ev.accept()
            return
        elif ev.key() in (Qt.Key_3, Qt.Key_L):
            self.set_view_side()
            ev.accept()
            return
        elif ev.key() in (Qt.Key_1, Qt.Key_F):
            self.set_view_front()
            ev.accept()
            return
        elif ev.key() in (Qt.Key_0, Qt.Key_P):
            self.set_view_3d()
            ev.accept()
            return
        super().keyPressEvent(ev)

    def keyReleaseEvent(self, ev):
        if ev.key() == Qt.Key_Control:
            self.setCursor(Qt.ArrowCursor)
        super().keyReleaseEvent(ev)

    def leaveEvent(self, ev):
        self.setCursor(Qt.ArrowCursor)
        super().leaveEvent(ev)

    def mousePressEvent(self, ev):
        lpos = _event_pos(ev)
        self._last_mouse_pos = lpos
        if ev.modifiers() & Qt.ControlModifier:
            self.setCursor(Qt.ClosedHandCursor)
            ev.accept()
            return
        super().mousePressEvent(ev)

    def mouseMoveEvent(self, ev):
        lpos = _event_pos(ev)
        if not hasattr(self, '_last_mouse_pos') or self._last_mouse_pos is None:
            self._last_mouse_pos = lpos
        diff = lpos - self._last_mouse_pos
        self._last_mouse_pos = lpos

        buttons = ev.buttons()
        if buttons != Qt.NoButton:
            if ev.modifiers() & Qt.ControlModifier:
                self.setCursor(Qt.ClosedHandCursor)
                self.pan(diff.x(), diff.y(), 0, relative='view')
            else:
                self.orbit(-diff.x(), diff.y())
            ev.accept()
            return
        else:
            if ev.modifiers() & Qt.ControlModifier:
                self.setCursor(Qt.OpenHandCursor)
            else:
                self.setCursor(Qt.ArrowCursor)

        super().mouseMoveEvent(ev)

    def mouseReleaseEvent(self, ev):
        if ev.modifiers() & Qt.ControlModifier:
            self.setCursor(Qt.OpenHandCursor)
        else:
            self.setCursor(Qt.ArrowCursor)
        super().mouseReleaseEvent(ev)

    def wheelEvent(self, ev):
        delta = ev.angleDelta().y()
        if delta == 0:
            delta = ev.angleDelta().x()
        if delta == 0:
            return

        elev = math.radians(self.opts['elevation'])
        azim = math.radians(self.opts['azimuth'])
        dir_x = -math.cos(elev) * math.cos(azim)
        dir_y = -math.cos(elev) * math.sin(azim)
        dir_z = -math.sin(elev)

        steps = delta / 120.0
        current_dist = self.opts['distance']
        min_dist_threshold = 20.0

        if steps > 0:
            # Zoom IN hacia adelante
            if current_dist > min_dist_threshold:
                new_dist = current_dist * (0.88 ** steps)
                if new_dist < min_dist_threshold:
                    excess = min_dist_threshold - new_dist
                    self.opts['distance'] = min_dist_threshold
                    advance = excess * 1.5
                    self.opts['center'] = pg.Vector(
                        self.opts['center'].x() + dir_x * advance,
                        self.opts['center'].y() + dir_y * advance,
                        self.opts['center'].z() + dir_z * advance
                    )
                else:
                    self.opts['distance'] = new_dist
            else:
                # Zoom infinito continuo
                advance = 8.0 * steps
                self.opts['center'] = pg.Vector(
                    self.opts['center'].x() + dir_x * advance,
                    self.opts['center'].y() + dir_y * advance,
                    self.opts['center'].z() + dir_z * advance
                )
        else:
            # Zoom OUT hacia atrás
            zoom_factor = 1.15 ** (-steps)
            self.opts['distance'] = max(min_dist_threshold, current_dist * zoom_factor)
            if current_dist <= min_dist_threshold + 5.0:
                retreat = 6.0 * (-steps)
                self.opts['center'] = pg.Vector(
                    self.opts['center'].x() - dir_x * retreat,
                    self.opts['center'].y() - dir_y * retreat,
                    self.opts['center'].z() - dir_z * retreat
                )

        self.update()


class SlicedGLView(SmoothGLView):
    """
    Visor 3D interactivo para el modelo rebanado con navegación estilo Blender.
    - Botón Central (MMB): Orbitar cámara
    - Shift + Botón Central (o Shift + Click Derecho): Pan (desplazar vista)
    - Rueda del mouse: Zoom suave infinito
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
            computeNormals=False,
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
        lpos = event.position() if hasattr(event, 'position') else event.localPos()
        self._mouse_press_pos = _event_pos(event)
        self._last_mouse_pos = lpos
        self._is_dragging_disc = False
        self._drag_disc_id = None
        self._has_moved_mouse = False

        # Si Control está presionado: es Pan con la manita (no tocar discos ni pisos)
        if event.modifiers() & Qt.ControlModifier:
            self.setCursor(Qt.ClosedHandCursor)
            event.accept()
            return

        # Si el usuario hace click izquierdo (sin Control):
        if event.button() == Qt.LeftButton and self.disc_manager:
            total = len(self.plates_polygons)
            if 0 <= self.active_floor < total - 1:
                # Verificar si tocó un disco existente del piso activo
                clicked_disc = self._find_disc_at_point(_event_pos(event), self.active_floor)
                if clicked_disc:
                    self.select_disc(clicked_disc.id)
                    self._is_dragging_disc = True
                    self._drag_disc_id = clicked_disc.id
                    self.disc_manager._save_snapshot()
                    event.accept()
                    return

        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        lpos = event.position() if hasattr(event, 'position') else event.localPos()
        if not hasattr(self, '_last_mouse_pos') or self._last_mouse_pos is None:
            self._last_mouse_pos = lpos
        diff = lpos - self._last_mouse_pos
        self._last_mouse_pos = lpos

        # Marcar que hubo desplazamiento significativo
        if self._mouse_press_pos is not None:
            if (_event_pos(event) - self._mouse_press_pos).manhattanLength() > 4:
                self._has_moved_mouse = True

        # 1. Si estamos arrastrando un disco con LMB (sin Control)
        if self._is_dragging_disc and self._drag_disc_id is not None and self.disc_manager:
            p0, dir_vec = self._get_ray(_event_pos(event))
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

        buttons = event.buttons()

        # 2. Si hay algún botón presionado (arrastre de cámara):
        if buttons != Qt.NoButton:
            if event.modifiers() & Qt.ControlModifier:
                # Control = Pan con la manita
                self.setCursor(Qt.ClosedHandCursor)
                self.pan(diff.x(), diff.y(), 0, relative='view')
            elif event.modifiers() & Qt.ShiftModifier:
                # Shift = Pan como alternativa
                self.pan(diff.x(), diff.y(), 0, relative='view')
            else:
                # Giro de mouse = Mover/orbitar cámara
                self.orbit(-diff.x(), diff.y())
            event.accept()
            return

        # 3. Sin botones presionados (hover):
        if event.modifiers() & Qt.ControlModifier:
            self.setCursor(Qt.OpenHandCursor)
        elif self.disc_manager:
            total = len(self.plates_polygons)
            if 0 <= self.active_floor < total - 1:
                disc_under_cursor = self._find_disc_at_point(_event_pos(event), self.active_floor)
                new_hover_id = disc_under_cursor.id if disc_under_cursor else None
                if new_hover_id != self.hovered_disc_id:
                    self.hovered_disc_id = new_hover_id
                    if new_hover_id is not None:
                        self.setCursor(Qt.PointingHandCursor)
                    else:
                        self.setCursor(Qt.ArrowCursor)
                    self.update_opacities()
                elif new_hover_id is None:
                    self.setCursor(Qt.ArrowCursor)
            else:
                self.setCursor(Qt.ArrowCursor)
        else:
            self.setCursor(Qt.ArrowCursor)

        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        was_dragging_disc = self._is_dragging_disc
        self._is_dragging_disc = False
        self._drag_disc_id = None

        if was_dragging_disc:
            self._mouse_press_pos = None
            self._has_moved_mouse = False
            self.setCursor(Qt.ArrowCursor)
            event.accept()
            return

        # Si Control estaba presionado, fue Pan (manita): no colocar nada ni seleccionar
        if event.modifiers() & Qt.ControlModifier:
            self._mouse_press_pos = None
            self._has_moved_mouse = False
            self.setCursor(Qt.OpenHandCursor)
            event.accept()
            return

        if event.button() == Qt.LeftButton and self._mouse_press_pos is not None:
            drag_dist = (_event_pos(event) - self._mouse_press_pos).manhattanLength()
            # Solo interpretar como click si el movimiento fue menor a 6 píxeles y no hubo arrastre
            if drag_dist < 6 and not getattr(self, '_has_moved_mouse', False):
                total = len(self.plates_polygons)
                # Primero: comprobar si clickeó un disco para seleccionarlo
                disc_clicked = self._find_disc_at_point(_event_pos(event), self.active_floor)
                if disc_clicked is not None:
                    self.select_disc(disc_clicked.id)
                elif self.mode_add_discs:
                    # Modo poner discos activo y no clickeó disco: colocar uno nuevo
                    if total > 0 and self.active_floor >= total - 1:
                        self.status_message.emit("La última placa no tiene hueco arriba para colocar discos.")
                    elif self.disc_manager and total > 0:
                        z_top = self.active_floor * (self.thickness + self.gap) + self.thickness
                        p0, dir_vec = self._get_ray(_event_pos(event))
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
                    clicked_floor = self._find_clicked_plate(_event_pos(event))
                    if clicked_floor is not None:
                        self.set_active_floor(clicked_floor)
                        self.deselect_disc()
                    else:
                        self.deselect_disc()

        self._mouse_press_pos = None
        self._has_moved_mouse = False
        if self.hovered_disc_id is not None:
            self.setCursor(Qt.PointingHandCursor)
        else:
            self.setCursor(Qt.ArrowCursor)
        super().mouseReleaseEvent(event)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Control:
            self.setCursor(Qt.OpenHandCursor)
        if event.key() in (Qt.Key_7, Qt.Key_T):
            if event.modifiers() & Qt.ControlModifier:
                self.set_view_bottom()
            else:
                self.set_view_top()
            event.accept()
            return
        elif event.key() in (Qt.Key_3, Qt.Key_L):
            self.set_view_side()
            event.accept()
            return
        elif event.key() in (Qt.Key_1, Qt.Key_F):
            self.set_view_front()
            event.accept()
            return
        elif event.key() in (Qt.Key_0, Qt.Key_P):
            self.set_view_3d()
            event.accept()
            return
        elif event.key() in (Qt.Key_Up, Qt.Key_Right, Qt.Key_BracketRight, Qt.Key_W):
            self.next_floor()
            event.accept()
            return
        elif event.key() in (Qt.Key_Down, Qt.Key_Left, Qt.Key_BracketLeft, Qt.Key_S):
            self.prev_floor()
            event.accept()
            return
        elif event.key() in (Qt.Key_Delete, Qt.Key_Backspace):
            if self.delete_selected_disc():
                event.accept()
                return
        elif event.key() == Qt.Key_Z and (event.modifiers() & Qt.ControlModifier):
            if event.modifiers() & Qt.ShiftModifier:
                self.redo()
            else:
                self.undo()
            event.accept()
            return
        elif event.key() == Qt.Key_Y and (event.modifiers() & Qt.ControlModifier):
            self.redo()
            event.accept()
            return
        super().keyPressEvent(event)

    def undo(self):
        if self.disc_manager and self.disc_manager.undo():
            self.deselect_disc()
            self.update_discs_render()
            self.discs_changed.emit()
            self.status_message.emit("Acción deshecha (Deshacer).")

    def redo(self):
        if self.disc_manager and self.disc_manager.redo():
            self.deselect_disc()
            self.update_discs_render()
            self.discs_changed.emit()
            self.status_message.emit("Acción rehecha (Rehacer).")

    def keyReleaseEvent(self, event):
        if event.key() == Qt.Key_Control:
            if self.hovered_disc_id is not None:
                self.setCursor(Qt.PointingHandCursor)
            else:
                self.setCursor(Qt.ArrowCursor)
        super().keyReleaseEvent(event)

    def leaveEvent(self, event):
        self.setCursor(Qt.ArrowCursor)
        super().leaveEvent(event)


class SculptureViewer(QWidget):
    """
    Visor 3D unificado para Escultura de Planos Seriados.
    Proporciona un viewport amplio a pantalla completa con navegación 360°,
    slider rápido de pisos, herramientas interactivas de discos, grilla CAD
    y la capacidad de alternar o superponer la malla 3D original.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self.disc_manager: Optional[DiscManager] = None
        self._mesh: Optional[trimesh.Trimesh] = None
        self._mesh_item: Optional[GLMeshItem] = None
        self._showing_slices: bool = False
        self._setup_layout()

    def _setup_layout(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Contenedor superior de herramientas
        toolbar_frame = QFrame()
        toolbar_vbox = QVBoxLayout(toolbar_frame)
        toolbar_vbox.setContentsMargins(10, 6, 10, 6)
        toolbar_vbox.setSpacing(6)

        # Fila 1: Navegación de pisos y herramientas de discos
        toolbar_row1 = QHBoxLayout()
        toolbar_row1.setContentsMargins(0, 0, 0, 0)
        toolbar_row1.setSpacing(6)

        self.lbl_floor = QLabel("Piso activo: 0 / 0")

        self.btn_prev_floor = QPushButton("◀ Piso ant.")
        self.btn_prev_floor.setToolTip("Subir/bajar al piso anterior (Tecla S o Flecha Abajo)")

        self.btn_next_floor = QPushButton("Piso sig. ▶")
        self.btn_next_floor.setToolTip("Ir al piso siguiente (Tecla W o Flecha Arriba)")

        self.btn_solo_piso = QPushButton("Solo piso activo")
        self.btn_solo_piso.setCheckable(True)

        self.btn_poner_discos = QPushButton("Poner discos")
        self.btn_poner_discos.setCheckable(True)

        # Control de diámetro de disco seleccionado
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

        # Botones Deshacer y Rehacer
        self.btn_undo = QPushButton("↩")
        self.btn_undo.setToolTip("Deshacer disco (Ctrl+Z)")
        self.btn_undo.setFixedWidth(32)
        self.btn_redo = QPushButton("↪")
        self.btn_redo.setToolTip("Rehacer disco (Ctrl+Y)")
        self.btn_redo.setFixedWidth(32)

        # Botón toggle para alternar o superponer el modelo 3D original
        self.btn_toggle_mesh = QPushButton("👁 Ver modelo original")
        self.btn_toggle_mesh.setCheckable(True)
        self.btn_toggle_mesh.setToolTip("Superpone o alterna la malla 3D original con las placas rebanadas")

        toolbar_row1.addWidget(self.lbl_floor)
        toolbar_row1.addWidget(self.btn_prev_floor)
        toolbar_row1.addWidget(self.btn_next_floor)
        toolbar_row1.addWidget(self.btn_solo_piso)
        toolbar_row1.addWidget(self.btn_poner_discos)
        toolbar_row1.addWidget(self.lbl_diam)
        toolbar_row1.addWidget(self.spin_selected_diam)
        toolbar_row1.addWidget(self.btn_delete_disc)
        toolbar_row1.addWidget(self.btn_undo)
        toolbar_row1.addWidget(self.btn_redo)
        toolbar_row1.addStretch(1)
        toolbar_row1.addWidget(self.btn_toggle_mesh)

        # Fila 2: Botones de vistas predefinidas y ayuda de navegación
        toolbar_row2 = QHBoxLayout()
        toolbar_row2.setContentsMargins(0, 0, 0, 0)
        toolbar_row2.setSpacing(6)

        lbl_vistas = QLabel("Cámara:")
        lbl_vistas.setStyleSheet("font-weight: bold;")

        self.btn_view_top = QPushButton("⬆ Arriba (7)")
        self.btn_view_top.setToolTip("Vista superior alineada (Numpad 7 o Tecla T)")

        self.btn_view_side = QPushButton("➡ Lado (3)")
        self.btn_view_side.setToolTip("Vista lateral alineada (Numpad 3 o Tecla L)")

        self.btn_view_front = QPushButton("⏺ Frente (1)")
        self.btn_view_front.setToolTip("Vista frontal alineada (Numpad 1 o Tecla F)")

        self.btn_view_bottom = QPushButton("⬇ Abajo (Ctrl+7)")
        self.btn_view_bottom.setToolTip("Vista inferior alineada (Ctrl+Numpad 7)")

        self.btn_view_3d = QPushButton("🔄 3D (0)")
        self.btn_view_3d.setToolTip("Vista perspectiva 3D (Numpad 0 o Tecla P)")

        self.lbl_status = QLabel("Ctrl + Arrastre: Pan | Scroll: Zoom | Arrastre libre: Órbita 360°")
        self.lbl_status.setStyleSheet("color: #666; font-size: 11px;")

        toolbar_row2.addWidget(lbl_vistas)
        toolbar_row2.addWidget(self.btn_view_top)
        toolbar_row2.addWidget(self.btn_view_side)
        toolbar_row2.addWidget(self.btn_view_front)
        toolbar_row2.addWidget(self.btn_view_bottom)
        toolbar_row2.addWidget(self.btn_view_3d)
        toolbar_row2.addSpacing(10)
        toolbar_row2.addWidget(self.lbl_status, stretch=1)

        toolbar_vbox.addLayout(toolbar_row1)
        toolbar_vbox.addLayout(toolbar_row2)
        main_layout.addWidget(toolbar_frame)

        # Visor 3D único y espacioso
        self.view_sliced = SlicedGLView()
        self.view_sliced.setWindowTitle("Visor 3D")
        self.view_original = self.view_sliced  # Alias para compatibilidad con código existente
        main_layout.addWidget(self.view_sliced, stretch=1)

        # Conectar controles con view_sliced
        self.btn_prev_floor.clicked.connect(self.view_sliced.prev_floor)
        self.btn_next_floor.clicked.connect(self.view_sliced.next_floor)
        self.btn_solo_piso.toggled.connect(self._on_solo_piso_toggled)
        self.btn_poner_discos.toggled.connect(self._on_poner_discos_toggled)
        self.btn_delete_disc.clicked.connect(self.view_sliced.delete_selected_disc)
        self.btn_undo.clicked.connect(self.view_sliced.undo)
        self.btn_redo.clicked.connect(self.view_sliced.redo)
        self.spin_selected_diam.valueChanged.connect(self._on_selected_diam_changed)
        self.btn_toggle_mesh.toggled.connect(self._on_toggle_mesh_toggled)

        self.btn_view_top.clicked.connect(self.view_sliced.set_view_top)
        self.btn_view_side.clicked.connect(self.view_sliced.set_view_side)
        self.btn_view_front.clicked.connect(self.view_sliced.set_view_front)
        self.btn_view_bottom.clicked.connect(self.view_sliced.set_view_bottom)
        self.btn_view_3d.clicked.connect(self.view_sliced.set_view_3d)

        self.view_sliced.floor_changed.connect(self._update_floor_label)
        self.view_sliced.status_message.connect(self.lbl_status.setText)
        self.view_sliced.disc_selected.connect(self._on_disc_selected)

    def set_disc_manager(self, manager: DiscManager):
        self.disc_manager = manager
        self.view_sliced.set_disc_manager(manager)

    def set_default_disc_diameter(self, diameter: float):
        self.view_sliced.default_disc_diameter = diameter

    def _on_slider_floor_changed(self, value: int):
        self.view_sliced.set_active_floor(value)

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
            self.spin_selected_diam.blockSignals(True)
            self.spin_selected_diam.setValue(self.view_sliced.default_disc_diameter)
            self.spin_selected_diam.blockSignals(False)
            self.spin_selected_diam.setEnabled(False)
            self.btn_delete_disc.setEnabled(False)

    def _on_selected_diam_changed(self, val: float):
        self.set_default_disc_diameter(val)
        self.view_sliced.update_selected_disc_diameter(val)

    def _update_floor_label(self, floor_idx: int):
        total = len(self.view_sliced.plates_polygons)
        if total > 0:
            self.lbl_floor.setText(f"Piso activo: {floor_idx + 1} / {total}")
        else:
            self.lbl_floor.setText("Piso activo: 0 / 0")

    def _on_toggle_mesh_toggled(self, checked: bool):
        """Alterna visibilidad de la malla original sobre el visor."""
        if self._mesh_item is None:
            return
        if checked:
            self._mesh_item.setVisible(True)
            self.btn_toggle_mesh.setText("👁 Ocultar malla original")
        else:
            # Si estamos mostrando placas cortadas, ocultar la malla
            if self._showing_slices:
                self._mesh_item.setVisible(False)
                self.btn_toggle_mesh.setText("👁 Ver modelo original")
            else:
                self._mesh_item.setVisible(True)
                self.btn_toggle_mesh.setText("👁 Modelo original")

    def show_original_mesh(self, mesh: trimesh.Trimesh):
        """Renderiza el mesh original en el visor único."""
        self._mesh = mesh
        self._showing_slices = False
        self.view_sliced.clear()

        verts = mesh.vertices.astype(np.float32)
        faces = mesh.faces.astype(np.uint32)
        colors = np.ones((len(faces), 4), dtype=np.float32)
        colors[:, :3] = [0.7, 0.85, 1.0]
        colors[:, 3] = 0.7

        self._mesh_item = GLMeshItem(
            vertexes=verts,
            faces=faces,
            faceColors=colors,
            smooth=True,
            computeNormals=False,  # sin shader las normales no se usan; pyqtgraph las calcula con un bucle Python (6 s en 450k caras)
            drawEdges=True,
            edgeColor=(0.3, 0.5, 0.8, 1.0),
            glOptions='translucent'
        )
        self.view_sliced.addItem(self._mesh_item)
        self._fit_camera(self.view_sliced, mesh.bounding_box)

        # Ajustar controles para modo vista previa de malla
        self.lbl_floor.setText("Vista Previa 3D")
        self.btn_prev_floor.setEnabled(False)
        self.btn_next_floor.setEnabled(False)
        self.btn_solo_piso.setEnabled(False)
        self.btn_poner_discos.setEnabled(False)
        self.btn_toggle_mesh.setChecked(False)
        self.btn_toggle_mesh.setEnabled(False)
        self.lbl_status.setText("Modelo 3D cargado. Ajustá los parámetros y presioná 'Aplicar corte'.")

    def show_sliced_result(self, result: SliceResult, thickness: float, gap: float) -> int:
        """
        Renderiza las placas rebanadas como sólidos extruidos en el visor principal.
        Retorna el conteo de polígonos que cayeron a wireframe.
        """
        self._showing_slices = True
        self.view_sliced.clear()
        self._mesh_item = None
        wireframe_count = 0

        # Habilitar controles de corte y discos
        self.btn_prev_floor.setEnabled(True)
        self.btn_next_floor.setEnabled(True)
        self.btn_solo_piso.setEnabled(True)
        self.btn_poner_discos.setEnabled(True)

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
                    computeNormals=False,
                    drawEdges=True,
                    edgeColor=(0.0, 0.0, 0.0, 0.5),
                    glOptions='translucent'
                )
                item.setColor((*base_rgb, 1.0))
                self.view_sliced.addItem(item)
                self.view_sliced._plate_items.append((i, item, base_rgb))

        # Crear y añadir la malla original como item superpuesto transparente
        if self._mesh is not None:
            # Escalar y alinear la malla igual que el rebanado para que coincida exactamente
            m_copy = self._mesh.copy()
            m_copy.vertices -= m_copy.bounds.mean(axis=0)
            m_copy.apply_scale(result.auto_scale)
            # Alinear base de la malla con la base de las placas (z = 0)
            min_z = float(m_copy.bounds[0][2])
            m_copy.apply_translation([0.0, 0.0, -min_z])

            verts = m_copy.vertices.astype(np.float32)
            faces = m_copy.faces.astype(np.uint32)
            colors = np.ones((len(faces), 4), dtype=np.float32)
            colors[:, :3] = [0.75, 0.88, 1.0]
            colors[:, 3] = 0.22  # Silueta fantasma transparente

            self._mesh_item = GLMeshItem(
                vertexes=verts,
                faces=faces,
                faceColors=colors,
                smooth=True,
                computeNormals=False,
                drawEdges=True,
                edgeColor=(0.4, 0.6, 0.9, 0.35),
                glOptions='translucent'
            )
            self._mesh_item.setVisible(False)
            self.view_sliced.addItem(self._mesh_item)
            self.btn_toggle_mesh.setEnabled(True)
            self.btn_toggle_mesh.setChecked(False)
            self.btn_toggle_mesh.setText("👁 Ver modelo original")

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


