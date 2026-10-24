import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Point2D, PolygonWithHoles } from '../src/types/sculpture';
import {
  computeCrossing,
  subtractSlotsFromSection,
  computeLocalSlotLabels,
  type SlotRect,
  type WaffleCrossing,
  type WaffleSection,
} from '../src/core/waffle';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '../test-results/waffle-preview');

// Helper: Genera un perfil de arco/cúpula 2D (u, v)
function createDomeSection(
  halfWidth: number,
  height: number,
  steps = 32
): PolygonWithHoles {
  const exterior: Point2D[] = [];
  // Base recta en v = 0 de -halfWidth a +halfWidth
  exterior.push([-halfWidth, 0]);
  exterior.push([halfWidth, 0]);

  // Cúpula semielíptica hacia arriba de +halfWidth a -halfWidth
  for (let i = 0; i <= steps; i++) {
    const theta = (Math.PI * i) / steps;
    const u = halfWidth * Math.cos(theta);
    const v = height * Math.sin(theta);
    exterior.push([u, v]);
  }

  // Calcular área aproximada
  let area = (Math.PI * halfWidth * height) / 2;
  return { exterior, holes: [], area };
}

function computeBounds(polygons: PolygonWithHoles[]) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of polygons) {
    for (const [u, v] of p.exterior) {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  return { minU, maxU, minV, maxV };
}

function renderSectionToSvg(
  sec: WaffleSection,
  crossings: WaffleCrossing[],
  drawnSlotWidth: number
): string {
  const margin = 10;
  const b = sec.bounds2D;
  const widthMm = b.maxU - b.minU;
  const heightMm = b.maxV - b.minV;

  const viewBoxW = widthMm + 2 * margin;
  const viewBoxH = heightMm + 2 * margin;

  // En SVG: Y hacia abajo. En CAD: V hacia arriba.
  // u -> xSvg = (u - b.minU) + margin
  // v -> ySvg = viewBoxH - ((v - b.minV) + margin)
  const toSvgX = (u: number) => (u - b.minU + margin).toFixed(3);
  const toSvgY = (v: number) => (viewBoxH - (v - b.minV + margin)).toFixed(3);

  // SVG Paths para contornos cortados (#FF0000)
  const pathData: string[] = [];
  for (const poly of sec.polygons) {
    if (poly.exterior.length >= 3) {
      const dExt =
        'M ' +
        poly.exterior
          .map(([u, v]) => `${toSvgX(u)},${toSvgY(v)}`)
          .join(' L ') +
        ' Z';
      pathData.push(dExt);
    }
    for (const hole of poly.holes) {
      if (hole.length >= 3) {
        const dHole =
          'M ' +
          hole.map(([u, v]) => `${toSvgX(u)},${toSvgY(v)}`).join(' L ') +
          ' Z';
        pathData.push(dHole);
      }
    }
  }

  // Guías de cruces (líneas v* en color esmeralda #10B981)
  const guides: string[] = [];
  const labelsSvg: string[] = [];

  for (const slot of sec.slots) {
    const xCenter = toSvgX(slot.uCenter);
    const yVStar = toSvgY(slot.vStar);
    const halfW = (drawnSlotWidth * 0.5).toFixed(3);

    // Línea de referencia v*
    guides.push(
      `<line x1="${(parseFloat(xCenter) - 8).toFixed(3)}" y1="${yVStar}" x2="${(parseFloat(xCenter) + 8).toFixed(3)}" y2="${yVStar}" stroke="#10B981" stroke-width="0.3" stroke-dasharray="1,1" />`
    );
    guides.push(
      `<text x="${(parseFloat(xCenter) + 9).toFixed(3)}" y="${yVStar}" fill="#10B981" font-size="1.8" font-family="JetBrains Mono, monospace" dominant-baseline="middle">v*=${slot.vStar.toFixed(1)}</text>`
    );
  }

  // Etiquetas de ranura (#0000FF, capa GRABADO)
  for (const lbl of sec.slotLabels) {
    // lbl.x y lbl.y son relativas a b.minU, b.minV
    const xText = (lbl.x + margin).toFixed(3);
    const yText = (viewBoxH - (lbl.y + margin)).toFixed(3);
    labelsSvg.push(
      `<text x="${xText}" y="${yText}" fill="#0000FF" font-size="${lbl.fontSize}" font-family="JetBrains Mono, monospace" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${lbl.text}</text>`
    );
  }

  // Etiqueta principal de la pieza en la esquina inferior izquierda
  const idX = (margin + 4).toFixed(3);
  const idY = (viewBoxH - margin - 4).toFixed(3);
  labelsSvg.push(
    `<text x="${idX}" y="${idY}" fill="#0000FF" font-size="3.5" font-family="JetBrains Mono, monospace" font-weight="bold">${sec.id}</text>`
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxW.toFixed(3)} ${viewBoxH.toFixed(3)}" width="${viewBoxW.toFixed(1)}mm" height="${viewBoxH.toFixed(1)}mm">
  <rect width="100%" height="100%" fill="#F8FAFC" />
  <g id="GUIAS_DEBUG">
    ${guides.join('\n    ')}
  </g>
  <g id="GRABADO" fill="none" stroke="#0000FF" stroke-width="0.1">
    ${labelsSvg.join('\n    ')}
  </g>
  <g id="CORTE" fill="#FEE2E2" stroke="#FF0000" stroke-width="0.35" fill-rule="nonzero">
    <path d="${pathData.join(' ')}" />
  </g>
</svg>`;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const thickness = 3.0;
  const clearance = 0.1;
  const kerf = 0.15;
  const drawnSlotWidth = thickness + clearance - kerf; // 2.95 mm

  // Modelo de prueba: Escultura cúpula de 80 x 80 x 45 mm
  // P1: planos en x = -20, 0, +20 (prefijo X)
  // P2: planos en y = -20, 0, +20 (prefijo Y)
  const p1Coords = [-20.0, 0.0, 20.0];
  const p2Coords = [-20.0, 0.0, 20.0];

  const p1Sections: WaffleSection[] = [];
  const p2Sections: WaffleSection[] = [];

  // Construir secciones P1 (vistas laterales)
  for (let i = 0; i < p1Coords.length; i++) {
    const xCoord = p1Coords[i];
    // A mayor distancia del centro, el ancho y alto del domo decrecen esféricamente
    const rMax = 40.0;
    const rLocal = Math.sqrt(Math.max(100, rMax * rMax - xCoord * xCoord));
    const hLocal = 45.0 * (rLocal / rMax);
    const rawPoly = createDomeSection(rLocal, hLocal);
    const bounds = computeBounds([rawPoly]);

    p1Sections.push({
      id: `X${i + 1}`,
      family: 'P1',
      indexInFamily: i,
      planeCoord: xCoord,
      rawPolygons: [rawPoly],
      polygons: [],
      slots: [],
      slotLabels: [],
      bounds2D: bounds,
    });
  }

  // Construir secciones P2 (vistas frontales)
  for (let j = 0; j < p2Coords.length; j++) {
    const yCoord = p2Coords[j];
    const rMax = 40.0;
    const rLocal = Math.sqrt(Math.max(100, rMax * rMax - yCoord * yCoord));
    const hLocal = 45.0 * (rLocal / rMax);
    const rawPoly = createDomeSection(rLocal, hLocal);
    const bounds = computeBounds([rawPoly]);

    p2Sections.push({
      id: `Y${j + 1}`,
      family: 'P2',
      indexInFamily: j,
      planeCoord: yCoord,
      rawPolygons: [rawPoly],
      polygons: [],
      slots: [],
      slotLabels: [],
      bounds2D: bounds,
    });
  }

  // Calcular cruces activos entre P1 y P2
  const crossings: WaffleCrossing[] = [];
  const slotsP1ByPiece = new Map<string, SlotRect[]>();
  const slotsP2ByPiece = new Map<string, SlotRect[]>();

  for (const s1 of p1Sections) {
    for (const s2 of p2Sections) {
      const cr = computeCrossing(s1, s2, drawnSlotWidth);
      if (cr) {
        crossings.push(cr);

        const list1 = slotsP1ByPiece.get(s1.id) ?? [];
        list1.push(cr.slotOnP1);
        slotsP1ByPiece.set(s1.id, list1);

        const list2 = slotsP2ByPiece.get(s2.id) ?? [];
        list2.push(cr.slotOnP2);
        slotsP2ByPiece.set(s2.id, list2);
      }
    }
  }

  // Ranurar cada sección y colocar etiquetas
  const allSections = [...p1Sections, ...p2Sections];
  for (const s of p1Sections) {
    s.slots = slotsP1ByPiece.get(s.id) ?? [];
    s.polygons = subtractSlotsFromSection(s.rawPolygons, s.slots);
    const lblRes = computeLocalSlotLabels(s.polygons, s.bounds2D, s.slots, 'P1');
    s.slotLabels = lblRes.labels;
  }

  for (const s of p2Sections) {
    s.slots = slotsP2ByPiece.get(s.id) ?? [];
    s.polygons = subtractSlotsFromSection(s.rawPolygons, s.slots);
    const lblRes = computeLocalSlotLabels(s.polygons, s.bounds2D, s.slots, 'P2');
    s.slotLabels = lblRes.labels;
  }

  console.log(`[Waffle Preview] Generated ${crossings.length} crossings.`);
  console.log(`Drawn slot width: ${drawnSlotWidth.toFixed(3)} mm (t=${thickness}, c=${clearance}, kerf=${kerf})`);

  for (const sec of allSections) {
    const svg = renderSectionToSvg(sec, crossings, drawnSlotWidth);
    const outPath = path.join(OUTPUT_DIR, `${sec.id}.svg`);
    fs.writeFileSync(outPath, svg, 'utf-8');
    console.log(`  -> Wrote ${sec.id}.svg (${sec.polygons.length} polys, ${sec.slots.length} slots, ${sec.slotLabels.length} labels) to ${outPath}`);
  }

  // Generar overview.svg con las 6 piezas dispuestas en cuadrícula (2 filas x 3 columnas)
  const cellW = 110;
  const cellH = 75;
  const overviewW = cellW * 3 + 20;
  const overviewH = cellH * 2 + 30;

  const overviewSvgParts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${overviewW} ${overviewH}" width="${overviewW}mm" height="${overviewH}mm">`,
    `  <rect width="100%" height="100%" fill="#0F172A" />`,
    `  <text x="20" y="22" fill="#F8FAFC" font-size="7" font-family="Inter, sans-serif" font-weight="bold">Waffle 2D Engine Prototype (Phase 9.0 Preview)</text>`,
    `  <text x="20" y="30" fill="#94A3B8" font-size="3" font-family="JetBrains Mono, monospace">t=${thickness}mm · c=${clearance}mm · kerf=${kerf}mm · drawnSlotWidth=${drawnSlotWidth.toFixed(3)}mm · CORTE: #FF0000 · GRABADO: #0000FF · v*: #10B981</text>`,
  ];

  for (let idx = 0; idx < allSections.length; idx++) {
    const sec = allSections[idx];
    const row = Math.floor(idx / 3);
    const col = idx % 3;
    const posX = 15 + col * cellW;
    const posY = 38 + row * cellH;

    const pieceSvg = renderSectionToSvg(sec, crossings, drawnSlotWidth);
    // Extraer contenido interno de SVG (remover <svg...> y </svg>)
    const innerContent = pieceSvg
      .replace(/<\?xml[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>/, '');

    overviewSvgParts.push(
      `  <g transform="translate(${posX}, ${posY})">`,
      `    <rect width="100" height="65" fill="#1E293B" rx="4" stroke="#334155" stroke-width="0.5" />`,
      `    <text x="8" y="10" fill="#E2E8F0" font-size="3.5" font-family="JetBrains Mono, monospace" font-weight="bold">Pieza ${sec.id} (${sec.family})</text>`,
      `    ${innerContent}`,
      `  </g>`
    );
  }

  overviewSvgParts.push(`</svg>`);
  const overviewPath = path.join(OUTPUT_DIR, 'overview.svg');
  fs.writeFileSync(overviewPath, overviewSvgParts.join('\n'), 'utf-8');
  console.log(`  -> Wrote overview.svg to ${overviewPath}`);
  console.log(`[Waffle Preview] All SVGs dumped to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
