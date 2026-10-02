import type { AnalyzeOptions, RiskReport } from "../types";
import type { CSSProperties } from "react";

type RiskFilter = "all" | "spatial" | "temporal" | "identifier" | "rare";

interface RiskSummaryProps {
  report: RiskReport | null;
  options: AnalyzeOptions;
  busy: boolean;
  onFilter: (filter: RiskFilter) => void;
}

export default function RiskSummary({ report, options, busy, onFilter }: RiskSummaryProps) {
  const levelFor = (matches: (kind: string) => boolean) => {
    let highest: "LOW" | "REVIEW" | "HIGH" = "LOW";
    for (const risk of report?.perPoint ?? []) {
      if (risk.indicators.some((indicator) => matches(indicator.kind))) {
        if (risk.level === "HIGH") return "high";
        if (risk.level === "REVIEW") highest = "REVIEW";
      }
    }
    return highest.toLowerCase();
  };

  return <article id="section-temuan" className="panel findings-panel">
    <div className="panel-heading"><div><b>Ringkasan temuan</b><small>{report ? `Grid ${options.gridSizeM} m · ukuran kelompok spasial minimum k=${options.k}` : "Tinjauan teknis dataset"}</small></div><span className="count-pill">{report ? report.perPoint.filter((risk) => risk.indicators.length).length.toLocaleString("id-ID") : 0}</span></div>
    {report ? <div className="finding-list">
      <Finding label="Kolom terindikasi identifier" value={report.summary.identifiers.length} level={levelFor((kind) => kind === "identifier-column")} order={0} onClick={() => onFilter("identifier")} />
      <Finding label="Record pada kelompok kecil" value={report.summary.smallGroupPoints} level={levelFor((kind) => kind === "small-group")} order={1} onClick={() => onFilter("spatial")} />
      <Finding label="Observasi unik secara spasial" value={report.summary.spatiallyUnique} level={levelFor((kind) => kind === "spatially-unique")} order={2} onClick={() => onFilter("spatial")} />
      <Finding label="Kombinasi lokasi-waktu sangat unik" value={report.summary.temporalUnique} level={levelFor((kind) => kind === "temporal-unique")} order={3} onClick={() => onFilter("temporal")} />
      <Finding label="Kombinasi atribut langka" value={report.summary.rareCombos} level={levelFor((kind) => kind === "rare-attribute")} order={4} onClick={() => onFilter("rare")} />
      <p className="calculation">{report.summary.totalPoints === 1 ? "Satu titik tidak memiliki tetangga pembanding." : `Jarak tetangga median ${report.summary.medianNearestM.toFixed(1)} m · persentil 95 ${report.summary.p95NearestM.toFixed(1)} m.`}<button title="Grid meter dihitung menggunakan proyeksi equirectangular sekitar centroid dataset. k adalah ukuran kelompok minimum, bukan jaminan anonimitas.">Bagaimana dihitung?</button></p>
      <p className="risk-rule">LOW: tidak ada indikator · REVIEW: 1 indikator · HIGH: ≥2 indikator atau kelompok kecil + waktu unik. Penyaringan teknis, bukan klasifikasi hukum.</p>
    </div> : <div className="empty-findings"><span className="empty-contour" aria-hidden="true" /><b>{busy ? "Analisis sedang berjalan" : "Belum ada temuan"}</b><small>{busy ? "Dataset Anda diproses di perangkat ini." : "Tambahkan data untuk memulai pemeriksaan."}</small></div>}
  </article>;
}

function Finding({ label, value, level, order, onClick }: { label: string; value: number; level: string; order: number; onClick: () => void }) {
  return <button className={`finding-row risk-${level}`} style={{ "--finding-order": order } as CSSProperties} onClick={onClick}><span className="finding-contour" aria-hidden="true" />{label}<b>{value.toLocaleString("id-ID")}</b></button>;
}
