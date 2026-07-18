"use client";

import { extrusions, geometries } from "@jscad/modeling";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Geom3 } from "@jscad/modeling/src/geometries/types";
import { isGeom2, isGeom3, type CadGeometry } from "@/lib/scad/evaluator";

interface ModelViewportProps {
  geometries: CadGeometry[];
  wireframe: boolean;
  autoRotate: boolean;
  fitViewRequest: number;
  // Receives a PNG-capture function while the viewport is mounted (P3.1
  // thumbnails). Returns a data URL ≤ 512 KB, or null with nothing to render.
  captureRef?: React.RefObject<(() => string | null) | null>;
}

interface ViewportState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  hasFitModel: boolean;
}

const THUMBNAIL_BYTE_LIMIT = 512 * 1024;

// The renderer runs without preserveDrawingBuffer, so the capture renders and
// reads the canvas synchronously in the same frame, then downscales onto an
// offscreen canvas. Falls to smaller sizes if the PNG exceeds the byte cap.
function capturePng(current: ViewportState): string | null {
  if (!current.mesh) return null;
  current.renderer.render(current.scene, current.camera);
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

function fitView(current: ViewportState) {
  const box = current.mesh?.geometry.boundingBox;
  if (!box) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 1.12, 14);
  current.controls.target.copy(center);
  current.camera.position.copy(center).add(new THREE.Vector3(radius, -radius * 1.3, radius));
  current.camera.near = Math.max(radius / 1000, 0.05);
  current.camera.far = radius * 40;
  current.camera.updateProjectionMatrix();
  current.controls.update();
  current.hasFitModel = true;
}

export function ModelViewport({ geometries: sourceGeometries, wireframe, autoRotate, fitViewRequest, captureRef }: ModelViewportProps) {
  const container = useRef<HTMLDivElement>(null);
  const state = useRef<ViewportState | null>(null);
  const wireframeSetting = useRef(wireframe);

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

    scene.add(new THREE.HemisphereLight(0xdde8de, 0x31362e, 2.25));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(-80, -60, 140);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x84cbbd, 1.4);
    rim.position.set(100, 80, 55);
    scene.add(rim);

    const grid = new THREE.GridHelper(500, 50, 0x4b5149, 0x292d29);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.04;
    (grid.material as THREE.Material).opacity = 0.6;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const axes = new THREE.AxesHelper(22);
    axes.position.set(-0.02, -0.02, 0.02);
    scene.add(axes);

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
    state.current = { scene, camera, controls, renderer, hasFitModel: false };
    if (captureRef) captureRef.current = () => (state.current ? capturePng(state.current) : null);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
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
    if (current.mesh) {
      current.scene.remove(current.mesh);
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
    current.scene.add(mesh);
    current.mesh = mesh;
    buffer.computeBoundingBox();
    if (!current.hasFitModel) fitView(current);
  }, [sourceGeometries]);

  useEffect(() => {
    if (fitViewRequest > 0 && state.current?.mesh) fitView(state.current);
  }, [fitViewRequest]);

  return <div ref={container} className="model-viewport" aria-label="Interactive 3D model preview" />;
}
