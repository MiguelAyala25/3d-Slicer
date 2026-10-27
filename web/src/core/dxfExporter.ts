import {
  DxfWriter,
  Units,
  Colors,
  LWPolylineFlags,
  point2d,
  point3d,
} from '@tarikjabiri/dxf';
import JSZip from 'jszip';
import { generateSheetSvg } from './svgExporter';
import type { Point2D, SheetLayout } from '../types/sculpture';

function addDxfClosedPolyline(
  dxf: DxfWriter,
  layerName: 'CORTE' | 'GRABADO',
  points: Point2D[]
): void {
  if (points.length < 2) return;
  dxf.addLWPolyline(
    points.map(([x, y]) => ({ point: point2d(x, y) })),
    {
      flags: LWPolylineFlags.Closed,
      layerName,
    }
  );
}

/**
 * Traducción 1:1 de _draw_dashed_circle_dxf (exporter.py:341-358).
 * Genera entidades ARC en la capa GRABADO para representar un círculo punteado
 * (cuando gapIndex === plateIndex - 1).
 */
function addDxfDashedCircle(
  dxf: DxfWriter,
  layerName: 'GRABADO',
  cx: number,
  cy: number,
  radius: number,
  dashLen = 1.5,
  gapLen = 1.0
): void {
  if (radius <= 0) return;
  const circumference = 2.0 * Math.PI * radius;
  const period = dashLen + gapLen;
  const numSegments = Math.max(4, Math.round(circumference / period));
  const stepDeg = 360.0 / numSegments;
  const dashDeg = stepDeg * (dashLen / period);

  for (let segI = 0; segI < numSegments; segI++) {
    const startAngle = segI * stepDeg;
    const endAngle = startAngle + dashDeg;
    dxf.addArc(point3d(cx, cy, 0), radius, startAngle, endAngle, {
      layerName,
    });
  }
}

function addDxfCenteredText(
  dxf: DxfWriter,
  layerName: 'GRABADO',
  cx: number,
  cy: number,
  height: number,
  text: string
): void {
  const approxHalfW = text.length * height * 0.3;
  const insertX = cx - approxHalfW;
  const insertY = cy - height * 0.5;
  dxf.addText(point3d(insertX, insertY, 0), height, text, {
    layerName,
  });
}

/**
 * Genera un archivo ASCII DXF AC1015 (AutoCAD 2000) mediante @tarikjabiri/dxf@2.9.0
 * con $INSUNITS = 4 (mm) y $MEASUREMENT = 1 (métrico) para que AutoCAD, LightBurn,
 * LibreCAD, RDWorks e Inkscape honren la escala 1:1 en milímetros.
 */
export function generateSheetDxf(sheet: SheetLayout): string {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Millimeters);
  dxf.setVariable('$ACADVER', { 1: 'AC1015' });
  dxf.setVariable('$MEASUREMENT', { 70: 1 });
  dxf.setVariable('$EXTMIN', { 10: 0, 20: 0, 30: 0 });
  dxf.setVariable('$EXTMAX', { 10: sheet.width, 20: sheet.height, 30: 0 });

  dxf.addLayer('CORTE', Colors.Red, 'CONTINUOUS');
  dxf.addLayer('GRABADO', Colors.Blue, 'CONTINUOUS');

  // Placas
  for (const plate of sheet.plates) {
    for (const poly of plate.polygons) {
      const extPts: Point2D[] = poly.exterior.map(([x, y]) => [
        x + plate.xOffset,
        y + plate.yOffset,
      ]);
      addDxfClosedPolyline(dxf, 'CORTE', extPts);

      for (const hole of poly.holes) {
        const holePts: Point2D[] = hole.map(([x, y]) => [
          x + plate.xOffset,
          y + plate.yOffset,
        ]);
        addDxfClosedPolyline(dxf, 'CORTE', holePts);
      }
    }

    // Círculos de alineación de discos en GRABADO (exporter.py:322-338):
    // - gapIndex === plateIndex (isDashed === false) -> 1 CIRCLE sólido
    // - gapIndex === plateIndex - 1 (isDashed === true) -> N ARC punteados
    // Ambos con r = (d.diameter + engraveClearance) / 2
    for (const disc of plate.discs) {
      const cx = plate.xOffset + disc.x;
      const cy = plate.yOffset + disc.y;
      const r = disc.diameter * 0.5;
      if (disc.isDashed) {
        addDxfDashedCircle(dxf, 'GRABADO', cx, cy, r);
      } else {
        dxf.addCircle(point3d(cx, cy, 0), r, { layerName: 'GRABADO' });
      }
    }

    addDxfCenteredText(
      dxf,
      'GRABADO',
      plate.labelX,
      plate.labelY,
      plate.labelSize,
      plate.labelText
    );

    if (plate.slotLabels) {
      for (const slotLbl of plate.slotLabels) {
        addDxfCenteredText(
          dxf,
          'GRABADO',
          slotLbl.x,
          slotLbl.y,
          slotLbl.fontSize,
          slotLbl.text
        );
      }
    }
  }

  // Bandejas de discos (GRABADO)
  for (const grp of sheet.discGroups) {
    const x0 = grp.trayX;
    const y0 = grp.trayY;
    const x1 = grp.trayX + grp.trayW;
    const y1 = grp.trayY + grp.trayH;
    addDxfClosedPolyline(dxf, 'GRABADO', [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]);
    dxf.addLine(point3d(grp.labelSepX, y0, 0), point3d(grp.labelSepX, y1, 0), {
      layerName: 'GRABADO',
    });

    const labelZoneW = grp.labelSepX - grp.trayX;
    const lblCx = grp.trayX + labelZoneW * 0.5;
    const lblCy = grp.trayY + grp.trayH * 0.5;
    const lblSize = Math.max(
      2.0,
      Math.min(4.0, (labelZoneW * 0.85) / Math.max(1, grp.label.length * 0.6))
    );
    addDxfCenteredText(dxf, 'GRABADO', lblCx, lblCy, lblSize, grp.label);
  }

  // Discos (CORTE con compensación de kerf + etiqueta en GRABADO)
  for (const disc of sheet.discs) {
    const cutRadius = (disc.diameter + sheet.kerf) * 0.5;
    dxf.addCircle(point3d(disc.x, disc.y, 0), cutRadius, {
      layerName: 'CORTE',
    });
    const lblSize = Math.max(1.5, Math.min(3.5, disc.diameter * 0.18));
    addDxfCenteredText(dxf, 'GRABADO', disc.x, disc.y, lblSize, disc.label);
  }

  return dxf.stringify();
}

export function getSheetFileBaseName(sheet: SheetLayout, prefix = 'hoja'): string {
  const num = sheet.sheetIndex + 1;
  const tipo = sheet.sheetType === 'plates' ? 'placas' : 'discos';
  return `${prefix}_${num}_${tipo}`;
}

export async function exportAllSheetsZip(
  sheets: SheetLayout[],
  prefix = 'hoja'
): Promise<Blob> {
  const zip = new JSZip();
  for (const sheet of sheets) {
    const base = getSheetFileBaseName(sheet, prefix);
    zip.file(`${base}.dxf`, generateSheetDxf(sheet));
    zip.file(
      `${base}.svg`,
      generateSheetSvg(sheet, { includeReference: true })
    );
  }
  return zip.generateAsync({ type: 'blob' });
}
