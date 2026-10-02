import type { ColumnKind, ColumnMeta, ParsedDataset, QualityIssue, RawPoint } from "../types";

const LAT_NAMES = new Set(["lat", "latitude", "lintang", "y"]);
const LON_NAMES = new Set(["lon", "lng", "longitude", "bujur", "x"]);
const TIME_NAMES = new Set(["timestamp", "time", "waktu", "datetime", "tanggal", "date"]);
const ID_NAMES = new Set(["id", "user_id", "respondent_id", "nama", "name", "email", "phone", "telepon", "alamat", "address", "nik"]);

function parseDelimited(text: string, delimiter: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("File teks memiliki tanda kutip yang tidak berpasangan.");
  if (field || row.length) { row.push(field); if (row.some((cell) => cell.trim() !== "")) rows.push(row); }
  if (rows.length < 2) throw new Error("Dataset kosong atau hanya berisi baris judul.");
  const headers = rows[0]!.map((header) => header.trim().replace(/^\uFEFF/, ""));
  if (headers.some((header) => !header)) throw new Error("Nama kolom kosong. Periksa baris judul file.");
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, i) => [header, cells[i]?.trim() ?? ""])));
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 8).join("\n");
  const candidates = [",", ";", "\t"];
  return candidates.map((delimiter) => {
    const counts = sample.split(/\r?\n/).filter(Boolean).map((line) => [...line].filter((char) => char === delimiter).length);
    const avg = counts.reduce((sum, n) => sum + n, 0) / Math.max(1, counts.length);
    const variance = counts.reduce((sum, n) => sum + (n - avg) ** 2, 0) / Math.max(1, counts.length);
    return { delimiter, score: avg - Math.sqrt(variance) };
  }).sort((a, b) => b.score - a.score)[0]!.delimiter;
}

const numberValue = (value: unknown): number => {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  if (!text) return Number.NaN;
  const normalized = text.includes(",") && !text.includes(".") ? text.replace(",", ".") : text;
  return Number(normalized);
};

function classifyColumns(rows: Record<string, unknown>[]): ColumnMeta[] {
  const names = Object.keys(rows[0] ?? {});
  return names.map((name): ColumnMeta => {
    const lower = name.toLowerCase().trim();
    const values = rows.map((row) => row[name]).filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
    const uniqueRatio = values.length ? new Set(values.map(String)).size / values.length : 0;
    let kind: ColumnKind = "unknown";
    if (LAT_NAMES.has(lower)) kind = "coordinate-lat";
    else if (LON_NAMES.has(lower)) kind = "coordinate-lon";
    else if (TIME_NAMES.has(lower)) kind = "time";
    else if (ID_NAMES.has(lower)) kind = "identifier-candidate";
    else if (values.length && values.every((value) => Number.isFinite(numberValue(value)))) kind = "numeric";
    else if (values.length) kind = "categorical";
    return { name, kind, confidence: kind.startsWith("coordinate-") || kind === "time" || kind === "identifier-candidate" ? 0.98 : kind === "unknown" ? 0 : 0.7, nullRatio: 1 - values.length / rows.length, uniqueRatio };
  });
}

