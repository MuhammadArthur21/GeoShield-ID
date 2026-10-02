import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/analysis";
import { makeManifest, sha256, toCSV, toGeoJSON } from "../src/core/export";
import { protect } from "../src/core/mitigation";
import { parseDataset } from "../src/core/parser";
import { utilityMetrics } from "../src/core/utility";
import type { AnalyzeOptions, ColumnMeta, RawPoint } from "../src/types";

const options: AnalyzeOptions = { gridSizeM: 100, k: 3, timeBucket: "hour" };
const columns: ColumnMeta[] = [
  { name: "latitude", kind: "coordinate-lat", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
  { name: "longitude", kind: "coordinate-lon", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
  { name: "email", kind: "identifier-candidate", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
  { name: "age", kind: "numeric", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
  { name: "gender", kind: "categorical", confidence: 1, nullRatio: 0, uniqueRatio: 0.5 },
];

describe("parser dan deteksi kolom", () => {
  it("mendeteksi alias koordinat dan koma desimal", () => {
    const result = parseDataset("lintang;bujur;waktu\n-6,2;106,8;2026-01-01T08:03:17Z", "sampel.csv");
    expect(result.columns.find((column) => column.name === "lintang")?.kind).toBe("coordinate-lat");
    expect(result.points[0]).toMatchObject({ lat: -6.2, lon: 106.8 });
  });

  it("mendukung TSV dan pemetaan manual", () => {
    const result = parseDataset("northing\teasting\tjam\n40\t6\t2026-01-01T08:00:00Z", "sampel.tsv");
    expect(result.errors[0]).toContain("Pemetaan manual");
    const mapped = parseDataset("northing\teasting\tjam\n40\t6\t2026-01-01T08:00:00Z", "sampel.tsv", { latitude: "northing", longitude: "easting", time: "jam" });
    expect(mapped.points[0]?.time).toBe("2026-01-01T08:00:00.000Z");
  });

  it("membaca GeoJSON Point dan menolak geometry yang tidak didukung", () => {
    const source = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [106.8, -6.2] }, properties: { place: "synthetic" } }, { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} }] });
    const result = parseDataset(source, "points.geojson");
    expect(result.points).toHaveLength(1);
    expect(result.quality.find((issue) => issue.kind === "bad-geometry")?.count).toBe(1);
  });

  it("menghitung null, rentang koordinat, dan duplikat", () => {
    const result = parseDataset("lat,lon\n-6.2,106.8\n-6.2,106.8\n91,200\n,106.8", "quality.csv");
    expect(result.quality).toEqual(expect.arrayContaining([
      { kind: "duplicate", count: 1 },
      { kind: "out-of-range", count: 1 },
      { kind: "null", count: 1 },
    ]));
    expect(result.points).toHaveLength(2);
  });

  it("memunculkan pesan yang jelas untuk file rusak dan kosong", () => {
    expect(() => parseDataset('lat,lon\n"-6,106.8', "broken.csv")).toThrow(/kutip/);
    expect(() => parseDataset("lat,lon\n", "empty.csv")).toThrow(/kosong/);
  });
});

