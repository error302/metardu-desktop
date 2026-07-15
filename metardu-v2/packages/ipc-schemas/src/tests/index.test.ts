/**
 * Tests for the IPC schema validation.
 *
 * Verifies:
 *   - All 5 namespaces are registered
 *   - Total channel count matches expected (14 + 10 + 9 + 5 + 4 = 42)
 *   - Valid inputs pass validation
 *   - Invalid inputs fail with descriptive errors
 *   - Unknown channels return CHANNEL_NOT_REGISTERED
 *   - Security-critical refinements (e.g., polygon closure, traverse connectivity)
 */

import { describe, it, expect } from "vitest";
import {
  validateIpcInput,
  listRegisteredChannels,
  getSchema,
  IPC_SCHEMAS,
  DRONE_SCHEMAS,
  GCP_SCHEMAS,
  PIPELINE_SCHEMAS,
  PARCEL_SCHEMAS,
  TRAVERSE_SCHEMAS,
} from "../index.js";

describe("IPC schema registry", () => {
  it("should register all 5 namespaces", () => {
    expect(Object.keys(DRONE_SCHEMAS).length).toBe(14);
    expect(Object.keys(GCP_SCHEMAS).length).toBe(10);
    expect(Object.keys(PIPELINE_SCHEMAS).length).toBe(9);
    expect(Object.keys(PARCEL_SCHEMAS).length).toBe(5);
    expect(Object.keys(TRAVERSE_SCHEMAS).length).toBe(4);
  });

  it("should register 42 total channels (14+10+9+5+4)", () => {
    const total = Object.keys(IPC_SCHEMAS).length;
    expect(total).toBe(42);
  });

  it("listRegisteredChannels should return sorted list", () => {
    const channels = listRegisteredChannels();
    expect(channels.length).toBe(42);
    // Alphabetical sort: "drone:" < "gcp:" < "parcel:" < "pipeline:" < "traverse:"
    expect(channels[0]).toBe("drone:contours.generate");
    expect(channels[channels.length - 1]).toBe("traverse:transit");
    // Verify sort
    for (let i = 1; i < channels.length; i++) {
      expect(channels[i - 1]! <= channels[i]!).toBe(true);
    }
  });

  it("getSchema should return the schema for a registered channel", () => {
    const schema = getSchema("drone:mission.plan");
    expect(schema).toBeDefined();
  });

  it("getSchema should return undefined for an unknown channel", () => {
    expect(getSchema("nonexistent:action")).toBeUndefined();
  });
});

describe("validateIpcInput — drone namespace", () => {
  it("should accept valid drone:mission.plan input", () => {
    const validInput = {
      cameraId: "dji-mavic-3-enterprise",
      altitudeM: 75,
      frontOverlap: 0.75,
      sideOverlap: 0.65,
      area: {
        coordinates: [
          { lat: -1.2864, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8227 },
          { lat: -1.2864, lng: 36.8227 },
          { lat: -1.2864, lng: 36.8172 }, // closed
        ],
      },
    };
    const result = validateIpcInput("drone:mission.plan", validInput);
    expect(result.success).toBe(true);
  });

  it("should reject drone:mission.plan with non-closed polygon", () => {
    const invalidInput = {
      cameraId: "dji-mavic-3-enterprise",
      altitudeM: 75,
      frontOverlap: 0.75,
      sideOverlap: 0.65,
      area: {
        coordinates: [
          { lat: -1.2864, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8227 },
          { lat: -1.2864, lng: 36.8227 },
          // Missing closing point
        ],
      },
    };
    const result = validateIpcInput("drone:mission.plan", invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details.some(d => d.message.includes("closed"))).toBe(true);
    }
  });

  it("should reject drone:mission.plan with invalid latitude (> 90)", () => {
    const invalidInput = {
      cameraId: "dji-mavic-3-enterprise",
      altitudeM: 75,
      frontOverlap: 0.75,
      sideOverlap: 0.65,
      area: {
        coordinates: [
          { lat: 95, lng: 36.8172 }, // invalid latitude
          { lat: -1.2774, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8227 },
          { lat: 95, lng: 36.8227 },
          { lat: 95, lng: 36.8172 },
        ],
      },
    };
    const result = validateIpcInput("drone:mission.plan", invalidInput);
    expect(result.success).toBe(false);
  });

  it("should reject drone:imagery.delete without confirm=true", () => {
    const result = validateIpcInput("drone:imagery.delete", {
      datasetId: "123e4567-e89b-12d3-a456-426614174000",
      confirm: false, // must be true
    });
    expect(result.success).toBe(false);
  });

  it("should accept drone:features.extract with changes requiring previous path", () => {
    const validInput = {
      orthophotoPath: "/data/ortho.tif",
      featureType: "changes",
      previousOrthophotoPath: "/data/ortho_prev.tif",
    };
    const result = validateIpcInput("drone:features.extract", validInput);
    expect(result.success).toBe(true);
  });

  it("should reject drone:features.extract with changes but no previous path", () => {
    const invalidInput = {
      orthophotoPath: "/data/ortho.tif",
      featureType: "changes",
      // Missing previousOrthophotoPath
    };
    const result = validateIpcInput("drone:features.extract", invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details.some(d => d.message.includes("previousOrthophotoPath"))).toBe(true);
    }
  });
});

