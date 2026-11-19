import {describe,it,expect} from "vitest";
import {retainedTopographicPlanContext} from "../main/draft-topographic-map.js";
import {getCountryConfig} from "@metardu/country-config";
const srid=getCountryConfig("GB").geodeticFramework.primarySRID;
const output={evidenceStatus:"computed-draft-unadjusted",coordinateContext:{horizontalCrsEpsg:srid,horizontalCrsLabel:"Saved project source",horizontalUnits:"m",verticalReference:"SYNTHETIC local benchmark",referenceStatus:"user-declared-unverified"}};
describe("retained draft print context",()=>{
 it("uses the retained source and no invented survey date or certification",()=>{const result=retainedTopographicPlanContext(output);expect(result?.coordinateSystemLabel).toContain(String(srid));expect(result?.date).toBe("not recorded");expect(result?.planTypeLabel).toBe("COMPUTED DRAFT");expect(result?.titleBlockLayout).toBeUndefined();expect(result?.footerNote).toContain("SYNTHETIC local benchmark");});
 it("refuses computed drafts with missing reference",()=>expect(()=>retainedTopographicPlanContext({evidenceStatus:"computed-draft-unadjusted"})).toThrow(/reference/i));
 it("leaves other workflow outputs to their existing path",()=>expect(retainedTopographicPlanContext({allBeacons:[]})).toBeUndefined());
});