describe("analisis risiko", () => {
  it("menandai identifier, kelompok kecil, dan keunikan waktu", () => {
    const points: RawPoint[] = [
      { id: 1, lon: 106.8, lat: -6.2, time: "2026-01-01T08:00:00Z", attrs: { email: "a@example.test", age: 30, gender: "x" } },
      { id: 2, lon: 106.80001, lat: -6.20001, time: "2026-01-01T08:00:00Z", attrs: { email: "b@example.test", age: 30, gender: "x" } },
      { id: 3, lon: 106.80002, lat: -6.20002, time: "2026-01-01T10:00:00Z", attrs: { email: "c@example.test", age: 32, gender: "y" } },
    ];
    const report = analyze(points, [...columns,
      { name: "phone", kind: "identifier-candidate", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
      { name: "nik", kind: "identifier-candidate", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
    ], { ...options, k: 5 });
    expect(report.summary.identifiers.some((item) => item.column === "email")).toBe(true);
    expect(report.summary.smallGroupCells).toBeGreaterThan(0);
    expect(report.summary.temporalUnique).toBeGreaterThan(0);
    expect(report.perPoint[0]?.level).toBe("HIGH");
    expect(report.summary.rareCombos).toBeGreaterThan(0);
    expect(report.perPoint.every((risk) => risk.explanation.length > 0)).toBe(true);
  });

  it("menandai format email, telepon, NIK sintetis, dan presisi tinggi", () => {
    const points = [
      { id: 0, lat: -6.2, lon: 106.8, precision: { lat: 7, lon: 7 }, attrs: { email: "a@example.test", phone: "081234567890", nik: "1234567890123456" } },
      { id: 1, lat: -6.200001, lon: 106.800001, attrs: { email: "b@example.test", phone: "081234567891", nik: "1234567890123457" } },
      { id: 2, lat: -6.200002, lon: 106.800002, attrs: { email: "c@example.test", phone: "081234567892", nik: "1234567890123458" } },
    ];
    const report = analyze(points, [...columns,
      { name: "phone", kind: "identifier-candidate", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
      { name: "nik", kind: "identifier-candidate", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
    ], options);
    expect(report.summary.identifiers.map((item) => item.column)).toEqual(expect.arrayContaining(["email", "phone", "nik"]));
    expect(report.perPoint[0]?.indicators.some((indicator) => indicator.kind === "high-precision")).toBe(true);
  });

  it("menandai kolom dengan rasio nilai unik tinggi sebagai kandidat", () => {
    const points = Array.from({ length: 10 }, (_, id) => ({ id, lon: 106.8 + id * .00001, lat: -6.2, attrs: { reference: `value-${id}` } }));
    const report = analyze(points, [{ name: "reference", kind: "categorical", confidence: 0.7, nullRatio: 0, uniqueRatio: 1 }], options);
    expect(report.summary.identifiers).toEqual([{ column: "reference", reason: "rasio nilai unik tinggi" }]);
  });

  it("menghasilkan laporan terdefinisi untuk satu record", () => {
    const result = analyze([{ id: 0, lon: 106.8, lat: -6.2, attrs: {} }], [], options);
    expect(result.summary.medianNearestM).toBe(0);
    expect(result.perPoint[0]?.level).toBe("REVIEW");
  });

  it("menyaring pengamatan terpisah dari klaster", () => {
    const points = Array.from({ length: 25 }, (_, id) => ({ id, lon: 106.8 + id * 0.000001, lat: -6.2, attrs: {} }));
    points.push({ id: 25, lon: 107, lat: -6.2, attrs: {} });
    const report = analyze(points, [], options);
    expect(report.summary.spatiallyUnique).toBeGreaterThan(0);
    expect(report.summary.p95NearestM).toBeGreaterThan(0);
  });

  it("menganalisis 10.000 titik tanpa pemindaian pasangan kuadratik", () => {
    const points = Array.from({ length: 10_000 }, (_, id) => ({
      id, lon: 106.8 + (id % 100) * 0.000001, lat: -6.2 + Math.floor(id / 100) * 0.000001, attrs: {},
    }));
    const started = performance.now();
    const report = analyze(points, [], options);
    expect(report.summary.totalPoints).toBe(10_000);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("mitigasi dan ekspor", () => {
  const points: RawPoint[] = Array.from({ length: 4 }, (_, id) => ({ id, lon: 106.8 + id * .0001, lat: -6.2, time: "2026-01-01T08:03:17Z", attrs: { email: "synthetic@example.test", type: "test" } }));

  it("menghasilkan jitter deterministik dalam radius yang dipilih", () => {
    const config = { jitterRadiusM: 50, jitterSeed: "seed-sama" };
    const first = protect(points, config), second = protect(points, config);
    expect(first.points.map(({ lon, lat }) => [lon, lat])).toEqual(second.points.map(({ lon, lat }) => [lon, lat]));
    expect(first.displacement.maxM).toBeLessThanOrEqual(50.001);
  });

  it("menggeneralisasi waktu dan menghapus kolom yang dipilih", () => {
    const result = protect(points, { timeGeneralization: "1h", removedColumns: ["email"] });
    expect(result.points[0]?.time).toBe("2026-01-01T08:00:00.000Z");
    expect(result.points[0]?.attrs).not.toHaveProperty("email");
  });

  it("mengagregasi ke centroid bersama dan menghitung retensi", () => {
    const result = protect(points, { aggregateCellM: 10000 });
    expect(result.points).toHaveLength(points.length);
    expect(new Set(result.points.map((point) => `${point.lon}:${point.lat}`)).size).toBe(1);
  });

  it("menghasilkan GeoJSON yang valid dan hash SHA-256 konsisten", async () => {
    const data = protect(points, {});
    expect(toGeoJSON(data)).toMatchObject({ type: "FeatureCollection", features: expect.arrayContaining([expect.objectContaining({ geometry: { type: "Point", coordinates: expect.any(Array) } })]) });
    expect(await sha256("sama")).toBe(await sha256("sama"));
    expect(await sha256("sama")).not.toBe(await sha256("beda"));
    expect(toCSV(data)).toContain("longitude,latitude");
  });

  it("membuat manifest berisi hash dan transform tanpa menyertakan titik mentah", async () => {
    const source = points.map((point) => ({ ...point, attrs: { ...point.attrs, private_note: "sample-secret" } }));
    const manifest = await makeManifest(source, protect(source, { jitterRadiusM: 25, jitterSeed: "repeatable" }));
    expect(manifest.recordCountIn).toBe(source.length);
    expect(manifest.processingMode).toBe("client-side");
    expect(manifest.inputHash).toHaveLength(64);
    expect(JSON.stringify(manifest)).not.toContain("sample-secret");
  });

  it("menghitung retensi, shift centroid, extent, dan perubahan atribut", () => {
    const after = protect(points, { jitterRadiusM: 25, jitterSeed: "metrics" });
    const metrics = utilityMetrics(points, after.points);
    expect(metrics.recordRetention).toBe(1);
    expect(metrics.centroidShiftM).toBeGreaterThanOrEqual(0);
    expect(metrics.attributePreservation.find((item) => item.column === "email")?.retained).toBe(1);
    expect(metrics.uniqueLocationsBefore).toBeGreaterThan(0);
  });
});
