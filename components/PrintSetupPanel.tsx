"use client";

import {
  Check,
  CircleGauge,
  Crosshair,
  Info,
  Move,
  Printer,
  RotateCcw,
  RotateCw,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  MATERIAL_PROFILES,
  PRINTER_PROFILES,
  type BedFitAnalysis,
  type FdmGeometryAnalysis,
  type MaterialEstimate,
  type ModelPlacement,
  type PrintSettings,
  type PrinterProfile,
} from "@/lib/fdm";

interface PrintSetupPanelProps {
  open: boolean;
  settings: PrintSettings;
  printer: PrinterProfile;
  placement: ModelPlacement;
  fit: BedFitAnalysis | null;
  geometry: FdmGeometryAnalysis | null;
  material: MaterialEstimate | null;
  hasModel: boolean;
  onClose: () => void;
  onSettingsChange: (settings: PrintSettings) => void;
  onPlacementChange: (placement: ModelPlacement) => void;
  onBestFit: () => void;
  onFitPlate: () => void;
}

const format = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(Math.abs(value) >= 100 ? 0 : digits) : "—";

function NumericField({ label, value, min = 0, max = 10_000, step = 1, suffix = "mm", disabled = false, onChange }: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="print-number-field">
      <span>{label}</span>
      <span className="print-number-input">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const numeric = Number(event.target.value);
            if (Number.isFinite(numeric)) onChange(Math.min(max, Math.max(min, numeric)));
          }}
        />
        {suffix ? <small>{suffix}</small> : null}
      </span>
    </label>
  );
}

export function PrintFitBadge({ printer, fit, onClick }: { printer: PrinterProfile; fit: BedFitAnalysis | null; onClick: () => void }) {
  const state = fit?.fits ? "fits" : fit ? "overflow" : "empty";
  const overflow = fit?.overflow
    .map((value, index) => value > 0.005 ? `${["X", "Y", "Z"][index]} +${format(value)} mm` : "")
    .filter(Boolean)
    .join(" · ");
  return (
    <button className={`print-fit-badge ${state}`} type="button" onClick={onClick} aria-label="Open printer and build plate settings">
      <span className="print-fit-icon">{fit?.fits ? <Check size={15} /> : fit ? <TriangleAlert size={15} /> : <Printer size={15} />}</span>
      <span>
        <strong>{fit?.fits ? `Fits ${printer.shortName}` : fit ? "Outside build volume" : printer.shortName}</strong>
        <small>{fit
          ? fit.fits ? `${format(fit.spare[0])} × ${format(fit.spare[1])} × ${format(fit.spare[2])} mm spare` : `${overflow || "Placement crosses the printable edge"} over`
          : `${printer.width} × ${printer.depth} × ${printer.height} mm`}</small>
      </span>
    </button>
  );
}

