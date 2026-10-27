import { WAFFLE_CONSTANTS } from './constants';
import type {
  PlacedPlate,
  Point2D,
  PolygonWithHoles,
  SheetLayout,
  SlotLabel,
} from '../../types/sculpture';

/**
 * Calcula las 7 holguras de prueba centradas en slotClearance:
 * c_k = max(0, slotClearance + (k - 3) * 0.05) para k = 0..6
 */
export function computeCalibrationClearances(slotClearance: number): number[] {
  const count = WAFFLE_CONSTANTS.CALIBRATION_SLOT_COUNT;
  const step = WAFFLE_CONSTANTS.CALIBRATION_STEP_MM;
  const mid = Math.floor(count / 2);

  const clearances: number[] = [];
  for (let k = 0; k < count; k++) {
    const c = Math.max(0, slotClearance + (k - mid) * step);
    clearances.push(Number(c.toFixed(4)));
  }
  return clearances;
}

function buildCombPlate(
  combIndex: number,
  xOffset: number,
  yOffset: number,
  thickness: number,
  kerf: number,
  clearances: number[]
): PlacedPlate {
  const W = WAFFLE_CONSTANTS.CALIBRATION_COMB_W_MM;
  const H = WAFFLE_CONSTANTS.CALIBRATION_COMB_H_MM;
  const slotDepth = WAFFLE_CONSTANTS.CALIBRATION_SLOT_DEPTH_MM;
  const count = clearances.length;

  // 7 ranuras distribuidas uniformemente: centro en (k + 1) * (W / (count + 1))
  const slotSpacing = W / (count + 1);

  // Anillo exterior CCW en coordenadas locales [0, W] x [0, H]
  const ring: Point2D[] = [
    [0, 0],
    [W, 0],
    [W, H],
  ];

  // Recorrer el borde superior (y = H) de derecha a izquierda
  for (let k = count - 1; k >= 0; k--) {
    const c_k = clearances[k];
    const w_k = Math.max(0.05, thickness + c_k - kerf);
    const xCenter = (k + 1) * slotSpacing;
    const xRight = Number((xCenter + w_k * 0.5).toFixed(4));
    const xLeft = Number((xCenter - w_k * 0.5).toFixed(4));
    const yBottom = Number((H - slotDepth).toFixed(4));

    ring.push([xRight, H]);
    ring.push([xRight, yBottom]);
    ring.push([xLeft, yBottom]);
    ring.push([xLeft, H]);
  }

  ring.push([0, H]);

  let totalSlotArea = 0;
  for (const c_k of clearances) {
    const w_k = Math.max(0.05, thickness + c_k - kerf);
    totalSlotArea += w_k * slotDepth;
  }

  const localPoly: PolygonWithHoles = {
    exterior: ring,
    holes: [],
    area: Number((W * H - totalSlotArea).toFixed(2)),
  };

  // Etiquetas grabadas (coordenadas de la hoja)
  const slotLabels: SlotLabel[] = [];
  for (let k = 0; k < count; k++) {
    const c_k = clearances[k];
    const xCenter = (k + 1) * slotSpacing;
    slotLabels.push({
      crossingId: `cal-${combIndex}-${k}`,
      text: `c=${c_k.toFixed(2)}`,
      x: Number((xOffset + xCenter).toFixed(3)),
      y: Number((yOffset + 7.5).toFixed(3)),
      fontSize: 2.0,
    });
  }

  const combName = combIndex === 0 ? 'Peine A' : 'Peine B';
  const infoText = `PRUEBA t=${thickness.toFixed(2)} kerf=${kerf.toFixed(2)}`;

  slotLabels.push({
    crossingId: `cal-info-${combIndex}`,
    text: infoText,
    x: Number((xOffset + W * 0.5).toFixed(3)),
    y: Number((yOffset + 3.0).toFixed(3)),
    fontSize: 2.2,
  });

  return {
    plateIndex: combIndex,
    xOffset,
    yOffset,
    width: W,
    height: H,
    polygons: [localPoly],
    discs: [],
    labelText: combName,
    labelX: Number((xOffset + W * 0.5).toFixed(3)),
    labelY: Number((yOffset + 11.0).toFixed(3)),
    labelSize: 2.5,
    labelOutside: false,
    slotLabels,
  };
}

/**
 * Genera un SheetLayout compacto (120 x 80 mm) con 2 peines de calibración
 * idénticos para probar físicamente el calce de ranuras en acrílico antes de cortar la escultura.
 */
export function generateSlotCalibrationSheet(
  thickness: number,
  kerf: number,
  slotClearance: number
): SheetLayout {
  const sheetW = WAFFLE_CONSTANTS.CALIBRATION_SHEET_W_MM;
  const sheetH = WAFFLE_CONSTANTS.CALIBRATION_SHEET_H_MM;
  const combW = WAFFLE_CONSTANTS.CALIBRATION_COMB_W_MM;
  const combH = WAFFLE_CONSTANTS.CALIBRATION_COMB_H_MM;
  const margin = 5.0;

  const clearances = computeCalibrationClearances(slotClearance);

  const xOffset = Number(((sheetW - combW) * 0.5).toFixed(3)); // 15 mm
  const yOffset1 = 9.0;
  const yOffset2 = 44.0;

  const plate1 = buildCombPlate(0, xOffset, yOffset1, thickness, kerf, clearances);
  const plate2 = buildCombPlate(1, xOffset, yOffset2, thickness, kerf, clearances);

  const usableW = sheetW - 2 * margin;
  const usableH = sheetH - 2 * margin;
  const usableArea = usableW * usableH;
  const usedW = combW;
  const usedH = yOffset2 + combH - yOffset1;

  return {
    sheetIndex: 0,
    sheetType: 'plates',
    materialThickness: thickness,
    width: sheetW,
    height: sheetH,
    margin,
    kerf,
    engraveClearance: 0,
    plates: [plate1, plate2],
    discs: [],
    discGroups: [],
    scrapTags: [],
    usedWidth: usedW,
    usedHeight: usedH,
    usedAreaMm2: Number((usedW * usedH).toFixed(1)),
    usableAreaMm2: Number(usableArea.toFixed(1)),
    occupancyPct: Number(((usedW * usedH) / usableArea * 100).toFixed(1)),
    remnantWidth: 0,
    remnantHeight: 0,
    remnantAreaMm2: 0,
  };
}