describe("validateIpcInput — gcp namespace", () => {
  it("should accept valid gcp:create input", () => {
    const validInput = {
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      coordinate: { lat: -1.2864, lng: 36.8172 },
      elevationM: 1700.5,
      label: "GCP1",
    };
    const result = validateIpcInput("gcp:create", validInput);
    expect(result.success).toBe(true);
  });

  it("should reject gcp:create with custom target but no size", () => {
    const invalidInput = {
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      coordinate: { lat: -1.2864, lng: 36.8172 },
      elevationM: 1700.5,
      targetType: "custom",
      // Missing customTargetSizeCm
    };
    const result = validateIpcInput("gcp:create", invalidInput);
    expect(result.success).toBe(false);
  });

  it("should reject gcp:update with empty updates object", () => {
    const invalidInput = {
      gcpId: "123e4567-e89b-12d3-a456-426614174000",
      updates: {},
    };
    const result = validateIpcInput("gcp:update", invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details.some(d => d.message.includes("At least one field"))).toBe(true);
    }
  });
});

describe("validateIpcInput — parcel namespace", () => {
  it("should accept valid parcel:create input with Kenyan LR number", () => {
    const validInput = {
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      lrNumber: "209/12345",
      boundary: {
        coordinates: [
          { lat: -1.2864, lng: 36.8172 },
          { lat: -1.2864, lng: 36.8180 },
          { lat: -1.2858, lng: 36.8180 },
          { lat: -1.2858, lng: 36.8172 },
          { lat: -1.2864, lng: 36.8172 }, // closed
        ],
      },
      county: "Nairobi",
    };
    const result = validateIpcInput("parcel:create", validInput);
    expect(result.success).toBe(true);
  });

  it("should reject parcel:create with invalid LR number (lowercase)", () => {
    const invalidInput = {
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      lrNumber: "209/abc", // lowercase not allowed
      boundary: {
        coordinates: [
          { lat: -1.2864, lng: 36.8172 },
          { lat: -1.2864, lng: 36.8180 },
          { lat: -1.2858, lng: 36.8180 },
          { lat: -1.2864, lng: 36.8172 },
        ],
      },
    };
    const result = validateIpcInput("parcel:create", invalidInput);
    expect(result.success).toBe(false);
  });
});

