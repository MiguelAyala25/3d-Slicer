import { ValidationError } from './validator';
import type {
  PaperPresetId,
  PrintTilingConfig,
  SheetLayout,
} from '../types/sculpture';

export const PAPER_PRESETS: Record<
  Exclude<PaperPresetId, 'custom'>,
  { label: string; widthMm: number; heightMm: number }
> = {
  letter: { label: 'Carta (215.9 × 279.4 mm)', widthMm: 215.9, heightMm: 279.4 },
  tabloid: { label: 'Tabloide (279.4 × 431.8 mm)', widthMm: 279.4, heightMm: 431.8 },
  a4: { label: 'A4 (210 × 297 mm)', widthMm: 210.0, heightMm: 297.0 },
  a3: { label: 'A3 (297 × 420 mm)', widthMm: 297.0, heightMm: 420.0 },
};

export interface TileRegistrationMark {
  x: number; // Relativo a la esquina inferior izquierda de la página de papel (mm)
  y: number;
  armRadius: number;
  circleRadius: number;
}

export interface PrintTile {
  sheetIndex: number;
  row: number; // 0 = fila superior de la hoja física
  col: number; // 0 = columna izquierda
  label: string; // p. ej. "H1 · F1C1"
  fileSuffix: string; // p. ej. "F1C1"
  paperW: number;
  paperH: number;
  printerMarginMm: number;
  printableW: number;
  printableH: number;
  /** Coordenadas de la ventana de este mosaico en el marco CAD de la hoja (mm) */
  sheetMinX: number;
  sheetMinY: number;
  sheetMaxX: number;
  sheetMaxY: number;
  /** Vector unitario hacia el origen (0, 0) de la hoja CAD para flecha guía */
  originDirX: number;
  originDirY: number;
  marks: TileRegistrationMark[];
}

export interface TilingPlan {
  sheetIndex: number;
  sheetW: number;
  sheetH: number;
  paperW: number;
  paperH: number;
  orientationUsed: 'portrait' | 'landscape';
  cols: number;
  rows: number;
  overlapMm: number;
  printerMarginMm: number;
  tiles: PrintTile[];
}

function resolvePaperDims(config: PrintTilingConfig): { w: number; h: number } {
  if (config.preset === 'custom') {
    return { w: config.customW, h: config.customH };
  }
  const p = PAPER_PRESETS[config.preset];
  return { w: p.widthMm, h: p.heightMm };
}

function computeGridForPaper(
  sheetW: number,
  sheetH: number,
  paperW: number,
  paperH: number,
  margin: number,
  overlap: number
): { cols: number; rows: number; stepX: number; stepY: number; printW: number; printH: number } | null {
  const printW = paperW - 2 * margin;
  const printH = paperH - 2 * margin;
  const stepX = printW - overlap;
  const stepY = printH - overlap;
  if (printW <= 0 || printH <= 0 || stepX < 10 || stepY < 10) {
    return null;
  }
  const cols = sheetW <= printW + 1e-6 ? 1 : 1 + Math.ceil((sheetW - printW - 1e-6) / stepX);
  const rows = sheetH <= printH + 1e-6 ? 1 : 1 + Math.ceil((sheetH - printH - 1e-6) / stepY);
  return { cols, rows, stepX, stepY, printW, printH };
}

