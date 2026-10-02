import Icon from "./Icon";

type ExportKind = "geojson" | "csv" | "report" | "manifest";

interface ExportPanelProps {
  available: boolean;
  onExport: (kind: ExportKind) => void;
}

export default function ExportPanel({ available, onExport }: ExportPanelProps) {
  const options: Array<[ExportKind, string, string]> = [
    ["geojson", "GeoJSON terlindungi", "file-geojson"],
    ["csv", "CSV terlindungi", "file-csv"],
    ["report", "Laporan HTML", "file-laporan"],
    ["manifest", "Manifest + SHA-256", "file-manifest"],
  ];
  return <article id="section-ekspor" className="panel export-panel">
    <div className="panel-heading"><div><b>Ekspor hasil</b><small>Versi terlindungi dan bukti metode</small></div></div>
    <div className="export-buttons">{options.map(([kind, label, icon]) => <button key={kind} onClick={() => onExport(kind)} disabled={!available}><Icon name={icon} />{label}</button>)}</div>
    <small className="export-note">Ekspor mencakup seluruh data, bukan hanya sampel tampilan.</small>
  </article>;
}
