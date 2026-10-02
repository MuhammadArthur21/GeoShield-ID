import RBush from "rbush";
import type { AnalyzeOptions, ColumnMeta, Indicator, PointRisk, RawPoint, RiskReport } from "../types";

export function project(points: RawPoint[]) {
  const lat0 = points.reduce((sum, point) => sum + point.lat, 0) / Math.max(1, points.length);
  const lon0 = points.reduce((sum, point) => sum + point.lon, 0) / Math.max(1, points.length);
  const scale = Math.cos(lat0 * Math.PI / 180);
  return {
    forward: (lon: number, lat: number) => ({ x: (lon - lon0) * 111320 * scale, y: (lat - lat0) * 111320 }),
    inverse: (x: number, y: number) => ({ lon: lon0 + x / (111320 * Math.max(1e-9, scale)), lat: lat0 + y / 111320 }),
  };
}

function cellFor(point: RawPoint, options: AnalyzeOptions, projection: ReturnType<typeof project>, origin: { x: number; y: number }): string {
  const { x, y } = projection.forward(point.lon, point.lat);
  return `${Math.floor((x - origin.x) / options.gridSizeM)}:${Math.floor((y - origin.y) / options.gridSizeM)}`;
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]!;
}

function timeKey(value: string, bucket: AnalyzeOptions["timeBucket"]): string {
  const date = new Date(value);
  if (bucket === "day") return date.toISOString().slice(0, 10);
  if (bucket === "hour") return `${date.toISOString().slice(0, 13)}`;
  return date.toISOString().slice(0, 16);
}