export function computeTilingPlan(
  sheetIndex: number,
  sheetW: number,
  sheetH: number,
  config: PrintTilingConfig
): TilingPlan {
  const base = resolvePaperDims(config);
  const shortSide = Math.min(base.w, base.h);
  const longSide = Math.max(base.w, base.h);
  const margin = Math.max(0, config.printerMarginMm);
  const overlap = Math.max(0, config.overlapMm);

  const portraitGrid = computeGridForPaper(
    sheetW,
    sheetH,
    shortSide,
    longSide,
    margin,
    overlap
  );
  const landscapeGrid = computeGridForPaper(
    sheetW,
    sheetH,
    longSide,
    shortSide,
    margin,
    overlap
  );

  let chosenOrient: 'portrait' | 'landscape';
  let paperW: number;
  let paperH: number;
  let grid: ReturnType<typeof computeGridForPaper>;

  if (config.orientation === 'portrait') {
    chosenOrient = 'portrait';
    paperW = shortSide;
    paperH = longSide;
    grid = portraitGrid;
  } else if (config.orientation === 'landscape') {
    chosenOrient = 'landscape';
    paperW = longSide;
    paperH = shortSide;
    grid = landscapeGrid;
  } else {
    if (!portraitGrid && !landscapeGrid) {
      grid = null;
      chosenOrient = 'portrait';
      paperW = shortSide;
      paperH = longSide;
    } else if (!landscapeGrid) {
      chosenOrient = 'portrait';
      paperW = shortSide;
      paperH = longSide;
      grid = portraitGrid;
    } else if (!portraitGrid) {
      chosenOrient = 'landscape';
      paperW = longSide;
      paperH = shortSide;
      grid = landscapeGrid;
    } else {
      const pCount = portraitGrid.cols * portraitGrid.rows;
      const lCount = landscapeGrid.cols * landscapeGrid.rows;
      if (lCount < pCount) {
        chosenOrient = 'landscape';
        paperW = longSide;
        paperH = shortSide;
        grid = landscapeGrid;
      } else {
        chosenOrient = 'portrait';
        paperW = shortSide;
        paperH = longSide;
        grid = portraitGrid;
      }
    }
  }

  if (!grid) {
    throw new ValidationError('PRINT_TILE_PAPER_TOO_SMALL', {
      paperW: Number(paperW.toFixed(1)),
      paperH: Number(paperH.toFixed(1)),
      margin,
      overlap,
    });
  }

  const tiles: PrintTile[] = [];
  const markInset = margin + Math.min(4, Math.max(2, overlap * 0.35));

  for (let r = 0; r < grid.rows; r++) {
    // Fila 0 cubre la parte superior de la hoja (y más alto en CAD)
    const sheetMaxY = Math.max(0, sheetH - r * grid.stepY);
    const sheetMinY = sheetMaxY - grid.printH;

    for (let c = 0; c < grid.cols; c++) {
      const sheetMinX = c * grid.stepX;
      const sheetMaxX = sheetMinX + grid.printW;

      const centerX = (sheetMinX + sheetMaxX) * 0.5;
      const centerY = (sheetMinY + sheetMaxY) * 0.5;
      const len = Math.hypot(centerX, centerY) || 1;

      const marks: TileRegistrationMark[] = [
        { x: markInset, y: markInset, armRadius: 3, circleRadius: 1.8 },
        { x: paperW - markInset, y: markInset, armRadius: 3, circleRadius: 1.8 },
        { x: markInset, y: paperH - markInset, armRadius: 3, circleRadius: 1.8 },
        { x: paperW - markInset, y: paperH - markInset, armRadius: 3, circleRadius: 1.8 },
      ];

      tiles.push({
        sheetIndex,
        row: r,
        col: c,
        label: `H${sheetIndex + 1} · F${r + 1}C${c + 1}`,
        fileSuffix: `F${r + 1}C${c + 1}`,
        paperW,
        paperH,
        printerMarginMm: margin,
        printableW: grid.printW,
        printableH: grid.printH,
        sheetMinX: Number(sheetMinX.toFixed(4)),
        sheetMinY: Number(sheetMinY.toFixed(4)),
        sheetMaxX: Number(sheetMaxX.toFixed(4)),
        sheetMaxY: Number(sheetMaxY.toFixed(4)),
        originDirX: Number((-centerX / len).toFixed(4)),
        originDirY: Number((-centerY / len).toFixed(4)),
        marks,
      });
    }
  }

  return {
    sheetIndex,
    sheetW,
    sheetH,
    paperW,
    paperH,
    orientationUsed: chosenOrient,
    cols: grid.cols,
    rows: grid.rows,
    overlapMm: overlap,
    printerMarginMm: margin,
    tiles,
  };
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

export function generateTileMapSvg(sheet: SheetLayout, plan: TilingPlan): string {
  const W = sheet.width;
  const H = sheet.height;

  const plateOutlines: string[] = [];
  for (const plate of sheet.plates) {
    for (const poly of plate.polygons) {
      if (poly.exterior.length < 3) continue;
      const d =
        poly.exterior
          .map(
            ([x, y], i) =>
              `${i === 0 ? 'M' : 'L'} ${fmt(x + plate.xOffset)} ${fmt(y + plate.yOffset)}`
          )
          .join(' ') + ' Z';
      plateOutlines.push(
        `<path d="${d}" fill="#E5E7EB" fill-opacity="0.35" stroke="#9CA3AF" stroke-width="0.4" />`
      );
    }
  }

  const tileRects: string[] = [];
  for (const tile of plan.tiles) {
    const x = Math.max(0, tile.sheetMinX);
    const y = Math.max(0, tile.sheetMinY);
    const w = Math.min(W, tile.sheetMaxX) - x;
    const h = Math.min(H, tile.sheetMaxY) - y;
    tileRects.push(
      `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="#0A84FF" fill-opacity="0.08" stroke="#0A84FF" stroke-width="0.7" stroke-dasharray="4,2" />`,
      `<text x="0" y="0" transform="translate(${fmt(x + w * 0.5)}, ${fmt(y + h * 0.5)}) scale(1, -1)" fill="#0A84FF" font-family="monospace" font-size="10" font-weight="bold" text-anchor="middle" dominant-baseline="central">${tile.fileSuffix}</text>`
    );
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(W)}mm" height="${fmt(H)}mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}">`,
    `  <g id="cad-frame" transform="translate(0, ${fmt(H)}) scale(1, -1)">`,
    `    <rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="#FFFFFF" stroke="#111827" stroke-width="0.8" />`,
    `    <g id="placas-ref">\n      ${plateOutlines.join('\n      ')}\n    </g>`,
    `    <g id="mosaicos">\n      ${tileRects.join('\n      ')}\n    </g>`,
    `  </g>`,
    `</svg>`,
  ].join('\n');
}
