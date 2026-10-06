"""
project.py — Persistencia de proyectos en formato JSON (Etapa 1.C).
Guarda y carga versión, número de placas, espesor, separación y lista de discos.
Verifica compatibilidad de parámetros con respecto a los parámetros actuales.
"""

import json
from typing import Dict, Any, List, Tuple, Optional
from discs import Disc, DiscManager

PROJECT_VERSION = "1.0"


def project_to_dict(
    plates: int,
    thickness: float,
    gap: float,
    disc_manager: DiscManager,
    version: str = PROJECT_VERSION
) -> Dict[str, Any]:
    """Serializa la configuración del proyecto y sus discos a un diccionario."""
    return {
        "version": version,
        "plates": plates,
        "thickness": float(thickness),
        "gap": float(gap),
        "discs": [
            {
                "id": d.id,
                "hueco": d.hueco,
                "x": float(d.x),
                "y": float(d.y),
                "diameter": float(d.diameter),
            }
            for d in disc_manager.discs
        ]
    }


def save_project(
    filepath: str,
    plates: int,
    thickness: float,
    gap: float,
    disc_manager: DiscManager
) -> None:
    """Guarda el proyecto en un archivo JSON."""
    data = project_to_dict(plates, thickness, gap, disc_manager)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def load_project_from_dict(
    data: Dict[str, Any],
    disc_manager: DiscManager
) -> Tuple[int, float, float]:
    """
    Carga los discos en disc_manager a partir de un diccionario y retorna (plates, thickness, gap).
    Restaura los IDs y actualiza _next_id del gestor.
    """
    plates = int(data.get("plates", 10))
    thickness = float(data.get("thickness", 3.0))
    gap = float(data.get("gap", 3.0))

    disc_manager.clear()
    max_id = 0
    for item in data.get("discs", []):
        disc = Disc(
            id=int(item["id"]),
            hueco=int(item["hueco"]),
            x=float(item["x"]),
            y=float(item["y"]),
            diameter=float(item["diameter"])
        )
        disc_manager.discs.append(disc)
        if disc.id > max_id:
            max_id = disc.id
    disc_manager._next_id = max_id + 1

    return plates, thickness, gap


def load_project(
    filepath: str,
    disc_manager: DiscManager
) -> Tuple[int, float, float]:
    """Lee un archivo JSON y carga su contenido en disc_manager."""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    return load_project_from_dict(data, disc_manager)


def check_params_compatibility(
    loaded_plates: int,
    loaded_gap: float,
    current_plates: int,
    current_gap: float
) -> bool:
    """
    Comprueba si los parámetros cargados coinciden con los actuales.
    Retorna True si son compatibles, False si difieren y requieren re-slicing.
    """
    if loaded_plates != current_plates:
        return False
    if abs(loaded_gap - current_gap) > 0.01:
        return False
    return True
