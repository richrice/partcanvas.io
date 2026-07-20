"use client";

import { extrusions, geometries } from "@jscad/modeling";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Geom3 } from "@jscad/modeling/src/geometries/types";
import { isGeom2, isGeom3, type CadGeometry } from "@/lib/scad/evaluator";
import type { ModelPlacement, PrinterProfile } from "@/lib/fdm";

export type ViewPreset = "perspective" | "top" | "front" | "right";

interface ModelViewportProps {
  geometries: CadGeometry[];
  wireframe: boolean;
  autoRotate: boolean;
  viewRequest?: { view: ViewPreset; nonce: number; frame?: "model" | "bed" };
  printer?: PrinterProfile;
  safetyMargin?: number;
  placement?: ModelPlacement;
  showBed?: boolean;
  showBuildVolume?: boolean;
  modelFits?: boolean;
  // Fired when the user starts orbiting manually, so a selected standard view
  // (Top/Front/Right) can stop claiming to be active.
  onUserOrbit?: () => void;
  // Receives a PNG-capture function while the viewport is mounted (P3.1
  // thumbnails). Returns a data URL ≤ 512 KB, or null with nothing to render.
  captureRef?: React.RefObject<(() => string | null) | null>;
}

interface ViewportState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  modelGroup: THREE.Group;
  bedGroup: THREE.Group;
  mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  hasFitModel: boolean;
  printer?: PrinterProfile;
  placement: ModelPlacement;
}

const THUMBNAIL_BYTE_LIMIT = 512 * 1024;

// The renderer runs without preserveDrawingBuffer, so the capture renders and
// reads the canvas synchronously in the same frame, then downscales onto an
// offscreen canvas. Falls to smaller sizes if the PNG exceeds the byte cap.
function capturePng(current: ViewportState): string | null {
  if (!current.mesh) return null;
  const bedWasVisible = current.bedGroup.visible;
  current.bedGroup.visible = false;
  current.renderer.render(current.scene, current.camera);
  current.bedGroup.visible = bedWasVisible;
  const sourceCanvas = current.renderer.domElement;
  if (!sourceCanvas.width || !sourceCanvas.height) return null;
  for (const target of [512, 384, 256]) {
    const scale = Math.min(1, target / Math.max(sourceCanvas.width, sourceCanvas.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
    canvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    // Base64 inflates bytes by 4/3; compare against the decoded size.
    if ((dataUrl.length - "data:image/png;base64,".length) * 3 / 4 <= THUMBNAIL_BYTE_LIMIT) return dataUrl;
  }
  return null;
}

function createBufferGeometry(sources: Geom3[]) {
  const positions: number[] = [];
  const normals: number[] = [];
  const vertexColors: number[] = [];
  for (const source of sources) {
    const color = source.color ?? [0.46, 0.84, 0.76, 1];
    const polygons = geometries.geom3.toPolygons(source);
    for (const polygon of polygons) {
      if (polygon.vertices.length < 3) continue;
      const a = new THREE.Vector3(...polygon.vertices[0]);
      for (let index = 1; index < polygon.vertices.length - 1; index += 1) {
        const b = new THREE.Vector3(...polygon.vertices[index]);
        const c = new THREE.Vector3(...polygon.vertices[index + 1]);
        const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
        for (const vertex of [a, b, c]) {
          positions.push(vertex.x, vertex.y, vertex.z);
          normals.push(normal.x, normal.y, normal.z);
          vertexColors.push(color[0], color[1], color[2]);
        }
      }
    }
  }
  const output = new THREE.BufferGeometry();
  output.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  output.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  output.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
  output.computeBoundingSphere();
  return output;
}

// Camera offsets (in units of the fit radius) for the standard CAD views. The
// top view keeps a slight Y offset so the Z-up orbit controls never hit the
// gimbal pole exactly.
const VIEW_OFFSETS: Record<ViewPreset, [number, number, number]> = {
  perspective: [1, -1.3, 1],
  top: [0, -0.03, 1.6],
  front: [0, -1.6, 0],
  right: [1.6, 0, 0],
};

function fitView(current: ViewportState, view: ViewPreset = "perspective", frame: "model" | "bed" = "model") {
  const box = current.mesh?.geometry.boundingBox;
  if (!box) return;
  const geometrySize = box.getSize(new THREE.Vector3());
  const rotatedSize = current.placement.rotationZ === 90 || current.placement.rotationZ === 270
    ? new THREE.Vector3(geometrySize.y, geometrySize.x, geometrySize.z)
    : geometrySize;
  const frameBed = frame === "bed" && current.printer;
  const center = frameBed
    ? new THREE.Vector3(0, 0, Math.min(current.printer!.height * 0.08, 18))
    : new THREE.Vector3(current.placement.x, current.placement.y, geometrySize.z / 2);
  const size = frameBed
    ? new THREE.Vector3(current.printer!.width, current.printer!.depth, Math.min(current.printer!.height, Math.max(current.printer!.width, current.printer!.depth) * 0.55))
    : rotatedSize;
  const radius = Math.max(size.length() * 1.12, 14);
  const offset = VIEW_OFFSETS[view];
  current.controls.target.copy(center);
  current.camera.position.copy(center).add(new THREE.Vector3(radius * offset[0], radius * offset[1], radius * offset[2]));
  current.camera.near = Math.max(radius / 1000, 0.05);
  current.camera.far = radius * 40;
  current.camera.updateProjectionMatrix();
  // The default fog and zoom limits suit desk-sized parts; scale them up for
  // large models (e.g. automotive trim) so the fitted view isn't fogged out.
  const fog = current.scene.fog as THREE.Fog | null;
  if (fog) {
    fog.near = Math.max(180, radius * 1.8);
    fog.far = Math.max(520, radius * 6);
  }
  current.controls.maxDistance = Math.max(800, radius * 8);
  current.controls.update();
  current.hasFitModel = true;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material?.dispose());
    }
  });
}

