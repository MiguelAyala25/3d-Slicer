import math
from dataclasses import dataclass
from typing import List, Optional, Tuple


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
        self._undo_stack: List[Tuple[List[Disc], int]] = []
        self._redo_stack: List[Tuple[List[Disc], int]] = []

    def _save_snapshot(self):
        """Guarda una copia profunda del estado actual para Undo."""
        snapshot = ([Disc(d.id, d.hueco, d.x, d.y, d.diameter) for d in self.discs], self._next_id)
        self._undo_stack.append(snapshot)
        if len(self._undo_stack) > 50:
            self._undo_stack.pop(0)
        self._redo_stack.clear()

    def undo(self) -> bool:
        """Deshace la última acción y devuelve True si hubo cambio."""
        if not self._undo_stack:
            return False
        # Guardar estado actual en redo stack
        current = ([Disc(d.id, d.hueco, d.x, d.y, d.diameter) for d in self.discs], self._next_id)
        self._redo_stack.append(current)
        prev_discs, prev_next_id = self._undo_stack.pop()
        self.discs = [Disc(d.id, d.hueco, d.x, d.y, d.diameter) for d in prev_discs]
        self._next_id = prev_next_id
        return True

    def redo(self) -> bool:
        """Rehace la última acción deshecha y devuelve True si hubo cambio."""
        if not self._redo_stack:
            return False
        current = ([Disc(d.id, d.hueco, d.x, d.y, d.diameter) for d in self.discs], self._next_id)
        self._undo_stack.append(current)
        next_discs, next_id = self._redo_stack.pop()
        self.discs = [Disc(d.id, d.hueco, d.x, d.y, d.diameter) for d in next_discs]
        self._next_id = next_id
        return True

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
        self._save_snapshot()
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

    def move_disc(self, id: int, x: float, y: float, record_undo: bool = False) -> bool:
        """Mueve un disco de forma totalmente independiente."""
        if record_undo:
            self._save_snapshot()
        for disc in self.discs:
            if disc.id == id:
                disc.x = x
                disc.y = y
                return True
        return False

    def set_diameter(self, id: int, diameter: float) -> bool:
        """Modifica el diámetro de un disco de forma totalmente independiente."""
        self._save_snapshot()
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
        self._save_snapshot()
        for i, disc in enumerate(self.discs):
            if disc.id == id:
                del self.discs[i]
                return True
        return False

    def clear(self):
        self.discs.clear()
        self._next_id = 1
        self._undo_stack.clear()
        self._redo_stack.clear()

