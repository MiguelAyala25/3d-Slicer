"""
validator.py — Validaciones de archivo, parámetros y mesh 3D.
"""

import os
from typing import Tuple
import trimesh
import trimesh.repair


def validate_file(path: str) -> Tuple[bool, str]:
    """
    Verifica que el archivo existe y tiene extensión OBJ o STL.
    (La carga real con trimesh se hace después para evitar doble trabajo).
    Retorna (True, "") si todo OK, o (False, "mensaje de error") si falla.
    """
    if not path or not isinstance(path, str):
        return False, "Ruta de archivo no proporcionada."

    if not os.path.exists(path):
        return False, f"El archivo no existe: '{path}'"

    if not os.path.isfile(path):
        return False, f"La ruta especificada no es un archivo válido: '{path}'"

    _, ext = os.path.splitext(path)
    ext_lower = ext.lower()
    if ext_lower not in ('.obj', '.stl'):
        return False, f"Solo se aceptan archivos OBJ o STL. El archivo tiene extensión '{ext}'"

    return True, ""


def validate_params(plates: int, gap: float, thickness: float) -> Tuple[bool, str]:
    """
    Verifica que:
      - plates >= 2
      - gap >= 0
      - thickness > 0
    Retorna (True, "") o (False, "mensaje de error").
    """
    if not isinstance(plates, int) or plates < 2:
        return False, "Se necesitan al menos 2 placas."

    if gap < 0:
        return False, "La separación entre placas no puede ser negativa."

    if thickness <= 0:
        return False, "El grosor debe ser mayor a 0."

    return True, ""


def validate_mesh(mesh: trimesh.Trimesh) -> Tuple[bool, str, bool]:
    """
    Recibe un objeto trimesh.Trimesh ya cargado.
    Verifica que no esté vacío (vértices > 0, caras > 0).
    Intenta reparación automática si no es watertight.

    IMPORTANTE: esta función MUTA el mesh recibido (fill_holes, fix_normals).
    El caller debe ser consciente de que el mesh original se modifica.
    Esto es intencional: queremos que slice_mesh trabaje con la versión reparada.

    Retorna (es_válido: bool, mensaje: str, fue_reparado: bool).
    """
    if mesh is None or not hasattr(mesh, 'vertices') or not hasattr(mesh, 'faces'):
        return False, "El modelo cargado no tiene geometría (0 vértices).", False

    if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        return False, "El modelo cargado no tiene geometría (0 vértices).", False

    if not mesh.is_watertight:
        try:
            trimesh.repair.fill_holes(mesh)
            trimesh.repair.fix_normals(mesh)
        except Exception:
            pass

        if not mesh.is_watertight:
            return True, "El modelo tiene huecos que no pudieron repararse. Los cortes pueden ser incompletos.", False
        else:
            return True, "El modelo tenía huecos y fue reparado automáticamente.", True

    return True, "", False
