import JSZip from 'jszip';
import { generateSheetDxf, getSheetFileBaseName, type DxfExportOptions } from '../core/dxfExporter';
import { type PrintSheet } from '../core/printLayout';
import { generatePrintSheetSvg } from '../core/printSvgExporter';
import {
  computeTilingPlan,
  generateTileMapSvg,
  type PrintTile,
} from '../core/printTiling';
import { generateSheetSvg, type SvgExportOptions } from '../core/svgExporter';
import type {
  PolygonWithHoles,
  PrintExportConfig,
  SheetLayout,
} from '../types/sculpture';

export const MAX_RASTER_DIM_PX = 16384;

export interface RasterDimensionsInfo {
  pxW: number;
  pxH: number;
  exceedsMax: boolean;
  maxSafeDpi: number;
}

export function computeRasterPixelDims(
  widthMm: number,
  heightMm: number,
  dpi: number
): RasterDimensionsInfo {
  const safeDpi = Math.max(1, dpi);
  const pxPerMm = safeDpi / 25.4;
  const pxW = Math.max(1, Math.round(widthMm * pxPerMm));
  const pxH = Math.max(1, Math.round(heightMm * pxPerMm));
  const exceedsMax = pxW > MAX_RASTER_DIM_PX || pxH > MAX_RASTER_DIM_PX;
  const maxDimMm = Math.max(widthMm, heightMm);
  const maxSafeDpi =
    maxDimMm > 0
      ? Math.max(1, Math.floor((MAX_RASTER_DIM_PX * 25.4) / maxDimMm))
      : safeDpi;
  return { pxW, pxH, exceedsMax, maxSafeDpi };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

/**
 * Inserta o reemplaza el chunk PNG `pHYs` (píxeles por metro, unidad = metro)
 * justo después de IHDR para que impresoras, RIPs e Illustrator lean el tamaño exacto en mm.
 */
export function injectPngDpi(pngBytes: Uint8Array, dpi: number): Uint8Array {
  if (
    pngBytes.length < 33 ||
    pngBytes[0] !== 137 ||
    pngBytes[1] !== 80 ||
    pngBytes[2] !== 78 ||
    pngBytes[3] !== 71
  ) {
    return pngBytes;
  }

  const ppm = Math.max(1, Math.round(dpi / 0.0254));
  const physChunk = new Uint8Array(4 + 4 + 9 + 4);
  writeUint32BE(physChunk, 0, 9);
  physChunk[4] = 112; // 'p'
  physChunk[5] = 72;  // 'H'
  physChunk[6] = 89;  // 'Y'
  physChunk[7] = 115; // 's'
  writeUint32BE(physChunk, 8, ppm);
  writeUint32BE(physChunk, 12, ppm);
  physChunk[16] = 1; // meters
  const crc = crc32(physChunk.subarray(4, 17));
  writeUint32BE(physChunk, 17, crc);

  // Recorrer chunks existentes para descartar cualquier pHYs previo
  const parts: Uint8Array[] = [pngBytes.subarray(0, 8)];
  let offset = 8;
  let inserted = false;

  while (offset + 12 <= pngBytes.length) {
    const chunkLen = readUint32BE(pngBytes, offset);
    const totalChunkLen = 12 + chunkLen;
    if (offset + totalChunkLen > pngBytes.length) break;

    const typeStr = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7]
    );

    if (typeStr !== 'pHYs') {
      parts.push(pngBytes.subarray(offset, offset + totalChunkLen));
      if (typeStr === 'IHDR' && !inserted) {
        parts.push(physChunk);
        inserted = true;
      }
    }
    offset += totalChunkLen;
  }

  if (!inserted) {
    return pngBytes;
  }

  const totalSize = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalSize);
  let writePos = 0;
  for (const p of parts) {
    out.set(p, writePos);
    writePos += p.length;
  }
  return out;
}

type RenderableCanvas = OffscreenCanvas | HTMLCanvasElement;
type Renderable2DContext =
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D;

