import type { ProtectedDataset, RiskReport } from "../types";

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function toGeoJSON(dataset: ProtectedDataset) {
  return { type: "FeatureCollection", features: dataset.points.map((point) => ({ type: "Feature", geometry: { type: "Point", coordinates: [point.lon, point.lat] }, properties: { id: point.id, ...(point.time ? { time: point.time } : {}), ...point.attrs, ...(point.cellId ? { cellId: point.cellId } : {}) } })) };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCSV(dataset: ProtectedDataset): string {
  const keys = [...new Set(dataset.points.flatMap((point) => Object.keys(point.attrs)))];
  const headers = ["id", "longitude", "latitude", ...(dataset.points.some((point) => point.time) ? ["time"] : []), ...keys, ...(dataset.points.some((point) => point.cellId) ? ["cellId"] : [])];
  return [headers, ...dataset.points.map((point) => headers.map((key) => key === "longitude" ? point.lon : key === "latitude" ? point.lat : key === "id" ? point.id : key === "time" ? point.time ?? "" : key === "cellId" ? point.cellId ?? "" : point.attrs[key] ?? ""))].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export async function makeManifest(input: unknown, output: ProtectedDataset) {
  const inputCount = Array.isArray(input) ? input.length : 0;
  return {
    application: "GeoShield ID", version: "1.0.0", createdAt: new Date().toISOString(),
    inputHash: await sha256(stable(input)), outputHash: await sha256(stable(toGeoJSON(output))),
    recordCountIn: inputCount, recordCountOut: output.points.length,
    transforms: output.transformsApplied, processingMode: "client-side",
    disclaimer: DISCLAIMER,
  };
}

export const DISCLAIMER = "GeoShield ID adalah alat bantu pemeriksaan risiko teknis dan bukan alat sertifikasi kepatuhan hukum. Hasil analisis tidak menjamin bahwa dataset bebas dari risiko identifikasi atau otomatis memenuhi seluruh ketentuan peraturan perundang-undangan. Pengguna tetap bertanggung jawab memastikan dasar pemrosesan, hak akses, tujuan penggunaan, keamanan, dan ketentuan penyebarluasan data yang berlaku.";

export function reportHTML(report: RiskReport, dataset: ProtectedDataset): string {
  const flagged = report.perPoint.filter((point) => point.indicators.length);
  const rows = flagged.slice(0, 500).map((point) => `<tr><td>${point.pointId}</td><td>${point.level}</td><td>${escapeHTML(point.explanation)}</td></tr>`).join("");
  const truncation = flagged.length > 500 ? `<p>Rincian menampilkan 500 dari ${flagged.length} record bertanda; ringkasan di atas dihitung untuk seluruh dataset.</p>` : "";
  return `<!doctype html><html lang="id"><meta charset="utf-8"><title>Laporan GeoShield ID</title><style>body{font:15px system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#243329}h1{color:#476e50}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dce3db;padding:8px;text-align:left}th{background:#eef3ec}.note{background:#f1f5ef;padding:14px;border-left:3px solid #52795b}@media print{body{margin:10mm}}</style><h1>GeoShield ID — Laporan pemeriksaan</h1><p>Analisis teknis konservatif; hasil bukan klasifikasi hukum.</p><h2>Ringkasan</h2><p>Record: ${report.summary.totalPoints} · Ukuran grid: ${report.params.gridSizeM} m · k: ${report.params.k} · Sel kelompok kecil: ${report.summary.smallGroupCells} · Kombinasi lokasi-waktu unik: ${report.summary.temporalUnique}</p><h2>Apa yang berubah?</h2><p>Record masuk: ${report.summary.totalPoints} · Record keluar: ${dataset.points.length} · Kolom dihapus: ${escapeHTML(dataset.transformsApplied.removedColumns?.join(", ") || "Tidak ada")} · Jarak perpindahan maksimum: ${dataset.displacement.maxM.toFixed(1)} m.</p><h2>Temuan</h2>${truncation}<table><thead><tr><th>Record</th><th>Tingkat indikator</th><th>Penjelasan</th></tr></thead><tbody>${rows}</tbody></table><p class="note">${DISCLAIMER}</p></html>`;
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
