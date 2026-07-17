import type { ModelMetrics } from "../scad/compiler";
import type { ModelParameter, ParameterValue } from "../scad/parameters";

export interface HostedModelDraft {
  name: string;
  description?: string;
  source: string;
  files?: Record<string, string>;
  parameters?: Record<string, ParameterValue>;
  tags?: string[];
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
  metrics: ModelMetrics;
}
