import {
  affineCompose,
  affineMirrorX,
  affineRound,
  affineTranslate,
  transformPolygons,
} from './affine2d';
import type {
  Affine2D,
  DecalRegion,
  PlacedPlate,
  PolygonWithHoles,
  SheetLayout,
} from '../types/sculpture';

export interface RegistrationMark {
  id: 'BL' | 'BR' | 'TL' | 'TR';
  x: number;
  y: number;
  armRadius: number;
  circleRadius: number;
  isOrigin: boolean;
}

export interface PrintRegionItem {
  decalId: string;
  imageKey: string;
  pxW: number;
  pxH: number;
  plateIndex: number;
  order: number;
  clipSheet: PolygonWithHoles[];
  imageToSheet: Affine2D;
}

export interface PrintedPlateLabel {
  text: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface PrintSheet {
  sheetIndex: number;
  width: number;
  height: number;
  margin: number;
  mirrorHorizontal: boolean;
  regions: PrintRegionItem[];
  labels: PrintedPlateLabel[];
  registrationMarks: RegistrationMark[];
}

export function computeRegistrationMarks(
  sheetW: number,
  sheetH: number,
  margin: number,
  mirrorHorizontal = false
): RegistrationMark[] {
  const inset =
    margin >= 6
      ? Math.min(margin * 0.5, 10)
      : Math.min(5, sheetW * 0.1, sheetH * 0.1);
  const armRadius = Math.min(4.0, inset * 0.8);
  const circleRadius = Math.min(2.5, inset * 0.5);

  return [
    {
      id: 'BL',
      x: Number(inset.toFixed(4)),
      y: Number(inset.toFixed(4)),
      armRadius,
      circleRadius,
      isOrigin: !mirrorHorizontal,
    },
    {
      id: 'BR',
      x: Number((sheetW - inset).toFixed(4)),
      y: Number(inset.toFixed(4)),
      armRadius,
      circleRadius,
      isOrigin: mirrorHorizontal,
    },
    {
      id: 'TL',
      x: Number(inset.toFixed(4)),
      y: Number((sheetH - inset).toFixed(4)),
      armRadius,
      circleRadius,
      isOrigin: false,
    },
    {
      id: 'TR',
      x: Number((sheetW - inset).toFixed(4)),
      y: Number((sheetH - inset).toFixed(4)),
      armRadius,
      circleRadius,
      isOrigin: false,
    },
  ];
}

function mirrorPlateHorizontal(plate: PlacedPlate, sheetW: number): PlacedPlate {
  const w = plate.width;
  const newXOffset = Number((sheetW - (plate.xOffset + w)).toFixed(4));
  const mirroredPolys = transformPolygons(
    plate.polygons,
    affineMirrorX(w),
    true
  );

  const mirroredDiscs = plate.discs.map((d) => ({
    ...d,
    x: Number((w - d.x).toFixed(4)),
  }));

  const mirroredSlotLabels = plate.slotLabels?.map((s) => ({
    ...s,
    x: Number((sheetW - s.x).toFixed(4)),
  }));

  const nextTransform = plate.sheetTransform
    ? affineRound(affineCompose(affineMirrorX(sheetW), plate.sheetTransform), 6)
    : undefined;

  return {
    ...plate,
    xOffset: newXOffset,
    polygons: mirroredPolys,
    discs: mirroredDiscs,
    ...(mirroredSlotLabels ? { slotLabels: mirroredSlotLabels } : {}),
    labelX: Number((sheetW - plate.labelX).toFixed(4)),
    ...(nextTransform ? { sheetTransform: nextTransform } : {}),
  };
}

/**
 * Refleja horizontalmente (x -> width - x) toda una hoja de corte/grabado
 * manteniendo la orientación CCW de exteriores y CW de huecos.
 */
export function mirrorSheetLayoutHorizontal(sheet: SheetLayout): SheetLayout {
  const W = sheet.width;
  return {
    ...sheet,
    plates: sheet.plates.map((p) => mirrorPlateHorizontal(p, W)),
    discs: sheet.discs.map((d) => ({
      ...d,
      x: Number((W - d.x).toFixed(4)),
    })),
    discGroups: sheet.discGroups.map((grp) => ({
      ...grp,
      trayX: Number((W - (grp.trayX + grp.trayW)).toFixed(4)),
      labelSepX: Number((W - grp.labelSepX).toFixed(4)),
      discs: grp.discs.map((d) => ({
        ...d,
        x: Number((W - d.x).toFixed(4)),
      })),
    })),
    scrapTags: sheet.scrapTags.map((tag) => ({
      ...tag,
      x: Number((W - (tag.x + tag.w)).toFixed(4)),
    })),
  };
}

export interface BuildPrintSheetsOptions {
  mirrorHorizontal?: boolean;
  includeRegistrationMarks?: boolean;
  includePrintedLabels?: boolean;
}

export function buildPrintSheets(
  sheets: readonly SheetLayout[],
  regions: readonly DecalRegion[],
  options?: BuildPrintSheetsOptions
): PrintSheet[] {
  const mirrorHorizontal = options?.mirrorHorizontal ?? false;
  const includeRegistrationMarks = options?.includeRegistrationMarks ?? true;
  const includePrintedLabels = options?.includePrintedLabels ?? true;

  const regionsByPlate = new Map<number, DecalRegion[]>();
  for (const r of regions) {
    const list = regionsByPlate.get(r.plateIndex) ?? [];
    list.push(r);
    regionsByPlate.set(r.plateIndex, list);
  }
  for (const list of regionsByPlate.values()) {
    list.sort((a, b) => a.order - b.order);
  }

  const out: PrintSheet[] = [];

  for (const sheet of sheets) {
    if (sheet.sheetType !== 'plates') continue;

    const printRegions: PrintRegionItem[] = [];
    const labels: PrintedPlateLabel[] = [];

    for (const plate of sheet.plates) {
      if (includePrintedLabels) {
        const labelX = mirrorHorizontal ? sheet.width - plate.labelX : plate.labelX;
        labels.push({
          text: plate.labelText,
          x: Number(labelX.toFixed(4)),
          y: plate.labelY,
          fontSize: plate.labelSize,
        });
      }

      const plateRegions = regionsByPlate.get(plate.plateIndex);
      if (!plateRegions || plateRegions.length === 0) continue;

      const baseTransform: Affine2D =
        plate.sheetTransform ?? affineTranslate(plate.xOffset, plate.yOffset);
      const plateToSheet: Affine2D = mirrorHorizontal
        ? affineCompose(affineMirrorX(sheet.width), baseTransform)
        : baseTransform;

      for (const reg of plateRegions) {
        const clipSheet = transformPolygons(reg.printClip, plateToSheet, true);
        if (clipSheet.length === 0) continue;
        const imageToSheet = affineRound(
          affineCompose(plateToSheet, reg.imageToPlate),
          6
        );
        printRegions.push({
          decalId: reg.decalId,
          imageKey: reg.imageKey,
          pxW: reg.pxW,
          pxH: reg.pxH,
          plateIndex: reg.plateIndex,
          order: reg.order,
          clipSheet,
          imageToSheet,
        });
      }
    }

    printRegions.sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.plateIndex - b.plateIndex
    );

    const registrationMarks = includeRegistrationMarks
      ? computeRegistrationMarks(sheet.width, sheet.height, sheet.margin, mirrorHorizontal)
      : [];

    out.push({
      sheetIndex: sheet.sheetIndex,
      width: sheet.width,
      height: sheet.height,
      margin: sheet.margin,
      mirrorHorizontal,
      regions: printRegions,
      labels,
      registrationMarks,
    });
  }

  return out;
}
