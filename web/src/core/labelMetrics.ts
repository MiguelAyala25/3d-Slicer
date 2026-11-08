/**
 * Proporción nominal entre el ancho medio de un glifo y su altura/tamaño de fuente.
 * Unifica las estimaciones de ancho de texto en layout y exportadores CAD (DXF y SVG).
 */
export const GLYPH_WIDTH_RATIO = 0.6;

/**
 * Estima el ancho total en milímetros de una cadena de texto para un tamaño de fuente dado.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * GLYPH_WIDTH_RATIO;
}
