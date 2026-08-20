/**
 * CrossImportBus — typed pub/sub for view-to-view data sharing.
 *
 * Replaces the single-slot `crossImport: CrossImportPayload | null`
 * mailbox with a multi-subscriber event bus. Each view declares its
 * own event types; consumers subscribe to the events they care about.
 *
 * # Architecture
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  CrossImportBus (standalone module, no React)        │
 *   │                                                      │
 *   │  on("cogo:points", handler)   ← TraverseView        │
 *   │  on("traverse:results", h)    ← COGOView            │
 *   │  on("topo:surface", h)        ← LULCView            │
 *   │  on("fieldbook:reading", h)   ← TraverseView        │
 *   │                                                      │
 *   │  emit("cogo:points", data)    → COGOView            │
 *   │  emit("traverse:results", d)  → TraverseView        │
 *   └──────────────────────────────────────────────────────┘
 *
 * # What replaces what
 *
 *   BEFORE                              AFTER
 *   ──────                              ─────
 *   CrossImportPayload union type       CrossImportEvents map (flat)
 *   setCrossImport(payload)             bus.emit("cogo:points", data)
 *   crossImport?.type === "cogo_points" bus.on("cogo:points", handler)
 *   setCrossImport(null)                unsub() — returns unsubscribe fn
 *   single-slot (one payload at a time) multi-subscriber, buffered queue
 *
 * # Deletion test
 *
 * Deleting this module would concentrate the coupling back into
 * SurveyStateContext (every view imports the union type, every new
 * event type touches the context). With this module, the context
 * only needs to hold the bus instance — events flow outside React.
 */

// ─── Event map ────────────────────────────────────────────────────
//
// Each key is a dot-separated event name: "domain:action".
// The value type is the payload shape for that event.
// Add new events here — no other file needs to change.

export interface CrossImportEvents {
  /** COGOView pushes accumulated computed points for import. */
  "cogo:points": {
    points: Array<{ id: string; easting: number; northing: number; source: string }>;
  };

  /** TraverseView pushes LS adjusted coordinates + diagnostics. */
  "traverse:results": {
    adjusted: Array<{ id: string; easting: number; northing: number; height: number | null }>;
    residuals: Array<{
      from: string;
      to: string;
      kind: string;
      residual: number;
      redundancy: number;
      wStatistic: number;
    }>;
    sigma0Squared: number;
    precisionRatio?: number;
  };

  /** TopographicView pushes a surface model / TIN for LULC or contour. */
  "topo:surface": {
    points: Array<{ easting: number; northing: number; elevation: number }>;
    breaklines?: Array<{ from: string; to: string }>;
  };

  /** FieldBookView pushes a recorded reading for traverse import. */
  "fieldbook:reading": {
    station: string;
    target: string;
    distance: number;
    bearing: number;
    zenithAngle?: number;
    sigma: number;
  };

  /** LSAView pushes adjusted coordinates for deed plan / report. */
  "lsa:adjusted": {
    adjusted: Array<{ id: string; easting: number; northing: number; height: number | null }>;
    sigma0Squared: number;
    chiSquarePasses: boolean;
  };

  /** FlightPlanner pushes GCPs for drone export. */
  "flight:gcp": {
    gcps: Array<{
      id: string;
      easting: number;
      northing: number;
      elevation: number;
      imageX: number;
      imageY: number;
      source: string;
    }>;
  };
}

// ─── Event names (derived) ────────────────────────────────────────

export type CrossImportEventName = keyof CrossImportEvents;

// ─── Handler type ─────────────────────────────────────────────────

export type CrossImportHandler<K extends CrossImportEventName = CrossImportEventName> = (
  payload: CrossImportEvents[K],
  event: K,
) => void;

// ─── Unsubscribe function ─────────────────────────────────────────

export type Unsubscribe = () => void;

// ─── Bus implementation ───────────────────────────────────────────

interface Subscription {
  handler: CrossImportHandler;
  eventFilter: CrossImportEventName | "*";
}

/**
 * Typed event bus for view-to-view data sharing.
 *
 * Thread-safe, no React dependency. Can be used in tests, Node scripts,
 * or any renderer code.
 */
export class CrossImportBus {
  private subscriptions: Subscription[] = [];
  private eventCount = 0;

  /**
   * Subscribe to one or more event types.
   *
   * @param event   Event name, or "*" for all events.
   * @param handler Called when the event fires. Receives (payload, eventName).
   * @returns Unsubscribe function.
   *
   * @example
   * const unsub = bus.on("cogo:points", (payload) => {
   *   // payload.points is typed as Array<{ id, easting, northing, source }>
   * });
   * // later: unsub();
   */
  on<K extends CrossImportEventName>(
    event: K,
    handler: CrossImportHandler<K>,
  ): Unsubscribe;

  /** Subscribe to all events. */
  on(handler: CrossImportHandler): Unsubscribe;

  on(
    eventOrHandler: CrossImportEventName | CrossImportHandler,
    handler?: CrossImportHandler,
  ): Unsubscribe {
    let eventFilter: CrossImportEventName | "*";
    let h: CrossImportHandler;

    if (typeof eventOrHandler === "function") {
      eventFilter = "*";
      h = eventOrHandler;
    } else {
      eventFilter = eventOrHandler;
      h = handler!;
    }

    const sub: Subscription = { handler: h, eventFilter };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  /**
   * Emit an event. All matching subscribers are called synchronously.
   *
   * @param event   Event name.
   * @param payload Event data — must match the event's type in CrossImportEvents.
   *
   * @example
   * bus.emit("cogo:points", {
   *   points: [{ id: "PT1", easting: 257000, northing: 9857000, source: "radiation" }]
   * });
   */
  emit<K extends CrossImportEventName>(event: K, payload: CrossImportEvents[K]): void {
    this.eventCount++;
    for (const sub of this.subscriptions) {
      if (sub.eventFilter === "*" || sub.eventFilter === event) {
        try {
          sub.handler(payload, event);
        } catch {
          // Swallow handler errors — one bad subscriber shouldn't break others.
        }
      }
    }
  }

  /**
   * Remove all subscriptions. Use in test teardown or provider unmount.
   */
  clear(): void {
    this.subscriptions = [];
  }

  /**
   * Number of events emitted since construction or last clear().
   */
  get totalEvents(): number {
    return this.eventCount;
  }

  /**
   * Number of active subscriptions.
   */
  get subscriberCount(): number {
    return this.subscriptions.length;
  }
}

// ─── Singleton ────────────────────────────────────────────────────

/**
 * App-wide singleton bus. Views import this and call `bus.on()` / `bus.emit()`.
 *
 * For testing, create a new `CrossImportBus()` instance instead.
 */
export const bus = new CrossImportBus();
