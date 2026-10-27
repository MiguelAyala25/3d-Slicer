import type { Point2D, SheetLayout } from '../types/sculpture';

export interface SvgExportOptions {
  includeReference?: boolean; // Bordes de hoja, margen y etiquetas de retazo
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function ringToSvgPath(ring: Point2D[], dx: number, dy: number): string {
  if (ring.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    const cmd = i === 0 ? 'M' : 'L';
    parts.push(`${cmd} ${fmt(x + dx)} ${fmt(y + dy)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

function renderCadText(
  x: number,
  y: number,
  fontSize: number,
  color: string,
  text: string,
  anchor: 'middle' | 'start' = 'middle'
): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<text x="0" y="0" transform="translate(${fmt(x)}, ${fmt(y)}) scale(1, -1)" fill="${color}" font-family="monospace" font-size="${fmt(fontSize)}" text-anchor="${anchor}" dominant-baseline="central">${escaped}</text>`;
}

export function generateSheetSvg(
  sheet: SheetLayout,
  options: SvgExportOptions = { includeReference: true }
): string {
  const W = sheet.width;
  const H = sheet.height;
  const M = sheet.margin;
  const includeRef = options.includeReference ?? true;

  const refElements: string[] = [];
  const engraveElements: string[] = [];
  const cutElements: string[] = [];

  if (includeRef) {
    refElements.push(
      `<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="none" stroke="#888888" stroke-width="0.5" />`
    );
    if (M > 0) {
      refElements.push(
        `<rect x="${fmt(M)}" y="${fmt(M)}" width="${fmt(W - 2 * M)}" height="${fmt(H - 2 * M)}" fill="none" stroke="#CCCCCC" stroke-width="0.3" stroke-dasharray="4,4" />`
      );
    }
    for (const tag of sheet.scrapTags) {
      refElements.push(
        `<rect x="${fmt(tag.x)}" y="${fmt(tag.y)}" width="${fmt(tag.w)}" height="${fmt(tag.h)}" fill="none" stroke="#22C55E" stroke-width="0.35" stroke-dasharray="6,3" />`
      );
      const cx = tag.x + tag.w * 0.5;
      const cy = tag.y + tag.h * 0.5;
      const tSize = Math.max(4.0, Math.min(12.0, Math.min(tag.w, tag.h) * 0.08));
      for (let idx = 0; idx < tag.lines.length; idx++) {
        const lineY =
          cy + (tag.lines.length - 1 - idx * 2) * tSize * 0.65;
        refElements.push(
          renderCadText(cx, lineY, tSize, '#22C55E', tag.lines[idx])
        );
      }
    }
  }

  // Placas (CORTE en #FF0000 y GRABADO en #0000FF)
  for (const plate of sheet.plates) {
    for (const poly of plate.polygons) {
      const subPaths: string[] = [
        ringToSvgPath(poly.exterior, plate.xOffset, plate.yOffset),
      ];
      for (const hole of poly.holes) {
        subPaths.push(ringToSvgPath(hole, plate.xOffset, plate.yOffset));
      }
      cutElements.push(
        `<path d="${subPaths.join(' ')}" fill="none" stroke="#FF0000" stroke-width="0.2" fill-rule="nonzero" />`
      );
    }

    for (const disc of plate.discs) {
      const cx = plate.xOffset + disc.x;
      const cy = plate.yOffset + disc.y;
      // disc.diameter ya incluye params.engraveClearance (layout.ts)
      const r = disc.diameter * 0.5;
      const dashAttr = disc.isDashed ? ' stroke-dasharray="1.5,1"' : '';
      engraveElements.push(
        `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="#0000FF" stroke-width="0.15"${dashAttr} />`
      );
    }

    engraveElements.push(
      renderCadText(
        plate.labelX,
        plate.labelY,
        plate.labelSize,
        '#0000FF',
        plate.labelText
      )
    );

    if (plate.slotLabels) {
      for (const slotLbl of plate.slotLabels) {
        engraveElements.push(
          renderCadText(
            slotLbl.x,
            slotLbl.y,
            slotLbl.fontSize,
            '#0000FF',
            slotLbl.text
          )
        );
      }
    }
  }

  // Bandejas de discos (GRABADO #0000FF)
  for (const grp of sheet.discGroups) {
    engraveElements.push(
      `<rect x="${fmt(grp.trayX)}" y="${fmt(grp.trayY)}" width="${fmt(grp.trayW)}" height="${fmt(grp.trayH)}" fill="none" stroke="#0000FF" stroke-width="0.2" />`
    );
    engraveElements.push(
      `<line x1="${fmt(grp.labelSepX)}" y1="${fmt(grp.trayY)}" x2="${fmt(grp.labelSepX)}" y2="${fmt(grp.trayY + grp.trayH)}" stroke="#0000FF" stroke-width="0.15" />`
    );
    const labelZoneW = grp.labelSepX - grp.trayX;
    const lblCx = grp.trayX + labelZoneW * 0.5;
    const lblCy = grp.trayY + grp.trayH * 0.5;
    const lblSize = Math.max(
      2.0,
      Math.min(4.0, (labelZoneW * 0.85) / Math.max(1, grp.label.length * 0.6))
    );
    engraveElements.push(
      renderCadText(lblCx, lblCy, lblSize, '#0000FF', grp.label)
    );
  }

  // Discos (CORTE #FF0000 con compensación de kerf + etiqueta en GRABADO #0000FF)
  for (const disc of sheet.discs) {
    const cutRadius = (disc.diameter + sheet.kerf) * 0.5;
    cutElements.push(
      `<circle cx="${fmt(disc.x)}" cy="${fmt(disc.y)}" r="${fmt(cutRadius)}" fill="none" stroke="#FF0000" stroke-width="0.2" />`
    );
    const lblSize = Math.max(1.5, Math.min(3.5, disc.diameter * 0.18));
    engraveElements.push(
      renderCadText(disc.x, disc.y, lblSize, '#0000FF', disc.label)
    );
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}">`,
    `  <g id="cad-frame" transform="translate(0, ${fmt(H)}) scale(1, -1)">`,
    includeRef
      ? `    <g id="referencia">\n      ${refElements.join('\n      ')}\n    </g>`
      : '',
    `    <g id="grabado">`,
    `      ${engraveElements.join('\n      ')}`,
    `    </g>`,
    `    <g id="corte">`,
    `      ${cutElements.join('\n      ')}`,
    `    </g>`,
    `  </g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n');
}
