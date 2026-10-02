import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { downloadFile, makeManifest, reportHTML, toCSV, toGeoJSON, DISCLAIMER } from "./core/export";
import { utilityMetrics } from "./core/utility";
import { parseDataset } from "./core/parser";
import idMessages from "./i18n/id.json";
import enMessages from "./i18n/en.json";
import PrivacyModeBadge from "./components/PrivacyModeBadge";
import MetricCard from "./components/MetricCard";
import RiskSummary from "./components/RiskSummary";
import ExportPanel from "./components/ExportPanel";
import Icon from "./components/Icon";
import ContourField from "./components/ContourField";
import type { AnalyzeOptions, ColumnMeta, ParsedDataset, ProtectedDataset, RawPoint, RiskReport, TransformConfig, WorkerRequest, WorkerResponse } from "./types";

const DEFAULT_OPTIONS: AnalyzeOptions = { gridSizeM: 250, k: 5, timeBucket: "hour" };
const NAV = ["Data", "Temuan", "Proteksi", "Utilitas", "Ekspor"];
const NAV_ICONS = ["data", "temuan", "proteksi", "utilitas", "ekspor"];
const NAV_TARGETS: Record<string, string> = {
  Data: "section-data",
  Temuan: "section-temuan",
  Proteksi: "section-proteksi",
  Utilitas: "section-utilitas",
  Ekspor: "section-ekspor",
};
type Filter = "all" | "spatial" | "temporal" | "identifier" | "rare";
type MapVersion = "before" | "after" | "compare";
interface SvgPoint {
  id: number;
  x: number;
  y: number;
  level: "LOW" | "REVIEW" | "HIGH";
}
interface PointGroup extends SvgPoint {
  count: number;
  sumX: number;
  sumY: number;
}

function makeDemo(): ParsedDataset {
  let seed = 20260930;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const points: RawPoint[] = Array.from({ length: 2000 }, (_, id) => {
    const outlier = id >= 1970;
    const lat = outlier ? -6.18 - random() * .02 : -6.2 + (random() - .5) * .006;
    const lon = outlier ? 106.94 + random() * .02 : 106.82 + (random() - .5) * .008;
    const time = new Date(Date.UTC(2026, 6, 1, 6 + Math.floor(random() * 12), Math.floor(random() * 60), id % 60)).toISOString();
    return { id, lon, lat, time, precision: { lon: 6, lat: 6 }, attrs: { age_group: ["18-29", "30-44", "45-59"][Math.floor(random() * 3)]!, visit_type: ["routine", "follow-up", "first-visit"][Math.floor(random() * 3)]! } };
  });
  const columns: ColumnMeta[] = [
    { name: "longitude", kind: "coordinate-lon", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
    { name: "latitude", kind: "coordinate-lat", confidence: 1, nullRatio: 0, uniqueRatio: 1 },
    { name: "timestamp", kind: "time", confidence: 1, nullRatio: 0, uniqueRatio: .9 },
    { name: "age_group", kind: "categorical", confidence: .7, nullRatio: 0, uniqueRatio: .01 },
    { name: "visit_type", kind: "categorical", confidence: .7, nullRatio: 0, uniqueRatio: .01 },
  ];
  return { points, columns, quality: [], errors: [] };
}

function groupMapPoints(points: SvgPoint[], cellSize: number, selectedRisk: number | null) {
  const groups = new Map<string, PointGroup>();
  const severity = { LOW: 0, REVIEW: 1, HIGH: 2 } as const;
  for (const point of points) {
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { ...point, count: 1, sumX: point.x, sumY: point.y });
      continue;
    }
    group.count += 1;
    group.sumX += point.x;
    group.sumY += point.y;
    if ((selectedRisk === point.id && group.id !== selectedRisk) || (group.id !== selectedRisk && severity[point.level] > severity[group.level])) group.id = point.id;
    if (severity[point.level] > severity[group.level]) group.level = point.level;
  }
  return [...groups.values()].map((group) => ({ ...group, x: group.sumX / group.count, y: group.sumY / group.count }));
}

function PointMarks({ points, selectedRisk, onSelect, cellSize }: { points: SvgPoint[]; selectedRisk: number | null; onSelect: (id: number) => void; cellSize: number }) {
  const groups = useMemo(() => groupMapPoints(points, cellSize, selectedRisk), [points, cellSize, selectedRisk]);
  return <g>{groups.map((point) => {
    const markerRadius = point.count > 1 ? Math.min(cellSize * 0.32, 1.35 + Math.sqrt(point.count) * 0.6) : selectedRisk === point.id ? 4.2 : 2.2;
    const ridgeOffset = Math.min(cellSize * 0.28, point.level === "HIGH" ? 2.8 : 1.8);
    return <g key={point.id} onClick={() => onSelect(point.id)}>
      {point.level !== "LOW" && <circle cx={point.x} cy={point.y} r={markerRadius + ridgeOffset} className={`point-ridge ${point.level.toLowerCase()}`} />}
      <circle cx={point.x} cy={point.y} r={markerRadius} className={`point ${point.level.toLowerCase()}${point.count > 1 ? " cluster-point" : ""}${selectedRisk === point.id ? " selected" : ""}`}><title>{point.count > 1 ? `${point.count} titik pada sampel peta · ` : ""}Record {point.id} · {point.level}</title></circle>
    </g>;
  })}</g>;
}

