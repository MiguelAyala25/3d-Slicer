import { projectDecals } from './imageProjection';
import { generateSheetLayouts } from './layout';
import { buildPrintSheets, type PrintSheet } from './printLayout';
import { computeCutPositions } from './slicer';
import type {
  CoreParams,
  DecalRegion,
  ImageDecal,
  PlateContour,
  Point2D,
  SheetLayout,
  SliceResult,
} from '../types/sculpture';

export interface PrintCalibrationPackage {
  sliceResult: SliceResult;
  decal: ImageDecal;
  regions: DecalRegion[];
  sheets: SheetLayout[];
  printSheets: PrintSheet[];
  imageDataUrl: string;
}

/**
 * Construye la silueta asimétrica "F" en coordenadas slice-local (axis === 'y', donde y_s = -z_w).
 * El brazo superior de la F apunta hacia +Z del mundo = -Y en slice-local, y los brazos hacia +X.
 * Orden CCW para exteriores en sistema cartesiano.
 */
function buildAsymmetricFPlate(): PlateContour {
  const pts: Point2D[] = [
    [-12, -20], // Top-left (z = +20)
    [14, -20],  // Top-right
    [14, -12],  // Top-bar bottom-right
    [-4, -12],  // Inner top-bar corner
    [-4, -3],   // Mid-bar top inner
    [9, -3],    // Mid-bar top right
    [9, 4],     // Mid-bar bottom right
    [-4, 4],    // Mid-bar bottom inner
    [-4, 20],   // Stem bottom right (z = -20)
    [-12, 20],  // Stem bottom left
  ];
  // Asegurar CCW (area > 0)
  let signed2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    signed2 += x0 * y1 - x1 * y0;
  }
  if (signed2 < 0) pts.reverse();
  return [
    {
      exterior: pts,
      holes: [],
      area: Math.abs(signed2 * 0.5),
    },
  ];
}

/**
 * Placa trasera (56 x 64 mm) con chaflán asimétrico en esquina superior derecha
 * para probar proyección en modo 'surface' (anillo alrededor de la F frontal).
 */
function buildBackChamferPlate(): PlateContour {
  const pts: Point2D[] = [
    [-28, 32],
    [-28, -32],
    [18, -32], // Chaflán arriba-derecha (z = +32)
    [28, -22],
    [28, 32],
  ];
  let signed2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    signed2 += x0 * y1 - x1 * y0;
  }
  if (signed2 < 0) pts.reverse();
  return [
    {
      exterior: pts,
      holes: [],
      area: Math.abs(signed2 * 0.5),
    },
  ];
}

export function buildCalibrationTestSvgDataUrl(): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="640" viewBox="0 0 560 640">`,
    `  <rect width="560" height="640" fill="#F8FAFC" stroke="#0F172A" stroke-width="6" />`,
    `  <rect x="20" y="20" width="520" height="600" fill="none" stroke="#94A3B8" stroke-dasharray="10,6" stroke-width="2" />`,
    `  <text x="280" y="54" text-anchor="middle" font-family="monospace" font-size="28" font-weight="bold" fill="#0F172A">ARRIBA ^</text>`,
    `  <text x="280" y="612" text-anchor="middle" font-family="monospace" font-size="22" font-weight="bold" fill="#475569">BASE / ABAJO</text>`,
    `  <text x="34" y="330" font-family="monospace" font-size="24" font-weight="bold" fill="#2563EB">&lt;- IZQ</text>`,
    `  <text x="526" y="330" text-anchor="end" font-family="monospace" font-size="24" font-weight="bold" fill="#DC2626">DER -&gt;</text>`,
    `  <path d="M 160 120 L 420 120 L 420 200 L 240 200 L 240 290 L 370 290 L 370 360 L 240 360 L 240 520 L 160 520 Z" fill="#F59E0B" fill-opacity="0.85" stroke="#0F172A" stroke-width="6" />`,
    `  <circle cx="80" cy="80" r="14" fill="none" stroke="#16A34A" stroke-width="4" />`,
    `  <circle cx="480" cy="80" r="14" fill="none" stroke="#DC2626" stroke-width="4" />`,
    `  <circle cx="80" cy="560" r="14" fill="none" stroke="#2563EB" stroke-width="4" />`,
    `  <circle cx="480" cy="560" r="14" fill="none" stroke="#9333EA" stroke-width="4" />`,
    `  <text x="280" y="566" text-anchor="middle" font-family="monospace" font-size="16" fill="#334155">CALIBRACION FRENTE (TINTA ATRAS POR DEFECTO)</text>`,
    `</svg>`,
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildPrintCalibrationPackage(
  baseParams: Pick<
    CoreParams,
    'thickness' | 'gap' | 'sheetW' | 'sheetH' | 'sheetMargin' | 'partGap' | 'kerf' | 'scrapTagEnabled' | 'optimizeLayout'
  >,
  options?: {
    bleedMm?: number;
    mirrorPrint?: boolean;
    includeRegistrationMarks?: boolean;
    includePrintedLabels?: boolean;
  }
): PrintCalibrationPackage {
  const params: CoreParams = {
    plates: 2,
    thickness: baseParams.thickness,
    gap: baseParams.gap,
    axis: 'y',
    sheetW: Math.max(120, baseParams.sheetW),
    sheetH: Math.max(120, baseParams.sheetH),
    sheetMargin: Math.min(10, baseParams.sheetMargin),
    partGap: baseParams.partGap,
    kerf: baseParams.kerf,
    scrapTagEnabled: baseParams.scrapTagEnabled,
    optimizeLayout: baseParams.optimizeLayout,
  };

  const { totalHeight, zPositions } = computeCutPositions(2, params.thickness, params.gap);

  const sliceResult: SliceResult = {
    plates: [buildAsymmetricFPlate(), buildBackChamferPlate()],
    zPositions,
    scaleFactor: 1.0,
    scaledBounds: [
      [-28, -32],
      [28, 32],
    ],
    scaledHeight: totalHeight,
    warnings: [],
  };

  const decal: ImageDecal = {
    id: 'cal-decal-f',
    name: 'calibracion_F.svg',
    imageKey: 'calibration-f',
    pxW: 560,
    pxH: 640,
    centerX: 0,
    centerZ: 0,
    widthMm: 56,
    heightMm: 64,
    rotationDeg: 0,
    mode: 'surface',
    order: 1,
    visible: true,
  };

  const imageDataUrl = buildCalibrationTestSvgDataUrl();
  const regions = projectDecals(sliceResult, [decal], {
    bleedMm: options?.bleedMm ?? 1.0,
  });
  const sheets = generateSheetLayouts(sliceResult, params);
  const printSheets = buildPrintSheets(sheets, regions, {
    mirrorHorizontal: options?.mirrorPrint ?? false,
    includeRegistrationMarks: options?.includeRegistrationMarks ?? true,
    includePrintedLabels: options?.includePrintedLabels ?? true,
  });

  return {
    sliceResult,
    decal,
    regions,
    sheets,
    printSheets,
    imageDataUrl,
  };
}
