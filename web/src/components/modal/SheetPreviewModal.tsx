import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertTriangle,
  Archive,
  Download,
  Maximize2,
  Printer,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { blobToDataUrl } from '../../core/autosave';
import {
  exportAllSheetsZip,
  generateSheetDxf,
  getSheetFileBaseName,
  type DxfExportOptions,
} from '../../core/dxfExporter';
import { projectDecals } from '../../core/imageProjection';
import { buildPrintCalibrationPackage } from '../../core/printCalibration';
import { buildPrintSheets } from '../../core/printLayout';
import { generatePrintSheetSvg } from '../../core/printSvgExporter';
import {
  computeTilingPlan,
  generateTileMapSvg,
  PAPER_PRESETS,
} from '../../core/printTiling';
import { getDiscardedChainsSummary } from '../../core/slicer';
import { generateSheetSvg, type SvgExportOptions } from '../../core/svgExporter';
import {
  computeRasterPixelDims,
  exportSheetsWithPrintZip,
  loadImageSourcesMap,
  renderPrintSheetToPng,
  renderPrintTileToPng,
} from '../../export/printRaster';
import { useSculptureStore } from '../../store/useSculptureStore';
import type {
  PaperPresetId,
  PlateLabelPrintMode,
  PrintFormat,
  PrintTechnique,
  TileOrientation,
} from '../../types/sculpture';

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

async function resolveDataUrlsForSvgExport(
  urls: Record<string, string>
): Promise<Record<string, string>> {
  const entries = Object.entries(urls);
  const resolved: Record<string, string> = {};
  await Promise.all(
    entries.map(async ([key, url]) => {
      if (url.startsWith('blob:')) {
        const res = await fetch(url);
        const blob = await res.blob();
        resolved[key] = await blobToDataUrl(blob);
      } else {
        resolved[key] = url;
      }
    })
  );
  return resolved;
}

type PreviewCanvasMode = 'combined' | 'cut' | 'tiling';

