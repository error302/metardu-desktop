/** Saved declaration only: no transform, approval, or survey-date inference. */
export function retainedTopographicPlanContext(output:unknown,date?:string){
 if(!output||typeof output!=="object"||(output as Record<string,unknown>).evidenceStatus!=="computed-draft-unadjusted")return undefined;
 const c=(output as Record<string,unknown>).coordinateContext as Record<string,unknown>|undefined;
 if(!c||!Number.isSafeInteger(c.horizontalCrsEpsg)||Number(c.horizontalCrsEpsg)<=0||c.horizontalUnits!=="m"||c.referenceStatus!=="user-declared-unverified"||typeof c.horizontalCrsLabel!=="string"||!c.horizontalCrsLabel.trim()||typeof c.verticalReference!=="string"||!c.verticalReference.trim())throw new Error("Computed draft plan requires its saved coordinate and height reference.");
 return {coordinateSystemLabel:(c.horizontalCrsLabel.includes(`EPSG:${c.horizontalCrsEpsg}`) ? c.horizontalCrsLabel : `${c.horizontalCrsLabel} (EPSG:${c.horizontalCrsEpsg})`),date:date?.trim()||"not recorded",titleBlockLabel:undefined,planTypeLabel:"COMPUTED DRAFT",titleBlockLayout:undefined,footerNote:`Height reference: ${c.verticalReference}. User-declared and unverified. Points unadjusted; no field accuracy, professional approval or statutory acceptance established.`};
}
