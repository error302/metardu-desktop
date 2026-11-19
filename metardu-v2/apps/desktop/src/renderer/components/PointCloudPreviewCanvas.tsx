import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointCloudPreviewResult } from "../../shared/point-cloud.js";

interface ClassLabel {
  code: number;
  meaning?: string | null;
}

interface PointCloudPreviewCanvasProps {
  preview: PointCloudPreviewResult;
  classLabels?: ClassLabel[];
}

interface ViewState {
  yaw: number;
  pitch: number;
  zoom: number;
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
}

const INITIAL_VIEW: ViewState = { yaw: Math.PI * 0.22, pitch: 0.42, zoom: 1 };

function classColor(code: number): string {
  // METARDU display colors are a stable visual key, not LAS source color.
  const hue = (code * 137.508 + 28) % 360;
  return `hsl(${hue.toFixed(1)} 78% 62%)`;
}

function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function formatCoordinate(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export const PointCloudPreviewCanvas: React.FC<PointCloudPreviewCanvasProps> = ({ preview, classLabels = [] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [hiddenClasses, setHiddenClasses] = useState<Set<number>>(() => new Set());
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const classes = useMemo(() => {
    const counts = new Map<number, number>();
    for (const point of preview.points) counts.set(point.classification, (counts.get(point.classification) ?? 0) + 1);
    const meanings = new Map(classLabels.map(({ code, meaning }) => [code, meaning ?? null]));
    return [...counts.entries()]
      .map(([code, count]) => ({ code, count, meaning: meanings.get(code) ?? null }))
      .sort((left, right) => left.code - right.code);
  }, [classLabels, preview.points]);

  const visibleCount = useMemo(() => classes.reduce(
    (sum, entry) => sum + (hiddenClasses.has(entry.code) ? 0 : entry.count),
    0,
  ), [classes, hiddenClasses]);

  const bounds = useMemo(() => {
    const first = preview.points[0];
    if (!first) return null;
    const min = { x: first.x, y: first.y, z: first.z };
    const max = { x: first.x, y: first.y, z: first.z };
    for (const point of preview.points.slice(1)) {
      min.x = Math.min(min.x, point.x);
      min.y = Math.min(min.y, point.y);
      min.z = Math.min(min.z, point.z);
      max.x = Math.max(max.x, point.x);
      max.y = Math.max(max.y, point.y);
      max.z = Math.max(max.z, point.z);
    }
    return { min, max, center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    } };
  }, [preview.points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvasSize.width * pixelRatio);
    canvas.height = Math.round(canvasSize.height * pixelRatio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const width = canvasSize.width;
    const height = canvasSize.height;
    const background = cssColor("--bg-primary", "#08090a");
    const text = cssColor("--text-tertiary", "#8b91a0");
    const accent = cssColor("--accent-primary", "#ff9500");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    // A sparse drafting grid gives the viewport orientation without implying
    // any CRS, unit, vertical datum, or map registration.
    context.strokeStyle = "rgba(132, 148, 171, 0.11)";
    context.lineWidth = 1;
    for (let index = 1; index <= 5; index++) {
      const x = (width * index) / 6;
      const y = (height * index) / 6;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.fillStyle = text;
    context.font = "11px var(--font-sans, system-ui)";
    context.fillText("LOCAL COORDINATE VIEW · NO MAP REGISTRATION", 14, 20);

    if (!bounds || preview.points.length === 0) {
      context.fillStyle = text;
      context.textAlign = "center";
      context.fillText("No finite XYZ points in this sample", width / 2, height / 2);
      context.textAlign = "left";
      return;
    }

    const cosineYaw = Math.cos(view.yaw);
    const sineYaw = Math.sin(view.yaw);
    const cosinePitch = Math.cos(view.pitch);
    const sinePitch = Math.sin(view.pitch);
    const projected: Array<{ x: number; y: number; depth: number; code: number }> = [];
    let extentX = 0;
    let extentY = 0;
    for (const point of preview.points) {
      if (hiddenClasses.has(point.classification)) continue;
      const dx = point.x - bounds.center.x;
      const dy = point.y - bounds.center.y;
      const dz = point.z - bounds.center.z;
      const rotatedX = dx * cosineYaw - dy * sineYaw;
      const rotatedY = dx * sineYaw + dy * cosineYaw;
      const screenY = rotatedY * cosinePitch + dz * sinePitch;
      const depth = rotatedY * sinePitch - dz * cosinePitch;
      extentX = Math.max(extentX, Math.abs(rotatedX));
      extentY = Math.max(extentY, Math.abs(screenY));
      projected.push({ x: rotatedX, y: screenY, depth, code: point.classification });
    }

    const fit = Math.min(
      (width - 58) / Math.max(1e-9, extentX * 2),
      (height - 58) / Math.max(1e-9, extentY * 2),
    ) * view.zoom;
    const centerX = width / 2;
    const centerY = height / 2 + 8;
    projected.sort((left, right) => left.depth - right.depth);
    const radius = Math.min(2.4, Math.max(1.1, 210 / Math.sqrt(Math.max(1, projected.length))));
    for (const point of projected) {
      context.beginPath();
      context.arc(centerX + point.x * fit, centerY - point.y * fit, radius, 0, Math.PI * 2);
      context.fillStyle = classColor(point.code);
      context.globalAlpha = 0.92;
      context.fill();
    }
    context.globalAlpha = 1;

    // Local-axis triad, transformed with the same view rotation.
    const axisOrigin = { x: width - 58, y: height - 52 };
    const axisLength = 27;
    const axes = [
      { name: "X", x: cosineYaw, y: sineYaw * cosinePitch, color: "#f06b61" },
      { name: "Y", x: -sineYaw, y: cosineYaw * cosinePitch, color: "#62d39a" },
      { name: "Z", x: 0, y: sinePitch, color: accent },
    ];
    context.lineWidth = 1.5;
    context.font = "11px var(--font-mono, ui-monospace)";
    for (const axis of axes) {
      const endX = axisOrigin.x + axis.x * axisLength;
      const endY = axisOrigin.y - axis.y * axisLength;
      context.beginPath();
      context.moveTo(axisOrigin.x, axisOrigin.y);
      context.lineTo(endX, endY);
      context.strokeStyle = axis.color;
      context.stroke();
      context.fillStyle = axis.color;
      context.fillText(axis.name, endX + 3, endY + 4);
    }
  }, [bounds, canvasSize, hiddenClasses, preview.points, view]);

  const rotateBy = useCallback((horizontal: number, vertical: number) => {
    setView((current) => ({
      ...current,
      yaw: current.yaw + horizontal,
      pitch: Math.max(-1.15, Math.min(1.15, current.pitch + vertical)),
    }));
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: view.yaw,
      pitch: view.pitch,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setView((current) => ({
      ...current,
      yaw: drag.yaw + (event.clientX - drag.x) * 0.008,
      pitch: Math.max(-1.15, Math.min(1.15, drag.pitch + (event.clientY - drag.y) * 0.008)),
    }));
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    setView((current) => ({ ...current, zoom: Math.max(0.35, Math.min(8, current.zoom * Math.exp(-event.deltaY * 0.001))) }));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = 0.12;
    if (event.key === "ArrowLeft") rotateBy(-step, 0);
    else if (event.key === "ArrowRight") rotateBy(step, 0);
    else if (event.key === "ArrowUp") rotateBy(0, -step);
    else if (event.key === "ArrowDown") rotateBy(0, step);
    else if (event.key === "+" || event.key === "=") setView((current) => ({ ...current, zoom: Math.min(8, current.zoom * 1.15) }));
    else if (event.key === "-") setView((current) => ({ ...current, zoom: Math.max(0.35, current.zoom / 1.15) }));
    else return;
    event.preventDefault();
  };

  const toggleClass = (code: number) => {
    setHiddenClasses((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const sampleBounds = bounds ? [
    `X ${formatCoordinate(bounds.min.x)} to ${formatCoordinate(bounds.max.x)}`,
    `Y ${formatCoordinate(bounds.min.y)} to ${formatCoordinate(bounds.max.y)}`,
    `Z ${formatCoordinate(bounds.min.z)} to ${formatCoordinate(bounds.max.z)}`,
  ] : [];

  return (
    <section aria-label="Point-cloud visual preview" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: 12, minWidth: 0 }}>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "var(--text-secondary)", fontSize: 11 }}>
          <strong style={{ color: "var(--text-primary)" }}>{visibleCount.toLocaleString()} visible of {preview.renderedPointCount.toLocaleString()} sampled points</strong>
          <span style={{ marginLeft: "auto" }}>Class colors · METARDU display</span>
          <button onClick={() => setView(INITIAL_VIEW)}>Reset view</button>
        </div>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Sampled three-dimensional point cloud. Drag to rotate; use the mouse wheel or plus and minus keys to zoom; use arrow keys to rotate. Local coordinates are not map registered."
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          style={{ display: "block", width: "100%", height: "min(58vh, 560px)", minHeight: 320, border: "1px solid var(--border-default)", borderRadius: 4, background: "var(--bg-primary)", cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none", outlineOffset: 2 }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", color: "var(--text-tertiary)", fontSize: 10 }}>
          <span>Drag to rotate</span><span>· Scroll or + / − to zoom</span><span>· Arrow keys also rotate</span>
        </div>
      </div>

      <aside style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 12, padding: 12, border: "1px solid var(--border-subtle)", borderRadius: 4, background: "var(--bg-primary)" }}>
        <div>
          <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: 13 }}>Source classes in sample</h3>
          <p style={{ margin: "4px 0 8px", color: "var(--text-tertiary)", fontSize: 10, lineHeight: 1.45 }}>
            Counts describe this sample. Hide or show classes to inspect the cloud.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 250, overflowY: "auto" }}>
            {classes.length === 0 ? (
              <div style={{ color: "var(--text-tertiary)", fontSize: 11 }}>No finite points to display.</div>
            ) : classes.map(({ code, count, meaning }) => (
              <button
                key={code}
                type="button"
                aria-pressed={!hiddenClasses.has(code)}
                onClick={() => toggleClass(code)}
                style={{ display: "grid", gridTemplateColumns: "12px minmax(0, 1fr) auto", alignItems: "center", gap: 8, padding: "5px 6px", border: "1px solid var(--border-subtle)", borderRadius: 3, background: hiddenClasses.has(code) ? "transparent" : "var(--bg-tertiary)", color: hiddenClasses.has(code) ? "var(--text-tertiary)" : "var(--text-primary)", textAlign: "left", cursor: "pointer", fontSize: 10 }}
              >
                <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: classColor(code), opacity: hiddenClasses.has(code) ? 0.35 : 1 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Class {code}{meaning ? ` · ${meaning}` : ""}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ paddingTop: 9, borderTop: "1px solid var(--border-subtle)" }}>
          <h3 style={{ margin: "0 0 6px", color: "var(--text-primary)", fontSize: 12 }}>Sample coordinates</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: 10 }}>
            {sampleBounds.map((bound) => <span key={bound}>{bound}</span>)}
          </div>
          <div style={{ marginTop: 5, color: "var(--text-tertiary)", fontSize: 9 }}>Range of displayed points; source CRS and units are unknown.</div>
        </div>
        {preview.warnings.map((warning) => (
          <p key={warning} style={{ margin: 0, padding: 8, borderLeft: "2px solid var(--status-warning, #D97706)", color: "var(--text-secondary)", fontSize: 10, lineHeight: 1.45 }}>{warning}</p>
        ))}
      </aside>
    </section>
  );
};
