import math
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class Disc:
    id: int
    hueco: int
    x: float
    y: float
    diameter: float


class DiscManager:
    def __init__(self):
        self.discs: List[Disc] = []
        self._next_id: int = 1

    def add_disc(
        self,
        hueco: int,
        x: float,
        y: float,
        diameter: float,
        max_gap: Optional[int] = None
    ) -> int:
        """
        Agrega un disco en el hueco especificado.
        Si se indica max_gap y hueco < max_gap, auto-copia el disco al piso siguiente (hueco + 1)
        si no existe ya un disco en esa misma coordenada (x, y).
        """
        disc_id = self._next_id
        self._next_id += 1
        disc = Disc(id=disc_id, hueco=hueco, x=x, y=y, diameter=diameter)
        self.discs.append(disc)

        # Auto-copia independiente al piso siguiente
        if max_gap is not None and hueco < max_gap:
            next_hueco = hueco + 1
            exists = any(
                d.hueco == next_hueco and math.hypot(d.x - x, d.y - y) < 0.1
                for d in self.discs
            )
            if not exists:
                copy_id = self._next_id
                self._next_id += 1
                copy_disc = Disc(id=copy_id, hueco=next_hueco, x=x, y=y, diameter=diameter)
                self.discs.append(copy_disc)

        return disc_id

    def move_disc(self, id: int, x: float, y: float) -> bool:
        """Mueve un disco de forma totalmente independiente."""
        for disc in self.discs:
            if disc.id == id:
                disc.x = x
                disc.y = y
                return True
        return False

    def set_diameter(self, id: int, diameter: float) -> bool:
        """Modifica el diámetro de un disco de forma totalmente independiente."""
        for disc in self.discs:
            if disc.id == id:
                disc.diameter = diameter
                return True
        return False

    def get_disc(self, id: int) -> Optional[Disc]:
        for disc in self.discs:
            if disc.id == id:
                return disc
        return None

    def get_discs_for_gap(self, hueco: int) -> List[Disc]:
        return [d for d in self.discs if d.hueco == hueco]

    def remove_disc(self, id: int) -> bool:
        """Elimina un disco de forma totalmente independiente."""
        for i, disc in enumerate(self.discs):
            if disc.id == id:
                del self.discs[i]
                return True
        return False

    def clear(self):
        self.discs.clear()
        self._next_id = 1
