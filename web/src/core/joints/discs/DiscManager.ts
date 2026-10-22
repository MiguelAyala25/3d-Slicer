import {
  isDiscValidForGap,
  isPointOnPlate,
} from './discGeometry';
import { DEFAULT_PARAMS, PARAM_BOUNDS } from '../../params';
import { ValidationError } from '../../validator';
import type { Disc, PlateContour } from '../../../types/sculpture';

export const MAX_HISTORY = 50;

export interface AddDiscOutcome {
  primary: Disc;
  autoCopied: Disc | null;
}

export class DiscManager {
  private discs: Disc[] = [];
  private nextId = 1;
  private defaultDiameter: number;
  private undoStack: Disc[][] = [];
  private redoStack: Disc[][] = [];

  constructor(defaultDiameter = DEFAULT_PARAMS.discDiameter) {
    this.defaultDiameter = defaultDiameter;
  }

  private cloneDiscs(list: Disc[] = this.discs): Disc[] {
    return list.map((d) => ({ ...d }));
  }

  saveSnapshot(): void {
    this.undoStack.push(this.cloneDiscs());
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this.cloneDiscs());
    this.discs = this.undoStack.pop()!;
    return true;
  }

  redo(): boolean {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this.cloneDiscs());
    this.discs = this.redoStack.pop()!;
    return true;
  }

  getDefaultDiameter(): number {
    return this.defaultDiameter;
  }

  setDefaultDiameter(diameter: number): void {
    if (
      !Number.isFinite(diameter) ||
      diameter < PARAM_BOUNDS.discDiameter.min ||
      diameter > PARAM_BOUNDS.discDiameter.max
    ) {
      throw new ValidationError(
        `El diámetro por defecto debe estar entre ${PARAM_BOUNDS.discDiameter.min} y ${PARAM_BOUNDS.discDiameter.max} mm.`
      );
    }
    this.defaultDiameter = diameter;
  }

  getAllDiscs(): Disc[] {
    return this.cloneDiscs();
  }

  getDiscsForGap(gapIndex: number): Disc[] {
    return this.discs.filter((d) => d.gapIndex === gapIndex).map((d) => ({ ...d }));
  }

  getDiscsForPlate(plateIndex: number): Disc[] {
    return this.discs
      .filter((d) => d.gapIndex === plateIndex || d.gapIndex === plateIndex - 1)
      .map((d) => ({ ...d }));
  }

  addDisc(
    x: number,
    y: number,
    gapIndex: number,
    plates: PlateContour[],
    diameter?: number,
    autoCopyNext = true
  ): AddDiscOutcome {
    const d = diameter ?? this.defaultDiameter;
    if (gapIndex < 0 || gapIndex >= plates.length - 1) {
      throw new ValidationError(
        `El índice de hueco ${gapIndex} está fuera de rango (0 a ${plates.length - 2}).`
      );
    }
    if (!isPointOnPlate(x, y, plates[gapIndex])) {
      throw new ValidationError(
        `El punto seleccionado está fuera de la placa activa P${gapIndex}.`
      );
    }

    this.saveSnapshot();
    const primary: Disc = {
      id: this.nextId++,
      x,
      y,
      diameter: d,
      gapIndex,
    };
    this.discs.push(primary);

    let autoCopied: Disc | null = null;
    if (
      autoCopyNext &&
      gapIndex + 1 < plates.length - 1 &&
      isDiscValidForGap(x, y, d, gapIndex + 1, plates)
    ) {
      autoCopied = {
        id: this.nextId++,
        x,
        y,
        diameter: d,
        gapIndex: gapIndex + 1,
      };
      this.discs.push(autoCopied);
    }

    return {
      primary: { ...primary },
      autoCopied: autoCopied ? { ...autoCopied } : null,
    };
  }

  /**
   * Mueve un disco validando contra plates[k] y plates[k+1].
   * `recordSnapshot` es false durante pointermove y true (o previo saveSnapshot) al finalizar.
   */
  moveDisc(
    discId: number,
    newX: number,
    newY: number,
    plates: PlateContour[],
    recordSnapshot = true
  ): boolean {
    const target = this.discs.find((d) => d.id === discId);
    if (!target) return false;
    if (!isPointOnPlate(newX, newY, plates[target.gapIndex], 2.0)) {
      return false;
    }
    if (Math.abs(target.x - newX) < 1e-6 && Math.abs(target.y - newY) < 1e-6) {
      return true;
    }
    if (recordSnapshot) {
      this.saveSnapshot();
    }
    target.x = newX;
    target.y = newY;
    return true;
  }

  setDiameter(
    discId: number,
    newDiameter: number,
    plates: PlateContour[]
  ): boolean {
    if (
      !Number.isFinite(newDiameter) ||
      newDiameter < PARAM_BOUNDS.discDiameter.min ||
      newDiameter > PARAM_BOUNDS.discDiameter.max
    ) {
      throw new ValidationError(
        `El diámetro debe estar entre ${PARAM_BOUNDS.discDiameter.min} y ${PARAM_BOUNDS.discDiameter.max} mm.`
      );
    }
    const target = this.discs.find((d) => d.id === discId);
    if (!target) return false;
    if (
      newDiameter > target.diameter &&
      !isDiscValidForGap(target.x, target.y, newDiameter, target.gapIndex, plates)
    ) {
      throw new ValidationError(
        `El diámetro Ø${newDiameter} mm excede el borde de las placas P${target.gapIndex}/P${target.gapIndex + 1} en la posición actual.`
      );
    }
    if (Math.abs(target.diameter - newDiameter) < 1e-6) return true;
    this.saveSnapshot();
    target.diameter = newDiameter;
    return true;
  }

  removeDisc(discId: number): boolean {
    const idx = this.discs.findIndex((d) => d.id === discId);
    if (idx === -1) return false;
    this.saveSnapshot();
    this.discs.splice(idx, 1);
    return true;
  }

  clearGap(gapIndex: number): number {
    const matching = this.discs.filter((d) => d.gapIndex === gapIndex);
    if (matching.length === 0) return 0;
    this.saveSnapshot();
    this.discs = this.discs.filter((d) => d.gapIndex !== gapIndex);
    return matching.length;
  }

  clearAll(recordSnapshot = true): void {
    if (this.discs.length === 0) return;
    if (recordSnapshot) {
      this.saveSnapshot();
    }
    this.discs = [];
  }

  /**
   * Re-escala las coordenadas (x, y) de todos los discos por `scaleRatio = newAutoScale / oldAutoScale`
   * antes de ejecutar `purgeInvalidDiscs` (Corrección #5c, main.py:201-212).
   */
  rescalePositions(scaleRatio: number): void {
    if (
      this.discs.length === 0 ||
      !Number.isFinite(scaleRatio) ||
      scaleRatio <= 0 ||
      Math.abs(scaleRatio - 1.0) <= 1e-9
    ) {
      return;
    }
    this.saveSnapshot();
    for (const d of this.discs) {
      d.x *= scaleRatio;
      d.y *= scaleRatio;
    }
  }

  purgeInvalidDiscs(plates: PlateContour[]): number {
    const valid: Disc[] = [];
    let removedCount = 0;
    for (const d of this.discs) {
      if (
        d.gapIndex >= 0 &&
        d.gapIndex < plates.length - 1 &&
        isPointOnPlate(d.x, d.y, plates[d.gapIndex], 1.0)
      ) {
        valid.push(d);
      } else {
        removedCount++;
      }
    }
    if (removedCount > 0) {
      this.saveSnapshot();
      this.discs = valid;
    }
    return removedCount;
  }

  loadDiscsFromProject(rawDiscs: Disc[]): void {
    this.discs = rawDiscs.map((d) => ({ ...d }));
    const maxId = this.discs.reduce((acc, d) => Math.max(acc, d.id), 0);
    this.nextId = maxId + 1;
    this.undoStack = [];
    this.redoStack = [];
  }
}