export function SheetPreviewModal() {
  const isOpen = useSculptureStore((s) => s.isPreviewModalOpen);
  const sheets = useSculptureStore((s) => s.sheetLayouts);
  const closeModal = useSculptureStore((s) => s.closeSheetPreviewModal);
  const build = useSculptureStore((s) => s.build);
  const params = useSculptureStore((s) => s.params);
  const lastSliceAxis = useSculptureStore((s) => s.lastSliceAxis);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const decals = useSculptureStore((s) => s.decals);
  const decalObjectUrls = useSculptureStore((s) => s.decalObjectUrls);
  const printConfig = useSculptureStore((s) => s.printConfig);
  const setPrintConfig = useSculptureStore((s) => s.setPrintConfig);
  const setPrintTilingConfig = useSculptureStore((s) => s.setPrintTilingConfig);
  const isPrintCalibrationPreview = useSculptureStore(
    (s) => s.isPrintCalibrationPreview
  );
  const exportAnywayConfirmed = useSculptureStore((s) => s.exportAnywayConfirmed);
  const confirmExportAnyway = useSculptureStore((s) => s.confirmExportAnyway);

  const [activeTab, setActiveTab] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [previewMode, setPreviewMode] = useState<PreviewCanvasMode>('combined');
  const [isExportingPrint, setIsExportingPrint] = useState(false);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 960, height: 520 });

  useEffect(() => {
    if (!isOpen) return;
    setPreviewMode('combined');
    setActiveTab(0);
    setZoom(1.0);
  }, [isOpen, isPrintCalibrationPreview]);

  useEffect(() => {
    if (!isOpen) return;
    const el = previewViewportRef.current;
    if (!el) return;
    const updateSize = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setViewportSize({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

  const hasPrintMode =
    isPrintCalibrationPreview ||
    (build.techniqueId === 'stacked' &&
      lastSliceAxis === 'y' &&
      decals.some((d) => d.visible));

  const effectiveBleedMm = printConfig.bleedMm;

  const calibrationPkg = useMemo(() => {
    if (!isOpen || !isPrintCalibrationPreview) return null;
    return buildPrintCalibrationPackage(params, {
      bleedMm: effectiveBleedMm,
      mirrorPrint: printConfig.mirrorPrint,
      includeRegistrationMarks: printConfig.includeRegistrationMarks,
      includePrintedLabels: printConfig.plateLabelMode === 'print',
    });
  }, [
    isOpen,
    isPrintCalibrationPreview,
    params,
    effectiveBleedMm,
    printConfig.mirrorPrint,
    printConfig.includeRegistrationMarks,
    printConfig.plateLabelMode,
  ]);

  const activeSheets = calibrationPkg ? calibrationPkg.sheets : sheets;
  const currentSheet = activeSheets?.[activeTab] ?? activeSheets?.[0] ?? null;

  const activeImageUrls = useMemo(() => {
    if (!calibrationPkg) return decalObjectUrls;
    return {
      ...decalObjectUrls,
      [calibrationPkg.decal.imageKey]: calibrationPkg.imageDataUrl,
    };
  }, [calibrationPkg, decalObjectUrls]);

  const printSheets = useMemo(() => {
    if (!isOpen || !hasPrintMode || !activeSheets || !printConfig.enabled) return [];
    if (calibrationPkg) return calibrationPkg.printSheets;
    if (!sliceResult) return [];
    const regions = projectDecals(sliceResult, decals, {
      bleedMm: effectiveBleedMm,
    });
    return buildPrintSheets(activeSheets, regions, {
      mirrorHorizontal: printConfig.mirrorPrint,
      includeRegistrationMarks: printConfig.includeRegistrationMarks,
      includePrintedLabels: printConfig.plateLabelMode === 'print',
    });
  }, [
    isOpen,
    hasPrintMode,
    activeSheets,
    printConfig.enabled,
    printConfig.mirrorPrint,
    printConfig.includeRegistrationMarks,
    printConfig.plateLabelMode,
    calibrationPkg,
    sliceResult,
    decals,
    effectiveBleedMm,
  ]);

  const currentPrintSheet = useMemo(() => {
    if (!currentSheet) return null;
    return (
      printSheets.find((ps) => ps.sheetIndex === currentSheet.sheetIndex) ?? null
    );
  }, [printSheets, currentSheet]);

  const cutExportOptions: DxfExportOptions & SvgExportOptions = useMemo(() => {
    if (!hasPrintMode || !printConfig.enabled) {
      return { includeReference: true };
    }
    return {
      includeReference: true,
      includeRegistrationMarks: printConfig.includeRegistrationMarks,
      mirrorHorizontal: printConfig.mirrorPrint,
      omitEngravedPlateLabels: printConfig.plateLabelMode !== 'engrave',
    };
  }, [
    hasPrintMode,
    printConfig.enabled,
    printConfig.includeRegistrationMarks,
    printConfig.mirrorPrint,
    printConfig.plateLabelMode,
  ]);

  const tilingEvaluation = useMemo(() => {
    if (
      !isOpen ||
      !currentSheet ||
      !hasPrintMode ||
      !printConfig.enabled ||
      printConfig.technique !== 'adhesive-film' ||
      !printConfig.tiling.enabled
    ) {
      return { plan: null, error: null as string | null };
    }
    try {
      const plan = computeTilingPlan(
        currentSheet.sheetIndex,
        currentSheet.width,
        currentSheet.height,
        printConfig.tiling
      );
      return { plan, error: null };
    } catch (err) {
      return {
        plan: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [isOpen, currentSheet, hasPrintMode, printConfig]);

  const rasterInfo = useMemo(() => {
    if (!currentSheet) return null;
    if (tilingEvaluation.plan) {
      return computeRasterPixelDims(
        tilingEvaluation.plan.paperW,
        tilingEvaluation.plan.paperH,
        printConfig.dpi
      );
    }
    return computeRasterPixelDims(
      currentSheet.width,
      currentSheet.height,
      printConfig.dpi
    );
  }, [currentSheet, tilingEvaluation.plan, printConfig.dpi]);

  const discardedSummary = useMemo(() => {
    if (isPrintCalibrationPreview || build.techniqueId !== 'stacked') {
      return { totalDiscarded: 0, affectedFloors: [] };
    }
    return getDiscardedChainsSummary(sliceResult);
  }, [isPrintCalibrationPreview, build.techniqueId, sliceResult]);

  const isBlocked =
    !isPrintCalibrationPreview &&
    discardedSummary.totalDiscarded > 0 &&
    !exportAnywayConfirmed;

  const canShowTiling =
    printConfig.technique === 'adhesive-film' &&
    printConfig.tiling.enabled &&
    Boolean(tilingEvaluation.plan);
  const effectivePreviewMode: PreviewCanvasMode =
    previewMode === 'tiling' && !canShowTiling ? 'combined' : previewMode;

  const svgMarkup = useMemo(() => {
    if (!isOpen || !currentSheet) return '';
    if (
      hasPrintMode &&
      printConfig.enabled &&
      effectivePreviewMode === 'tiling' &&
      tilingEvaluation.plan
    ) {
      return generateTileMapSvg(currentSheet, tilingEvaluation.plan);
    }
    if (
      hasPrintMode &&
      printConfig.enabled &&
      effectivePreviewMode === 'combined' &&
      currentPrintSheet
    ) {
      return generatePrintSheetSvg(currentPrintSheet, activeImageUrls, {
        cutOverlaySheet: currentSheet,
        includeSheetBorder: true,
      });
    }
    return generateSheetSvg(
      currentSheet,
      currentSheet.sheetType === 'plates'
        ? cutExportOptions
        : { includeReference: true }
    );
  }, [
    isOpen,
    currentSheet,
    hasPrintMode,
    printConfig.enabled,
    effectivePreviewMode,
    tilingEvaluation.plan,
    currentPrintSheet,
    activeImageUrls,
    cutExportOptions,
  ]);

  if (!isOpen || !activeSheets || !currentSheet) return null;

  const availW = Math.max(240, viewportSize.width - 48);
  const availH = Math.max(200, viewportSize.height - 48);
  const baseScale = Math.min(availW / currentSheet.width, availH / currentSheet.height);
  const displayW = Math.max(120, Math.round(currentSheet.width * baseScale * zoom));
  const displayH = Math.max(90, Math.round(currentSheet.height * baseScale * zoom));

  const currentCutOpts =
    currentSheet.sheetType === 'plates'
      ? cutExportOptions
      : { includeReference: true };

  const handleDownloadCurrentDxf = () => {
    if (isBlocked) return;
    const dxf = generateSheetDxf(currentSheet, currentCutOpts);
    const base = getSheetFileBaseName(currentSheet);
    triggerBlobDownload(
      new Blob([dxf], { type: 'application/dxf;charset=utf-8' }),
      `${base}.dxf`
    );
  };

  const handleDownloadCurrentSvg = () => {
    if (isBlocked) return;
    const svg = generateSheetSvg(currentSheet, currentCutOpts);
    const base = getSheetFileBaseName(currentSheet);
    triggerBlobDownload(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      `${base}.svg`
    );
  };

  const handleDownloadCurrentPrint = async () => {
    if (isBlocked || !currentPrintSheet) return;
    const base = getSheetFileBaseName(currentSheet);
    setIsExportingPrint(true);
    try {
      if (
        printConfig.technique === 'adhesive-film' &&
        printConfig.tiling.enabled &&
        tilingEvaluation.plan
      ) {
        const imgs = await loadImageSourcesMap(activeImageUrls);
        const zip = new JSZip();
        zip.file(
          `${base}_mapa_mosaico.svg`,
          generateTileMapSvg(currentSheet, tilingEvaluation.plan)
        );
        for (const tile of tilingEvaluation.plan.tiles) {
          const pngBytes = await renderPrintTileToPng(
            currentPrintSheet,
            tile,
            imgs,
            printConfig.dpi
          );
          zip.file(`${base}_impresion_${tile.fileSuffix}.png`, pngBytes);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        triggerBlobDownload(zipBlob, `${base}_mosaicos.zip`);
        return;
      }

      if (printConfig.format === 'svg') {
        const exportUrls = await resolveDataUrlsForSvgExport(activeImageUrls);
        const svg = generatePrintSheetSvg(currentPrintSheet, exportUrls);
        triggerBlobDownload(
          new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
          `${base}_impresion.svg`
        );
      } else {
        const imgs = await loadImageSourcesMap(activeImageUrls);
        const pngBytes = await renderPrintSheetToPng(
          currentPrintSheet,
          imgs,
          printConfig.dpi
        );
        triggerBlobDownload(
          new Blob([pngBytes.buffer as ArrayBuffer], { type: 'image/png' }),
          `${base}_impresion.png`
        );
        if (printConfig.format === 'both') {
          const exportUrls = await resolveDataUrlsForSvgExport(activeImageUrls);
          const svg = generatePrintSheetSvg(currentPrintSheet, exportUrls);
          triggerBlobDownload(
            new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
            `${base}_impresion.svg`
          );
        }
      }
    } catch (err) {
      useSculptureStore.setState({
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsExportingPrint(false);
    }
  };

  const handleDownloadAllZip = async () => {
    if (isBlocked) return;
    if (!hasPrintMode || !printConfig.enabled) {
      const zipBlob = await exportAllSheetsZip(activeSheets);
      triggerBlobDownload(zipBlob, 'cortes_escultura_dxf_svg.zip');
      return;
    }

    setIsExportingPrint(true);
    try {
      const needRaster =
        printConfig.format === 'png' ||
        printConfig.format === 'both' ||
        (printConfig.technique === 'adhesive-film' && printConfig.tiling.enabled);
      const needSvgExport =
        printConfig.format === 'svg' || printConfig.format === 'both';
      const [imgs, exportUrls] = await Promise.all([
        needRaster
          ? loadImageSourcesMap(activeImageUrls)
          : Promise.resolve({} as Record<string, CanvasImageSource>),
        needSvgExport
          ? resolveDataUrlsForSvgExport(activeImageUrls)
          : Promise.resolve(activeImageUrls),
      ]);
      const zipBlob = await exportSheetsWithPrintZip(
        activeSheets,
        printSheets,
        printConfig,
        exportUrls,
        imgs
      );
      triggerBlobDownload(
        zipBlob,
        isPrintCalibrationPreview
          ? 'calibracion_corte_impresion.zip'
          : 'escultura_corte_e_impresion.zip'
      );
    } catch (err) {
      useSculptureStore.setState({
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsExportingPrint(false);
    }
  };

  const rasterExceeded =
    Boolean(rasterInfo?.exceedsMax) &&
    (printConfig.format === 'png' ||
      printConfig.format === 'both' ||
      (printConfig.technique === 'adhesive-film' && printConfig.tiling.enabled));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Previsualización de hojas de corte 2D"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 md:p-6"
    >
      <div className="flex flex-col w-full max-w-6xl h-[90vh] rounded-xl bg-[#121215] border border-white/10 shadow-2xl overflow-hidden">
        {/* Encabezado y pestañas */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#18181B]">
          <div className="flex items-center gap-2 overflow-x-auto">
            {isPrintCalibrationPreview && (
              <span className="px-2.5 py-1 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-semibold shrink-0">
                Calibración de Impresión
              </span>
            )}
            {activeSheets.map((s, idx) => {
              const label =
                s.sheetType === 'plates'
                  ? `Hoja ${s.sheetIndex + 1} — Placas (${s.materialThickness} mm)`
                  : `Hoja ${s.sheetIndex + 1} — Discos (${s.materialThickness} mm)`;
              return (
                <button
                  key={s.sheetIndex}
                  type="button"
                  onClick={() => setActiveTab(idx)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 ${
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

        {/* Barra de métricas y zoom */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 border-b border-white/10 bg-[#121215] text-xs text-[#A1A1AA] hud-text-selectable">
          <div className="flex flex-wrap items-center gap-4 font-mono-tabular">
            <span>
              Hoja: {currentSheet.width} × {currentSheet.height} mm
            </span>
            <span>
              Usado: {currentSheet.usedWidth} × {currentSheet.usedHeight} mm (
              {currentSheet.occupancyPct}%)
            </span>
            <span className="text-emerald-400">
              Sobrante: {currentSheet.remnantWidth} × {currentSheet.remnantHeight}{' '}
              mm
            </span>
          </div>

          <div className="flex items-center gap-2">
            {hasPrintMode && printConfig.enabled && (
              <div className="flex items-center gap-1 bg-white/5 rounded-md p-0.5 mr-2">
                <button
                  type="button"
                  onClick={() => setPreviewMode('combined')}
                  className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                    effectivePreviewMode === 'combined'
                      ? 'bg-[#0A84FF] text-white'
                      : 'text-[#A1A1AA] hover:text-white'
                  }`}
                >
                  Corte + Impresión
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('cut')}
                  className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                    effectivePreviewMode === 'cut'
                      ? 'bg-[#0A84FF] text-white'
                      : 'text-[#A1A1AA] hover:text-white'
                  }`}
                >
                  Solo corte
                </button>
                {printConfig.technique === 'adhesive-film' &&
                  printConfig.tiling.enabled &&
                  tilingEvaluation.plan && (
                    <button
                      type="button"
                      onClick={() => setPreviewMode('tiling')}
                      className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                        effectivePreviewMode === 'tiling'
                          ? 'bg-[#0A84FF] text-white'
                          : 'text-[#A1A1AA] hover:text-white'
                      }`}
                    >
                      Mapa de mosaico
                    </button>
                  )}
              </div>
            )}

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

        {/* Panel de configuración de impresión */}
        {hasPrintMode && (
          <div
            data-testid="print-export-options-bar"
            className="flex flex-col gap-2 px-4 py-2.5 border-b border-white/10 bg-[#18181B]/70 text-xs text-[#E4E4E7]"
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 font-medium cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={printConfig.enabled}
                  onChange={(e) => setPrintConfig({ enabled: e.target.checked })}
                  className="accent-[#0A84FF] cursor-pointer"
                />
                <Printer className="w-3.5 h-3.5 text-[#2997ff]" />
                <span>Incluir impresión</span>
              </label>

              {printConfig.enabled && (
                <>
                  <label className="flex items-center gap-1.5">
                    <span className="text-[#A1A1AA]">Técnica:</span>
                    <select
                      value={printConfig.technique}
                      onChange={(e) => {
                        const tech = e.target.value as PrintTechnique;
                        setPrintConfig({ technique: tech });
                      }}
                      className="bg-[#121215] border border-white/15 rounded px-2 py-1 text-xs text-white"
                    >
                      <option value="uv">UV hoja entera</option>
                      <option value="adhesive-film">Film adhesivo (PET/PP)</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1.5">
                    <span className="text-[#A1A1AA]">Formato:</span>
                    <select
                      value={printConfig.format}
                      onChange={(e) =>
                        setPrintConfig({ format: e.target.value as PrintFormat })
                      }
                      className="bg-[#121215] border border-white/15 rounded px-2 py-1 text-xs text-white"
                    >
                      <option value="svg">SVG (vectorial mm)</option>
                      <option value="png">PNG (DPI exacto)</option>
                      <option value="both">Ambos (SVG + PNG)</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-1.5">
                    <span className="text-[#A1A1AA]">DPI:</span>
                    <input
                      type="number"
                      min={72}
                      max={1200}
                      step={50}
                      value={printConfig.dpi}
                      onChange={(e) =>
                        setPrintConfig({
                          dpi: Math.max(72, Math.min(1200, Number(e.target.value) || 300)),
                        })
                      }
                      className="w-16 bg-[#121215] border border-white/15 rounded px-2 py-1 text-xs font-mono-tabular text-white"
                    />
                  </label>

                  <label className="flex items-center gap-1.5">
                    <span className="text-[#A1A1AA]">Sangrado (mm):</span>
                    <input
                      type="number"
                      min={0}
                      max={5}
                      step={0.25}
                      value={printConfig.bleedMm}
                      onChange={(e) =>
                        setPrintConfig({
                          bleedMm: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
                        })
                      }
                      className="w-14 bg-[#121215] border border-white/15 rounded px-2 py-1 text-xs font-mono-tabular text-white"
                    />
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={printConfig.includeRegistrationMarks}
                      onChange={(e) =>
                        setPrintConfig({
                          includeRegistrationMarks: e.target.checked,
                        })
                      }
                      className="accent-[#0A84FF] cursor-pointer"
                    />
                    <span>Marcas registro</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={printConfig.mirrorPrint}
                      onChange={(e) =>
                        setPrintConfig({ mirrorPrint: e.target.checked })
                      }
                      className="accent-[#0A84FF] cursor-pointer"
                    />
                    <span>Espejo (tinta al frente)</span>
                  </label>

                  <label className="flex items-center gap-1.5">
                    <span className="text-[#A1A1AA]">Etiquetas:</span>
                    <select
                      value={printConfig.plateLabelMode}
                      onChange={(e) =>
                        setPrintConfig({
                          plateLabelMode: e.target.value as PlateLabelPrintMode,
                        })
                      }
                      className="bg-[#121215] border border-white/15 rounded px-2 py-1 text-xs text-white"
                    >
                      <option value="print">Imprimir</option>
                      <option value="engrave">Grabar (láser)</option>
                      <option value="none">Ocultar</option>
                    </select>
                  </label>
                </>
              )}
            </div>

            {printConfig.enabled && printConfig.technique === 'adhesive-film' && (
              <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-white/[0.06]">
                <span className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/15 border border-amber-500/35 text-amber-200 text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  Usa film PET o polipropileno. Nunca PVC en el láser.
                </span>

                <label className="flex items-center gap-1.5 cursor-pointer select-none font-medium">
                  <input
                    type="checkbox"
                    checked={printConfig.tiling.enabled}
                    onChange={(e) =>
                      setPrintTilingConfig({ enabled: e.target.checked })
                    }
                    className="accent-[#0A84FF] cursor-pointer"
                  />
                  <span>Dividir en mosaicos</span>
                </label>

                {printConfig.tiling.enabled && (
                  <>
                    <select
                      value={printConfig.tiling.preset}
                      onChange={(e) =>
                        setPrintTilingConfig({
                          preset: e.target.value as PaperPresetId,
                        })
                      }
                      className="bg-[#121215] border border-white/15 rounded px-2 py-1 text-xs text-white"
                    >
                      {Object.entries(PAPER_PRESETS).map(([k, p]) => (
                        <option key={k} value={k}>
                          {p.label}
                        </option>
                      ))}
                      <option value="custom">Personalizado (mm)</option>
                    </select>

                    {printConfig.tiling.preset === 'custom' && (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={30}
                          max={2000}
                          value={printConfig.tiling.customW}
                          onChange={(e) =>
                            setPrintTilingConfig({
                              customW: Number(e.target.value) || 215.9,
                            })
                          }
                          className="w-14 bg-[#121215] border border-white/15 rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                        />
                        <span>×</span>
                        <input
                          type="number"
                          min={30}
                          max={2000}
                          value={printConfig.tiling.customH}
                          onChange={(e) =>
                            setPrintTilingConfig({
                              customH: Number(e.target.value) || 279.4,
                            })
                          }
                          className="w-14 bg-[#121215] border border-white/15 rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                        />
                      </div>
                    )}

                    <select
                      value={printConfig.tiling.orientation}
                      onChange={(e) =>
                        setPrintTilingConfig({
                          orientation: e.target.value as TileOrientation,
                        })
                      }
                      className="bg-[#121215] border border-white/15 rounded px-2 py-1 text-xs text-white"
                    >
                      <option value="auto">Orientación: Auto</option>
                      <option value="portrait">Vertical</option>
                      <option value="landscape">Horizontal</option>
                    </select>

                    <label className="flex items-center gap-1">
                      <span className="text-[#A1A1AA]">Traslape:</span>
                      <input
                        type="number"
                        min={0}
                        max={40}
                        step={1}
                        value={printConfig.tiling.overlapMm}
                        onChange={(e) =>
                          setPrintTilingConfig({
                            overlapMm: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-12 bg-[#121215] border border-white/15 rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                      />
                    </label>

                    <label className="flex items-center gap-1">
                      <span className="text-[#A1A1AA]">Margen imp.:</span>
                      <input
                        type="number"
                        min={0}
                        max={25}
                        step={0.5}
                        value={printConfig.tiling.printerMarginMm}
                        onChange={(e) =>
                          setPrintTilingConfig({
                            printerMarginMm: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-12 bg-[#121215] border border-white/15 rounded px-1.5 py-1 text-xs font-mono-tabular text-white"
                      />
                    </label>

                    {tilingEvaluation.plan ? (
                      <span className="text-[#60A5FA] font-mono-tabular">
                        {tilingEvaluation.plan.cols} × {tilingEvaluation.plan.rows} ={' '}
                        {tilingEvaluation.plan.tiles.length} hojas (
                        {tilingEvaluation.plan.orientationUsed === 'portrait'
                          ? 'Vertical'
                          : 'Horizontal'}
                        )
                      </span>
                    ) : tilingEvaluation.error ? (
                      <span className="text-red-400">{tilingEvaluation.error}</span>
                    ) : null}
                  </>
                )}
              </div>
            )}

            {printConfig.enabled && rasterExceeded && rasterInfo && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-red-500/15 border border-red-500/35 text-red-200 text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span>
                  El PNG a {printConfig.dpi} DPI mediría {rasterInfo.pxW} ×{' '}
                  {rasterInfo.pxH} px (máximo 16384 px). Reduce el DPI a ≤{' '}
                  {rasterInfo.maxSafeDpi} o exporta en SVG.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Banner de bloqueo por cadenas abiertas descartadas (DEC-2 / D2) */}
        {!isPrintCalibrationPreview && discardedSummary.totalDiscarded > 0 && (
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
                <strong>Atención:</strong> Se descartaron{' '}
                {discardedSummary.totalDiscarded} cadena(s) abierta(s) en los
                pisos:{' '}
                {discardedSummary.affectedFloors
                  .map((f) => `Piso ${f}`)
                  .join(', ')}
                .
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
        <div
          ref={previewViewportRef}
          className="flex-1 overflow-auto p-6 flex bg-[#09090B]"
        >
          <div
            style={{
              width: `${displayW}px`,
              height: `${displayH}px`,
            }}
            className="m-auto shrink-0 bg-white/95 rounded shadow-lg p-2 [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        </div>

        {/* Pie de acciones de exportación */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-white/10 bg-[#18181B]">
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#A1A1AA]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#FF0000] inline-block" /> CORTE
              (#FF0000)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#0000FF] inline-block" /> GRABADO
              (#0000FF)
            </span>
            {hasPrintMode &&
              printConfig.enabled &&
              printConfig.includeRegistrationMarks && (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#00AA00] inline-block" />{' '}
                  REGISTRO (#00AA00)
                </span>
              )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            {hasPrintMode && printConfig.enabled && currentPrintSheet && (
              <button
                type="button"
                disabled={isBlocked || isExportingPrint || rasterExceeded}
                onClick={handleDownloadCurrentPrint}
                data-testid="btn-export-current-print"
                className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-white transition-opacity"
              >
                <Printer className="w-3.5 h-3.5" />
                Exportar impresión (esta hoja)
              </button>
            )}
            <button
              type="button"
              disabled={
                isBlocked ||
                isExportingPrint ||
                rasterExceeded ||
                Boolean(tilingEvaluation.error)
              }
              onClick={handleDownloadAllZip}
              data-testid="btn-export-all-zip"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold text-white transition-opacity"
            >
              <Archive className="w-3.5 h-3.5" />
              {hasPrintMode && printConfig.enabled
                ? 'Exportar todas (.zip Corte + Impresión)'
                : 'Exportar todas (.zip DXF + SVG)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