describe("validateIpcInput — traverse namespace", () => {
  it("should accept valid closed traverse input", () => {
    const validInput = {
      controlPoints: {
        start: {
          stationId: "STN-A",
          coordinate: { x: 1000, y: 2000 },
          referenceBearing: 45.0,
        },
        end: {
          stationId: "STN-D",
          coordinate: { x: 1100, y: 2100 },
          referenceBearing: 90.0,
        },
      },
      legs: [
        { fromStation: "STN-A", toStation: "STN-B", bearing: 45.0, distance: 100 },
        { fromStation: "STN-B", toStation: "STN-C", bearing: 90.0, distance: 50 },
        { fromStation: "STN-C", toStation: "STN-D", bearing: 135.0, distance: 75 },
      ],
    };
    const result = validateIpcInput("traverse:bowditch", validInput);
    expect(result.success).toBe(true);
  });

  it("should reject traverse with disconnected legs", () => {
    const invalidInput = {
      controlPoints: {
        start: {
          stationId: "STN-A",
          coordinate: { x: 1000, y: 2000 },
          referenceBearing: 45.0,
        },
      },
      legs: [
        { fromStation: "STN-A", toStation: "STN-B", bearing: 45.0, distance: 100 },
        { fromStation: "STN-X", toStation: "STN-C", bearing: 90.0, distance: 50 }, // disconnected!
      ],
    };
    const result = validateIpcInput("traverse:bowditch", invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details.some(d => d.message.includes("connected"))).toBe(true);
    }
  });

  it("should accept traverse:lsa with optional convergence parameters", () => {
    const validInput = {
      controlPoints: {
        start: {
          stationId: "STN-A",
          coordinate: { x: 1000, y: 2000 },
          referenceBearing: 45.0,
        },
      },
      legs: [
        { fromStation: "STN-A", toStation: "STN-B", bearing: 45.0, distance: 100 },
      ],
      convergenceTolerance: 1e-8,
      maxIterations: 100,
      confidenceLevel: 0.95,
    };
    const result = validateIpcInput("traverse:lsa", validInput);
    expect(result.success).toBe(true);
  });
});

describe("validateIpcInput — pipeline namespace", () => {
  it("should accept valid pipeline:start input", () => {
    const validInput = {
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      skipStages: ["drone_capture", "processing"],
    };
    const result = validateIpcInput("pipeline:start", validInput);
    expect(result.success).toBe(true);
  });

  it("should accept pipeline:cost.estimate with KES currency", () => {
    const validInput = {
      areaHectares: 50,
      cameraId: "dji-mavic-3-enterprise",
      altitudeM: 75,
      gcpCount: 10,
      currency: "KES",
    };
    const result = validateIpcInput("pipeline:cost.estimate", validInput);
    expect(result.success).toBe(true);
  });

  it("should reject pipeline:cost.estimate with area > 10000 ha", () => {
    const invalidInput = {
      areaHectares: 50_000, // too large
      cameraId: "dji-mavic-3-enterprise",
      altitudeM: 75,
    };
    const result = validateIpcInput("pipeline:cost.estimate", invalidInput);
    expect(result.success).toBe(false);
  });
});

describe("validateIpcInput — error handling", () => {
  it("should return CHANNEL_NOT_REGISTERED for unknown channel", () => {
    const result = validateIpcInput("nonexistent:action", {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CHANNEL_NOT_REGISTERED");
    }
  });

  it("should include path information in validation errors", () => {
    const invalidInput = {
      cameraId: "dji-mavic-3-enterprise",
      altitudeM: -10, // negative altitude (invalid)
      frontOverlap: 0.75,
      sideOverlap: 0.65,
      area: {
        coordinates: [
          { lat: -1.2864, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8172 },
          { lat: -1.2774, lng: 36.8227 },
          { lat: -1.2864, lng: 36.8172 },
        ],
      },
    };
    const result = validateIpcInput("drone:mission.plan", invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details.some(d => d.path.includes("altitudeM"))).toBe(true);
    }
  });

  it("should reject extra keys when strict mode is used", () => {
    const inputWithExtraKeys = {
      projectId: "123e4567-e89b-12d3-a456-426614174000",
      coordinate: { lat: -1.2864, lng: 36.8172 },
      elevationM: 1700,
      maliciousField: "DROP TABLE users;", // extra key
    };
    const result = validateIpcInput("gcp:create", inputWithExtraKeys);
    expect(result.success).toBe(false);
  });
});
