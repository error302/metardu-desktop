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
});