function isIdentifier(name: string, values: Array<string | number | null>): string | undefined {
  const key = name.toLowerCase();
  const nonempty = values.map(String).filter(Boolean);
  if (/(^|_)(id|user_id|respondent_id|nama|name|email|phone|telepon|alamat|address|nik)(_|$)/i.test(key)) return "nama kolom mengindikasikan identifier";
  if (nonempty.some((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return "pola nilai menyerupai alamat email";
  if (nonempty.some((value) => /^(?:\+?62|0)8\d{8,11}$/.test(value.replace(/[\s-]/g, "")))) return "pola nilai menyerupai nomor telepon";
  if (nonempty.some((value) => /^\d{16}$/.test(value))) return "pola nilai terdiri dari 16 digit";
  if (nonempty.length >= 3 && new Set(nonempty).size / nonempty.length >= 0.98) return "rasio nilai unik tinggi";
  return undefined;
}

export function analyze(points: RawPoint[], columns: ColumnMeta[], options: AnalyzeOptions): RiskReport {
  const projection = project(points);
  const projectedForGrid = points.map((point) => projection.forward(point.lon, point.lat));
  const gridOrigin = projectedForGrid.reduce((origin, point) => ({ x: Math.min(origin.x, point.x), y: Math.min(origin.y, point.y) }), { x: Infinity, y: Infinity });
  const cells = points.map((point) => cellFor(point, options, projection, gridOrigin));
  const cellCounts = new Map<string, number>();
  cells.forEach((cell) => cellCounts.set(cell, (cellCounts.get(cell) ?? 0) + 1));
  const identifierColumns = columns.filter((column) => column.kind !== "coordinate-lat" && column.kind !== "coordinate-lon" && column.kind !== "time")
    .map((column) => ({ column: column.name, reason: isIdentifier(column.name, points.map((point) => point.attrs[column.name])) }))
    .filter((result): result is { column: string; reason: string } => Boolean(result.reason));
  const identifierNames = new Set(identifierColumns.map((item) => item.column));
  const attrFields = columns.filter((column) => !["coordinate-lat", "coordinate-lon", "time", "identifier-candidate"].includes(column.kind)).map((column) => column.name).slice(0, 4);
  const attrKeys = points.map((point) => attrFields.map((field) => String(point.attrs[field] ?? "")).join("|"));
  const attrCounts = new Map<string, number>();
  attrKeys.forEach((key) => attrCounts.set(key, (attrCounts.get(key) ?? 0) + 1));
  const timedKeys = points.map((point, index) => point.time ? `${cells[index]}|${timeKey(point.time, options.timeBucket)}` : "");
  const timedCounts = new Map<string, number>();
  timedKeys.filter(Boolean).forEach((key) => timedCounts.set(key, (timedCounts.get(key) ?? 0) + 1));
  const projected = points.map((point) => projection.forward(point.lon, point.lat));
  const spatialIndex = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; index: number }>();
  spatialIndex.load(projected.map(({ x, y }, index) => ({ minX: x, minY: y, maxX: x, maxY: y, index })));
  const nearest = projected.length < 2 ? projected.map(() => 0) : projected.map((point, i) => {
    let distance = Number.POSITIVE_INFINITY;
    let radius = 1;
    while (!Number.isFinite(distance) || distance > radius) {
      const candidates = spatialIndex.search({ minX: point.x - radius, minY: point.y - radius, maxX: point.x + radius, maxY: point.y + radius });
      for (const candidate of candidates) {
        if (candidate.index === i) continue;
        const other = projected[candidate.index]!;
        distance = Math.min(distance, Math.hypot(point.x - other.x, point.y - other.y));
      }
      if (Number.isFinite(distance) && distance <= radius) break;
      if (radius >= 80_000_000) break;
      radius *= 2;
    }
    return Number.isFinite(distance) ? distance : 0;
  });
  const outlierThreshold = percentile(nearest, 0.95);
  const perPoint: PointRisk[] = points.map((point, index) => {
    const indicators: Indicator[] = [];
    identifierNames.forEach((column) => indicators.push({ kind: "identifier-column", column }));
    const count = cellCounts.get(cells[index]!) ?? 0;
    if (count < options.k) indicators.push({ kind: "small-group", cellId: cells[index]!, count, threshold: options.k });
    if (nearest[index]! > 0 && nearest[index]! >= outlierThreshold && nearest[index]! > options.gridSizeM) indicators.push({ kind: "spatially-unique", nearestDistM: nearest[index]! });
    const decimals = Math.max(point.precision?.lon ?? 0, point.precision?.lat ?? 0);
    if (decimals >= 6) indicators.push({ kind: "high-precision", decimals, approxMeters: Math.min(111320, 111320 * 10 ** -decimals) });
    const temporal = timedKeys[index]!;
    if (temporal && timedCounts.get(temporal) === 1) indicators.push({ kind: "temporal-unique", timeKey: temporal.split("|")[1]! });
    const combo = attrKeys[index]!;
    if (attrFields.length && combo && attrCounts.get(combo) === 1) indicators.push({ kind: "rare-attribute", combo: attrFields.join(" + "), comboCount: 1 });
    const hasSmallAndTemporal = indicators.some((item) => item.kind === "small-group") && indicators.some((item) => item.kind === "temporal-unique");
    const level: PointRisk["level"] = indicators.length === 0 ? "LOW" : indicators.length >= 2 || hasSmallAndTemporal ? "HIGH" : "REVIEW";
    return { pointId: point.id, indicators, level, explanation: explain(indicators), cellId: cells[index]!, nearestDistM: nearest[index]! };
  });
  const smallCells = [...cellCounts.values()].filter((count) => count < options.k);
  return {
    perPoint,
    summary: {
      totalPoints: points.length, identifiers: identifierColumns, smallGroupCells: smallCells.length,
      smallGroupPoints: perPoint.filter((risk) => risk.indicators.some((item) => item.kind === "small-group")).length,
      spatiallyUnique: perPoint.filter((risk) => risk.indicators.some((item) => item.kind === "spatially-unique")).length,
      temporalUnique: perPoint.filter((risk) => risk.indicators.some((item) => item.kind === "temporal-unique")).length,
      rareCombos: perPoint.filter((risk) => risk.indicators.some((item) => item.kind === "rare-attribute")).length,
      medianNearestM: percentile(nearest, 0.5), p95NearestM: outlierThreshold, minGroupSize: cellCounts.size ? [...cellCounts.values()].reduce((min, count) => Math.min(min, count), Infinity) : 0,
    }, params: options,
  };
}

export function explain(indicators: Indicator[]): string {
  if (!indicators.length) return "Tidak ditemukan indikator risiko teknis berdasarkan metode yang dipilih.";
  return indicators.map((indicator) => {
    switch (indicator.kind) {
      case "identifier-column": return `Kolom “${indicator.column}” terindikasi memuat identifier langsung.`;
      case "small-group": return `Sel grid ${indicator.cellId} hanya berisi ${indicator.count} record (ambang k=${indicator.threshold}).`;
      case "spatially-unique": return `Observasi ini unik secara spasial; tetangga terdekat berjarak sekitar ${Math.round(indicator.nearestDistM)} m.`;
      case "high-precision": return `Koordinat memiliki presisi ${indicator.decimals} angka desimal; presisi tinggi dapat meningkatkan paparan lokasi.`;
      case "temporal-unique": return "Kombinasi lokasi dan waktu pada record ini sangat unik.";
      case "rare-attribute": return `Kombinasi atribut ${indicator.combo} hanya muncul sekali dalam dataset.`;
    }
  }).join(" ");
}
