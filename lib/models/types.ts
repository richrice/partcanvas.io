import type { ModelMetrics } from "../scad/compiler";
import type { ModelParameter, ParameterValue } from "../scad/parameters";

// Social-model metadata choices (D10).
export const LICENSES = ["CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-4.0", "CC0-1.0", "All rights reserved"] as const;
export type License = (typeof LICENSES)[number];
export const DEFAULT_LICENSE: License = "CC-BY-4.0";

export const VISIBILITIES = ["public", "unlisted", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export interface HostedModelDraft {
  name: string;
  description?: string;
  source: string;
  files?: Record<string, string>;
  parameters?: Record<string, ParameterValue>;
  tags?: string[];
  // Geometry measurements from the publisher's own compile. They are derived
  // data, not identity, so the content hash ignores them.
  metrics?: ModelMetrics | null;
}

export interface HostedModel {
  version: 1;
  id: string;
  createdAt: string;
  name: string;
  description: string;
  source: string;
  files: Record<string, string>;
  parameters: Record<string, ParameterValue>;
  tags: string[];
  parameterSchema: ModelParameter[];
  // Null when the publisher reported no usable measurements.
  metrics: ModelMetrics | null;
}
