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
}

interface ViewportState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  hasFitModel: boolean;
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

export function ModelViewport({ geometries: sourceGeometries, wireframe, autoRotate, fitViewRequest }: ModelViewportProps) {
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
    state.current = { scene, camera, controls, hasFitModel: false };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      state.current = null;
    };
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
