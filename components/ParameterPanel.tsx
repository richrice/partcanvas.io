"use client";

import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { colors } from "@jscad/modeling";
import type { ModelParameter, ParameterValue } from "@/lib/scad/parameters";

interface ParameterPanelProps {
  parameters: ModelParameter[];
  values: Record<string, ParameterValue>;
  presets?: Array<{ key: string; name: string; filename: string; warningCount: number }>;
  selectedPreset?: string;
  onChange: (name: string, value: ParameterValue) => void;
  onPresetChange?: (key: string) => void;
  onReset: () => void;
}

function colorComponents(value: ParameterValue): [number, number, number] | undefined {
  if (Array.isArray(value) && value.length >= 3) {
    return [value[0], value[1], value[2]].map((component) => Math.min(1, Math.max(0, component))) as [number, number, number];
  }
  if (typeof value !== "string") return undefined;
  if (/^#[\da-f]{6}$/i.test(value)) return colors.hexToRgb(value).slice(0, 3) as [number, number, number];
  return colors.colorNameToRgb(value)?.slice(0, 3) as [number, number, number] | undefined;
}

function colorHex(value: ParameterValue, fallback: ParameterValue) {
  return colors.rgbToHex(colorComponents(value) ?? colorComponents(fallback) ?? [0.18, 0.75, 0.66]).slice(0, 7);
}

export function ParameterPanel({ parameters, values, presets = [], selectedPreset = "", onChange, onPresetChange, onReset }: ParameterPanelProps) {
  const groups = parameters.reduce<Record<string, ModelParameter[]>>((output, parameter) => {
    (output[parameter.section] ??= []).push(parameter);
    return output;
  }, {});

  return (
    <div className="parameter-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow"><SlidersHorizontal size={13} /> Customizer</span>
          <h2>Make it yours</h2>
        </div>
        <button className="icon-button" onClick={onReset} title="Reset parameters" aria-label="Reset parameters">
          <RotateCcw size={16} />
        </button>
      </div>
      <p className="panel-intro">Adjust the model without touching the script. Measurements are in millimeters.</p>
      {presets.length ? (
        <label className="preset-picker">
          <span>Starting preset</span>
          <select aria-label="Customizer preset" value={selectedPreset} onChange={(event) => onPresetChange?.(event.target.value)}>
            <option value="">Custom values</option>
            {presets.map((preset) => (
              <option value={preset.key} key={preset.key}>
                {preset.name} · {preset.filename}{preset.warningCount ? ` (${preset.warningCount} warning${preset.warningCount === 1 ? "" : "s"})` : ""}
              </option>
            ))}
          </select>
          <small>Loaded from OpenSCAD Customizer JSON</small>
        </label>
      ) : null}
      {!parameters.length && (
        <div className="empty-parameters">
          <SlidersHorizontal size={24} />
          <strong>No public parameters yet</strong>
          <span>Add a top-level assignment, such as <code>width = 40; // [10:1:80]</code></span>
        </div>
      )}
      {Object.entries(groups).map(([section, items]) => (
        <section className="parameter-group" key={section}>
          <div className="group-title"><span>{section}</span><ChevronDown size={14} /></div>
          <div className="parameter-list">
            {items.map((parameter) => {
              const value = values[parameter.name] ?? parameter.defaultValue;
              const selectedColor = parameter.type === "color" ? colorHex(value, parameter.defaultValue) : "";
              return (
                <label className="parameter-control" key={parameter.name}>
                  <span className="parameter-label">
                    <span>{parameter.label}</span>
                    {parameter.type === "number" && <output>{Number(value).toFixed(Number(parameter.step) < 1 ? 1 : 0)}{parameter.unit ? ` ${parameter.unit}` : ""}</output>}
                    {parameter.type === "vector" && <output>[{(Array.isArray(value) ? value : parameter.defaultValue as number[]).join(", ")}]</output>}
                    {parameter.type === "color" && <output>{selectedColor.toUpperCase()}</output>}
                  </span>
                  {parameter.description && <small>{parameter.description}</small>}
                  {parameter.type === "number" && parameter.min !== undefined && parameter.max !== undefined ? (
                    <div className="range-row">
                      <input
                        type="range"
                        min={parameter.min}
                        max={parameter.max}
                        step={parameter.step}
                        value={Number(value)}
                        onChange={(event) => onChange(parameter.name, Number(event.target.value))}
                      />
                      <input
                        className="number-input"
                        type="number"
                        min={parameter.min}
                        max={parameter.max}
                        step={parameter.step}
                        value={Number(value)}
                        onChange={(event) => onChange(parameter.name, Number(event.target.value))}
                      />
                    </div>
                  ) : parameter.type === "boolean" ? (
                    <button
                      type="button"
                      className={`toggle ${value ? "on" : ""}`}
                      onClick={() => onChange(parameter.name, !value)}
                      aria-pressed={Boolean(value)}
                    ><span />{value ? "Enabled" : "Disabled"}</button>
                  ) : parameter.type === "select" ? (
                    <select value={String(value)} onChange={(event) => {
                      const selected = parameter.options?.find((option) => String(option.value) === event.target.value);
                      if (selected) onChange(parameter.name, selected.value);
                    }}>
                      {parameter.options?.map((option) => <option value={String(option.value)} key={String(option.value)}>{option.label}</option>)}
                    </select>
                  ) : parameter.type === "color" ? (
                    <div className="color-input-row">
                      <input
                        aria-label={`${parameter.label} color`}
                        type="color"
                        value={selectedColor}
                        onChange={(event) => {
                          const next = colors.hexToRgb(event.target.value).slice(0, 3);
                          const currentAlpha = Array.isArray(value) && value.length === 4 ? value[3]
                            : Array.isArray(parameter.defaultValue) && parameter.defaultValue.length === 4 ? parameter.defaultValue[3] : undefined;
                          onChange(parameter.name, currentAlpha === undefined ? next : [...next, currentAlpha]);
                        }}
                      />
                      <span>{selectedColor.toUpperCase()}</span>
                    </div>
                  ) : parameter.type === "vector" ? (
                    <div className="vector-inputs">
                      {(Array.isArray(value) ? value : parameter.defaultValue as number[]).map((component, index, vector) => (
                        <input
                          aria-label={`${parameter.label} component ${index + 1}`}
                          className="number-input"
                          key={index}
                          type="number"
                          min={parameter.min}
                          max={parameter.max}
                          step={parameter.step}
                          value={component}
                          onChange={(event) => {
                            const next = [...vector];
                            next[index] = Number(event.target.value);
                            onChange(parameter.name, next);
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <input className="text-input" value={String(value)} onChange={(event) => onChange(parameter.name, event.target.value)} />
                  )}
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