export function PrintSetupPanel({
  open,
  settings,
  printer,
  placement,
  fit,
  geometry,
  material,
  hasModel,
  onClose,
  onSettingsChange,
  onPlacementChange,
  onBestFit,
  onFitPlate,
}: PrintSetupPanelProps) {
  if (!open) return null;

  const updateSettings = (patch: Partial<PrintSettings>) => onSettingsChange({ ...settings, ...patch });
  const updateCustom = (patch: Partial<PrintSettings["customProfile"]>) => updateSettings({
    customProfile: { ...settings.customProfile, ...patch },
  });
  const warnings = geometry ? [
    fit?.fits
      ? { level: "ok", title: "Inside build volume", detail: `${format(fit.edgeClearance)} mm to the nearest bed edge` }
      : { level: "error", title: "Does not fit this printer", detail: "Rotate, reposition, or choose a larger build volume." },
    geometry.contactArea >= 10 && geometry.contactRatio >= 0.02
      ? { level: "ok", title: "Bed contact looks usable", detail: `${format(geometry.contactArea)} mm² touching the plate` }
      : { level: "warning", title: "Small bed contact area", detail: `${format(geometry.contactArea)} mm² detected; a brim or new orientation may help.` },
    geometry.severeOverhangArea > 25 && geometry.severeOverhangRatio > 0.01
      ? { level: "warning", title: "Support may be needed", detail: `${format(geometry.severeOverhangArea)} mm² of steep downward-facing surface detected.` }
      : { level: "ok", title: "No large severe overhangs", detail: "Geometry-only check at a 50° threshold." },
    geometry.minDimension < settings.nozzleDiameter * 2
      ? { level: "warning", title: "Very small overall dimension", detail: `${format(geometry.minDimension, 2)} mm is under two nozzle widths.` }
      : { level: "info", title: `${geometry.partCount} printable volume${geometry.partCount === 1 ? "" : "s"}`, detail: geometry.partCount > 1 ? "Relative positions and colors will be preserved." : "The model will export as one positioned volume." },
  ] : [];

  return (
    <section className="print-setup-popover" aria-label="Printer and build plate settings">
      <div className="print-setup-header">
        <div>
          <span className="eyebrow"><Printer size={13} /> Print setup</span>
          <h2>Fit it to your printer</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close print setup"><X size={16} /></button>
      </div>

      <label className="print-select-field">
        <span>Printer profile</span>
        <select
          aria-label="Printer profile"
          value={settings.profileId}
          onChange={(event) => {
            const profileId = event.target.value;
            const preset = PRINTER_PROFILES.find((candidate) => candidate.id === profileId);
            updateSettings({ profileId, nozzleDiameter: preset?.nozzleDiameter ?? settings.customProfile.nozzleDiameter });
          }}
        >
          {PRINTER_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          <option value="custom">Custom printer…</option>
        </select>
      </label>

      {settings.profileId === "custom" ? (
        <div className="print-custom-fields">
          <label className="print-select-field bed-shape-field">
            <span>Bed shape</span>
            <select aria-label="Bed shape" value={settings.customProfile.bedShape} onChange={(event) => updateCustom({ bedShape: event.target.value === "circular" ? "circular" : "rectangular" })}>
              <option value="rectangular">Rectangular</option>
              <option value="circular">Circular</option>
            </select>
          </label>
          <NumericField label={settings.customProfile.bedShape === "circular" ? "Diameter" : "Width"} value={settings.customProfile.width} min={20} onChange={(width) => updateCustom(settings.customProfile.bedShape === "circular" ? { width, depth: width } : { width })} />
          <NumericField label="Depth" value={settings.customProfile.depth} min={20} disabled={settings.customProfile.bedShape === "circular"} onChange={(depth) => updateCustom({ depth })} />
          <NumericField label="Height" value={settings.customProfile.height} min={20} onChange={(height) => updateCustom({ height })} />
        </div>
      ) : (
        <div className="printer-dimensions"><span>BUILD VOLUME</span><strong>{printer.width} × {printer.depth} × {printer.height} mm</strong></div>
      )}

      <div className="print-two-column">
        <NumericField label="Safety margin" value={settings.safetyMargin} min={0} max={100} step={0.5} onChange={(safetyMargin) => updateSettings({ safetyMargin })} />
        <NumericField label="Nozzle" value={settings.nozzleDiameter} min={0.1} max={2} step={0.1} onChange={(nozzleDiameter) => updateSettings({ nozzleDiameter })} />
      </div>

      <div className="print-section-heading"><Move size={13} /><span>Placement</span><small>Automatically dropped to Z=0</small></div>
      <div className="placement-actions">
        <button type="button" onClick={() => onPlacementChange({ x: 0, y: 0, rotationZ: placement.rotationZ })} disabled={!hasModel}><Crosshair size={14} /> Center</button>
        <button type="button" onClick={() => onPlacementChange({ ...placement, rotationZ: ((placement.rotationZ + 90) % 360) as ModelPlacement["rotationZ"] })} disabled={!hasModel}><RotateCw size={14} /> Rotate 90°</button>
        <button type="button" onClick={onBestFit} disabled={!hasModel}><Sparkles size={14} /> Best fit</button>
        <button type="button" onClick={() => onPlacementChange({ x: 0, y: 0, rotationZ: 0 })} disabled={!hasModel} aria-label="Reset placement"><RotateCcw size={14} /></button>
      </div>
      <div className="print-three-column">
        <NumericField label="X" value={placement.x} min={-5000} max={5000} onChange={(x) => onPlacementChange({ ...placement, x })} />
        <NumericField label="Y" value={placement.y} min={-5000} max={5000} onChange={(y) => onPlacementChange({ ...placement, y })} />
        <label className="print-number-field">
          <span>Rotation</span>
          <select aria-label="Z rotation" value={placement.rotationZ} onChange={(event) => onPlacementChange({ ...placement, rotationZ: Number(event.target.value) as ModelPlacement["rotationZ"] })}>
            <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
          </select>
        </label>
      </div>

      <div className="print-view-toggles">
        <label><input type="checkbox" checked={settings.showBed} onChange={(event) => updateSettings({ showBed: event.target.checked })} /> Show build plate</label>
        <label><input type="checkbox" checked={settings.showBuildVolume} onChange={(event) => updateSettings({ showBuildVolume: event.target.checked })} /> Show height boundary</label>
        <label><input type="checkbox" checked={settings.exportPlacement} onChange={(event) => updateSettings({ exportPlacement: event.target.checked })} /> Apply placement to export</label>
        <button type="button" onClick={onFitPlate} disabled={!settings.showBed}><CircleGauge size={14} /> Frame entire plate</button>
      </div>

      <div className="print-section-heading"><CircleGauge size={13} /><span>FDM checks</span><small>Guidance, not slicing</small></div>
      {!geometry ? <div className="print-empty"><Info size={16} /> Compile a 3D model to run print checks.</div> : (
        <div className="print-checks">
          {warnings.map((warning) => (
            <div className={`print-check ${warning.level}`} key={warning.title}>
              <span>{warning.level === "ok" ? <Check size={13} /> : warning.level === "info" ? <Info size={13} /> : <TriangleAlert size={13} />}</span>
              <span><strong>{warning.title}</strong><small>{warning.detail}</small></span>
            </div>
          ))}
        </div>
      )}

      <div className="print-section-heading"><Info size={13} /><span>Material estimate</span><small>Solid volume only</small></div>
      <div className="material-controls">
        <label className="print-select-field">
          <span>Material</span>
          <select aria-label="Filament material" value={settings.materialId} onChange={(event) => updateSettings({ materialId: event.target.value })}>
            {MATERIAL_PROFILES.map((materialProfile) => <option value={materialProfile.id} key={materialProfile.id}>{materialProfile.name}</option>)}
          </select>
        </label>
        <NumericField label="Filament" value={settings.filamentDiameter} min={0.5} max={3} step={0.05} onChange={(filamentDiameter) => updateSettings({ filamentDiameter })} />
      </div>
      <div className="material-estimate">
        <div><span>FILAMENT</span><strong>{material ? `${format(material.filamentLengthMeters, 2)} m` : "—"}</strong></div>
        <div><span>MASS</span><strong>{material ? `${format(material.massGrams)} g` : "—"}</strong></div>
        <div><span>VOLUME</span><strong>{material ? `${format(material.volumeCm3)} cm³` : "—"}</strong></div>
      </div>
    </section>
  );
}
