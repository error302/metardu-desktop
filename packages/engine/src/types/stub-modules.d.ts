// Stub type declarations for metardu's @/types/* path aliases.
// These are minimal stubs so the engine source compiles. The actual
// runtime types are provided by the engine modules themselves.

declare module '@/types/importer' {
  export interface ParsedSurveyData {
    points?: Array<{ number?: string; easting: number; northing: number; elevation?: number; code?: string }>;
    observations?: unknown[];
    metadata?: Record<string, unknown>;
  }
  export interface ParseResult {
    points?: Array<{ number?: string; easting: number; northing: number; elevation?: number }>;
    errors?: string[];
    warnings?: string[];
  }
}

declare module '@/types/surveyPoint' {
  export interface SurveyPoint {
    number?: string;
    easting: number;
    northing: number;
    elevation?: number;
    code?: string;
    description?: string;
  }
}

declare module '@/types/landLaw' {
  export interface LandLawRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/deedPlan' {
  export interface DeedPlanRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/cadastra' {
  export interface CadastraRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/fieldguard' {
  export interface FieldguardRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/edmCorrection' {
  export interface EdmCorrection {
    distance: number;
    correctedDistance: number;
  }
}

declare module '@/types/fieldbook' {
  export interface FieldbookRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/engineering' {
  export interface EngineeringRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/ifc' {
  export interface IfcRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/project' {
  export interface ProjectRecord {
    id: string;
    name: string;
    [key: string]: unknown;
  }
}

declare module '@/types/subdivision' {
  export interface SubdivisionRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/submission' {
  export interface SubmissionRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/surveyReport' {
  export interface SurveyReportRecord {
    id: string;
    [key: string]: unknown;
  }
}

declare module '@/types/workflow' {
  export interface WorkflowRecord {
    id: string;
    [key: string]: unknown;
  }
}
