declare module "@jscad/stl-serializer" {
  export const mimeType: string;
  export function serialize(options: { binary?: boolean; name?: string }, ...objects: unknown[]): ArrayBuffer[] | string[];
}

declare module "@jscad/obj-serializer" {
  export const mimeType: string;
  export function serialize(options: { triangulate?: boolean }, ...objects: unknown[]): ArrayBuffer[] | Uint8Array[] | string[];
}

declare module "@jscad/3mf-serializer" {
  export const mimeType: string;
  export const fileExtension: string;
  export function serialize(options: { unit?: string; metadata?: boolean; compress?: boolean }, ...objects: unknown[]): ArrayBuffer[] | Uint8Array[] | string[];
}

declare module "@jscad/stl-deserializer" {
  export function deserialize(options: { output: "geometry"; filename?: string }, input: string | ArrayBuffer): unknown[];
}

declare module "@jscad/obj-deserializer" {
  export function deserialize(options: { output: "geometry"; filename?: string; orientation?: "outward" | "inward" }, input: string): unknown[];
}

declare module "@jscad/svg-deserializer" {
  export function deserialize(options: { output: "geometry"; filename?: string; pxPmm?: number }, input: string): unknown[];
}

declare module "@jscad/dxf-deserializer" {
  export function deserialize(options: { output: "geometry"; filename?: string; strict?: boolean }, input: string): unknown[];
}

declare module "@jscad/svg-serializer" {
  export const mimeType: string;
  export function serialize(options: { unit?: string }, ...objects: unknown[]): string[];
}

declare module "@jscad/dxf-serializer" {
  export const mimeType: string;
  export function serialize(options: { geom2To?: "lwpolyline" | "polyline" }, ...objects: unknown[]): string[];
}
