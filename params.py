"""
params.py — Modelo de parámetros de corte, ensamblaje y exportación.
"""

from dataclasses import dataclass


@dataclass
class Params:
    plates: int = 10
    thickness: float = 3.0
    gap: float = 3.0
    axis: str = 'z'
    sheet_w: float = 600.0
    sheet_h: float = 400.0
    sheet_margin: float = 10.0
    part_gap: float = 5.0
    kerf: float = 0.15

    # Parámetros simplificados y sin clutter para columnas y discos
    disc_diameter: float = 6.0       # mm (por defecto 6.0 mm)
    edge_margin: float = 0.5         # mm (por defecto 0.5 mm)
    engrave_clearance: float = 0.3   # mm (por defecto 0.3 mm)

    # Compatibilidad interna opcional
    D_max: float = 40.0
    disc_frac: float = 0.5
    disc_min: float = 6.0
    disc_max: float = 6.0

    @property
    def disc_thickness(self) -> float:
        """El grosor del disco es exactamente igual a la separación entre placas."""
        return self.gap

    @property
    def discs_separate_sheet(self) -> bool:
        """Determina si los discos requieren una lámina aparte por tener distinto espesor que las placas."""
        return abs(self.gap - self.thickness) > 0.01
