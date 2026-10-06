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

    def add_disc(self, hueco: int, x: float, y: float, diameter: float) -> int:
        disc_id = self._next_id
        self._next_id += 1
        disc = Disc(id=disc_id, hueco=hueco, x=x, y=y, diameter=diameter)
        self.discs.append(disc)
        return disc_id

    def move_disc(self, id: int, x: float, y: float) -> bool:
        for disc in self.discs:
            if disc.id == id:
                disc.x = x
                disc.y = y
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
        for i, disc in enumerate(self.discs):
            if disc.id == id:
                del self.discs[i]
                return True
        return False

    def clear(self):
        self.discs.clear()
        self._next_id = 1
