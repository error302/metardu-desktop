/**
 * Statutory document renderers — one per country's statutory output.
 *
 * Per master plan Section 7 + invariant B1/B2/B3:
 *   - Every renderer requires its source document filed in
 *     docs/regulatory-sources/<country>/<doc-type>/.
 *   - Every layout decision cites the specific page/clause in a code comment.
 *   - Every renderer ships with at least one fixture plan reproduced
 *     from a real (anonymized if needed) example.
 *
 * Renderers consume the workflow output (adjusted coordinates, area,
 * beacons) and produce a print-ready PDF + DXF companion.
 */

export {
  generateForm3Pdf,
  type Form3Input,
  type Form3Output,
  type Form3Parcel,
  type Form3Beacon,
  type Form3Surveyor,
} from "./form-3.js";