function createRenderCanvas(pxW: number, pxH: number): {
  canvas: RenderableCanvas;
  ctx: Renderable2DContext;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(pxW, pxH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo inicializar contexto 2D OffscreenCanvas');
    return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo inicializar contexto 2D Canvas');
  return { canvas, ctx };
}

async function canvasToPngBytes(canvas: RenderableCanvas): Promise<Uint8Array> {
  if ('convertToBlob' in canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('No se pudo codificar el PNG'));
    }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function buildClipPath2D(polygons: PolygonWithHoles[]): Path2D {
  const path = new Path2D();
  for (const poly of polygons) {
    if (poly.exterior.length >= 3) {
      poly.exterior.forEach(([x, y], i) => {
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
    }
    for (const hole of poly.holes) {
      if (hole.length >= 3) {
        hole.forEach(([x, y], i) => {
          if (i === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        });
        path.closePath();
      }
    }
  }
  return path;
}

function drawPrintSheetContent(
  ctx: Renderable2DContext,
  printSheet: PrintSheet,
  images: Record<string, CanvasImageSource>,
  pxPerMm: number
): void {
  for (const reg of printSheet.regions) {
    const img = images[reg.imageKey];
    if (!img) continue;

    const clipPath = buildClipPath2D(reg.clipSheet);
    ctx.save();
    ctx.clip(clipPath, 'evenodd');
    const [a, b, c, d, e, f] = reg.imageToSheet;
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0, reg.pxW, reg.pxH);
    ctx.restore();
  }

  // Etiquetas impresas
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const lbl of printSheet.labels) {
    ctx.save();
    ctx.translate(lbl.x, lbl.y);
    ctx.scale(1, -1);
    ctx.font = `bold ${lbl.fontSize}px monospace`;
    ctx.lineWidth = Math.max(0.35, 1.0 / pxPerMm);
    ctx.strokeStyle = '#FFFFFF';
    ctx.strokeText(lbl.text, 0, 0);
    ctx.fillStyle = '#111827';
    ctx.fillText(lbl.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // Marcas de registro verdes
  ctx.save();
  ctx.strokeStyle = '#00AA00';
  ctx.fillStyle = '#00AA00';
  ctx.lineWidth = Math.max(0.3, 1.2 / pxPerMm);
  for (const m of printSheet.registrationMarks) {
    ctx.beginPath();
    ctx.moveTo(m.x - m.armRadius, m.y);
    ctx.lineTo(m.x + m.armRadius, m.y);
    ctx.moveTo(m.x, m.y - m.armRadius);
    ctx.lineTo(m.x, m.y + m.armRadius);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(m.x, m.y, m.circleRadius, 0, Math.PI * 2);
    ctx.stroke();

    if (m.isOrigin) {
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.circleRadius * 1.45, 0, Math.PI * 2);
      ctx.stroke();

      const dirX = m.x < printSheet.width * 0.5 ? 1 : -1;
      const dirY = m.y < printSheet.height * 0.5 ? 1 : -1;
      ctx.save();
      ctx.translate(
        m.x + dirX * (m.armRadius + 3.2),
        m.y + dirY * (m.armRadius + 1.5)
      );
      ctx.scale(1, -1);
      ctx.font = 'bold 2.2px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('0,0', 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

export async function renderPrintSheetToPng(
  printSheet: PrintSheet,
  images: Record<string, CanvasImageSource>,
  dpi: number
): Promise<Uint8Array> {
  const { pxW, pxH, exceedsMax, maxSafeDpi } = computeRasterPixelDims(
    printSheet.width,
    printSheet.height,
    dpi
  );
  if (exceedsMax) {
    throw new Error(
      `La imagen (${pxW} × ${pxH} px) excede el límite de ${MAX_RASTER_DIM_PX} px. Reduce el DPI a ≤ ${maxSafeDpi}.`
    );
  }

  const pxPerMm = dpi / 25.4;
  const { canvas, ctx } = createRenderCanvas(pxW, pxH);
  ctx.clearRect(0, 0, pxW, pxH);
  ctx.setTransform(pxPerMm, 0, 0, -pxPerMm, 0, pxH);
  drawPrintSheetContent(ctx, printSheet, images, pxPerMm);

  const rawPng = await canvasToPngBytes(canvas);
  return injectPngDpi(rawPng, dpi);
}

export async function renderPrintTileToPng(
  printSheet: PrintSheet,
  tile: PrintTile,
  images: Record<string, CanvasImageSource>,
  dpi: number
): Promise<Uint8Array> {
  const { pxW, pxH, exceedsMax, maxSafeDpi } = computeRasterPixelDims(
    tile.paperW,
    tile.paperH,
    dpi
  );
  if (exceedsMax) {
    throw new Error(
      `El mosaico (${pxW} × ${pxH} px) excede el límite de ${MAX_RASTER_DIM_PX} px. Reduce el DPI a ≤ ${maxSafeDpi}.`
    );
  }

  const pxPerMm = dpi / 25.4;
  const { canvas, ctx } = createRenderCanvas(pxW, pxH);
  ctx.clearRect(0, 0, pxW, pxH);
  ctx.setTransform(pxPerMm, 0, 0, -pxPerMm, 0, pxH);

  // Recortar al área imprimible del papel y trasladar la hoja CAD a esa ventana
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    tile.printerMarginMm,
    tile.printerMarginMm,
    tile.printableW,
    tile.printableH
  );
  ctx.clip();
  ctx.translate(
    tile.printerMarginMm - tile.sheetMinX,
    tile.printerMarginMm - tile.sheetMinY
  );
  drawPrintSheetContent(ctx, printSheet, images, pxPerMm);
  ctx.restore();

  // Guías de recorte / empalme del mosaico en papel
  ctx.save();
  ctx.strokeStyle = '#64748B';
  ctx.lineWidth = Math.max(0.25, 1.0 / pxPerMm);
  ctx.setLineDash([3, 2]);
  ctx.strokeRect(
    tile.printerMarginMm,
    tile.printerMarginMm,
    tile.printableW,
    tile.printableH
  );
  ctx.setLineDash([]);

  // Marcas de registro por mosaico
  ctx.strokeStyle = '#00AA00';
  ctx.lineWidth = Math.max(0.25, 1.0 / pxPerMm);
  for (const m of tile.marks) {
    ctx.beginPath();
    ctx.moveTo(m.x - m.armRadius, m.y);
    ctx.lineTo(m.x + m.armRadius, m.y);
    ctx.moveTo(m.x, m.y - m.armRadius);
    ctx.lineTo(m.x, m.y + m.armRadius);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(m.x, m.y, m.circleRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Rótulo del mosaico y flecha hacia origen (0,0) de la hoja
  const labelX = tile.printerMarginMm + 18;
  const labelY = tile.printerMarginMm + 4;
  ctx.save();
  ctx.translate(labelX, labelY);
  ctx.scale(1, -1);
  ctx.font = 'bold 3.2px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0F172A';
  ctx.fillText(tile.label, 0, 0);
  ctx.restore();

  const arrowCx = tile.printerMarginMm + 11;
  const arrowCy = tile.printerMarginMm + 4;
  const arrowLen = 3.2;
  ctx.strokeStyle = '#0A84FF';
  ctx.lineWidth = Math.max(0.3, 1.2 / pxPerMm);
  ctx.beginPath();
  ctx.moveTo(arrowCx, arrowCy);
  ctx.lineTo(
    arrowCx + tile.originDirX * arrowLen,
    arrowCy + tile.originDirY * arrowLen
  );
  ctx.stroke();
  ctx.restore();

  const rawPng = await canvasToPngBytes(canvas);
  return injectPngDpi(rawPng, dpi);
}

export async function loadImageSource(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo decodificar la imagen para impresión'));
    img.src = url;
  });
}

export async function loadImageSourcesMap(
  imageDataUrls: Record<string, string>
): Promise<Record<string, CanvasImageSource>> {
  const entries = Object.entries(imageDataUrls);
  const out: Record<string, CanvasImageSource> = {};
  await Promise.all(
    entries.map(async ([key, url]) => {
      out[key] = await loadImageSource(url);
    })
  );
  return out;
}

export async function exportSheetsWithPrintZip(
  sheets: readonly SheetLayout[],
  printSheets: readonly PrintSheet[],
  config: PrintExportConfig,
  imageDataUrls: Record<string, string>,
  images: Record<string, CanvasImageSource>,
  prefix = 'hoja'
): Promise<Blob> {
  const zip = new JSZip();
  const printBySheetIndex = new Map<number, PrintSheet>(
    printSheets.map((ps) => [ps.sheetIndex, ps])
  );

  const plateCutOpts: DxfExportOptions & SvgExportOptions = {
    includeReference: true,
    includeRegistrationMarks: config.enabled && config.includeRegistrationMarks,
    mirrorHorizontal: config.enabled && config.mirrorPrint,
    omitEngravedPlateLabels: config.enabled && config.plateLabelMode !== 'engrave',
  };

  for (const sheet of sheets) {
    const base = getSheetFileBaseName(sheet, prefix);
    if (sheet.sheetType === 'discs') {
      zip.file(`${base}.dxf`, generateSheetDxf(sheet));
      zip.file(`${base}.svg`, generateSheetSvg(sheet, { includeReference: true }));
      continue;
    }

    zip.file(`${base}.dxf`, generateSheetDxf(sheet, plateCutOpts));
    zip.file(`${base}.svg`, generateSheetSvg(sheet, plateCutOpts));

    if (!config.enabled) continue;
    const ps = printBySheetIndex.get(sheet.sheetIndex);
    if (!ps) continue;

    if (config.technique === 'adhesive-film' && config.tiling.enabled) {
      const plan = computeTilingPlan(
        sheet.sheetIndex,
        sheet.width,
        sheet.height,
        config.tiling
      );
      zip.file(`${base}_mapa_mosaico.svg`, generateTileMapSvg(sheet, plan));
      for (const tile of plan.tiles) {
        const pngBytes = await renderPrintTileToPng(ps, tile, images, config.dpi);
        zip.file(`${base}_impresion_${tile.fileSuffix}.png`, pngBytes);
      }
      if (config.format === 'svg' || config.format === 'both') {
        zip.file(
          `${base}_impresion.svg`,
          generatePrintSheetSvg(ps, imageDataUrls)
        );
      }
    } else {
      if (config.format === 'svg' || config.format === 'both') {
        zip.file(
          `${base}_impresion.svg`,
          generatePrintSheetSvg(ps, imageDataUrls)
        );
      }
      if (config.format === 'png' || config.format === 'both') {
        const pngBytes = await renderPrintSheetToPng(ps, images, config.dpi);
        zip.file(`${base}_impresion.png`, pngBytes);
      }
    }
  }

  return zip.generateAsync({ type: 'blob' });
}
