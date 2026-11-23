import { mirrorSheetLayoutHorizontal, type PrintSheet } from './printLayout';
import type { Point2D, PolygonWithHoles, SheetLayout } from '../types/sculpture';

export interface PrintSvgOptions {
  cutOverlaySheet?: SheetLayout;
  includeSheetBorder?: boolean;
}

function fmt(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ringToPath(ring: Point2D[], dx = 0, dy = 0): string {
  if (ring.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    parts.push(`${i === 0 ? 'M' : 'L'} ${fmt(x + dx)} ${fmt(y + dy)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

function polygonsToPathD(polys: PolygonWithHoles[], dx = 0, dy = 0): string {
  const parts: string[] = [];
  for (const poly of polys) {
    if (poly.exterior.length >= 3) {
      parts.push(ringToPath(poly.exterior, dx, dy));
    }
    for (const hole of poly.holes) {
      if (hole.length >= 3) {
        parts.push(ringToPath(hole, dx, dy));
      }
    }
  }
  return parts.join(' ');
}

function renderCadText(
  x: number,
  y: number,
  fontSize: number,
  color: string,
  text: string,
  extraAttrs = ''
): string {
  return `<text x="0" y="0" transform="translate(${fmt(x)}, ${fmt(y)}) scale(1, -1)" fill="${color}" font-family="monospace" font-size="${fmt(fontSize)}" text-anchor="middle" dominant-baseline="central"${extraAttrs}>${escapeXml(text)}</text>`;
}

export function generatePrintSheetSvg(
  printSheet: PrintSheet,
  imageDataUrls: Record<string, string>,
  options?: PrintSvgOptions
): string {
  const W = printSheet.width;
  const H = printSheet.height;
  const includeBorder = options?.includeSheetBorder ?? Boolean(options?.cutOverlaySheet);

  const defs: string[] = [];
  const printElements: string[] = [];
  const labelElements: string[] = [];
  const regElements: string[] = [];
  const overlayElements: string[] = [];

  if (includeBorder) {
    overlayElements.push(
      `<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="none" stroke="#888888" stroke-width="0.5" />`
    );
    if (printSheet.margin > 0) {
      const M = printSheet.margin;
      overlayElements.push(
        `<rect x="${fmt(M)}" y="${fmt(M)}" width="${fmt(W - 2 * M)}" height="${fmt(H - 2 * M)}" fill="none" stroke="#CCCCCC" stroke-width="0.3" stroke-dasharray="4,4" />`
      );
    }
  }

  for (let idx = 0; idx < printSheet.regions.length; idx++) {
    const reg = printSheet.regions[idx];
    const dataUrl = imageDataUrls[reg.imageKey];
    if (!dataUrl) continue;

    const pathD = polygonsToPathD(reg.clipSheet);
    if (!pathD) continue;

    const clipId = `print-clip-${printSheet.sheetIndex}-${idx}`;
    defs.push(
      `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><path d="${pathD}" clip-rule="evenodd" fill-rule="evenodd" /></clipPath>`
    );

    const [a, b, c, d, e, f] = reg.imageToSheet;
    const safeUrl = escapeXml(dataUrl);
    printElements.push(
      `<g clip-path="url(#${clipId})"><image href="${safeUrl}" xlink:href="${safeUrl}" x="0" y="0" width="${reg.pxW}" height="${reg.pxH}" preserveAspectRatio="none" transform="matrix(${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(e)} ${fmt(f)})" /></g>`
    );
  }

  for (const lbl of printSheet.labels) {
    labelElements.push(
      renderCadText(
        lbl.x,
        lbl.y,
        lbl.fontSize,
        '#111827',
        lbl.text,
        ' stroke="#FFFFFF" stroke-width="0.35" paint-order="stroke"'
      )
    );
  }

  for (const m of printSheet.registrationMarks) {
    regElements.push(
      `<line x1="${fmt(m.x - m.armRadius)}" y1="${fmt(m.y)}" x2="${fmt(m.x + m.armRadius)}" y2="${fmt(m.y)}" stroke="#00AA00" stroke-width="0.3" />`,
      `<line x1="${fmt(m.x)}" y1="${fmt(m.y - m.armRadius)}" x2="${fmt(m.x)}" y2="${fmt(m.y + m.armRadius)}" stroke="#00AA00" stroke-width="0.3" />`,
      `<circle cx="${fmt(m.x)}" cy="${fmt(m.y)}" r="${fmt(m.circleRadius)}" fill="none" stroke="#00AA00" stroke-width="0.3" />`
    );
    if (m.isOrigin) {
      const dirX = m.x < W * 0.5 ? 1 : -1;
      const dirY = m.y < H * 0.5 ? 1 : -1;
      regElements.push(
        `<circle cx="${fmt(m.x)}" cy="${fmt(m.y)}" r="${fmt(m.circleRadius * 1.45)}" fill="none" stroke="#00AA00" stroke-width="0.22" />`,
        renderCadText(
          m.x + dirX * (m.armRadius + 3.2),
          m.y + dirY * (m.armRadius + 1.5),
          2.2,
          '#00AA00',
          '0,0'
        )
      );
    }
  }

  if (options?.cutOverlaySheet) {
    const overlaySheet = printSheet.mirrorHorizontal
      ? mirrorSheetLayoutHorizontal(options.cutOverlaySheet)
      : options.cutOverlaySheet;
    for (const plate of overlaySheet.plates) {
      const dStr = polygonsToPathD(plate.polygons, plate.xOffset, plate.yOffset);
      if (dStr) {
        overlayElements.push(
          `<path d="${dStr}" fill="none" stroke="#FF0000" stroke-width="0.35" fill-rule="nonzero" />`
        );
      }
      for (const disc of plate.discs) {
        const cx = plate.xOffset + disc.x;
        const cy = plate.yOffset + disc.y;
        const r = disc.diameter * 0.5;
        const dashAttr = disc.isDashed ? ' stroke-dasharray="1.5,1"' : '';
        overlayElements.push(
          `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" fill="none" stroke="#0000FF" stroke-width="0.25"${dashAttr} />`
        );
      }
    }
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}">`,
    `  <g id="cad-frame" transform="translate(0, ${fmt(H)}) scale(1, -1)">`,
    defs.length > 0 ? `    <defs>\n      ${defs.join('\n      ')}\n    </defs>` : '',
    `    <g id="impresion">`,
    `      ${printElements.join('\n      ')}`,
    `    </g>`,
    labelElements.length > 0
      ? `    <g id="etiquetas-impresas">\n      ${labelElements.join('\n      ')}\n    </g>`
      : '',
    regElements.length > 0
      ? `    <g id="registro">\n      ${regElements.join('\n      ')}\n    </g>`
      : '',
    overlayElements.length > 0
      ? `    <g id="corte-guia">\n      ${overlayElements.join('\n      ')}\n    </g>`
      : '',
    `  </g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n');
}
