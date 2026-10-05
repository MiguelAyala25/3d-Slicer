"""
viewer.py — Widget Qt para visualización 3D con pyqtgraph / OpenGL.
Muestra dos vistas lado a lado: modelo original y resultado rebanado.
"""

import colorsys
from typing import Optional
import numpy as np
from PySide6.QtWidgets import QWidget, QHBoxLayout
import pyqtgraph as pg
import pyqtgraph.opengl as gl
from pyqtgraph.opengl import GLViewWidget, GLMeshItem, GLLinePlotItem
import trimesh
from slicer import SliceResult
from supports import SupportResult


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


class SculptureViewer(QWidget):
    """
    Widget con dos GLViewWidget lado a lado:
    - izquierda: mesh original
    - derecha: placas rebanadas y separadas por gap con columnas de soporte
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self._highlight_item = None
        self._setup_layout()

    def _setup_layout(self):
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        # Vista izquierda — modelo original
        self.view_original = GLViewWidget()
        self.view_original.setWindowTitle("Modelo Original")

        # Vista derecha — resultado rebanado
        self.view_sliced = GLViewWidget()
        self.view_sliced.setWindowTitle("Resultado Rebanado")

        layout.addWidget(self.view_original)
        layout.addWidget(self.view_sliced)

    def show_original_mesh(self, mesh: trimesh.Trimesh):
        """
        Renderiza el mesh original en la vista izquierda.
        Usa wireframe semitransparente para ver la forma.
        """
        self.view_original.clear()

        verts = mesh.vertices.astype(np.float32)
        faces = mesh.faces.astype(np.uint32)
        colors = np.ones((len(faces), 4), dtype=np.float32)
        colors[:, :3] = [0.7, 0.85, 1.0]  # azul claro
        colors[:, 3] = 0.7  # semitransparente

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

    def show_sliced_result(
        self,
        result: SliceResult,
        thickness: float,
        gap: float,
        supports: Optional[SupportResult] = None
    ) -> int:
        """
        Renderiza las placas como cajas planas separadas por el gap,
        y las columnas de soporte como cilindros acrílicos (discos apilados).

        Los polígonos en result.polygons ya están en mm (pre-escalados por el slicer).
        No se aplica escala adicional.
        Retorna el conteo de polígonos que cayeron a wireframe.
        """
        self.view_sliced.clear()
        self._highlight_item = None
        wireframe_count = 0  # contador de placas/polígonos que cayeron a wireframe

        total_plates = len(result.polygons)
        for i, plist in enumerate(result.polygons):
            if plist is None:
                continue

            # Posición de la placa en Z (en mm)
            plate_position = i * (thickness + gap)

            # Color alternado por placa
            hue = (i / total_plates) if total_plates > 0 else 0.0
            color = _hue_to_rgb(hue) + [0.85]

            for polygon in plist:
                plate_mesh = _extrude_polygon(polygon, thickness, plate_position)

                if plate_mesh is None:
                    wireframe_count += 1
                    coords = np.array(polygon.exterior.coords)
                    z_coords = np.full((len(coords), 1), plate_position)
                    pts = np.hstack([coords, z_coords])

                    item = GLLinePlotItem(pos=pts, color=color, width=2.0, antialias=True)
                    self.view_sliced.addItem(item)
                    continue

                verts = plate_mesh.vertices.astype(np.float32)
                faces = plate_mesh.faces.astype(np.uint32)
                colors = np.tile(color, (len(faces), 1)).astype(np.float32)

                item = GLMeshItem(
                    vertexes=verts,
                    faces=faces,
                    faceColors=colors,
                    smooth=False,
                    drawEdges=True,
                    edgeColor=(0.0, 0.0, 0.0, 0.5),
                    glOptions='translucent'
                )
                self.view_sliced.addItem(item)

        # Renderizar cilindros de soporte entre placas
        if supports is not None and gap > 0.01:
            for col in supports.columns:
                try:
                    radius = max(0.5, col.diameter / 2.0)
                    cyl = trimesh.creation.cylinder(radius=radius, height=gap, sections=20)
                    z_center = col.level * (thickness + gap) + thickness + (gap / 2.0)
                    cyl.apply_translation([col.x, col.y, z_center])

                    verts = cyl.vertices.astype(np.float32)
                    faces = cyl.faces.astype(np.uint32)

                    # Continuas en púrpura, escalonadas/nuevas en naranja
                    if col.reused:
                        cyl_color = [0.65, 0.25, 0.85, 0.95]
                        edge_c = (0.4, 0.1, 0.6, 1.0)
                    else:
                        cyl_color = [0.95, 0.40, 0.15, 0.95]
                        edge_c = (0.7, 0.2, 0.0, 1.0)

                    colors = np.tile(cyl_color, (len(faces), 1)).astype(np.float32)

                    item = GLMeshItem(
                        vertexes=verts,
                        faces=faces,
                        faceColors=colors,
                        smooth=True,
                        drawEdges=True,
                        edgeColor=edge_c,
                        glOptions='translucent'
                    )
                    self.view_sliced.addItem(item)
                except Exception:
                    pass

        self._fit_camera_to_result(self.view_sliced, result, thickness, gap)
        return wireframe_count

    def highlight_position(
        self,
        level: int,
        x: Optional[float],
        y: Optional[float],
        thickness: float,
        gap: float
    ):
        """Resalta la posición de un aviso o columna seleccionada y enfoca la cámara."""
        if self._highlight_item is not None:
            try:
                self.view_sliced.removeItem(self._highlight_item)
            except Exception:
                pass
            self._highlight_item = None

        z_center = level * (thickness + gap) + thickness + (gap / 2.0)
        target_x = x if x is not None else 0.0
        target_y = y if y is not None else 0.0

        if x is not None and y is not None:
            try:
                marker = trimesh.creation.icosphere(radius=max(2.5, gap * 0.4), subdivisions=2)
                marker.apply_translation([target_x, target_y, z_center])
                verts = marker.vertices.astype(np.float32)
                faces = marker.faces.astype(np.uint32)
                colors = np.tile([1.0, 0.9, 0.0, 0.95], (len(faces), 1)).astype(np.float32)

                self._highlight_item = GLMeshItem(
                    vertexes=verts,
                    faces=faces,
                    faceColors=colors,
                    smooth=True,
                    drawEdges=True,
                    edgeColor=(1.0, 0.5, 0.0, 1.0),
                    glOptions='opaque'
                )
                self.view_sliced.addItem(self._highlight_item)
            except Exception:
                pass

        self.view_sliced.opts['center'] = pg.Vector(float(target_x), float(target_y), float(z_center))
        self.view_sliced.update()

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

        # Los polígonos ya están en mm — usar directo
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