export default function App() {
  const [dataset, setDataset] = useState<ParsedDataset | null>(null);
  const [report, setReport] = useState<RiskReport | null>(null);
  const [protectedData, setProtectedData] = useState<ProtectedDataset | null>(null);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedRisk, setSelectedRisk] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [percent, setPercent] = useState(65);
  const [decimals, setDecimals] = useState(5);
  const [pendingRemoved, setPendingRemoved] = useState<string[]>([]);
  const [jitter, setJitter] = useState(false);
  const [jitterRadius, setJitterRadius] = useState<25 | 50 | 100 | 250>(50);
  const [aggregate, setAggregate] = useState(false);
  const [generalize, setGeneralize] = useState<TransformConfig["timeGeneralization"] | "">("");
  const [removed, setRemoved] = useState<string[]>([]);
  const [seed, setSeed] = useState("GX-49201");
  const [section, setSection] = useState("Data");
  const [navTransition, setNavTransition] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);
  const [mapVersion, setMapVersion] = useState<MapVersion>("before");
  const [curtainPosition, setCurtainPosition] = useState(50);
  const [curtainDragging, setCurtainDragging] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [fileDropped, setFileDropped] = useState(false);
  const [fileProcessing, setFileProcessing] = useState(false);
  const [lang, setLang] = useState<"id" | "en">("id");
  const worker = useRef<Worker | null>(null);
  const navTimer = useRef<number | null>(null);
  const navFocusTimer = useRef<number | null>(null);
  const navFocusTarget = useRef<HTMLElement | null>(null);
  const requestId = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mapping, setMapping] = useState<{ rows: Record<string, string>[]; columns: string[] } | null>(null);

  useEffect(() => {
    worker.current = new Worker(new URL("./workers/privacy.worker.ts", import.meta.url), { type: "module" });
    worker.current.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== requestId.current) return;
      setBusy(false);
      if (event.data.type === "ERROR") { setError(event.data.message ?? "Analisis tidak dapat diselesaikan."); return; }
      if (event.data.report) { setReport(event.data.report); setProtectedData(null); }
      if (event.data.result) setProtectedData(event.data.result);
    };
    worker.current.onerror = () => { setBusy(false); setError("Worker analisis mengalami gangguan. Muat ulang halaman dan coba kembali."); };
    return () => worker.current?.terminate();
  }, []);

  useEffect(() => () => {
    if (navTimer.current !== null) window.clearTimeout(navTimer.current);
    if (navFocusTimer.current !== null) window.clearTimeout(navFocusTimer.current);
    navFocusTarget.current?.classList.remove("nav-arrival");
  }, []);

  const runAnalysis = (data: ParsedDataset, nextOptions = options) => {
    if (!worker.current) { setError("Worker analisis belum siap."); return; }
    setBusy(true); setError(""); setReport(null); setProtectedData(null); setExportComplete(false);
    requestId.current += 1;
    worker.current.postMessage({ id: requestId.current, type: "ANALYZE", payload: { points: data.points, columns: data.columns, options: nextOptions } } satisfies WorkerRequest);
  };

  const loadDataset = (data: ParsedDataset) => {
    setDataset(data); setMapping(null);
    setError(""); setNotice(""); setFilter("all"); setSelectedRisk(null); setMapVersion("before"); setCurtainPosition(50); setExportComplete(false);
    if (data.errors.some((item) => item.includes("Pemetaan manual"))) { setMapping({ rows: [], columns: data.columns.map((column) => column.name) }); setReport(null); return; }
    if (!data.points.length) { setError(data.errors[0] ?? "Dataset tidak memiliki titik valid."); return; }
    runAnalysis(data);
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setError(""); setNotice("");
    if (file.size > 50 * 1024 * 1024) { setError("Ukuran file melebihi batas 50 MB."); return; }
    if (!/\.(csv|tsv|geojson|json)$/i.test(file.name)) { setError("Format belum didukung. Pilih CSV, TSV, atau GeoJSON."); return; }
    setFileProcessing(true);
    try { loadDataset(parseDataset(await file.text(), file.name)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "File tidak dapat dibaca."); }
    finally { setFileProcessing(false); }
  };

  const transforms = useMemo<TransformConfig>(() => ({
    ...(percent < 70 ? { roundingDecimals: Math.max(4, decimals - (percent < 35 ? 1 : 0)) } : {}),
    ...(aggregate ? { aggregateCellM: options.gridSizeM } : {}),
    ...(jitter ? { jitterRadiusM: jitterRadius, jitterSeed: seed } : {}),
    ...(removed.length ? { removedColumns: removed } : {}),
    ...(generalize ? { timeGeneralization: generalize } : {}),
  }), [percent, decimals, aggregate, options.gridSizeM, jitter, jitterRadius, seed, removed, generalize]);

  useEffect(() => {
    if (!dataset || !report || !worker.current) return;
    setProtectedData(null); setExportComplete(false);
    const timer = window.setTimeout(() => {
      setBusy(true);
      requestId.current += 1;
      worker.current?.postMessage({ id: requestId.current, type: "PROTECT", payload: { points: dataset.points, transforms } } satisfies WorkerRequest);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [dataset, report, transforms]);

  const reanalyze = (next: AnalyzeOptions) => {
    setOptions(next);
    if (dataset?.points.length) runAnalysis(dataset, next);
  };

  const filteredRisks = useMemo(() => {
    if (!report) return [];
    return report.perPoint.filter((risk) => {
      if (filter === "all") return risk.indicators.length > 0;
      return risk.indicators.some((indicator) => filter === "spatial" ? indicator.kind === "small-group" || indicator.kind === "spatially-unique" || indicator.kind === "high-precision" : filter === "temporal" ? indicator.kind === "temporal-unique" : filter === "identifier" ? indicator.kind === "identifier-column" : indicator.kind === "rare-attribute");
    });
  }, [report, filter]);

  const mapCandidates = useMemo(() => {
    const sourcePoints = dataset?.points ?? [];
    const visibleIds = filter === "all" || !report ? null : new Set(filteredRisks.map((risk) => risk.pointId));
    const visible = visibleIds ? sourcePoints.filter((point) => visibleIds.has(point.id)) : sourcePoints;
    const stride = Math.max(1, Math.ceil(visible.length / 2000));
    return visible.filter((_, index) => index % stride === 0);
  }, [dataset, report, filter, filteredRisks]);
  const visiblePointCount = filter === "all" || !report ? dataset?.points.length ?? 0 : filteredRisks.length;
  const riskById = useMemo(() => new Map(report?.perPoint.map((item) => [item.pointId, item]) ?? []), [report]);
  const protectedById = useMemo(() => new Map(protectedData?.points.map((point) => [point.id, point]) ?? []), [protectedData]);

  const mapLayers = useMemo(() => {
    if (!mapCandidates.length) return { before: [] as SvgPoint[], after: [] as SvgPoint[], visibleCount: 0, sampleCount: 0 };
    const displayLimit = Math.max(120, Math.round(120 + percent * 18.8));
    const stride = Math.max(1, Math.ceil(mapCandidates.length / displayLimit));
    const displayed = mapCandidates.filter((_, index) => index % stride === 0);
    const paired = displayed.map((before) => ({ before, after: protectedById.get(before.id) ?? before }));
    const bounds = paired.flatMap(({ before, after }) => [before, after]).reduce((result, point) => ({ minLon: Math.min(result.minLon, point.lon), maxLon: Math.max(result.maxLon, point.lon), minLat: Math.min(result.minLat, point.lat), maxLat: Math.max(result.maxLat, point.lat) }), { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity });
    const { minLon, maxLon, minLat, maxLat } = bounds;
    const dx = Math.max(maxLon - minLon, 0.00001), dy = Math.max(maxLat - minLat, 0.00001);
    const mapPoint = (point: RawPoint): SvgPoint => {
      const risk = riskById.get(point.id);
      return { id: point.id, x: 20 + (point.lon - minLon) / dx * 760, y: 20 + (maxLat - point.lat) / dy * 360, level: risk?.level ?? "LOW" as const };
    };
    return { before: paired.map(({ before }) => mapPoint(before)), after: paired.map(({ after }) => mapPoint(after)), visibleCount: visiblePointCount, sampleCount: displayed.length };
  }, [mapCandidates, protectedById, riskById, percent, visiblePointCount]);

  const loadDemo = () => loadDataset(makeDemo());
  const metrics = dataset && protectedData ? utilityMetrics(dataset.points, protectedData.points, options.gridSizeM) : null;
  const exportAll = async (name: string) => {
    if (!protectedData) { setError("Terapkan proteksi dan tunggu pratinjau sebelum mengekspor."); return; }
    try {
      if (name === "manifest") downloadFile("privacy-manifest.json", JSON.stringify(await makeManifest(dataset?.points ?? [], protectedData), null, 2), "application/json");
      else if (name === "report") {
        if (!report) return;
        downloadFile("privacy-report.html", reportHTML(report, protectedData), "text/html");
      } else if (name === "geojson") downloadFile("protected-data.geojson", JSON.stringify(toGeoJSON(protectedData), null, 2), "application/geo+json");
      else downloadFile("protected-data.csv", toCSV(protectedData), "text/csv;charset=utf-8");
      setExportComplete(true);
    } catch { setError("Ekspor gagal. Pastikan browser mendukung Web Crypto API dan coba kembali."); }
  };
  const t = (id: string, en: string) => lang === "id" ? id : en;
  const completedSteps = !dataset ? 0 : !report ? 1 : !protectedData ? 3 : exportComplete ? 5 : 4;
  const navigateToSection = (next: string) => {
    setSection(next);
    setNavTransition(true);
    if (navTimer.current !== null) window.clearTimeout(navTimer.current);
    navTimer.current = window.setTimeout(() => setNavTransition(false), 250);
    window.requestAnimationFrame(() => {
      const targetId = NAV_TARGETS[next];
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) {
        setError(`Bagian ${next} tidak ditemukan. Muat ulang halaman dan coba kembali.`);
        return;
      }
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
      navFocusTarget.current?.classList.remove("nav-arrival");
      target.classList.remove("nav-arrival");
      void target.getBoundingClientRect();
      target.classList.add("nav-arrival");
      navFocusTarget.current = target;
      if (navFocusTimer.current !== null) window.clearTimeout(navFocusTimer.current);
      navFocusTimer.current = window.setTimeout(() => {
        target.classList.remove("nav-arrival");
        navFocusTarget.current = null;
      }, 900);
    });
  };
  const onMapDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDraggingFile(true);
  };
  const onMapDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDraggingFile(false);
    setFileDropped(true);
    window.setTimeout(() => setFileDropped(false), 850);
    void handleFile(event.dataTransfer.files[0]);
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" aria-label="GeoShield ID, beranda"><img className="brand-logo" src="/assets/brand/contour-shield.svg" alt="GeoShield ID — Pemeriksaan Privasi Geospasial" /></a>
      <div className="side-caption">Ruang kerja</div>
      <nav className="side-nav" aria-label="Navigasi utama" style={{ "--nav-index": NAV.indexOf(section) } as CSSProperties}><span className="nav-indicator" aria-hidden="true" />{NAV.map((item, index) => <button key={item} data-icon={`gs-${NAV_ICONS[index]}`} aria-current={section === item ? "page" : undefined} className={section === item ? "nav-item active" : "nav-item"} onClick={() => navigateToSection(item)}><Icon name={NAV_ICONS[index]!} className="nav-icon" />{item}<span className="nav-num">0{index + 1}</span></button>)}</nav>
      <div className="side-spacer" />
      <div className="privacy-card" tabIndex={0} aria-describedby="privacy-card-help"><b><i className="privacy-pulse" />Mode privasi aktif</b><p>{lang === "id" ? idMessages.privacyLocal : enMessages.privacyLocal} Tidak ada unggah, analitik, layanan AI eksternal, atau database.</p><span>Pemrosesan lokal</span><span id="privacy-card-help" className="privacy-tooltip" role="tooltip">Seluruh data diproses di perangkat ini dan tidak dikirim ke mana pun.</span></div>
      <div className="side-footer">GeoShield ID <span>v1.0.0</span></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Ruang kerja <span>/</span> <b>{section}</b></div><PrivacyModeBadge language={lang} onLanguageChange={setLang} /></header>
      <div id="section-data" className={`page-content${navTransition ? " nav-sweep" : ""}`}>
        <div className="page-heading hero-panel"><ContourField className="hero-contours" /><div className="hero-copy"><div className="overline">Pemeriksaan geospasial <span>·</span> Pra-publikasi</div><h1>{lang === "id" ? idMessages.tagline : enMessages.tagline}</h1><p>{t("Analisis indikator risiko privasi dataset geospasial langsung di browser. Tanpa unggah data.", "Review geospatial privacy risk indicators in your browser. No data upload.")}</p></div><div className="heading-actions"><button className="primary-button" onClick={() => fileRef.current?.click()}><Icon name="analisis" />{t("Analisis Data Saya", "Analyze My Data")}</button><button className="secondary-button" onClick={loadDemo}><Icon name="contoh" />{t("Coba Data Contoh", "Try Sample Data")}</button><input ref={fileRef} type="file" accept=".csv,.tsv,.geojson,.json" hidden onChange={(event) => { void handleFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></div></div>
        {error && <div className="alert error" role="alert"><b>Perlu diperiksa:</b> {error}<button onClick={() => setError("")} aria-label="Tutup pesan">×</button></div>}
        {notice && <div className="alert" role="status">{notice}</div>}
        <div className="metric-row">
          <MetricCard title={t("Record diperiksa", "Records checked")} numericValue={report?.summary.totalPoints} value={report ? report.summary.totalPoints.toLocaleString("id-ID") : "—"} caption={dataset ? "record valid" : t("menunggu dataset", "waiting for data")} />
          <MetricCard title={t("Indikator", "Indicators")} numericValue={report ? report.perPoint.filter((risk) => risk.indicators.length).length : undefined} value={report ? report.perPoint.filter((risk) => risk.indicators.length).length.toLocaleString("id-ID") : "—"} caption={report ? t("record ditandai", "records flagged") : t("belum dianalisis", "not analyzed")} />
          <MetricCard title={t("Kolom", "Columns")} numericValue={dataset?.columns.length} value={dataset ? dataset.columns.length.toString() : "—"} caption={dataset ? dataset.columns.filter((column) => column.kind.startsWith("coordinate")).length + " koordinat" : t("menunggu dataset", "waiting for data")} />
          <MetricCard title={t("Pemrosesan", "Processing")} value="Lokal" caption="di perangkat Anda" />
        </div>
        {dataset && dataset.quality.length > 0 && <div className="quality-review" role="status"><b>Validasi kualitas (terpisah dari risiko privasi):</b> {dataset.quality.map((issue) => `${{ null: "koordinat kosong/tidak valid", "out-of-range": "koordinat di luar rentang", duplicate: "duplikat koordinat", "bad-time": "timestamp tidak valid", "bad-geometry": "geometri bukan Point" }[issue.kind]}: ${issue.count}`).join(" · ")}</div>}
        <section className="dashboard-grid">
          <article className="panel map-panel">
            <div className="panel-heading"><div><b>{t("Peta risiko", "Risk map")}</b><small>{dataset ? `${dataset.points.length.toLocaleString("id-ID")} titik · proyeksi tampilan lokal` : t("Visualisasi sebaran dataset", "Dataset distribution visualization")}</small></div><div className="map-options"><div className="before-after" role="group" aria-label="Mode perbandingan peta"><button aria-pressed={mapVersion === "before"} className={mapVersion === "before" ? "chosen" : ""} onClick={() => setMapVersion("before")}>Sebelum</button><button aria-pressed={mapVersion === "compare"} className={mapVersion === "compare" ? "chosen" : ""} onClick={() => setMapVersion("compare")} disabled={!protectedData}>Bandingkan</button><button aria-pressed={mapVersion === "after"} className={mapVersion === "after" ? "chosen" : ""} onClick={() => setMapVersion("after")} disabled={!protectedData}>Sesudah</button></div><label>Grid <select value={options.gridSizeM} onChange={(event) => reanalyze({ ...options, gridSizeM: Number(event.target.value) as AnalyzeOptions["gridSizeM"] })}><option value="50">50 m</option><option value="100">100 m</option><option value="250">250 m</option><option value="500">500 m</option><option value="1000">1 km</option></select></label><label>k <select value={options.k} onChange={(event) => reanalyze({ ...options, k: Number(event.target.value) as AnalyzeOptions["k"] })}><option value="3">3</option><option value="5">5</option><option value="10">10</option><option value="20">20</option></select></label><label title="Resolusi waktu untuk menguji kombinasi lokasi dan waktu">Waktu <select value={options.timeBucket} onChange={(event) => reanalyze({ ...options, timeBucket: event.target.value as AnalyzeOptions["timeBucket"] })}><option value="minute">Menit</option><option value="hour">Jam</option><option value="day">Hari</option></select></label></div></div>
            <div className="map-filters" role="group" aria-label="Filter layer peta">{([["all", "Semua"], ["spatial", "Spasial"], ["temporal", "Temporal"], ["identifier", "Identifier"], ["rare", "Kombinasi langka"]] as [Filter, string][]).map(([key, title]) => <button key={key} onClick={() => setFilter(key)} className={filter === key ? "filter-chip selected" : "filter-chip"}>{title}</button>)}</div>
            <div className={`map-view${draggingFile ? " is-file-over" : ""}${fileDropped ? " is-file-dropped" : ""}`} data-detail={percent < 35 ? "privacy" : percent < 70 ? "balanced" : "detail"} aria-label="Peta dataset sintetis atau titik koordinat yang diunggah" onDragEnter={onMapDragOver} onDragOver={onMapDragOver} onDragLeave={(event) => { const target = event.relatedTarget; if (!(target instanceof Node) || !event.currentTarget.contains(target)) setDraggingFile(false); }} onDrop={onMapDrop} style={{ "--curtain-position": `${curtainPosition}%` } as CSSProperties}>
              <div className="map-grid" />
              <ContourField className="map-contours" />
              {mapLayers.before.length ? <svg className="points-map" viewBox="0 0 800 400" role="group" tabIndex={0} aria-label={`Peta menampilkan ${mapLayers.sampleCount} titik sampel dalam kelompok visual. Gunakan tombol panah untuk memilih record.`} onKeyDown={(event) => {
                if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key) || !mapLayers.before.length) return;
                event.preventDefault();
                const current = mapLayers.before.findIndex((point) => point.id === selectedRisk);
                const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
                const next = current < 0 ? 0 : (current + step + mapLayers.before.length) % mapLayers.before.length;
                setSelectedRisk(mapLayers.before[next]!.id);
              }}>
                <g aria-hidden="true"><PointMarks points={mapVersion === "after" ? mapLayers.after : mapLayers.before} selectedRisk={selectedRisk} onSelect={setSelectedRisk} cellSize={16 - percent * 0.06} /></g>
                {mapVersion === "compare" && <g className="compare-points" clipPath="url(#comparison-clip)" aria-hidden="true"><PointMarks points={mapLayers.after} selectedRisk={selectedRisk} onSelect={setSelectedRisk} cellSize={16 - percent * 0.06} /></g>}
                {mapVersion === "compare" && <><defs><clipPath id="comparison-clip"><rect x={curtainPosition * 8} y="0" width={(100 - curtainPosition) * 8} height="400" /></clipPath></defs><line className="comparison-line" x1={curtainPosition * 8} y1="0" x2={curtainPosition * 8} y2="400" /></>}
              </svg> : dataset && report && filter !== "all" ? <div className="map-filter-empty"><span className="empty-contour" aria-hidden="true" /><b>Tidak ada titik untuk filter ini</b><span>Coba jenis indikator lain atau tampilkan semua titik.</span><button className="text-button" onClick={() => setFilter("all")}>Tampilkan semua</button></div> : <div className="map-placeholder"><div className="map-symbol"><Icon name="peta" /></div><b>{busy || fileProcessing ? t("Sedang memeriksa data…", "Checking your data…") : t("Peta Anda menunggu data", "Your map is waiting for data")}</b><p>{busy || fileProcessing ? t("Berkas sedang dibaca atau diperiksa di perangkat ini. Titik akan muncul setelah proses selesai.", "The file is being read or checked on this device. Mapped points will appear when processing is complete.") : t("Lepaskan CSV, TSV, atau GeoJSON titik di sini, atau pilih berkas untuk mulai memeriksa privasi lokasinya.", "Drop a point CSV, TSV, or GeoJSON here, or choose a file to start checking its location privacy.")}</p><button className="text-button" onClick={() => fileRef.current?.click()}>{t("Pilih berkas", "Choose a file")}</button><button className="text-button" onClick={loadDemo}>{t("Coba data sintetis", "Try synthetic data")}</button></div>}
              {mapVersion === "compare" && mapLayers.before.length > 0 && <><span className="curtain-label curtain-before">Sebelum</span><span className="curtain-label curtain-after">Sesudah</span><input className={`comparison-range${curtainDragging ? " is-dragging" : ""}`} type="range" min="0" max="100" value={curtainPosition} aria-label="Posisi tirai perbandingan" aria-valuetext={`${curtainPosition}%; sebelum di kiri dan sesudah di kanan`} onChange={(event) => setCurtainPosition(Number(event.target.value))} onPointerDown={() => setCurtainDragging(true)} onPointerUp={() => setCurtainDragging(false)} onPointerCancel={() => setCurtainDragging(false)} onBlur={() => setCurtainDragging(false)} /></>}
              {(busy || fileProcessing) && <div className="map-progress" role="progressbar" aria-label="Sedang memproses seluruh record"><svg viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 9c38-9 49-9 82-2s47 7 79-1 51-7 81 1 55 8 82 0 50-9 76-4" /></svg><span>{t("Memproses seluruh record di perangkat ini", "Processing all records on this device")}</span></div>}
              {draggingFile && <div className="drop-overlay" aria-live="polite"><span>+</span>{t("Lepaskan untuk mulai memeriksa", "Drop to begin checking")}</div>}
              {mapLayers.visibleCount > mapLayers.sampleCount && <span className="sample-note">Peta mengelompokkan {mapLayers.sampleCount.toLocaleString("id-ID")} sampel visual dari {mapLayers.visibleCount.toLocaleString("id-ID")} titik sesuai tingkat detail. Pengelompokan tidak mengubah hasil analisis atau ekspor.</span>}
              <span className="map-crs">WGS 84 · EPSG:4326</span><span className="map-scale">— 1 km</span>
              {selectedRisk !== null && report && <div className="point-detail"><button onClick={() => setSelectedRisk(null)} aria-label="Tutup detail">×</button><b>Record {selectedRisk} · {report.perPoint.find((risk) => risk.pointId === selectedRisk)?.level}</b><p>{report.perPoint.find((risk) => risk.pointId === selectedRisk)?.explanation ?? "Tidak ditemukan indikator untuk record ini."}</p></div>}
            </div>
            {mapLayers.before.length > 0 && <p className="map-disclosure">{percent < 35 ? "Privasi: tampilan titik diringkas dan kontur risiko dirapatkan." : percent < 70 ? "Peta merangkum titik agar pola lokasi mudah dibaca." : "Detail: lebih banyak titik individual ditampilkan."} Analisis dan transformasi tetap memakai seluruh dataset.</p>}
            <div className="legend"><span><i className="legend-ridge low" /> Rendah</span><span><i className="legend-ridge review" /> Perlu ditinjau</span><span><i className="legend-ridge high" /> Perhatian tinggi</span><span className="legend-spacer" /><span>{t("Tanpa basemap eksternal", "No external basemap")}</span></div>
          </article>
          <aside className="right-column">
            <RiskSummary report={report} options={options} busy={busy} onFilter={setFilter} />
            <article className="panel pipeline"><div className="panel-heading"><div><b>Alur pemeriksaan</b><small>Dataset → tinjauan → proteksi</small></div><span className="count-pill">{completedSteps}/5</span></div><div className="pipeline-items" role="list" aria-label="Langkah pemeriksaan" style={{ "--pipeline-progress": `${completedSteps * 20}%` } as CSSProperties}>{["Tambahkan data", "Periksa kualitas", "Tinjau indikator", "Atur proteksi", "Ekspor hasil"].map((name, index) => <div key={name} role="listitem" aria-current={index === completedSteps && completedSteps < 5 ? "step" : undefined} className={`pipeline-step ${index < completedSteps ? "done" : index === completedSteps && completedSteps < 5 ? "current" : ""}`}><span>{index < completedSteps ? "✓" : `0${index + 1}`}</span><div><b>{name}</b><small>{["CSV · TSV · GeoJSON · maks. 50 MB", "Validasi koordinat dan record", "Lokasi · waktu · atribut", "Pratinjau perubahan dan utilitas", "GeoJSON · CSV · laporan · manifest"][index]}</small></div></div>)}</div></article>
          </aside>
        </section>
        <section className="lower-grid">
          <article id="section-proteksi" className="panel protection-panel"><div className="panel-heading"><div><b>Proteksi &amp; utilitas</b><small>Pratinjau transformasi, tidak diterapkan otomatis</small></div><span className="count-pill">Lokal</span></div><div className="protection-body"><div className="privacy-slider"><label htmlFor="privacy-slider">Privasi <span aria-hidden="true">←</span></label><input id="privacy-slider" type="range" min="0" max="100" value={percent} onChange={(event) => { setPercent(Number(event.target.value)); setMapVersion(protectedData ? "compare" : "before"); }} disabled={!report} aria-describedby="privacy-map-hint" /><label htmlFor="privacy-slider"><span aria-hidden="true">→</span> Detail</label><small id="privacy-map-hint">{percent < 35 ? "Kuat" : percent < 70 ? "Sedang" : "Asli"} · {percent < 35 ? "perlindungan lebih kuat, detail lebih rendah" : percent < 70 ? "seimbangkan perlindungan dan detail" : "tanpa pembulatan koordinat"}{percent < 70 ? ` · pembulatan ${Math.max(4, decimals - (percent < 35 ? 1 : 0))} desimal (~${(111320 * 10 ** -Math.max(4, decimals - (percent < 35 ? 1 : 0))).toFixed(2)} m/lintang)` : ""}</small></div><div className="transform-options"><label><input type="checkbox" checked={aggregate} onChange={(event) => setAggregate(event.target.checked)} disabled={!report} /> Agregasi grid {options.gridSizeM} m</label><label><input type="checkbox" checked={jitter} onChange={(event) => setJitter(event.target.checked)} disabled={!report} /> Jitter terkontrol</label>{jitter && <label className="field-option">Radius jitter<select value={jitterRadius} onChange={(event) => setJitterRadius(Number(event.target.value) as 25 | 50 | 100 | 250)}><option value="25">25 m</option><option value="50">50 m</option><option value="100">100 m</option><option value="250">250 m</option></select></label>}<label className="field-option">Presisi koordinat<select value={decimals} onChange={(event) => setDecimals(Number(event.target.value))} disabled={!report}><option value="7">7 desimal</option><option value="6">6 desimal</option><option value="5">5 desimal</option><option value="4">4 desimal</option></select></label><label className="field-option">Generalisasi waktu<select value={generalize} onChange={(event) => setGeneralize(event.target.value as TransformConfig["timeGeneralization"] | "")} disabled={!report}><option value="">Tidak diubah</option><option value="15m">15 menit</option><option value="30m">30 menit</option><option value="1h">1 jam</option><option value="1d">1 hari</option></select></label></div></div>{jitter && <div className="seed-row"><label htmlFor="jitter-seed">Seed jitter (agar dapat diulang)</label><input id="jitter-seed" value={seed} onChange={(event) => setSeed(event.target.value)} /></div>}{dataset && report && <div className="remove-fields"><b>Kolom untuk dihapus (pilihan Anda)</b><div>{dataset.columns.filter((column) => !column.kind.startsWith("coordinate")).map((column) => <label key={column.name}><input type="checkbox" checked={pendingRemoved.includes(column.name)} onChange={(event) => setPendingRemoved(event.target.checked ? [...pendingRemoved, column.name] : pendingRemoved.filter((name) => name !== column.name))} />{column.name}</label>)}</div>{pendingRemoved.length > 0 && <div className="remove-confirm"><span>{pendingRemoved.length} kolom dipilih: {pendingRemoved.join(", ")}</span><button onClick={() => { const confirmed = window.confirm(`${pendingRemoved.length} kolom akan dihapus: ${pendingRemoved.join(", ")}. Lanjutkan?`); if (confirmed) setRemoved(pendingRemoved); }}>Konfirmasi penghapusan</button>{removed.length > 0 && <button onClick={() => { setRemoved([]); setPendingRemoved([]); }}>Batalkan penghapusan</button>}</div>}</div>}<div id="section-utilitas" className="preview-metrics"><span>Displacement rata-rata <b>{protectedData?.displacement.meanM.toFixed(1) ?? "—"} m</b></span><span>Maksimum <b>{protectedData?.displacement.maxM.toFixed(1) ?? "—"} m</b></span><span>Retensi record <b>{metrics ? `${(metrics.recordRetention * 100).toFixed(0)}%` : "—"}</b></span>          <span>Shift extent X/Y <b>{metrics ? `${metrics.extentShift.dxM.toFixed(1)} / ${metrics.extentShift.dyM.toFixed(1)} m` : "—"}</b></span><span>Shift centroid <b>{metrics?.centroidShiftM.toFixed(1) ?? "—"} m</b></span><span>Lokasi unik sebelum/sesudah <b>{metrics ? `${metrics.uniqueLocationsBefore} / ${metrics.uniqueLocationsAfter}` : "—"}</b></span><span>Ukuran kelompok minimum sesudah <b>{metrics?.minGroupSizeAfter ?? "—"}</b></span>{metrics?.attributePreservation.map((item) => <span key={item.column}>Retensi atribut {item.column} <b>{(item.retained * 100).toFixed(0)}%</b></span>)}</div></article>
          <ExportPanel available={Boolean(protectedData)} onExport={exportAll} />
        </section>
        <footer className="disclaimer"><b>CATATAN PENTING</b><span>{DISCLAIMER}</span></footer>
      </div>
    </main>
    <nav className="mobile-nav" aria-label="Navigasi bawah">{NAV.map((item, index) => <button key={item} aria-current={section === item ? "page" : undefined} className={section === item ? "active" : ""} onClick={() => navigateToSection(item)}><Icon name={NAV_ICONS[index]!} />{item}</button>)}</nav>
    <div className="sr-only" aria-live="polite">{busy ? "Analisis berjalan" : ""}</div>
    {mapping && dataset?.sourceText && dataset.sourceName && <MappingPanel columns={mapping.columns} onClose={() => setMapping(null)} onSubmit={(form) => {
      const latitude = String(form.get("lat") ?? "");
      const longitude = String(form.get("lon") ?? "");
      const time = String(form.get("time") ?? "") || undefined;
      try { loadDataset(parseDataset(dataset.sourceText!, dataset.sourceName!, { latitude, longitude, time })); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Pemetaan kolom tidak valid."); }
    }} />}
  </div>;
}

function MappingPanel({ columns, onClose, onSubmit }: { columns: string[]; onClose: () => void; onSubmit: (form: FormData) => void }) {
  return <div className="modal-backdrop"><form className="mapping-modal" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }}><button className="modal-close" type="button" onClick={onClose} aria-label="Tutup">×</button><h2>Pemetaan kolom koordinat</h2><p>Pilih kolom yang berisi bujur dan lintang. Dataset tetap diproses lokal.</p>{(["lon", "lat", "time"] as const).map((field) => <label key={field}>{field === "lon" ? "Longitude / Bujur" : field === "lat" ? "Latitude / Lintang" : "Waktu (opsional)"}<select name={field} required={field !== "time"} defaultValue=""><option value="">Pilih kolom</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>)}<button className="primary-button" type="submit">Gunakan pemetaan</button></form></div>;
}