function boundaryPoints(width: number, depth: number, shape: PrinterProfile["bedShape"], z = 0.035) {
  if (shape === "circular") {
    const radius = Math.min(width, depth) / 2;
    return Array.from({ length: 65 }, (_, index) => {
      const angle = index / 64 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
    });
  }
  return [
    new THREE.Vector3(-width / 2, -depth / 2, z),
    new THREE.Vector3(width / 2, -depth / 2, z),
    new THREE.Vector3(width / 2, depth / 2, z),
    new THREE.Vector3(-width / 2, depth / 2, z),
    new THREE.Vector3(-width / 2, -depth / 2, z),
  ];
}

function createBedVisual(printer: PrinterProfile, safetyMargin: number, showBuildVolume: boolean, modelFits: boolean) {
  const group = new THREE.Group();
  const outlineColor = modelFits ? 0x67cdb7 : 0xe07068;
  const surface = printer.bedShape === "circular"
    ? new THREE.CircleGeometry(Math.min(printer.width, printer.depth) / 2, 96)
    : new THREE.PlaneGeometry(printer.width, printer.depth);
  const plate = new THREE.Mesh(surface, new THREE.MeshBasicMaterial({ color: 0x1c2521, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }));
  plate.position.z = -0.08;
  group.add(plate);

  const outline = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(boundaryPoints(printer.width, printer.depth, printer.bedShape)),
    new THREE.LineBasicMaterial({ color: outlineColor, transparent: true, opacity: 0.95 }),
  );
  group.add(outline);

  const margin = Math.max(0, Math.min(safetyMargin, Math.min(printer.width, printer.depth) / 2));
  const printableWidth = Math.max(0.1, printer.width - margin * 2);
  const printableDepth = Math.max(0.1, printer.depth - margin * 2);
  if (margin > 0) {
    const printable = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(boundaryPoints(printableWidth, printableDepth, printer.bedShape, 0.045)),
      new THREE.LineDashedMaterial({ color: 0x9cb3a9, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.72 }),
    );
    printable.computeLineDistances();
    group.add(printable);
  }

  const gridPositions: number[] = [];
  const step = Math.max(10, Math.ceil(Math.max(printer.width, printer.depth) / 500) * 10);
  const radius = Math.min(printer.width, printer.depth) / 2;
  for (let x = Math.ceil(-printer.width / 2 / step) * step; x <= printer.width / 2 + 1e-9; x += step) {
    const yExtent = printer.bedShape === "circular" ? Math.sqrt(Math.max(0, radius ** 2 - x ** 2)) : printer.depth / 2;
    gridPositions.push(x, -yExtent, 0.01, x, yExtent, 0.01);
  }
  for (let y = Math.ceil(-printer.depth / 2 / step) * step; y <= printer.depth / 2 + 1e-9; y += step) {
    const xExtent = printer.bedShape === "circular" ? Math.sqrt(Math.max(0, radius ** 2 - y ** 2)) : printer.width / 2;
    gridPositions.push(-xExtent, y, 0.01, xExtent, y, 0.01);
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(gridPositions, 3));
  group.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x3b4a44, transparent: true, opacity: 0.68 })));

  const axesPositions = [-Math.min(14, printer.width / 8), 0, 0.07, Math.min(14, printer.width / 8), 0, 0.07, 0, -Math.min(14, printer.depth / 8), 0.07, 0, Math.min(14, printer.depth / 8), 0.07];
  const axesGeometry = new THREE.BufferGeometry();
  axesGeometry.setAttribute("position", new THREE.Float32BufferAttribute(axesPositions, 3));
  group.add(new THREE.LineSegments(axesGeometry, new THREE.LineBasicMaterial({ color: 0x8bdccb, transparent: true, opacity: 0.9 })));

  if (showBuildVolume) {
    const volumeGeometry = printer.bedShape === "circular"
      ? new THREE.CylinderGeometry(Math.min(printer.width, printer.depth) / 2, Math.min(printer.width, printer.depth) / 2, printer.height, 48, 1, true)
      : new THREE.BoxGeometry(printer.width, printer.depth, printer.height);
    if (printer.bedShape === "circular") volumeGeometry.rotateX(Math.PI / 2);
    const volume = new THREE.LineSegments(
      new THREE.EdgesGeometry(volumeGeometry, 35),
      new THREE.LineBasicMaterial({ color: outlineColor, transparent: true, opacity: 0.14 }),
    );
    volume.position.z = printer.height / 2;
    group.add(volume);
    volumeGeometry.dispose();
  }

  return group;
}

