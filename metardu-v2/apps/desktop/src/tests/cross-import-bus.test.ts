import { describe, it, expect, vi } from "vitest";
import { CrossImportBus, type CrossImportEvents } from "../renderer/cross-import-bus.js";

describe("CrossImportBus", () => {
  it("delivers events to matching subscribers", () => {
    const bus = new CrossImportBus();
    const handler = vi.fn();

    bus.on("cogo:points", handler);
    bus.emit("cogo:points", {
      points: [{ id: "PT1", easting: 100, northing: 200, source: "radiation" }],
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { points: [{ id: "PT1", easting: 100, northing: 200, source: "radiation" }] },
      "cogo:points",
    );
  });

  it("does not deliver events to non-matching subscribers", () => {
    const bus = new CrossImportBus();
    const handler = vi.fn();

    bus.on("traverse:results", handler);
    bus.emit("cogo:points", {
      points: [{ id: "PT1", easting: 100, northing: 200, source: "radiation" }],
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("wildcard subscriber receives all events", () => {
    const bus = new CrossImportBus();
    const handler = vi.fn();

    bus.on(handler);
    bus.emit("cogo:points", { points: [] });
    bus.emit("traverse:results", {
      adjusted: [],
      residuals: [],
      sigma0Squared: 1,
    });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][1]).toBe("cogo:points");
    expect(handler.mock.calls[1][1]).toBe("traverse:results");
  });

  it("unsubscribe stops delivery", () => {
    const bus = new CrossImportBus();
    const handler = vi.fn();

    const unsub = bus.on("cogo:points", handler);
    bus.emit("cogo:points", { points: [] });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    bus.emit("cogo:points", { points: [] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("supports multiple subscribers to the same event", () => {
    const bus = new CrossImportBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on("cogo:points", h1);
    bus.on("cogo:points", h2);
    bus.emit("cogo:points", { points: [] });

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("clear() removes all subscribers", () => {
    const bus = new CrossImportBus();
    const handler = vi.fn();

    bus.on("cogo:points", handler);
    bus.clear();
    bus.emit("cogo:points", { points: [] });

    expect(handler).not.toHaveBeenCalled();
  });

  it("tracks event count and subscriber count", () => {
    const bus = new CrossImportBus();

    expect(bus.totalEvents).toBe(0);
    expect(bus.subscriberCount).toBe(0);

    const unsub1 = bus.on("cogo:points", () => {});
    const unsub2 = bus.on("traverse:results", () => {});

    expect(bus.subscriberCount).toBe(2);

    bus.emit("cogo:points", { points: [] });
    bus.emit("traverse:results", { adjusted: [], residuals: [], sigma0Squared: 1 });

    expect(bus.totalEvents).toBe(2);

    unsub1();
    expect(bus.subscriberCount).toBe(1);

    unsub2();
    expect(bus.subscriberCount).toBe(0);
  });

  it("handler errors do not break other subscribers", () => {
    const bus = new CrossImportBus();
    const badHandler = vi.fn(() => { throw new Error("boom"); });
    const goodHandler = vi.fn();

    bus.on("cogo:points", badHandler);
    bus.on("cogo:points", goodHandler);

    // Should not throw
    bus.emit("cogo:points", { points: [] });

    expect(badHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });

  it("type-safe: traverse:results payload has correct shape", () => {
    const bus = new CrossImportBus();
    const handler = vi.fn();

    bus.on("traverse:results", handler);
    bus.emit("traverse:results", {
      adjusted: [{ id: "STN1", easting: 257000, northing: 9857000, height: 1500 }],
      residuals: [{ from: "STN1", to: "STN2", kind: "Distance", residual: 0.001, redundancy: 0.5, wStatistic: 0.3 }],
      sigma0Squared: 1.23,
      precisionRatio: 50000,
    });

    expect(handler).toHaveBeenCalled();
    const payload = handler.mock.calls[0][0] as CrossImportEvents["traverse:results"];
    expect(payload.adjusted).toHaveLength(1);
    expect(payload.sigma0Squared).toBe(1.23);
    expect(payload.precisionRatio).toBe(50000);
  });

  // ─── Integration: full data flow between views ────────────────

  it("integration: COGO → Traverse data flow", () => {
    const bus = new CrossImportBus();
    const traverseHandler = vi.fn();

    // TraverseView subscribes to cogo:points
    bus.on("cogo:points", traverseHandler);

    // COGOView emits computed points
    bus.emit("cogo:points", {
      points: [
        { id: "C1", easting: 257000, northing: 9857000, source: "radiation" },
        { id: "C2", easting: 257100, northing: 9857100, source: "radiation" },
        { id: "C3", easting: 257050, northing: 9857200, source: "offset" },
      ],
    });

    expect(traverseHandler).toHaveBeenCalledTimes(1);
    const payload = traverseHandler.mock.calls[0][0] as CrossImportEvents["cogo:points"];
    expect(payload.points).toHaveLength(3);
    expect(payload.points[0].id).toBe("C1");
  });

  it("integration: Traverse → COGO results flow", () => {
    const bus = new CrossImportBus();
    const cogoHandler = vi.fn();

    // COGOView subscribes to traverse:results
    bus.on("traverse:results", cogoHandler);

    // TraverseView emits LS results
    bus.emit("traverse:results", {
      adjusted: [
        { id: "STN1", easting: 257000, northing: 9857000, height: null },
        { id: "STN2", easting: 257100, northing: 9857100, height: null },
      ],
      residuals: [],
      sigma0Squared: 0.98,
    });

    expect(cogoHandler).toHaveBeenCalledTimes(1);
    const payload = cogoHandler.mock.calls[0][0] as CrossImportEvents["traverse:results"];
    expect(payload.adjusted).toHaveLength(2);
    expect(payload.sigma0Squared).toBe(0.98);
  });

  it("integration: Topo → LULC surface flow", () => {
    const bus = new CrossImportBus();
    const lulcHandler = vi.fn();

    // LULCView subscribes to topo:surface
    bus.on("topo:surface", lulcHandler);

    // TopographicView emits surface data
    bus.emit("topo:surface", {
      points: [
        { easting: 257000, northing: 9857000, elevation: 100 },
        { easting: 257100, northing: 9857000, elevation: 102 },
        { easting: 257100, northing: 9857100, elevation: 101 },
        { easting: 257000, northing: 9857100, elevation: 99 },
      ],
      breaklines: [{ from: "P1", to: "P2" }],
    });

    expect(lulcHandler).toHaveBeenCalledTimes(1);
    const payload = lulcHandler.mock.calls[0][0] as CrossImportEvents["topo:surface"];
    expect(payload.points).toHaveLength(4);
    expect(payload.breaklines).toHaveLength(1);
  });

  it("integration: FieldBook → Traverse reading flow", () => {
    const bus = new CrossImportBus();
    const traverseHandler = vi.fn();

    // TraverseView subscribes to fieldbook:reading
    bus.on("fieldbook:reading", traverseHandler);

    // FieldBookView emits reduced readings
    bus.emit("fieldbook:reading", {
      station: "STN1", target: "PT1",
      distance: 45.234, bearing: 45.2317,
      zenithAngle: 87.5431, sigma: 0.005,
    });

    expect(traverseHandler).toHaveBeenCalledTimes(1);
    const payload = traverseHandler.mock.calls[0][0] as CrossImportEvents["fieldbook:reading"];
    expect(payload.station).toBe("STN1");
    expect(payload.target).toBe("PT1");
    expect(payload.distance).toBe(45.234);
  });

  it("integration: LSA → DeedPlan adjusted flow", () => {
    const bus = new CrossImportBus();
    const deedHandler = vi.fn();

    // DeedPlanView subscribes to lsa:adjusted
    bus.on("lsa:adjusted", deedHandler);

    // LSAView emits adjusted coordinates
    bus.emit("lsa:adjusted", {
      adjusted: [
        { id: "PT1", easting: 257000.123, northing: 9857000.456, height: 1500.789 },
      ],
      sigma0Squared: 1.02,
      chiSquarePasses: true,
    });

    expect(deedHandler).toHaveBeenCalledTimes(1);
    const payload = deedHandler.mock.calls[0][0] as CrossImportEvents["lsa:adjusted"];
    expect(payload.adjusted).toHaveLength(1);
    expect(payload.chiSquarePasses).toBe(true);
  });

  it("integration: multiple views can subscribe to the same event", () => {
    const bus = new CrossImportBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    // Three different views all care about traverse:results
    bus.on("traverse:results", handler1);
    bus.on("traverse:results", handler2);
    bus.on("traverse:results", handler3);

    bus.emit("traverse:results", {
      adjusted: [{ id: "S1", easting: 100, northing: 200, height: null }],
      residuals: [],
      sigma0Squared: 1,
    });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler3).toHaveBeenCalledTimes(1);
  });
});