export function parseDataset(text: string, filename: string, mapping?: { latitude: string; longitude: string; time?: string }): ParsedDataset {
  const errors: string[] = [];
  const qualityCounts = new Map<QualityIssue["kind"], number>();
  const increment = (kind: QualityIssue["kind"]) => qualityCounts.set(kind, (qualityCounts.get(kind) ?? 0) + 1);
  let records: Record<string, unknown>[];
  const isGeoJson = filename.toLowerCase().endsWith(".geojson") || filename.toLowerCase().endsWith(".json");
  if (isGeoJson) {
    let document: unknown;
    try { document = JSON.parse(text); } catch { throw new Error("GeoJSON rusak atau tidak dapat dibaca."); }
    const collection = document as { type?: string; features?: Array<{ type?: string; geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null }> };
    if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) throw new Error("GeoJSON harus berupa FeatureCollection.");
    records = collection.features.map((feature, index) => {
      const geometry = feature.geometry;
      if (feature.type !== "Feature" || geometry?.type !== "Point" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
        increment("bad-geometry");
        return { __row: index, ...(feature.properties ?? {}), __lon: "", __lat: "" };
      }
      return { ...(feature.properties ?? {}), __lon: geometry.coordinates[0], __lat: geometry.coordinates[1] };
    });
  } else {
    const delimiter = detectDelimiter(text);
    records = parseDelimited(text, delimiter);
  }
  if (!records.length) throw new Error("Dataset tidak berisi record yang dapat dianalisis.");
  const columns = classifyColumns(records).map((column) => isGeoJson && column.name === "__lat" ? { ...column, kind: "coordinate-lat" as const, confidence: 1 } : isGeoJson && column.name === "__lon" ? { ...column, kind: "coordinate-lon" as const, confidence: 1 } : column);
  const inferred = inferCoordinates(records, columns);
  const latName = isGeoJson ? "__lat" : mapping?.latitude ?? columns.find((column) => column.kind === "coordinate-lat")?.name ?? inferred?.latitude;
  const lonName = isGeoJson ? "__lon" : mapping?.longitude ?? columns.find((column) => column.kind === "coordinate-lon")?.name ?? inferred?.longitude;
  if (!latName || !lonName) {
    return { points: [], columns, quality: [], errors: ["Kolom koordinat tidak ditemukan. Pemetaan manual diperlukan."], sourceText: text, sourceName: filename };
  }
  const timeName = mapping?.time || columns.find((column) => column.kind === "time")?.name;
  const points: RawPoint[] = [];
  const duplicateKeys = new Set<string>();
  let duplicates = 0;
  for (const [index, row] of records.entries()) {
    const lon = numberValue(row[lonName]);
    const lat = numberValue(row[latName]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) { increment("null"); continue; }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) { increment("out-of-range"); continue; }
    const timeValue = timeName ? String(row[timeName] ?? "").trim() : "";
    if (timeValue && !Number.isFinite(Date.parse(timeValue))) increment("bad-time");
    const key = `${lon},${lat}`;
    if (duplicateKeys.has(key)) duplicates += 1;
    duplicateKeys.add(key);
    const attrs = Object.fromEntries(Object.entries(row).filter(([name]) => name !== latName && name !== lonName && name !== "__row").map(([name, value]) => [name, value === "" ? null : value as string | number]));
    points.push({ id: index, lon, lat, ...(timeValue && Number.isFinite(Date.parse(timeValue)) ? { time: new Date(timeValue).toISOString() } : {}), attrs, precision: { lon: decimalPlaces(String(row[lonName] ?? "")), lat: decimalPlaces(String(row[latName] ?? "")) } });
  }
  if (duplicates) qualityCounts.set("duplicate", duplicates);
  const quality = [...qualityCounts].map(([kind, count]) => ({ kind, count }));
  if (!points.length) errors.push("Tidak ada koordinat valid untuk dianalisis. Periksa kolom dan rentang koordinat.");
  return { points, columns: columns.map((column) => column.name === latName ? { ...column, kind: "coordinate-lat" as const } : column.name === lonName ? { ...column, kind: "coordinate-lon" as const } : column.name === timeName ? { ...column, kind: "time" as const } : column), quality, errors };
}

function inferCoordinates(records: Record<string, unknown>[], columns: ColumnMeta[]) {
  const numeric = columns.filter((column) => column.kind === "numeric");
  if (numeric.length !== 2) return undefined;
  const candidates = numeric.map((column) => {
    const values = records.map((record) => numberValue(record[column.name])).filter(Number.isFinite);
    return { name: column.name, values, meanAbs: values.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, values.length), validLat: values.every((value) => value >= -90 && value <= 90), validLon: values.every((value) => value >= -180 && value <= 180) };
  });
  const latitude = candidates.find((candidate) => candidate.validLat && candidate.meanAbs < 90);
  const longitude = candidates.find((candidate) => candidate !== latitude && candidate.validLon && candidate.meanAbs > 90);
  return latitude && longitude ? { latitude: latitude.name, longitude: longitude.name } : undefined;
}

function decimalPlaces(value: string): number {
  const decimal = value.replace(",", ".").split(".")[1];
  return decimal ? decimal.length : 0;
}
