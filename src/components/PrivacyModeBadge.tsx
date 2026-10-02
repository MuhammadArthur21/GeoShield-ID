interface PrivacyModeBadgeProps {
  language: "id" | "en";
  onLanguageChange: (language: "id" | "en") => void;
}

export default function PrivacyModeBadge({ language, onLanguageChange }: PrivacyModeBadgeProps) {
  return <div className="top-tools">
    <span className="privacy-badge" tabIndex={0} aria-describedby="privacy-badge-help"><i />{language === "id" ? "Privasi lokal" : "Local privacy"}<span id="privacy-badge-help" role="tooltip">{language === "id" ? "Data tidak meninggalkan perangkat ini." : "Your data stays on this device."}</span></span>
    <label className="language">Bahasa<select aria-label="Pilih bahasa" value={language} onChange={(event) => onLanguageChange(event.target.value as "id" | "en")}><option value="id">ID</option><option value="en">EN</option></select></label>
  </div>;
}
