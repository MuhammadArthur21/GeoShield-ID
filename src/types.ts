export type ColumnKind = "coordinate-lat" | "coordinate-lon" | "time" | "identifier-candidate" | "numeric" | "categorical" | "unknown";

export interface RawPoint {
  id: number;
  lon: number;
  lat: number;
  time?: string;
  attrs: Record<string, string | number | null>;
  precision?: { lon: number; lat: number };
}

export interface ColumnMeta {
  name: string;
  kind: ColumnKind;
  confidence: number;
  nullRatio: number;
  uniqueRatio: number;
}

export interface QualityIssue {
  kind: "null" | "out-of-range" | "duplicate" | "bad-time" | "bad-geometry";
  count: number;
  exampleRow?: number;
}

export interface ParsedDataset {
  points: RawPoint[];
  columns: ColumnMeta[];
  quality: QualityIssue[];
  errors: string[];
  sourceText?: string;
  sourceName?: string;
}

export interface AnalyzeOptions {
  gridSizeM: 50 | 100 | 250 | 500 | 1000;
  k: 3 | 5 | 10 | 20;
  timeBucket: "minute" | "hour" | "day";
}

export type Indicator =
  | { kind: "identifier-column"; column: string }
  | { kind: "small-group"; cellId: string; count: number; threshold: number }
  | { kind: "spatially-unique"; nearestDistM: number }
  | { kind: "high-precision"; decimals: number; approxMeters: number }
  | { kind: "temporal-unique"; timeKey: string }
  | { kind: "rare-attribute"; combo: string; comboCount: number };

export interface PointRisk {
  pointId: number;
  indicators: Indicator[];
  level: "LOW" | "REVIEW" | "HIGH";
  explanation: string;
  cellId: string;
  nearestDistM: number;
}

export interface RiskReport {
  perPoint: PointRisk[];
  summary: {
    totalPoints: number;
    identifiers: { column: string; reason: string }[];
    smallGroupCells: number;
    smallGroupPoints: number;
    spatiallyUnique: number;
    temporalUnique: number;
    rareCombos: number;
    medianNearestM: number;
    p95NearestM: number;
    minGroupSize: number;
  };
  params: AnalyzeOptions;
}

export interface TransformConfig {
  roundingDecimals?: number;
  aggregateCellM?: number;
  jitterRadiusM?: number;
  jitterSeed?: string;
  removedColumns?: string[];
  timeGeneralization?: "15m" | "30m" | "1h" | "1d";
}

export interface ProtectedPoint extends RawPoint {
  cellId?: string;
}

export interface ProtectedDataset {
  points: ProtectedPoint[];
  transformsApplied: TransformConfig;
  displacement: { meanM: number; medianM: number; maxM: number };
}

export interface WorkerRequest {
  id: number;
  type: "ANALYZE" | "PROTECT";
  payload: { points: RawPoint[]; columns?: ColumnMeta[]; options?: AnalyzeOptions; transforms?: TransformConfig };
}

export interface WorkerResponse {
  id: number;
  type: "ANALYZE_DONE" | "PROTECT_DONE" | "ERROR";
  report?: RiskReport;
  result?: ProtectedDataset;
  message?: string;
}
