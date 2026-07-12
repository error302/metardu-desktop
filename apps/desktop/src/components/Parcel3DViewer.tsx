/**
 * 3D Parcel Viewer — Three.js Renderer Component
 *
 * OV-UI2: Web apps are 2D only. This component renders parcels in 3D
 * with building extrusion, subsurface rights, and cross-sections.
 *
 * Uses Three.js for GPU-accelerated 3D rendering.
 * Designed to run in a detachable window (OV6).
 */

import { useEffect, useRef, useState } from 'react';

interface Parcel3DViewerProps {
  parcels: Array<{
    id: string;
    number: string;
    footprint: Array<[number, number]>;
    height: number;
    color?: [number, number, number];
  }>;
  subsurfaceRights?: Array<{
    type: string;
    footprint: Array<[number, number]>;
    depthFrom: number;
    depthTo: number;
  }>;
  beacons?: Array<{
    number: string;
    position: [number, number, number];
  }>;
}

export function Parcel3DViewer({ parcels, subsurfaceRights, beacons }: Parcel3DViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [showSubsurface, setShowSubsurface] = useState(true);
  const [showBeacons, setShowBeacons] = useState(true);
  const [extrudeHeight, setExtrudeHeight] = useState(15);

  useEffect(() => {
    if (!mountRef.current || parcels.length === 0) return;

    let cleanup: (() => void) | undefined;

    // Dynamically import Three.js (keeps initial bundle smaller)
    import('three').then((THREE) => {
      const mount = mountRef.current!;
      const width = mount.clientWidth;
      const height = mount.clientHeight;

      // Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);

      // Camera — orthographic-ish perspective for survey plans
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
      camera.position.set(200, -200, 300);
      camera.lookAt(0, 0, 0);

      // Renderer
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(window.devicePixelRatio);
      mount.appendChild(renderer.domElement);

      // Lighting
      const ambient = new THREE.AmbientLight(0x404060, 0.6);
      scene.add(ambient);
      const directional = new THREE.DirectionalLight(0xffffff, 0.8);
      directional.position.set(100, -100, 200);
      scene.add(directional);

      // Grid
      const gridHelper = new THREE.GridHelper(500, 50, 0x303050, 0x202030);
      gridHelper.rotation.x = Math.PI / 2;
      scene.add(gridHelper);

      // Axes (East = red, North = green, Up = blue)
      const axesHelper = new THREE.AxesHelper(50);
      scene.add(axesHelper);

      // Center the parcels
      let cx = 0, cy = 0, count = 0;
      for (const p of parcels) {
        for (const [x, y] of p.footprint) { cx += x; cy += y; count++; }
      }
      cx /= count; cy /= count;

      // Render parcels
      for (const parcel of parcels) {
        const color = parcel.color ?? [0.2, 0.6, 0.3];
        const h = parcel.height || extrudeHeight;

        // Extruded building
        const shape = new THREE.Shape();
        const pts = parcel.footprint.map(([x, y]) => new THREE.Vector2(x - cx, y - cy));
        shape.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
        shape.lineTo(pts[0].x, pts[0].y);

        const extrudeSettings = { depth: h, bevelEnabled: false };
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        const material = new THREE.MeshPhongMaterial({
          color: new THREE.Color(color[0], color[1], color[2]),
          transparent: true,
          opacity: 0.85,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2; // lay flat
        scene.add(mesh);

        // Wireframe overlay
        const edges = new THREE.EdgesGeometry(geometry);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1 });
        const wireframe = new THREE.LineSegments(edges, lineMaterial);
        wireframe.rotation.x = -Math.PI / 2;
        scene.add(wireframe);
      }

      // Render subsurface rights
      if (showSubsurface && subsurfaceRights) {
        for (const right of subsurfaceRights) {
          const shape = new THREE.Shape();
          const pts = right.footprint.map(([x, y]) => new THREE.Vector2(x - cx, y - cy));
          shape.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
          shape.lineTo(pts[0].x, pts[0].y);

          const depth = right.depthTo - right.depthFrom;
          const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
          const material = new THREE.MeshPhongMaterial({
            color: 0x8b4513,
            transparent: true,
            opacity: 0.4,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.z = -right.depthFrom;
          scene.add(mesh);
        }
      }

      // Render beacons
      if (showBeacons && beacons) {
        for (const beacon of beacons) {
          const geometry = new THREE.SphereGeometry(2, 16, 16);
          const material = new THREE.MeshPhongMaterial({ color: 0xff6600 });
          const sphere = new THREE.Mesh(geometry, material);
          sphere.position.set(beacon.position[0] - cx, beacon.position[1] - cy, beacon.position[2]);
          scene.add(sphere);
        }
      }

      // Simple orbit controls (mouse drag to rotate, wheel to zoom)
      let isDragging = false;
      let prevX = 0, prevY = 0;
      let azimuth = Math.PI / 4, elevation = Math.PI / 4;
      let radius = 400;

      const updateCamera = () => {
        camera.position.x = radius * Math.cos(elevation) * Math.sin(azimuth);
        camera.position.y = radius * Math.cos(elevation) * Math.cos(azimuth);
        camera.position.z = radius * Math.sin(elevation);
        camera.lookAt(0, 0, 0);
      };
      updateCamera();

      const onMouseDown = (e: MouseEvent) => { isDragging = true; prevX = e.clientX; prevY = e.clientY; };
      const onMouseUp = () => { isDragging = false; };
      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - prevX;
        const dy = e.clientY - prevY;
        azimuth -= dx * 0.01;
        elevation = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, elevation + dy * 0.01));
        prevX = e.clientX; prevY = e.clientY;
        updateCamera();
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        radius = Math.max(50, Math.min(2000, radius + e.deltaY * 0.5));
        updateCamera();
      };

      mount.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('mousemove', onMouseMove);
      mount.addEventListener('wheel', onWheel, { passive: false });

      // Animation loop
      const animate = () => {
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      };
      animate();

      // Resize handler
      const onResize = () => {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      // Cleanup
      cleanup = () => {
        mount.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('mousemove', onMouseMove);
        mount.removeEventListener('wheel', onWheel);
        window.removeEventListener('resize', onResize);
        if (mount.contains(renderer.domElement)) {
          mount.removeChild(renderer.domElement);
        }
        renderer.dispose();
      };
    });

    return () => { if (cleanup) cleanup(); };
  }, [parcels, subsurfaceRights, beacons, showSubsurface, showBeacons, extrudeHeight]);

  return (
    <div className="parcel-3d-viewer">
      <div className="viewer-controls">
        <label>
          <input type="checkbox" checked={showSubsurface} onChange={(e) => setShowSubsurface(e.target.checked)} />
          Subsurface
        </label>
        <label>
          <input type="checkbox" checked={showBeacons} onChange={(e) => setShowBeacons(e.target.checked)} />
          Beacons
        </label>
        <label>
          Height:
          <input type="range" min="5" max="50" value={extrudeHeight} onChange={(e) => setExtrudeHeight(Number(e.target.value))} />
          {extrudeHeight}m
        </label>
      </div>
      <div ref={mountRef} className="viewer-canvas" />
      <div className="viewer-hint">Drag to rotate · Scroll to zoom</div>
    </div>
  );
}
