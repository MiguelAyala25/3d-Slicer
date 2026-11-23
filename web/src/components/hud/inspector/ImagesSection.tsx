import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { pickBestPlaneForDecal } from '../../../core/imageProjection';
import { useSculptureStore } from '../../../store/useSculptureStore';
import type { DecalProjectionMode } from '../../../types/sculpture';
import { NumericInput } from '../../ui/NumericInput';
import { SelectField } from '../../ui/SelectField';

export function ImagesSection() {
  const [isOpen, setIsOpen] = useState(true);
  const [aspectLocked, setAspectLocked] = useState(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const build = useSculptureStore((s) => s.build);
  const meshGeometry = useSculptureStore((s) => s.meshGeometry);
  const params = useSculptureStore((s) => s.params);
  const sliceResult = useSculptureStore((s) => s.sliceResult);
  const decals = useSculptureStore((s) => s.decals);
  const selectedDecalId = useSculptureStore((s) => s.selectedDecalId);
  const decalObjectUrls = useSculptureStore((s) => s.decalObjectUrls);
  const cameraPreset = useSculptureStore((s) => s.cameraPreset);

  const setParam = useSculptureStore((s) => s.setParam);
  const setCameraPreset = useSculptureStore((s) => s.setCameraPreset);
  const addDecalFromFile = useSculptureStore((s) => s.addDecalFromFile);
  const updateDecal = useSculptureStore((s) => s.updateDecal);
  const removeDecal = useSculptureStore((s) => s.removeDecal);
  const reorderDecal = useSculptureStore((s) => s.reorderDecal);
  const selectDecal = useSculptureStore((s) => s.selectDecal);
  const openPrintCalibrationPreview = useSculptureStore(
    (s) => s.openPrintCalibrationPreview
  );

  const orderedDecals = useMemo(
    () => [...decals].sort((a, b) => b.order - a.order),
    [decals]
  );

  const selectedDecal = useMemo(
    () => decals.find((d) => d.id === selectedDecalId) ?? null,
    [decals, selectedDecalId]
  );

  const plateOptions = useMemo(() => {
    const count = sliceResult?.plates.length ?? params.plates;
    return Array.from({ length: count }, (_, i) => ({
      value: String(i),
      label: `Placa P${i}`,
    }));
  }, [sliceResult, params.plates]);

  if (build.techniqueId !== 'stacked') return null;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    try {
      for (const f of files) {
        await addDecalFromFile(f);
      }
    } finally {
      e.target.value = '';
    }
  };

  const handleModeChange = (mode: DecalProjectionMode) => {
    if (!selectedDecal) return;
    if (mode === 'plane') {
      const nextIdx =
        selectedDecal.plateIndex !== undefined
          ? selectedDecal.plateIndex
          : sliceResult
            ? pickBestPlaneForDecal(sliceResult, selectedDecal)
            : 0;
      updateDecal(selectedDecal.id, { mode: 'plane', plateIndex: nextIdx });
    } else {
      updateDecal(selectedDecal.id, { mode: 'surface' });
    }
  };

  return (
    <section
      data-testid="section-images"
      className="flex flex-col gap-2 bg-white/[0.02] p-2.5 rounded-2xl border border-white/[0.05]"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={handleFileChange}
        className="hidden"
        data-testid="decal-file-input"
      />

      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        data-testid="toggle-images-collapse"
        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[#131315] hover:bg-[#1f1f21] border transition-all cursor-pointer group ${
          isOpen
            ? 'border-[#0071e3]/40 bg-[#131315]'
            : 'border-white/[0.08] hover:border-white/15'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#2997ff] shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#8b919e] group-hover:text-white shrink-0" />
          )}
          <ImageIcon className="w-3.5 h-3.5 text-[#2997ff] shrink-0" />
          <h2 className="text-[13px] font-semibold text-[#cccccc] group-hover:text-white">
            Imágenes
          </h2>
        </div>

        <span className="px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] font-mono-tabular text-[#8b919e] group-hover:text-white shrink-0">
          {decals.length}
        </span>
      </button>

      {isOpen && (
        <div className="pt-1 flex flex-col gap-2.5">
          {decals.length > 0 && params.axis !== 'y' && (
            <div
              data-testid="axis-y-projection-warning"
              className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/35 text-[11px] text-amber-200"
            >
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>La proyección frontal requiere cortar en eje Y.</span>
              </div>
              <button
                type="button"
                data-testid="btn-switch-axis-y"
                onClick={() => setParam('axis', 'y')}
                className="self-start px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-[11px] transition-colors cursor-pointer"
              >
                Cambiar a eje Y
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!meshGeometry}
              onClick={() => fileInputRef.current?.click()}
              data-testid="btn-add-image"
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#252527] hover:bg-[#2f2f33] disabled:opacity-40 border border-white/[0.08] text-xs font-medium text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5 text-[#2997ff]" />
              <span>Agregar imagen...</span>
            </button>
          </div>

          {decals.length === 0 ? (
            <p className="text-[11px] text-[#8b919e] px-1">
              Arrastra una imagen (.png, .jpg, .webp) al visor frontal o usa el botón superior.
            </p>
          ) : (
            <>
              {cameraPreset !== 'front' && (
                <button
                  type="button"
                  onClick={() => setCameraPreset('front')}
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#0071e3]/15 hover:bg-[#0071e3]/25 border border-[#0071e3]/40 text-[11px] font-medium text-[#60A5FA] transition-colors cursor-pointer"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>Ir a vista frontal para editar en 3D</span>
                </button>
              )}

              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-0.5">
                {orderedDecals.map((d, idx) => {
                  const isSel = d.id === selectedDecalId;
                  const thumbUrl = decalObjectUrls[d.imageKey];
                  return (
                    <div
                      key={d.id}
                      onClick={() => selectDecal(d.id)}
                      className={`flex items-center gap-2 p-1.5 rounded-xl border transition-colors cursor-pointer ${
                        isSel
                          ? 'bg-[#0071e3]/15 border-[#0071e3]/50'
                          : 'bg-[#131315] border-white/[0.06] hover:border-white/15'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-black/40 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={d.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="w-3.5 h-3.5 text-[#8b919e]" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-white truncate">
                          {d.name}
                        </div>
                        <div className="text-[10px] text-[#8b919e] font-mono-tabular">
                          {d.mode === 'surface' ? 'Superficie' : `Plano P${d.plateIndex ?? 0}`} · {d.widthMm.toFixed(0)}×{d.heightMm.toFixed(0)} mm
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          title={d.visible ? 'Ocultar' : 'Mostrar'}
                          onClick={() => updateDecal(d.id, { visible: !d.visible })}
                          className="p-1 rounded-lg text-[#8b919e] hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          {d.visible ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          title="Subir capa"
                          disabled={idx === 0}
                          onClick={() => reorderDecal(d.id, 'up')}
                          className="p-1 rounded-lg text-[#8b919e] hover:text-white hover:bg-white/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          title="Bajar capa"
                          disabled={idx === orderedDecals.length - 1}
                          onClick={() => reorderDecal(d.id, 'down')}
                          className="p-1 rounded-lg text-[#8b919e] hover:text-white hover:bg-white/10 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          title="Eliminar imagen"
                          onClick={() => removeDecal(d.id)}
                          className="p-1 rounded-lg text-[#8b919e] hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {selectedDecal && (
            <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-[#131315] border border-white/[0.06]">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[#8b919e] select-none">
                  Modo de proyección
                </span>
                <div className="grid grid-cols-2 gap-1 p-0.5 rounded-full bg-[#1b1b1d] border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => handleModeChange('surface')}
                    className={`h-7 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                      selectedDecal.mode === 'surface'
                        ? 'bg-[#0066cc] text-white'
                        : 'text-[#8b919e] hover:text-white'
                    }`}
                  >
                    Superficie
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('plane')}
                    className={`h-7 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                      selectedDecal.mode === 'plane'
                        ? 'bg-[#0066cc] text-white'
                        : 'text-[#8b919e] hover:text-white'
                    }`}
                  >
                    Plano
                  </button>
                </div>
              </div>

              {selectedDecal.mode === 'plane' && (
                <SelectField<string>
                  label="Placa destino"
                  value={String(selectedDecal.plateIndex ?? 0)}
                  options={plateOptions}
                  onChange={(v) =>
                    updateDecal(selectedDecal.id, { plateIndex: Number(v) })
                  }
                />
              )}

              <div className="grid grid-cols-2 gap-2">
                <NumericInput
                  label="Centro X"
                  value={selectedDecal.centerX}
                  min={-5000}
                  max={5000}
                  step={0.5}
                  unit="mm"
                  onChange={(v) => updateDecal(selectedDecal.id, { centerX: v })}
                />
                <NumericInput
                  label="Centro Z"
                  value={selectedDecal.centerZ}
                  min={-5000}
                  max={5000}
                  step={0.5}
                  unit="mm"
                  onChange={(v) => updateDecal(selectedDecal.id, { centerZ: v })}
                />
              </div>

              <div className="flex items-end gap-1.5">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <NumericInput
                    label="Ancho"
                    value={selectedDecal.widthMm}
                    min={1}
                    max={5000}
                    step={0.5}
                    unit="mm"
                    onChange={(v) =>
                      updateDecal(selectedDecal.id, {
                        widthMm: v,
                        ...(aspectLocked
                          ? {
                              heightMm: Number(
                                (v * (selectedDecal.pxH / selectedDecal.pxW)).toFixed(2)
                              ),
                            }
                          : {}),
                      })
                    }
                  />
                  <NumericInput
                    label="Alto"
                    value={selectedDecal.heightMm}
                    min={1}
                    max={5000}
                    step={0.5}
                    unit="mm"
                    onChange={(v) =>
                      updateDecal(selectedDecal.id, {
                        heightMm: v,
                        ...(aspectLocked
                          ? {
                              widthMm: Number(
                                (v * (selectedDecal.pxW / selectedDecal.pxH)).toFixed(2)
                              ),
                            }
                          : {}),
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setAspectLocked((v) => !v)}
                  title={
                    aspectLocked
                      ? 'Proporción bloqueada'
                      : 'Proporción libre'
                  }
                  className={`h-9 w-8 rounded-xl border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                    aspectLocked
                      ? 'bg-[#0071e3]/15 border-[#0071e3]/40 text-[#2997ff]'
                      : 'bg-[#1b1b1d] border-white/[0.08] text-[#8b919e]'
                  }`}
                >
                  {aspectLocked ? (
                    <Lock className="w-3.5 h-3.5" />
                  ) : (
                    <Unlock className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              <NumericInput
                label="Rotación"
                value={selectedDecal.rotationDeg}
                min={-180}
                max={180}
                step={1}
                unit="°"
                onChange={(v) => updateDecal(selectedDecal.id, { rotationDeg: v })}
              />
            </div>
          )}

          <button
            type="button"
            data-testid="btn-print-calibration-sheet"
            onClick={openPrintCalibrationPreview}
            className="w-full bg-[#252527] text-[#2997ff] border border-[#2997ff]/40 hover:bg-[#2997ff]/10 rounded-xl py-2 text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Hoja de calibración de impresión</span>
          </button>
        </div>
      )}
    </section>
  );
}
