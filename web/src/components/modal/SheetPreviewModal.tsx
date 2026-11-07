import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Download,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { generateSheetSvg } from '../../core/svgExporter';
import {
  exportAllSheetsZip,
  generateSheetDxf,
  getSheetFileBaseName,
} from '../../core/dxfExporter';
import { getDiscardedChainsSummary } from '../../core/slicer';
import { useSculptureStore } from '../../store/useSculptureStore';

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SheetPreviewModal() {
  const isOpen = useSculptureStore((s) => s.isPreviewModalOpen);
  const sheets = useSculptureStore((s) => s.sheetLayouts);
  const closeModal = useSculptureStore((s) => s.closeSheetPreviewModal);
  const build = useSculptureStore((s) => s.build);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const exportAnywayConfirmed = useSculptureStore((s) => s.exportAnywayConfirmed);
  const confirmExportAnyway = useSculptureStore((s) => s.confirmExportAnyway);

  const [activeTab, setActiveTab] = useState(0);
  const [zoom, setZoom] = useState(1.0);

  const currentSheet = sheets?.[activeTab] ?? sheets?.[0] ?? null;

  const discardedSummary = useMemo(() => {
    if (build.techniqueId !== 'stacked') return { totalDiscarded: 0, affectedFloors: [] };
    return getDiscardedChainsSummary(sliceResult);
  }, [build.techniqueId, sliceResult]);

  const isBlocked = discardedSummary.totalDiscarded > 0 && !exportAnywayConfirmed;

  const svgMarkup = useMemo(() => {
    if (!currentSheet) return '';
    return generateSheetSvg(currentSheet, { includeReference: true });
  }, [currentSheet]);

  if (!isOpen || !sheets || !currentSheet) return null;

  const handleDownloadCurrentDxf = () => {
    if (isBlocked) return;
    const dxf = generateSheetDxf(currentSheet);
    const base = getSheetFileBaseName(currentSheet);
    triggerBlobDownload(
      new Blob([dxf], { type: 'application/dxf;charset=utf-8' }),
      `${base}.dxf`
    );
  };

  const handleDownloadCurrentSvg = () => {
    if (isBlocked) return;
    const svg = generateSheetSvg(currentSheet, { includeReference: true });
    const base = getSheetFileBaseName(currentSheet);
    triggerBlobDownload(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `${base}.svg`
    );
  };

  const handleDownloadAllZip = async () => {
    if (isBlocked) return;
    const zipBlob = await exportAllSheetsZip(sheets);
    triggerBlobDownload(zipBlob, 'cortes_escultura_dxf_svg.zip');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Previsualización de hojas de corte 2D"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
    >
      <div className="flex flex-col w-full max-w-6xl h-[88vh] rounded-xl bg-[#121215] border border-white/10 shadow-2xl overflow-hidden">
        {/* Encabezado y pestañas */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#18181B]">
          <div className="flex items-center gap-2 overflow-x-auto">
            {sheets.map((s, idx) => {
              const label =
                s.sheetType === 'plates'
                  ? `Hoja ${s.sheetIndex + 1} — Placas (${s.materialThickness} mm)`
                  : `Hoja ${s.sheetIndex + 1} — Discos (${s.materialThickness} mm)`;
              return (
                <button
                  key={s.sheetIndex}
                  type="button"
                  onClick={() => setActiveTab(idx)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    idx === activeTab
                      ? 'bg-[#0A84FF] text-white'
                      : 'bg-white/5 text-[#A1A1AA] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Cerrar previsualización"
            className="p-1.5 rounded-md text-[#A1A1AA] hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barra de métricas seleccionables y zoom */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2.5 border-b border-white/10 bg-[#121215] text-xs text-[#A1A1AA] hud-text-selectable">
          <div className="flex flex-wrap items-center gap-4 font-mono-tabular">
            <span>
              Hoja: {currentSheet.width} × {currentSheet.height} mm
            </span>
            <span>
              Usado: {currentSheet.usedWidth} × {currentSheet.usedHeight} mm (
              {currentSheet.occupancyPct}%)
            </span>
            <span className="text-emerald-400">
              Sobrante: {currentSheet.remnantWidth} ×{' '}
              {currentSheet.remnantHeight} mm
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-[#F4F4F5]"
              title="Alejar"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono-tabular text-[#F4F4F5]">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(4.0, z + 0.25))}
              className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-[#F4F4F5]"
              title="Acercar"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1.0)}
              className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-[#F4F4F5]"
              title="Restablecer zoom"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Banner de bloqueo por cadenas abiertas descartadas (DEC-2 / D2) */}
        {discardedSummary.totalDiscarded > 0 && (
          <div
            data-testid="discarded-chains-export-warning"
            className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b text-xs ${
              isBlocked
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>Atención:</strong> Se descartaron {discardedSummary.totalDiscarded} cadena(s) abierta(s) en los pisos:{' '}
                {discardedSummary.affectedFloors.map((f) => `Piso ${f}`).join(', ')}.
                {isBlocked
                  ? ' La exportación está bloqueada para prevenir piezas cortadas incompletas.'
                  : ' Exportación desbloqueada bajo confirmación explícita.'}
              </span>
            </div>
            {isBlocked && (
              <button
                type="button"
                data-testid="btn-export-anyway"
                onClick={confirmExportAnyway}
                className="px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs transition-colors shrink-0 select-none shadow"
              >
                Exportar de todos modos
              </button>
            )}
          </div>
        )}

        {/* Lienzo SVG */}
        <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-[#09090B]">
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            className="bg-white/95 rounded shadow-lg p-3"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        </div>

        {/* Pie de acciones de exportación */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-white/10 bg-[#18181B]">
          <div className="flex items-center gap-4 text-xs text-[#A1A1AA]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#FF0000] inline-block" /> CORTE
              (#FF0000)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#0000FF] inline-block" /> GRABADO
              (#0000FF)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isBlocked}
              onClick={handleDownloadCurrentSvg}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-[#F4F4F5] transition-opacity"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar esta hoja (.svg)
            </button>
            <button
              type="button"
              disabled={isBlocked}
              onClick={handleDownloadCurrentDxf}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#0A84FF] hover:bg-[#0070E0] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-white transition-opacity"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar esta hoja (.dxf)
            </button>
            <button
              type="button"
              disabled={isBlocked}
              onClick={handleDownloadAllZip}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white transition-opacity"
            >
              <Archive className="w-3.5 h-3.5" />
              Exportar todas (.zip DXF + SVG)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