function applyPlacement(current: ViewportState, placement: ModelPlacement) {
  current.placement = placement;
  const box = current.mesh?.geometry.boundingBox;
  if (!box || !current.mesh) return;
  const center = box.getCenter(new THREE.Vector3());
  current.mesh.position.set(-center.x, -center.y, -box.min.z);
  current.modelGroup.position.set(placement.x, placement.y, 0);
  current.modelGroup.rotation.set(0, 0, placement.rotationZ * Math.PI / 180);
}

export function ModelViewport({
  geometries: sourceGeometries,
  wireframe,
  autoRotate,
  viewRequest,
  printer,
  safetyMargin = 0,
  placement = { x: 0, y: 0, rotationZ: 0 },
  showBed = false,
  showBuildVolume = false,
  modelFits = true,
  onUserOrbit,
  captureRef,
}: ModelViewportProps) {
  const container = useRef<HTMLDivElement>(null);
  const state = useRef<ViewportState | null>(null);
  const wireframeSetting = useRef(wireframe);
  const placementSetting = useRef(placement);
  const modelFitsSetting = useRef(modelFits);
  const onUserOrbitRef = useRef(onUserOrbit);
  useEffect(() => {
    onUserOrbitRef.current = onUserOrbit;
  }, [onUserOrbit]);

  useEffect(() => {
    if (!container.current) return;
    const host = container.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x171a17);
    scene.fog = new THREE.Fog(0x171a17, 180, 520);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
    camera.position.set(85, -105, 78);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.9;
    controls.target.set(0, 0, 12);
    controls.minDistance = 8;
    controls.maxDistance = 800;
    const notifyUserOrbit = () => onUserOrbitRef.current?.();
    controls.addEventListener("start", notifyUserOrbit);

    scene.add(new THREE.HemisphereLight(0xdde8de, 0x31362e, 2.25));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(-80, -60, 140);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x84cbbd, 1.4);
    rim.position.set(100, 80, 55);
    scene.add(rim);

    const bedGroup = new THREE.Group();
    const modelGroup = new THREE.Group();
    scene.add(bedGroup, modelGroup);

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = Math.max(width / Math.max(height, 1), 0.1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    state.current = { scene, camera, controls, renderer, modelGroup, bedGroup, hasFitModel: false, printer, placement };
    if (captureRef) captureRef.current = () => (state.current ? capturePng(state.current) : null);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener("start", notifyUserOrbit);
      controls.dispose();
      disposeObject(bedGroup);
      disposeObject(modelGroup);
      renderer.dispose();
      renderer.domElement.remove();
      state.current = null;
      if (captureRef) captureRef.current = null;
    };
    // The capture ref is a stable ref object; the viewport mounts once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.current) state.current.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    wireframeSetting.current = wireframe;
    if (state.current?.mesh) state.current.mesh.material.wireframe = wireframe;
  }, [wireframe]);

  useEffect(() => {
    const current = state.current;
    if (!current) return;
    current.scene.remove(current.bedGroup);
    disposeObject(current.bedGroup);
    current.bedGroup = printer && showBed
      ? createBedVisual(printer, safetyMargin, showBuildVolume, modelFits)
      : new THREE.Group();
    current.printer = printer;
    current.scene.add(current.bedGroup);
    if (current.mesh) {
      current.mesh.material.emissive.setHex(modelFits ? 0x000000 : 0x6f1914);
      current.mesh.material.emissiveIntensity = modelFits ? 0 : 0.7;
    }
  }, [printer, safetyMargin, showBed, showBuildVolume, modelFits]);

  useEffect(() => {
    placementSetting.current = placement;
    if (state.current) applyPlacement(state.current, placement);
  }, [placement]);

  useEffect(() => {
    modelFitsSetting.current = modelFits;
  }, [modelFits]);

  useEffect(() => {
    const current = state.current;
    if (!current) return;
    if (current.mesh) {
      current.modelGroup.remove(current.mesh);
      current.mesh.geometry.dispose();
      (current.mesh.material as THREE.Material).dispose();
      current.mesh = undefined;
    }
    const preview = sourceGeometries.flatMap((geometry) => isGeom3(geometry)
      ? [geometry]
      : isGeom2(geometry) ? [extrusions.extrudeLinear({ height: 0.3 }, geometry)] : []);
    if (!preview.length) return;
    const buffer = createBufferGeometry(preview);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.08,
      wireframe: wireframeSetting.current,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(buffer, material);
    current.modelGroup.add(mesh);
    current.mesh = mesh;
    buffer.computeBoundingBox();
    material.emissive.setHex(modelFitsSetting.current ? 0x000000 : 0x6f1914);
    material.emissiveIntensity = modelFitsSetting.current ? 0 : 0.7;
    applyPlacement(current, placementSetting.current);
    if (!current.hasFitModel) fitView(current);
  }, [sourceGeometries]);

  useEffect(() => {
    if (viewRequest && viewRequest.nonce > 0 && state.current?.mesh) fitView(state.current, viewRequest.view, viewRequest.frame);
  }, [viewRequest]);

  return <div ref={container} className="model-viewport" aria-label="Interactive 3D model preview" />;
}
